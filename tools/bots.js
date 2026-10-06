// Rehearsal helper: spawns fake players that tap at different speeds.
// Usage: node tools/bots.js [count] [serverUrl]
const { io } = require('socket.io-client');

const count = Number(process.argv[2]) || 20;
const url = process.argv[3] || 'http://localhost:3000';
const NAMES = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Faye', 'Gino', 'Hana', 'Ivan', 'Joy', 'Kiko', 'Lea', 'Migs', 'Nina', 'Oli', 'Pia', 'Quin', 'Rafa', 'Sam', 'Tina'];

for (let i = 0; i < count; i++) {
  const socket = io(url, { transports: ['websocket'] });
  const id = 'bot' + String(i).padStart(6, '0');
  const name = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''} 🤖`;
  // each bot has its own stamina: taps/sec it can sustain, with some wobble
  const speed = 5 + Math.random() * 9;
  let me = null;
  socket.on('connect', () => socket.emit('join', { id, name }, () => {}));
  socket.on('me', (m) => (me = m));
  setInterval(() => {
    if (!me || me.phase !== 'playing' || me.status !== 'alive') return;
    const rate = speed * (0.8 + Math.random() * 0.4);
    const n = Math.random() < (rate / 10) % 1 ? Math.ceil(rate / 10) : Math.floor(rate / 10);
    if (n > 0) socket.emit('tap', n);
  }, 100);
}
console.log(`Spawned ${count} bots against ${url}`);
