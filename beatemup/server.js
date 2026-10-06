'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 3001;
const HOST_KEY = process.env.HOST_KEY || 'beatemup';

// ---- Game tuning --------------------------------------------------------
// The arena is a side-view brawler floor: x = left/right, y = depth (0 = back wall).
const TICK_MS = 50;              // 20 Hz
const PHONE_EVERY = 2;           // phones get updates at 10 Hz
const ARENA_W = 1600;
const ARENA_D = 500;
const SPEED_X = 330;             // units/sec
const SPEED_Y = 220;
const MAX_HP = 150;
const DMG_MIN = 9;
const DMG_MAX = 13;
const REACH = 105;               // how far in front the stick reaches
const DEPTH_REACH = 42;          // how far up/down the floor a hit still lands
const ATTACK_COOLDOWN_MS = 380;
const HITSTUN_MS = 220;
const KNOCKBACK = 45;
const COUNTDOWN_MS = 3000;
const SHRINK_AFTER_MS = 45000;   // arena starts closing after this long
const SHRINK_DURATION_MS = 45000;
const SHRINK_MIN = 0.22;         // final arena size (fraction)
const RING_DPS = 12;             // damage/sec outside the arena
const NAME_MAX = 16;
const FEED_MAX = 12;
const ANIMALS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐺', '🐗', '🦄', '🦉', '🐴', '🐲', '🦝'];

const STATUS = { waiting: 0, alive: 1, dead: 2, spectator: 3 };

// ---- HTTP ---------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/qr.svg', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 300);
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#1a1030', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  } catch {
    res.status(400).end();
  }
});

