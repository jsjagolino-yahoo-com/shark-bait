// Rehearsal helper: spawns fake fighters that chase the nearest opponent and swing.
// Usage: node tools/bots.js [count] [serverUrl]
const { io } = require('socket.io-client');

const count = Number(process.argv[2]) || 20;
const url = process.argv[3] || 'http://localhost:3001';
const NAMES = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Faye', 'Gino', 'Hana', 'Ivan', 'Joy', 'Kiko', 'Lea', 'Migs', 'Nina', 'Oli', 'Pia', 'Quin', 'Rafa', 'Sam', 'Tina'];

// one observer socket sees the whole arena
let world = null;
const eye = io(url, { transports: ['websocket'] });
eye.on('connect', () => eye.emit('screen:join'));
eye.on('state', (s) => (world = s));

for (let i = 0; i < count; i++) {
  const id = 'bubot' + String(i).padStart(6, '0');
  const socket = io(url, { transports: ['websocket'] });
  const name = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''} 🤖`;
  const skill = 0.4 + Math.random() * 0.6; // how often it makes a good decision
  let last = '';
  socket.on('connect', () => socket.emit('join', { id, name }, () => {}));
  setInterval(() => {
    if (!world) return;
    const meRow = world.players.find((p) => p[0] === id);
    const active = meRow && ((world.phase === 'fighting' && meRow[6] === 1) || (world.phase === 'lobby' && meRow[6] === 0));
    if (!active) {
      if (last !== '0,0') socket.emit('input', { dx: 0, dy: 0 });
      last = '0,0';
      return;
    }
    const [, , x, y] = meRow;
    let dx = 0, dy = 0;
    if (world.phase === 'lobby' || Math.random() > skill) {
      dx = Math.round(Math.random() * 2 - 1);
      dy = Math.round(Math.random() * 2 - 1);
    } else {
      // head for the arena center if outside the shrinking ring, else chase the nearest fighter
      const r = world.ring;
      let tx, ty;
      if (r && (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1)) {
        tx = (r.x0 + r.x1) / 2;
        ty = (r.y0 + r.y1) / 2;
      } else {
        let best = null, bd = Infinity;
        for (const p of world.players) {
          if (p[0] === id || p[6] !== 1) continue;
          const d = Math.hypot(p[2] - x, (p[3] - y) * 2);
          if (d < bd) { bd = d; best = p; }
        }
        if (!best) return;
        tx = best[2] - Math.sign(best[2] - x || 1) * 60; // stand just in front of them
        ty = best[3];
        const ahead = Math.abs(best[2] - x);
        if (ahead < 100 && Math.abs(best[3] - y) < 35 && Math.random() < 0.7) socket.emit('attack');
        if (ahead < 70 && Math.abs(best[3] - y) < 35) tx = best[2]; // turn to face
      }
      dx = Math.abs(tx - x) > 12 ? Math.sign(tx - x) : 0;
      dy = Math.abs(ty - y) > 10 ? Math.sign(ty - y) : 0;
    }
    if (world.phase === 'lobby' && Math.random() < 0.05) socket.emit('attack');
    const key = dx + ',' + dy;
    if (key !== last) socket.emit('input', { dx, dy });
    last = key;
  }, 150);
}
console.log(`Spawned ${count} fighter bots against ${url}`);
