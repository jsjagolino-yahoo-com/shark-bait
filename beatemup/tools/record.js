// Records a full bot game on the Game Master screen to a video file.
// Usage: node tools/record.js [players]
// Needs the server running locally (npm start) and Microsoft Edge installed.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const PLAYERS = Number(process.argv[2]) || 30;
const URL = process.env.GAME_URL || 'http://localhost:3001';
const KEY = process.env.HOST_KEY || 'beatemup';
const OUT_DIR = path.join(__dirname, '..', 'videos');
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
  await page.evaluate(() => {
    Display.socket.emit('host:reset', () => {});
    document.body.classList.add('hideControls');
  });

  const bots = spawn(process.execPath, [path.join(__dirname, 'bots.js'), String(PLAYERS), URL], { stdio: 'ignore' });
  console.log(`Recording: ${PLAYERS} fighters`);
  await sleep(8000); // lobby: players join and practice

  const start = () => page.evaluate(() => new Promise((r) => Display.socket.emit('host:start', r)));
  await start();
  let lastTag = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60 * 1000) {
    const s = await page.evaluate(() => {
      const st = Display.getState();
      return { phase: st.phase, round: st.round, alive: st.aliveCount };
    });
    const tag = s.phase + s.round;
    if (tag !== lastTag) {
      lastTag = tag;
      console.log(`${Math.round((Date.now() - t0) / 1000)}s  ${s.phase}  round ${s.round}  alive ${s.alive}`);
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
  bots.kill();

  const final = path.join(OUT_DIR, `beat-em-up-${PLAYERS}-players.webm`);
  try { fs.unlinkSync(final); } catch {}
  fs.renameSync(await video.path(), final);
  console.log(`Saved ${final}`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
