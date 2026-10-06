'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || 'shark';

// ---- Game tuning --------------------------------------------------------
// Depth runs from 0 (surface) to DEATH_DEPTH (shark's jaws).
const TICK_MS = 50;            // physics at 20 Hz
const PHONE_EVERY = 2;         // phones get updates at 10 Hz
const START_DEPTH = 40;
const DEATH_DEPTH = 100;
const BASE_SINK = 10;          // depth/sec pulled down at round start
const SINK_RAMP = 0.35;        // extra depth/sec added every second (rounds always end)
const TAP_LIFT = 2.5;          // depth/sec of lift per tap-per-second
const MAX_TAP_RATE = 16;       // taps/sec cap (anti-cheat; also guarantees rounds end)
const COUNTDOWN_MS = 3000;
const NAME_MAX = 16;

const STATUS = { waiting: 0, alive: 1, eaten: 2, spectator: 3 };

// ---- HTTP ---------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/qr.svg', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 300);
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#04263f', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  } catch {
    res.status(400).end();
  }
});

app.get('/api/info', (req, res) => {
  res.json({ lan: lanAddresses().map((ip) => `http://${ip}:${PORT}`) });
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// ---- Game state ---------------------------------------------------------
const game = {
  phase: 'lobby', // lobby | countdown | playing | roundOver | gameOver
  round: 0,
  elimPerRound: 5,
  quota: 0,
  kills: 0,
  sink: BASE_SINK,
  roundStart: 0,
  countdownEnd: 0,
  eatenThisRound: [],
  winner: null,
  focus: true,
};
const players = new Map(); // id -> player

const alivePlayers = () => [...players.values()].filter((p) => p.status === 'alive');

function cleanName(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

function uniqueName(name, selfId) {
  const taken = new Set([...players.values()].filter((p) => p.id !== selfId).map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, NAME_MAX - 3)} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function assignLanes(list) {
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  shuffled.forEach((p, i) => {
    p.lane = (i + 0.5) / shuffled.length + (Math.random() - 0.5) * (0.6 / shuffled.length);
  });
}

function startGame() {
  for (const [id, p] of players) {
    if (!p.connected) players.delete(id);
  }
  const roster = [...players.values()];
  if (roster.length < 2) return 'Need at least 2 connected players to start.';
  for (const p of roster) {
    p.status = 'alive';
    p.place = null;
    p.eatenRound = null;
  }
  game.round = 0;
  game.winner = null;
  beginCountdown();
  return null;
}

function beginCountdown() {
  const alive = alivePlayers();
  game.round++;
  game.quota = Math.min(game.elimPerRound, alive.length - 1);
  game.kills = 0;
  game.eatenThisRound = [];
  game.sink = BASE_SINK;
  for (const p of alive) {
    p.y = START_DEPTH;
    p.rate = 0;
    p.pending = 0;
  }
  assignLanes(alive);
  game.phase = 'countdown';
  game.countdownEnd = Date.now() + COUNTDOWN_MS;
  pushAll();
}

function resetToLobby() {
  for (const [id, p] of players) {
    if (!p.connected) {
      players.delete(id);
      continue;
    }
    p.status = 'waiting';
    p.y = START_DEPTH;
    p.rate = 0;
    p.pending = 0;
    p.place = null;
    p.eatenRound = null;
    p.lane = Math.random();
  }
  Object.assign(game, { phase: 'lobby', round: 0, quota: 0, kills: 0, eatenThisRound: [], winner: null, sink: BASE_SINK });
  pushAll();
}

function eat(p) {
  p.place = alivePlayers().length; // finishing position (1 = winner)
  p.status = 'eaten';
  p.eatenRound = game.round;
  p.y = DEATH_DEPTH;
  game.kills++;
  game.eatenThisRound.push(p.name);
  io.to('screens').emit('eaten', { id: p.id, name: p.name, lane: p.lane });
  sendMe(p);
}

function checkRoundEnd() {
  if (game.phase !== 'playing' && game.phase !== 'countdown') return;
  const alive = alivePlayers();
  // Never require more kills than would leave one survivor (e.g. after a kick).
  game.quota = Math.min(game.quota, game.kills + Math.max(0, alive.length - 1));
  if (game.kills >= game.quota || alive.length <= 1) endRound();
}

function endRound() {
  const alive = alivePlayers();
  if (alive.length <= 1) {
    game.phase = 'gameOver';
    const w = alive[0];
    if (w) w.place = 1;
    game.winner = w ? { id: w.id, name: w.name } : null;
  } else {
    game.phase = 'roundOver';
  }
  pushAll();
}

function step(dt, now) {
  const t = (now - game.roundStart) / 1000;
  game.sink = BASE_SINK + SINK_RAMP * t;
  const doomed = [];
  for (const p of alivePlayers()) {
    const instRate = p.pending / dt;
    p.pending = 0;
    p.rate = Math.min(MAX_TAP_RATE, p.rate * 0.85 + instRate * 0.15);
    p.y += (game.sink - p.rate * TAP_LIFT) * dt;
    if (p.y < 0) p.y = 0;
    if (p.y >= DEATH_DEPTH) doomed.push(p);
  }
  // Deepest goes first; only up to the round's quota get eaten.
  doomed.sort((a, b) => b.y - a.y || Math.random() - 0.5);
  for (const p of doomed) {
    if (game.kills < game.quota) eat(p);
    else p.y = DEATH_DEPTH - 0.01;
  }
  if (game.kills >= game.quota) endRound();
}

function rankAlive() {
  alivePlayers()
    .sort((a, b) => b.y - a.y)
    .forEach((p, i) => (p.rank = i + 1));
}

// ---- Broadcasting -------------------------------------------------------
function screenState() {
  return {
    phase: game.phase,
    round: game.round,
    quota: game.quota,
    kills: game.kills,
    sink: Math.round(game.sink * 10) / 10,
    countdownMs: Math.max(0, game.countdownEnd - Date.now()),
    eatenThisRound: game.eatenThisRound,
    winner: game.winner,
    elimPerRound: game.elimPerRound,
    focus: game.focus,
    aliveCount: alivePlayers().length,
    // [id, name, depth, statusCode, lane, connected, place]
    players: [...players.values()].map((p) => [
      p.id,
      p.name,
      Math.round(p.y * 10) / 10,
      STATUS[p.status],
      Math.round(p.lane * 1000) / 1000,
      p.connected ? 1 : 0,
      p.place || 0,
    ]),
  };
}

function sendMe(p) {
  if (!p.sid) return;
  io.to(p.sid).emit('me', {
    name: p.name,
    phase: game.phase,
    status: p.status,
    y: Math.round(p.y * 10) / 10,
    rank: p.status === 'alive' ? p.rank || 0 : 0,
    place: p.place || 0,
    eatenRound: p.eatenRound || 0,
    round: game.round,
    quota: game.quota,
    kills: game.kills,
    aliveCount: alivePlayers().length,
    countdownMs: Math.max(0, game.countdownEnd - Date.now()),
    winner: game.winner ? game.winner.name : null,
  });
}

function pushScreens() {
  io.to('screens').emit('state', screenState());
}

function pushAll() {
  rankAlive();
  pushScreens();
  for (const p of players.values()) if (p.connected) sendMe(p);
}

// ---- Main loop ----------------------------------------------------------
let tickNo = 0;
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  tickNo++;

  if (game.phase === 'countdown' && now >= game.countdownEnd) {
    game.phase = 'playing';
    game.roundStart = now;
    for (const p of alivePlayers()) p.pending = 0;
    pushAll();
    return;
  }
  if (game.phase === 'playing') step(dt, now);

  rankAlive();
  pushScreens();
  if (tickNo % PHONE_EVERY === 0) {
    for (const p of players.values()) if (p.connected) sendMe(p);
  }
}, TICK_MS);

// ---- Sockets ------------------------------------------------------------
io.on('connection', (socket) => {
  const me = () => players.get(socket.data.playerId);

  socket.on('join', (msg = {}, ack = () => {}) => {
    if (typeof ack !== 'function') ack = () => {};
    const name = cleanName(msg.name);
    if (!name) return ack({ error: 'Please enter a name.' });
    let id = String(msg.id || '');
    if (!/^[A-Za-z0-9-]{8,40}$/.test(id)) id = crypto.randomUUID();

    let p = players.get(id);
    if (p) {
      p.sid = socket.id;
      p.connected = true;
      if (game.phase === 'lobby') p.name = uniqueName(name, id);
    } else {
      p = {
        id,
        name: uniqueName(name, id),
        sid: socket.id,
        connected: true,
        status: game.phase === 'lobby' ? 'waiting' : 'spectator',
        y: START_DEPTH,
        rate: 0,
        pending: 0,
        lane: Math.random(),
        place: null,
        eatenRound: null,
        rank: 0,
      };
      players.set(id, p);
    }
    socket.data.playerId = id;
    ack({ ok: true, id, name: p.name });
    sendMe(p);
    pushScreens();
  });

  socket.on('tap', (n) => {
    const p = me();
    if (!p || p.status !== 'alive' || game.phase !== 'playing') return;
    n = Math.floor(Number(n)) || 0;
    p.pending += Math.max(0, Math.min(n, 10));
  });

  socket.on('leave', () => {
    const p = me();
    if (!p) return;
    if (game.phase === 'lobby' || p.status !== 'alive') players.delete(p.id);
    else p.connected = false; // alive players who quit just stop swimming...
    socket.data.playerId = null;
    pushScreens();
  });

  socket.on('screen:join', () => {
    socket.join('screens');
    socket.emit('state', screenState());
  });

  socket.on('host:auth', (key, ack) => {
    const ok = typeof key === 'string' && key === HOST_KEY;
    if (ok) {
      socket.data.host = true;
      socket.join('screens');
      socket.emit('state', screenState());
    }
    if (typeof ack === 'function') ack({ ok });
  });

  const hostOnly = (fn) => (...args) => {
    if (!socket.data.host) return;
    const ack = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
    ack(fn(...args) || {});
  };

  socket.on('host:start', hostOnly(() => {
    if (game.phase === 'lobby') {
      const err = startGame();
      return err ? { error: err } : null;
    }
    if (game.phase === 'roundOver') return beginCountdown();
    return { error: 'A round is already running.' };
  }));

  socket.on('host:reset', hostOnly(() => resetToLobby()));

  socket.on('host:kick', hostOnly((id) => {
    const p = players.get(String(id));
    if (!p) return;
    players.delete(p.id);
    if (p.sid) io.to(p.sid).emit('kicked');
    checkRoundEnd();
    pushAll();
  }));

  socket.on('host:config', hostOnly((cfg = {}) => {
    const n = Math.floor(Number(cfg.elimPerRound));
    if (n >= 1 && n <= 50) game.elimPerRound = n;
    if (typeof cfg.focus === 'boolean') game.focus = cfg.focus;
    pushScreens();
  }));

  socket.on('disconnect', () => {
    const p = me();
    if (p && p.sid === socket.id) {
      p.connected = false;
      pushScreens();
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🦈  Shark Bait is running on port ${PORT}\n`);
  console.log(`   Players join:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`                   http://${ip}:${PORT}`);
  console.log(`   Big screen:     http://localhost:${PORT}/screen`);
  console.log(`   Game master:    http://localhost:${PORT}/host?key=${HOST_KEY}`);
  console.log(`\n   (set HOST_KEY env var to change the game master password)\n`);
});
