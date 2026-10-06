// Records a full bot game on the Game Master screen to a video file.
// Usage: node tools/record.js [players] [eatenPerRound]
// Needs the server running locally (npm start) and Microsoft Edge installed.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { io } = require('socket.io-client');

const PLAYERS = Number(process.argv[2]) || 50;
const PER_ROUND = Number(process.argv[3]) || 10;
const URL = process.env.GAME_URL || 'http://localhost:3000';
const KEY = process.env.HOST_KEY || readKey();
const OUT_DIR = path.join(__dirname, '..', 'videos');

function readKey() {
  try { return fs.readFileSync(path.join(__dirname, '..', '.hostkey'), 'utf8').trim(); } catch { return 'shark'; }
}

const NAMES = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Faye', 'Gino', 'Hana', 'Ivan', 'Joy', 'Kiko', 'Lea', 'Migs', 'Nina', 'Oli', 'Pia', 'Quin', 'Rafa', 'Sam', 'Tina'];
const bots = [];
function spawnBots() {
  for (let i = 0; i < PLAYERS; i++) {
    const socket = io(URL, { transports: ['websocket'] });
    const name = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''}`;
    const speed = 5 + Math.random() * 9;
    let me = null;
    socket.on('connect', () => socket.emit('join', { id: 'rec' + String(i).padStart(6, '0'), name }, () => {}));
    socket.on('me', (m) => (me = m));
    const timer = setInterval(() => {
      if (!me || me.phase !== 'playing' || me.status !== 'alive') return;
      const rate = speed * (0.8 + Math.random() * 0.4);
      const n = Math.random() < (rate / 10) % 1 ? Math.ceil(rate / 10) : Math.floor(rate / 10);
      if (n > 0) socket.emit('tap', n);
    }, 100);
    bots.push({ socket, timer });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  await page.goto(`${URL}/host?key=${encodeURIComponent(KEY)}`);
  await page.waitForFunction(() => document.body.classList.contains('authed'), null, { timeout: 15000 });

  // fresh lobby, then let players trickle in
  await page.evaluate((n) => {
    Display.socket.emit('host:reset', () => {});
    Display.socket.emit('host:config', { elimPerRound: n });
  }, PER_ROUND);
  await page.evaluate(() => document.body.classList.add('hideControls'));
  spawnBots();
  console.log(`Recording: ${PLAYERS} players, ${PER_ROUND} eaten per round`);
  await sleep(6000);

  const start = () => page.evaluate(() => new Promise((r) => Display.socket.emit('host:start', r)));
  await start();
  let lastPhase = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 20 * 60 * 1000) {
    const s = await page.evaluate(() => {
      const st = Display.getState();
      return { phase: st.phase, round: st.round, alive: st.aliveCount };
    });
    if (s.phase !== lastPhase) {
      console.log(`${Math.round((Date.now() - t0) / 1000)}s  ${s.phase}  round ${s.round}  alive ${s.alive}`);
      lastPhase = s.phase;
      if (s.phase === 'roundOver') {
        await sleep(5000);
        await start();
      }
      if (s.phase === 'gameOver') {
        await sleep(9000);
        break;
      }
    }
    await sleep(250);
  }

  const video = page.video();
  await context.close();
  await browser.close();
  bots.forEach((b) => { clearInterval(b.timer); b.socket.close(); });

  const raw = await video.path();
  const final = path.join(OUT_DIR, `shark-bait-${PLAYERS}-players.webm`);
  try { fs.unlinkSync(final); } catch {}
  fs.renameSync(raw, final);
  console.log(`Saved ${final}`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
