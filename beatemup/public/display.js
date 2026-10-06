// Big-screen arena view, shared by /screen and /host.
(function () {
  const role = document.body.dataset.role;
  const socket = io({ transports: ['websocket', 'polling'] });
  if (role === 'screen') socket.on('connect', () => socket.emit('screen:join'));

  document.body.insertAdjacentHTML('beforeend', `
    <canvas id="arena"></canvas>
    <div id="hud" class="hidden"><span class="lbl">Fighters left</span><span id="hLeft">0 / 0</span></div>
    <aside id="leaders" class="panel hidden"><h3>🏆 Top KOs</h3><ol id="leaderList"></ol></aside>
    <aside id="feed" class="panel hidden"><h3>💀 Knocked out</h3><ul id="feedList"></ul></aside>
    <div id="ringMsg" class="hidden"></div>
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

  let ANIMALS = ['🐶'];
  fetch('/api/info').then((r) => r.json()).then((info) => {
    ANIMALS = info.animals;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || !info.lan[0]) return;
    joinUrl = info.lan[0] + '/';
    lobbySig = '';
    domDirty = true;
  }).catch(() => {});
  let joinUrl = location.origin + '/';

  // ---- Sound -------------------------------------------------------------------
  let audio = null;
  document.addEventListener('pointerdown', () => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
    } catch {}
  });
  function tone(freq, dur, type = 'square', vol = 0.12, slide = 0) {
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
  let lastThwack = 0;

  // ---- Canvas + projection --------------------------------------------------------
  const canvas = $('arena');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  let AW = 1600, AD = 500;
  let sx = 1, sy = 1, ox = 0, floorTop = 0, floorH = 0;
  function layout() {
    sx = (W * 0.94) / AW;
    ox = W * 0.03;
    floorH = Math.min(H * 0.6, AD * sx * 0.95);
    floorTop = H - floorH - H * 0.05;
    sy = floorH / AD;
  }
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    layout();
  }
  window.addEventListener('resize', resize);
  resize();
  const toX = (x) => ox + x * sx;
  const toY = (y) => floorTop + y * sy;
  const figScale = (y) => sx * 0.82 * (0.85 + 0.3 * (y / AD));

  // ---- State -------------------------------------------------------------------
  let state = null;
  const fighters = new Map();
  const effects = [];
  const confetti = [];
  let countdownEnd = 0;
  let fightFlash = 0;
  let domDirty = true;
  let lobbySig = '';

  socket.on('state', (s) => {
    const prevPhase = state && state.phase;
    state = s;
    if (s.arena.w !== AW || s.arena.d !== AD) {
      AW = s.arena.w;
      AD = s.arena.d;
      layout();
    }
    const now = performance.now();
    const seen = new Set();
    for (const [id, name, x, y, hp, facing, status, animal, hue, swings, hits, connected, kills, place, moving] of s.players) {
      seen.add(id);
      let f = fighters.get(id);
      if (!f) {
        f = { id, x, y, swings, hits, swingStart: -1, hitStart: -1, deadStart: status === 2 ? now - 9999 : -1 };
        fighters.set(id, f);
      }
      if (swings !== f.swings) f.swingStart = now;
      if (hits > f.hits) {
        f.hitStart = now;
        addPow(f);
      }
      if (status === 2 && f.status !== 2) f.deadStart = now;
      if (status !== 2) f.deadStart = -1;
      Object.assign(f, { name, tx: x, ty: y, hp, facing, status, animal, hue, swings, hits, connected, kills, place, moving });
      if (prevPhase !== s.phase && (s.phase === 'countdown' || s.phase === 'lobby')) {
        f.x = x;
        f.y = y;
      }
    }
    for (const id of fighters.keys()) if (!seen.has(id)) fighters.delete(id);
    if (s.phase === 'countdown') countdownEnd = now + s.countdownMs;
    if (s.phase !== prevPhase) onPhase(s.phase, prevPhase);
    domDirty = true;
  });

  socket.on('ko', (k) => {
    const f = fighters.get(k.id);
    if (f) effects.push({ kind: 'ko', x: f.x, y: f.y, t: performance.now() });
    toast(k.k ? `${ANIMALS[k.ka] || ''} ${k.k} knocked out ${ANIMALS[k.va] || ''} ${k.v}!` : `🌀 The arena took out ${ANIMALS[k.va] || ''} ${k.v}!`);
    tone(220, 0.15, 'square', 0.18);
    setTimeout(() => tone(110, 0.4, 'sawtooth', 0.2, 55), 90);
  });

  const POWS = ['POW!', 'BAM!', 'WHACK!', 'BONK!', 'THWACK!', 'OOF!'];
  function addPow(f) {
    effects.push({ kind: 'pow', x: f.x, y: f.y, t: performance.now(), text: POWS[Math.floor(Math.random() * POWS.length)], rot: (Math.random() - 0.5) * 0.5 });
    const now = performance.now();
    if (now - lastThwack > 60) {
      tone(180 + Math.random() * 120, 0.08, 'square', 0.08, 80);
      lastThwack = now;
    }
  }

  function onPhase(phase, prev) {
    lobbySig = '';
    confetti.length = 0;
    if (phase === 'fighting' && prev === 'countdown') {
      fightFlash = performance.now();
      [523, 784].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'square', 0.15), i * 120));
    }
    if (phase === 'gameOver') {
      for (let i = 0; i < 240; i++) {
        confetti.push({
          x: Math.random() * W, y: -Math.random() * H, vy: 90 + Math.random() * 150, vx: (Math.random() - 0.5) * 60,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, hue: Math.random() * 360, w: 6 + Math.random() * 8,
        });
      }
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.2), i * 140));
    }
  }

  function toast(text) {
    const t = el('div', 'toast', text);
    $('toasts').prepend(t);
    while ($('toasts').children.length > 4) $('toasts').lastChild.remove();
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  // ---- DOM overlays ---------------------------------------------------------------
  function renderDom() {
    if (!state) return;
    const s = state;
    const inGame = s.phase !== 'lobby';
    $('hud').classList.toggle('hidden', !inGame);
    $('feed').classList.toggle('hidden', !(s.phase === 'fighting' || s.phase === 'gameOver') || !s.feed.length);
    $('hLeft').textContent = `${s.aliveCount} / ${s.total}`;

    // KO feed
    const fl = $('feedList');
    fl.textContent = '';
    for (const k of s.feed.slice(0, 10)) {
      const li = el('li');
      li.append(el('span', 'k', k.k ? `${ANIMALS[k.ka] || ''} ${k.k}` : '🌀 Arena'));
      li.append(el('span', 'arrow', ' ➜ '));
      li.append(el('span', 'v', `${ANIMALS[k.va] || ''} ${k.v}`));
      fl.append(li);
    }

    // leaderboard
    const leaders = [...fighters.values()].filter((f) => f.kills > 0 && f.status !== 3).sort((a, b) => b.kills - a.kills).slice(0, 5);
    $('leaders').classList.toggle('hidden', !(s.phase === 'fighting' && leaders.length));
    const ll = $('leaderList');
    ll.textContent = '';
    for (const f of leaders) {
      const li = el('li', f.status === 2 ? 'out' : '');
      li.append(el('span', 'n', `${ANIMALS[f.animal] || ''} ${f.name}`));
      li.append(el('span', 'c', `${f.kills}`));
      ll.append(li);
    }

    // arena shrink message
    const rm = $('ringMsg');
    if (s.phase === 'fighting' && s.ring) {
      rm.textContent = '⚠ The arena is shrinking — get to the center! ⚠';
      rm.className = 'hot';
    } else if (s.phase === 'fighting' && s.shrinkInMs != null && s.shrinkInMs <= 10000) {
      rm.textContent = `Arena shrinks in ${Math.ceil(s.shrinkInMs / 1000)}…`;
      rm.className = '';
    } else {
      rm.className = 'hidden';
    }

    const c = $('center');
    if (s.phase === 'lobby') {
      const waiting = s.players.filter((p) => p[6] === 0);
      const sig = 'lobby|' + joinUrl + '|' + waiting.map((p) => p[1] + p[7] + p[11]).join(',');
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
      right.append(el('h1', 'title', "🥊 BEAT 'EM UP"));
      right.append(el('p', 'tag', 'Scan to join · Practice in the arena below · Last fighter standing wins!'));
      right.append(el('h2', null, `${waiting.length} fighter${waiting.length === 1 ? '' : 's'} ready`));
      const chips = el('div', 'chips');
      waiting.slice(0, 60).forEach((p) => chips.append(el('span', 'chip' + (p[11] ? '' : ' off'), `${ANIMALS[p[7]] || ''} ${p[1]}`)));
      if (waiting.length > 60) chips.append(el('span', 'chip', `+${waiting.length - 60} more`));
      right.append(chips);
      card.append(left, right);
      c.append(card);
    } else if (s.phase === 'countdown') {
      if (lobbySig !== 'cd') {
        lobbySig = 'cd';
        c.className = 'countdown';
        c.textContent = '';
        c.append(el('div', 'cdNum', '3'), el('div', 'cdSub', `${s.total} fighters · last one standing wins`));
      }
    } else if (s.phase === 'gameOver') {
      const sig = 'go|' + (s.winner ? s.winner.name : '');
      if (sig === lobbySig) return;
      lobbySig = sig;
      c.className = 'modal';
      c.textContent = '';
      const card = el('div', 'panel resultCard');
      card.append(el('div', 'trophy', s.winner ? ANIMALS[s.winner.animal] || '🏆' : '🏆'));
      card.append(el('h1', 'title', s.winner ? s.winner.name : 'Nobody survived!'));
      if (s.winner) card.append(el('p', 'tag', `🏆 Last fighter standing · ${s.winner.kills} KO${s.winner.kills === 1 ? '' : 's'} · ${s.winner.hp} HP left`));
      const top = [...fighters.values()].filter((f) => f.status !== 3).sort((a, b) => b.kills - a.kills).slice(0, 3).filter((f) => f.kills > 0);
      if (top.length) {
        card.append(el('p', null, 'Most knockouts'));
        const chips = el('div', 'chips');
        top.forEach((f, i) => chips.append(el('span', 'chip', `${['🥇', '🥈', '🥉'][i]} ${ANIMALS[f.animal] || ''} ${f.name} · ${f.kills}`)));
        card.append(chips);
      }
      c.append(card);
    } else {
      c.className = '';
      c.textContent = '';
      lobbySig = '';
    }
  }

  // ---- Drawing -------------------------------------------------------------------
  function drawStage(t) {
    // back wall
    const wall = ctx.createLinearGradient(0, 0, 0, floorTop);
    wall.addColorStop(0, '#1d0f3a');
    wall.addColorStop(1, '#3a1f63');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, floorTop);
    // hanging banners + lanterns
    for (let i = 0; i < 7; i++) {
      const bx = ((i + 0.5) / 7) * W;
      ctx.fillStyle = i % 2 ? 'rgba(255,59,92,0.35)' : 'rgba(255,204,51,0.25)';
      ctx.beginPath();
      ctx.moveTo(bx - 26, floorTop * 0.15);
      ctx.lineTo(bx + 26, floorTop * 0.15);
      ctx.lineTo(bx + 26, floorTop * 0.6);
      ctx.lineTo(bx, floorTop * 0.52);
      ctx.lineTo(bx - 26, floorTop * 0.6);
      ctx.closePath();
      ctx.fill();
      const glow = 0.6 + 0.4 * Math.sin(t * 2 + i);
      ctx.fillStyle = `rgba(255,170,60,${0.5 * glow})`;
      ctx.beginPath();
      ctx.arc(bx + W / 14, floorTop * 0.3, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    // floor
    const floor = ctx.createLinearGradient(0, floorTop, 0, H);
    floor.addColorStop(0, '#5a3a24');
    floor.addColorStop(1, '#8a5a34');
    ctx.fillStyle = floor;
    ctx.fillRect(0, floorTop - 6, W, H - floorTop + 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      const y = floorTop + (i / 8) * (H - floorTop);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // arena border
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(toX(0), toY(0), AW * sx, AD * sy);
  }

  function drawRing(t) {
    const r = state && state.ring;
    if (!r) return;
    const x0 = toX(r.x0), x1 = toX(r.x1), y0 = toY(r.y0), y1 = toY(r.y1);
    ctx.save();
    ctx.fillStyle = `rgba(200,0,40,${0.28 + 0.08 * Math.sin(t * 6)})`;
    ctx.beginPath();
    ctx.rect(toX(0), toY(0), AW * sx, AD * sy);
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.fill('evenodd');
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -t * 40;
    ctx.strokeStyle = '#ff3b5c';
    ctx.lineWidth = 4;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }

  function hpBar(x, y, w, hp) {
    const pct = (100 * hp) / ((state && state.arena.maxHp) || 100);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 7);
    ctx.fillStyle = pct > 50 ? '#38e08c' : pct > 25 ? '#ffcc33' : '#ff3b5c';
    ctx.fillRect(x - w / 2, y, (w * Math.max(0, pct)) / 100, 5);
  }

  let last = performance.now();
  let lastDom = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawStage(t);
    drawRing(t);

    const list = [];
    for (const f of fighters.values()) {
      if (f.status === 3) continue;
      const k = Math.min(1, dt * 14);
      f.x += (f.tx - f.x) * k;
      f.y += (f.ty - f.y) * k;
      let alpha = 1;
      if (f.status === 2) {
        const age = (now - f.deadStart) / 1000;
        if (age > 4) continue;
        alpha = age < 2.5 ? 1 : 1 - (age - 2.5) / 1.5;
      }
      list.push({ f, alpha });
    }
    list.sort((a, b) => a.f.y - b.f.y);
    const crowd = list.length > 30;
    ctx.textAlign = 'center';
    for (const { f, alpha } of list) {
      const px = toX(f.x), py = toY(f.y), s = figScale(f.y);
      const swingP = f.swingStart >= 0 ? (now - f.swingStart) / 300 : -1;
      const hitP = f.hitStart >= 0 ? (now - f.hitStart) / 250 : -1;
      const fall = f.status === 2 ? Math.min(1, (now - f.deadStart) / 400) : 0;
      Art.fighter(ctx, px, py, s, {
        hue: f.hue,
        animal: ANIMALS[f.animal],
        facing: f.facing,
        t: t + (f.hue % 10),
        walking: !!f.moving,
        swingP: swingP < 1 ? swingP : -1,
        hitP: hitP < 1 ? hitP : -1,
        fall,
        alpha: f.connected ? alpha : alpha * 0.5,
      });
      if (f.status === 2) continue;
      const top = py - 122 * s;
      if (state && state.phase !== 'lobby') hpBar(px, top, 54 * s, f.hp);
      const fs = Math.max(10, Math.round((crowd ? 12 : 15) * (s / 0.75)));
      ctx.font = `800 ${fs}px Trebuchet MS, Segoe UI, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(f.name, px, top - 6);
      ctx.fillStyle = '#fff';
      ctx.fillText(f.name, px, top - 6);
    }

    // POW / KO pop-ups
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const age = (now - e.t) / 1000;
      const life = e.kind === 'ko' ? 1.4 : 0.6;
      if (age > life) {
        effects.splice(i, 1);
        continue;
      }
      const s = figScale(e.y);
      const px = toX(e.x), py = toY(e.y) - 70 * s - age * 40;
      const pop = Math.min(1, age / 0.12);
      ctx.save();
      ctx.globalAlpha = 1 - Math.max(0, (age - life * 0.6) / (life * 0.4));
      ctx.translate(px, py);
      ctx.rotate(e.rot || 0);
      ctx.scale(pop, pop);
      const size = e.kind === 'ko' ? 54 : 26;
      ctx.font = `900 ${size * (s / 0.75)}px Impact, Trebuchet MS, sans-serif`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#1a1030';
      ctx.fillStyle = e.kind === 'ko' ? '#ff3b5c' : '#ffcc33';
      const txt = e.kind === 'ko' ? 'K.O.!' : e.text;
      ctx.strokeText(txt, 0, 0);
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }

    // FIGHT! flash
    if (fightFlash && now - fightFlash < 1000) {
      const a = 1 - (now - fightFlash) / 1000;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `900 ${Math.min(W * 0.18, 220)}px Impact, Trebuchet MS, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#1a1030';
      ctx.fillStyle = '#ff3b5c';
      ctx.strokeText('FIGHT!', W / 2, H * 0.42);
      ctx.fillText('FIGHT!', W / 2, H * 0.42);
      ctx.restore();
    }

    for (const c of confetti) {
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

    if (state && state.phase === 'countdown') {
      const num = document.querySelector('#center .cdNum');
      const n = Math.max(1, Math.ceil((countdownEnd - now) / 1000));
      if (num && num.textContent !== String(n)) {
        num.textContent = String(n);
        tone(440, 0.15, 'square', 0.12);
      }
    }

    if (domDirty && now - lastDom > 250) {
      domDirty = false;
      lastDom = now;
      renderDom();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.Display = { socket, getState: () => state, animals: () => ANIMALS };
})();
