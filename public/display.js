// Big-screen view: renders the sea, follows the fish closest to death.
(function () {
  const role = document.body.dataset.role; // "screen" or "host"
  const socket = io({ transports: ['websocket', 'polling'] });
  if (role === 'screen') socket.on('connect', () => socket.emit('screen:join'));

  // ---- DOM scaffold --------------------------------------------------------
  document.body.insertAdjacentHTML('beforeend', `
    <canvas id="sea"></canvas>
    <div id="hud" class="hidden">
      <div class="hudBox"><span class="lbl">Round</span><span id="hRound">1</span></div>
      <div class="hudBox wide"><span class="lbl">Eaten this round</span><span id="hKills">0 / 5</span></div>
      <div class="hudBox"><span class="lbl">Alive</span><span id="hAlive">0</span></div>
    </div>
    <aside id="danger" class="panel hidden">
      <h3>⚠ Danger Zone</h3>
      <ol id="dangerList"></ol>
    </aside>
    <div id="banner" class="hidden"></div>
    <div id="center"></div>
    <div id="toasts"></div>
    <div id="offline" class="hidden">Connecting to game server…</div>
  `);

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  socket.on('connect', () => $('offline').classList.add('hidden'));
  socket.on('disconnect', () => $('offline').classList.remove('hidden'));

  // ---- Sound (works after any click on the page) -----------------------------
  let audio = null;
  document.addEventListener('pointerdown', () => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
    } catch {}
  });
  function tone(freq, dur, type = 'square', vol = 0.15, slide = 0) {
    if (!audio || audio.state !== 'running') return;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audio.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, audio.currentTime + dur);
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
  }

  // ---- Canvas ----------------------------------------------------------------
  const canvas = $('sea');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
  }
  window.addEventListener('resize', resize);
  resize();

  const font = getComputedStyle(document.body).fontFamily;
  const laneX = (lane) => W * 0.07 + lane * W * 0.86;

  // ---- State -----------------------------------------------------------------
  let state = null;
  const fish = new Map();
  const shark = { x: 0, dir: 1, mouth: 0, lunge: null };
  const particles = [];
  const confetti = [];
  const cam = { x: 0, y: 0, z: 1 };
  let countdownEnd = 0;
  let domDirty = true;
  let lastBeep = 0;

  socket.on('state', (s) => {
    const prevPhase = state && state.phase;
    state = s;
    const seen = new Set();
    for (const [id, name, depth, status, lane, connected, place] of s.players) {
      seen.add(id);
      let f = fish.get(id);
      if (!f) {
        const h = Art.hash(id);
        f = { id, hue: Art.hueOf(id), seed: (h % 1000) / 159, idle: 12 + (h % 55), d: 40, x: laneX(lane) };
        fish.set(id, f);
      }
      if (f.status === 2 && status !== 2) f.eatenAt = 0;
      Object.assign(f, { name, depth, status, lane, connected, place });
    }
    for (const id of fish.keys()) if (!seen.has(id)) fish.delete(id);
    if (s.phase === 'countdown') countdownEnd = performance.now() + s.countdownMs;
    if (s.phase !== prevPhase) onPhase(s.phase);
    domDirty = true;
  });

  socket.on('eaten', (e) => {
    const f = fish.get(e.id);
    const x = laneX(e.lane);
    if (f) {
      f.eatenAt = performance.now();
      f.eatX = f.x;
      f.eatY = Art.depthToY(f.d, H);
    }
    shark.lunge = { x, t: performance.now() };
    const sy = Art.depthToY(100, H);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 240;
      particles.push({ x, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 1, r: 2 + Math.random() * 5, red: Math.random() < 0.5 });
    }
    toast(`🦈 ${e.name} was eaten!`);
    tone(140, 0.25, 'sawtooth', 0.25, 50);
    setTimeout(() => tone(90, 0.3, 'square', 0.2, 40), 120);
  });

  function onPhase(phase) {
    if (phase === 'gameOver') {
      for (let i = 0; i < 260; i++) {
        confetti.push({
          x: Math.random() * W, y: -Math.random() * H, vy: 80 + Math.random() * 160,
          vx: (Math.random() - 0.5) * 60, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8,
          hue: Math.random() * 360, w: 6 + Math.random() * 8,
        });
      }
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.2), i * 140));
    }
    if (phase === 'playing') tone(880, 0.35, 'square', 0.15);
    if (phase !== 'gameOver') confetti.length = 0;
    lobbySig = '';
  }

  function toast(text) {
    const t = el('div', 'toast', text);
    $('toasts').prepend(t);
    while ($('toasts').children.length > 5) $('toasts').lastChild.remove();
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  // ---- DOM overlays ----------------------------------------------------------
  let lobbySig = '';
  let joinUrl = location.origin + '/';
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    fetch('/api/info').then((r) => r.json()).then((info) => {
      if (info.lan && info.lan[0]) {
        joinUrl = info.lan[0] + '/';
        lobbySig = '';
        domDirty = true;
      }
    }).catch(() => {});
  }

  function aliveSorted() {
    return [...fish.values()].filter((f) => f.status === 1).sort((a, b) => b.d - a.d);
  }

  function renderDom() {
    if (!state) return;
    const s = state;
    const inRound = s.phase === 'countdown' || s.phase === 'playing' || s.phase === 'roundOver';
    $('hud').classList.toggle('hidden', !inRound);
    $('danger').classList.toggle('hidden', s.phase !== 'playing');
    $('hRound').textContent = s.round;
    $('hKills').textContent = `${s.kills} / ${s.quota}`;
    $('hAlive').textContent = s.aliveCount;

    // danger list
    if (s.phase === 'playing') {
      const list = $('dangerList');
      list.textContent = '';
      const left = Math.max(1, s.quota - s.kills);
      aliveSorted().slice(0, 6).forEach((f, i) => {
        const li = el('li', i < left ? 'hot' : '');
        li.append(el('span', 'dn', f.name));
        const bar = el('span', 'bar');
        const fill = el('i');
        fill.style.width = Math.min(100, Math.max(0, f.depth)) + '%';
        bar.append(fill);
        li.append(bar);
        list.append(li);
      });
    }

    const c = $('center');
    if (s.phase === 'lobby') {
      const waiting = s.players.filter((p) => p[3] === 0);
      const sig = 'lobby|' + joinUrl + '|' + waiting.map((p) => p[1] + p[5]).join(',');
      if (sig === lobbySig) return;
      lobbySig = sig;
      c.className = 'lobby';
      c.textContent = '';
      const card = el('div', 'panel lobbyCard');
      const left = el('div', 'qrSide');
      const img = el('img');
      img.src = '/qr.svg?text=' + encodeURIComponent(joinUrl);
      img.alt = 'QR code to join';
      left.append(img, el('div', 'url', joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')));
      const right = el('div', 'listSide');
      right.append(el('h1', 'title', '🦈 SHARK BAIT'));
      right.append(el('p', 'tag', 'Scan to join · Tap fast to stay afloat · Slowest fish get eaten!'));
      right.append(el('h2', null, `${waiting.length} player${waiting.length === 1 ? '' : 's'} in the water`));
      const chips = el('div', 'chips');
      waiting.slice(0, 90).forEach((p) => chips.append(el('span', 'chip' + (p[5] ? '' : ' off'), p[1])));
      if (waiting.length > 90) chips.append(el('span', 'chip', `+${waiting.length - 90} more`));
      right.append(chips);
      right.append(el('p', 'wait', 'Waiting for the Game Master to start…'));
      card.append(left, right);
      c.append(card);
    } else if (s.phase === 'roundOver') {
      const sig = 'ro|' + s.round;
      if (sig === lobbySig) return;
      lobbySig = sig;
      c.className = 'modal';
      c.textContent = '';
      const card = el('div', 'panel resultCard');
      card.append(el('h1', 'title', `Round ${s.round} over!`));
      card.append(el('p', null, 'Eaten this round:'));
      const chips = el('div', 'chips');
      s.eatenThisRound.forEach((n) => chips.append(el('span', 'chip dead', '🦴 ' + n)));
      card.append(chips);
      card.append(el('h2', null, `${s.aliveCount} survivors swim on`));
      card.append(el('p', 'wait', 'Get your thumbs ready for the next round…'));
      c.append(card);
    } else if (s.phase === 'gameOver') {
      const sig = 'go|' + (s.winner ? s.winner.id : '');
      if (sig === lobbySig) return;
      lobbySig = sig;
      c.className = 'modal';
      c.textContent = '';
      const card = el('div', 'panel resultCard winner');
      card.append(el('div', 'trophy', '🏆'));
      card.append(el('h1', 'title', s.winner ? s.winner.name : 'Nobody survived!'));
      card.append(el('p', 'tag', 'Last fish swimming — Champion of Shark Bait!'));
      const podium = s.players.filter((p) => p[6] === 2 || p[6] === 3).sort((a, b) => a[6] - b[6]);
      if (podium.length) {
        const pd = el('div', 'chips');
        podium.forEach((p) => pd.append(el('span', 'chip', `${p[6] === 2 ? '🥈' : '🥉'} ${p[1]}`)));
        card.append(pd);
      }
      c.append(card);
    } else if (s.phase === 'countdown') {
      if (lobbySig !== 'cd') {
        lobbySig = 'cd';
        c.className = 'countdown';
        c.textContent = '';
        c.append(el('div', 'cdRound', `Round ${s.round}`), el('div', 'cdNum', '3'), el('div', 'cdSub', `${s.quota} fish will be eaten`));
      }
    } else {
      c.className = '';
      c.textContent = '';
      lobbySig = '';
    }
  }

  // ---- Main loop -------------------------------------------------------------
  let last = performance.now();
  let lastDom = 0;
  shark.x = W / 2;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    const phase = state ? state.phase : 'lobby';
    const playing = phase === 'playing';

    // fish motion
    const visible = [];
    const n = state ? Math.max(1, state.phase === 'lobby' ? fish.size : state.aliveCount) : 1;
    const size = Math.max(9, Math.min(30, (W * 0.86) / n / 1.6));
    for (const f of fish.values()) {
      if (f.status === 3) continue;
      const target = phase === 'lobby' ? f.idle + Math.sin(t * 0.9 + f.seed) * 4 : f.depth;
      f.d += (target - f.d) * Math.min(1, dt * 8);
      const wander = phase === 'lobby' ? 0.06 : 0.012;
      f.x += (laneX(f.lane + Math.sin(t * 0.35 + f.seed) * wander) - f.x) * Math.min(1, dt * 4);
      f.dir = Math.cos(t * 0.35 + f.seed) >= 0 ? 1 : -1;
      if (f.status === 2 && !(f.eatenAt && now - f.eatenAt < 450)) continue;
      visible.push(f);
    }
    const alive = visible.filter((f) => f.status === 1).sort((a, b) => b.d - a.d);
    const deepest = playing ? alive[0] : null;
    const left = state ? Math.max(1, state.quota - state.kills) : 1;
    const hot = new Set(playing ? alive.slice(0, left).map((f) => f.id) : []);

    // shark
    const sharkS = Math.min(W * 0.11, 230);
    const sharkY = Art.depthToY(108, H);
    let tx;
    if (shark.lunge && now - shark.lunge.t < 700) {
      const age = (now - shark.lunge.t) / 1000;
      tx = shark.lunge.x - shark.dir * sharkS * 0.7;
      shark.x += (tx - shark.x) * Math.min(1, dt * 14);
      shark.mouth = age < 0.3 ? 1 : 0;
    } else {
      shark.lunge = null;
      tx = deepest ? deepest.x - shark.dir * sharkS * 0.7 : W / 2 + Math.sin(t * 0.25) * W * 0.35;
      const v = W * (deepest ? 0.25 : 0.08) * dt;
      const dx = Math.max(-v, Math.min(v, tx - shark.x));
      shark.x += dx;
      const wantMouth = deepest ? Math.max(0, Math.min(1, (deepest.d - 75) / 25)) : 0.1;
      shark.mouth += (wantMouth - shark.mouth) * Math.min(1, dt * 6);
    }
    const aimX = shark.lunge ? shark.lunge.x : deepest ? deepest.x : tx;
    if (Math.abs(aimX - shark.x) > sharkS * 0.4) shark.dir = aimX > shark.x ? 1 : -1;

    // camera: focus on the fish nearest to death
    let tz = 1, cx = W / 2, cy = H / 2, k = 0;
    if (state && state.focus && deepest && deepest.d > 62) {
      k = Math.min(1, (deepest.d - 62) / 30);
      tz = 1 + 0.7 * k;
      const fy = Art.depthToY(deepest.d, H);
      cx = W / 2 + (deepest.x - W / 2) * k;
      cy = H / 2 + ((fy + sharkY) / 2 - H / 2) * k;
    }
    const camRate = Math.min(1, dt * 2.5);
    cam.z += (tz - cam.z) * camRate;
    cam.x += (cx - cam.x) * camRate;
    cam.y += (cy - cam.y) * camRate;
    const hw = W / (2 * cam.z), hh = H / (2 * cam.z);
    cam.x = Math.max(hw, Math.min(W - hw, cam.x));
    cam.y = Math.max(hh, Math.min(H - hh, cam.y));

    // ---- draw world
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);

    Art.sea(ctx, W, H, t);

    const showAllNames = visible.length <= 40;
    const ordered = visible.slice().sort((a, b) => (hot.has(a.id) ? 1 : 0) - (hot.has(b.id) ? 1 : 0) || a.d - b.d);
    for (const f of ordered) {
      let x = f.x, y = Art.depthToY(f.d, H), sc = 1;
      if (f.status === 2 && f.eatenAt) {
        const p = Math.min(1, (now - f.eatenAt) / 450);
        x = f.eatX + (shark.x + shark.dir * sharkS * 0.8 - f.eatX) * p;
        y = f.eatY + (sharkY - f.eatY) * p;
        sc = 1 - p;
      }
      const isHot = hot.has(f.id);
      const isFocus = deepest && f.id === deepest.id;
      const fs = size * sc * (isFocus ? 1.35 : 1);
      if (isHot) {
        const pulse = 1 + 0.15 * Math.sin(t * 10);
        ctx.strokeStyle = isFocus ? '#ff2d55' : 'rgba(255,45,85,0.7)';
        ctx.lineWidth = isFocus ? 4 : 2.5;
        if (isFocus) ctx.setLineDash([10, 6]);
        ctx.lineDashOffset = -t * 30;
        ctx.beginPath();
        ctx.arc(x, y, fs * 1.6 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const jitter = isHot && f.d > 80 ? (Math.random() - 0.5) * 3 : 0;
      ctx.globalAlpha = f.connected ? 1 : 0.5;
      Art.fish(ctx, x + jitter, y, fs, f.hue, f.dir, t + f.seed);
      ctx.globalAlpha = 1;

      if (sc < 1) continue;
      if (showAllNames || isHot || phase !== 'playing') {
        const fsz = isFocus ? Math.max(18, size * 0.9) : isHot ? Math.max(14, size * 0.7) : Math.max(11, size * 0.55);
        ctx.font = `800 ${fsz}px ${font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const label = isHot ? '⚠ ' + f.name : f.name;
        const ly = y - fs * 1.05 - (isHot ? 6 : 0);
        if (isHot) {
          const w = ctx.measureText(label).width + 14;
          ctx.fillStyle = isFocus ? '#ff2d55' : 'rgba(200,20,60,0.85)';
          roundRect(ctx, x - w / 2, ly - fsz - 4, w, fsz + 8, 8);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillText(label, x, ly + 2);
        } else {
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,20,40,0.7)';
          ctx.strokeText(label, x, ly);
          ctx.fillStyle = '#fff';
          ctx.fillText(label, x, ly);
        }
      }
    }

    Art.shark(ctx, shark.x, sharkY, sharkS, shark.dir, shark.mouth, t);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 160 * dt;
      p.life -= dt * 1.1;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.fillStyle = p.red ? `rgba(220,20,50,${p.life})` : `rgba(255,255,255,${p.life * 0.8})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // ---- screen-space effects
    if (deepest && k > 0) {
      const sx = (deepest.x - cam.x) * cam.z + W / 2;
      const sy = (Art.depthToY(deepest.d, H) - cam.y) * cam.z + H / 2;
      const g = ctx.createRadialGradient(sx, sy, 120 * cam.z, sx, sy, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,10,${0.55 * k})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.y += c.vy * dt;
      c.x += c.vx * dt;
      c.rot += c.vr * dt;
      if (c.y > H + 20) c.y = -20;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = `hsl(${c.hue} 90% 60%)`;
      ctx.fillRect(-c.w / 2, -c.w / 4, c.w, c.w / 2);
      ctx.restore();
    }

    // near-death banner
    const banner = $('banner');
    if (deepest && deepest.d > 78) {
      banner.textContent = `⚠ ${deepest.name} is about to be eaten! ⚠`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    // countdown
    if (phase === 'countdown') {
      const num = document.querySelector('#center .cdNum');
      const left = Math.max(1, Math.ceil((countdownEnd - now) / 1000));
      if (num && num.textContent !== String(left)) {
        num.textContent = String(left);
        tone(440, 0.15, 'square', 0.12);
      }
    }
    // heartbeat when someone is close to death
    if (deepest && deepest.d > 85 && now - lastBeep > 600) {
      tone(70, 0.12, 'sine', 0.35);
      lastBeep = now;
    }

    if (domDirty && now - lastDom > 200) {
      domDirty = false;
      lastDom = now;
      renderDom();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  window.Display = { socket, getState: () => state };
})();