app.get('/api/info', (req, res) => {
  res.json({ lan: lanAddresses().map((ip) => `http://${ip}:${PORT}`), animals: ANIMALS, arena: { w: ARENA_W, d: ARENA_D } });
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// ---- Game state ---------------------------------------------------------
const game = {
  phase: 'lobby', // lobby | countdown | fighting | gameOver
  countdownEnd: 0,
  fightStart: 0,
  ring: null,     // {x0, x1, y0, y1} when the arena is shrinking
  feed: [],       // newest first: {k, ka, v, va}
  winner: null,
};
const players = new Map();

const alivePlayers = () => [...players.values()].filter((p) => p.status === 'alive');
const fighters = () => [...players.values()].filter((p) => p.status === 'alive' || p.status === 'dead');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

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

function pickAnimal() {
  const used = new Map();
  for (const p of players.values()) used.set(p.animal, (used.get(p.animal) || 0) + 1);
  const least = Math.min(...ANIMALS.map((_, i) => used.get(i) || 0));
  const options = ANIMALS.map((_, i) => i).filter((i) => (used.get(i) || 0) === least);
  return options[Math.floor(Math.random() * options.length)];
}

function placeRandomly(p) {
  p.x = rand(80, ARENA_W - 80);
  p.y = rand(40, ARENA_D - 40);
  p.facing = Math.random() < 0.5 ? -1 : 1;
}

function resetFighter(p) {
  p.hp = MAX_HP;
  p.kills = 0;
  p.place = null;
  p.killer = null;
  p.dx = 0;
  p.dy = 0;
  p.nextAttack = 0;
  p.stunUntil = 0;
}

function startGame() {
  for (const [id, p] of players) if (!p.connected) players.delete(id);
  const roster = [...players.values()];
  if (roster.length < 2) return 'Need at least 2 connected players to start.';
  // spread fighters out on a loose grid so nobody spawns on top of each other
  const cols = Math.ceil(Math.sqrt(roster.length * (ARENA_W / ARENA_D)));
  const rows = Math.ceil(roster.length / cols);
  roster.sort(() => Math.random() - 0.5).forEach((p, i) => {
    resetFighter(p);
    p.status = 'alive';
    const c = i % cols;
    const r = Math.floor(i / cols);
    p.x = ((c + 0.5) / cols) * (ARENA_W - 120) + 60 + rand(-15, 15);
    p.y = ((r + 0.5) / rows) * (ARENA_D - 60) + 30 + rand(-8, 8);
    p.facing = p.x < ARENA_W / 2 ? 1 : -1;
  });
  game.feed = [];
  game.winner = null;
  game.ring = null;
  game.phase = 'countdown';
  game.countdownEnd = Date.now() + COUNTDOWN_MS;
  pushAll();
  return null;
}

function resetToLobby() {
  for (const [id, p] of players) {
    if (!p.connected) {
      players.delete(id);
      continue;
    }
    resetFighter(p);
    p.status = 'waiting';
    placeRandomly(p);
  }
  Object.assign(game, { phase: 'lobby', ring: null, feed: [], winner: null });
  pushAll();
}

function knockOut(victim, killer, now) {
  victim.place = alivePlayers().length;
  victim.hp = 0;
  victim.status = 'dead';
  victim.dx = 0;
  victim.dy = 0;
  victim.killer = killer ? killer.name : 'the shrinking arena';
  if (killer) killer.kills++;
  const entry = {
    k: killer ? killer.name : null,
    ka: killer ? killer.animal : null,
    v: victim.name,
    va: victim.animal,
  };
  game.feed.unshift(entry);
  game.feed.length = Math.min(game.feed.length, FEED_MAX);
  io.to('screens').emit('ko', { ...entry, id: victim.id });
  sendMe(victim);
  checkEnd();
}

function checkEnd() {
  if (game.phase !== 'fighting') return;
  const alive = alivePlayers();
  if (alive.length <= 1) {
    game.phase = 'gameOver';
    const w = alive[0];
    if (w) {
      w.place = 1;
      w.dx = 0;
      w.dy = 0;
    }
    game.winner = w ? { name: w.name, animal: w.animal, kills: w.kills, hp: Math.ceil(w.hp) } : null;
    pushAll();
  }
}

function attack(p, now) {
  const canSwing = (game.phase === 'lobby' && p.status === 'waiting') || (game.phase === 'fighting' && p.status === 'alive');
  if (!canSwing || now < p.nextAttack || now < p.stunUntil) return;
  p.nextAttack = now + ATTACK_COOLDOWN_MS;
  p.swings++;
  if (game.phase !== 'fighting') return; // practice swings in the lobby do no damage
  for (const t of alivePlayers()) {
    if (t === p) continue;
    const ahead = (t.x - p.x) * p.facing;
    if (ahead > -15 && ahead < REACH && Math.abs(t.y - p.y) < DEPTH_REACH) {
      t.hp -= Math.round(rand(DMG_MIN, DMG_MAX));
      t.hits++;
      t.stunUntil = now + HITSTUN_MS;
      t.x = clamp(t.x + p.facing * KNOCKBACK, 20, ARENA_W - 20);
      if (t.hp <= 0) knockOut(t, p, now);
      if (game.phase !== 'fighting') return;
    }
  }
}

function updateRing(now) {
  const elapsed = now - game.fightStart;
  if (elapsed < SHRINK_AFTER_MS) {
    game.ring = null;
    return;
  }
  const k = Math.min(1, (elapsed - SHRINK_AFTER_MS) / SHRINK_DURATION_MS);
  const m = (k * (1 - SHRINK_MIN)) / 2;
  game.ring = { x0: ARENA_W * m, x1: ARENA_W * (1 - m), y0: ARENA_D * m, y1: ARENA_D * (1 - m) };
}

const outsideRing = (p) => game.ring && (p.x < game.ring.x0 || p.x > game.ring.x1 || p.y < game.ring.y0 || p.y > game.ring.y1);

function step(dt, now) {
  const moving = game.phase === 'fighting' ? alivePlayers() : [...players.values()].filter((p) => p.status === 'waiting');
  for (const p of moving) {
    if (now < p.stunUntil) continue;
    let { dx, dy } = p;
    if (dx && dy) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }
    p.x = clamp(p.x + dx * SPEED_X * dt, 20, ARENA_W - 20);
    p.y = clamp(p.y + dy * SPEED_Y * dt, 0, ARENA_D);
    if (p.dx) p.facing = p.dx > 0 ? 1 : -1;
  }
  if (game.phase !== 'fighting') return;

  updateRing(now);
  if (!game.ring) return;
  const alive = alivePlayers();
  const dying = [];
  for (const p of alive) {
    if (!outsideRing(p)) continue;
    p.hp -= RING_DPS * dt;
    if (p.hp <= 0) dying.push(p);
  }
  // The arena never knocks out the very last fighters at once: spare the healthiest.
  if (dying.length && dying.length >= alive.length) {
    dying.sort((a, b) => b.hp - a.hp);
    dying.shift().hp = 1;
  }
  for (const p of dying) knockOut(p, null, now);
}

// ---- Broadcasting -------------------------------------------------------
function screenState() {
  const now = Date.now();
  return {
    phase: game.phase,
    countdownMs: Math.max(0, game.countdownEnd - now),
    shrinkInMs: game.phase === 'fighting' ? Math.max(0, game.fightStart + SHRINK_AFTER_MS - now) : null,
    ring: game.ring,
    feed: game.feed,
    winner: game.winner,
    aliveCount: alivePlayers().length,
    total: fighters().length,
    arena: { w: ARENA_W, d: ARENA_D, maxHp: MAX_HP },
    // [id, name, x, y, hp, facing, status, animal, hue, swings, hits, connected, kills, place, moving]
    players: [...players.values()].map((p) => [
      p.id,
      p.name,
      Math.round(p.x),
      Math.round(p.y),
      Math.max(0, Math.ceil(p.hp)),
      p.facing,
      STATUS[p.status],
      p.animal,
      p.hue,
      p.swings,
      p.hits,
      p.connected ? 1 : 0,
      p.kills,
      p.place || 0,
      p.dx || p.dy ? 1 : 0,
    ]),
  };
}

function sendMe(p) {
  if (!p.sid) return;
  io.to(p.sid).emit('me', {
    name: p.name,
    animal: ANIMALS[p.animal],
    hue: p.hue,
    phase: game.phase,
    status: p.status,
    hp: Math.max(0, Math.ceil(p.hp)),
    maxHp: MAX_HP,
    kills: p.kills,
    place: p.place || 0,
    killer: p.killer,
    aliveCount: alivePlayers().length,
    total: fighters().length,
    countdownMs: Math.max(0, game.countdownEnd - Date.now()),
    shrinkInMs: game.phase === 'fighting' ? Math.max(0, game.fightStart + SHRINK_AFTER_MS - Date.now()) : null,
    outside: !!outsideRing(p) && p.status === 'alive',
    winner: game.winner ? game.winner.name : null,
  });
}

function pushScreens() {
  io.to('screens').emit('state', screenState());
}

function pushAll() {
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
    game.phase = 'fighting';
    game.fightStart = now;
    pushAll();
    return;
  }
  if (game.phase === 'lobby' || game.phase === 'fighting') step(dt, now);

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
    const name = cleanName(msg && msg.name);
    if (!name) return ack({ error: 'Please enter a name.' });
    let id = String((msg && msg.id) || '');
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
        animal: pickAnimal(),
        hue: Math.floor(Math.random() * 360),
        swings: 0,
        hits: 0,
      };
      resetFighter(p);
      placeRandomly(p);
      players.set(id, p);
    }
    socket.data.playerId = id;
    ack({ ok: true, id, name: p.name });
    sendMe(p);
    pushScreens();
  });

  socket.on('input', (d) => {
    const p = me();
    if (!p || !d) return;
    p.dx = Math.sign(Number(d.dx) || 0);
    p.dy = Math.sign(Number(d.dy) || 0);
  });

  socket.on('attack', () => {
    const p = me();
    if (p) attack(p, Date.now());
  });

  socket.on('leave', () => {
    const p = me();
    if (!p) return;
    if (game.phase === 'lobby' || p.status !== 'alive') players.delete(p.id);
    else {
      p.connected = false;
      p.dx = 0;
      p.dy = 0;
    }
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
    if (game.phase !== 'lobby') return { error: 'Reset to the lobby first.' };
    const err = startGame();
    return err ? { error: err } : null;
  }));

  socket.on('host:reset', hostOnly(() => resetToLobby()));

  socket.on('host:kick', hostOnly((id) => {
    const p = players.get(String(id));
    if (!p) return;
    players.delete(p.id);
    if (p.sid) io.to(p.sid).emit('kicked');
    checkEnd();
    pushAll();
  }));

  socket.on('disconnect', () => {
    const p = me();
    if (p && p.sid === socket.id) {
      p.connected = false;
      p.dx = 0;
      p.dy = 0;
      pushScreens();
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🥊  Beat 'Em Up is running on port ${PORT}\n`);
  console.log(`   Players join:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`                   http://${ip}:${PORT}`);
  console.log(`   Big screen:     http://localhost:${PORT}/screen`);
  console.log(`   Game master:    http://localhost:${PORT}/host?key=${HOST_KEY}`);
  console.log(`\n   (set HOST_KEY env var to change the game master password)\n`);
});
