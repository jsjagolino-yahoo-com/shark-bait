(function () {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  function newId() {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 32);
  }

  let myId = store.get('sb_id');
  if (!myId || !/^[A-Za-z0-9-]{8,40}$/.test(myId)) {
    myId = newId();
    store.set('sb_id', myId);
  }
  let myName = store.get('sb_name') || '';
  let joined = false;
  let me = null;
  let prevStatus = null;
  let countdownEnd = 0;

  const socket = io({ transports: ['websocket', 'polling'] });

  // ---- Join flow ----------------------------------------------------------
  $('name').value = myName;

  function showJoin(err) {
    $('joinView').classList.remove('hidden');
    $('gameView').classList.add('hidden');
    $('joinErr').textContent = err || '';
  }

  function showGame() {
    $('joinView').classList.add('hidden');
    $('gameView').classList.remove('hidden');
    resize();
  }

  function join(name) {
    socket.emit('join', { id: myId, name }, (res) => {
      if (!res || res.error) {
        joined = false;
        return showJoin(res ? res.error : 'Could not join.');
      }
      joined = true;
      myName = res.name;
      store.set('sb_name', myName);
      $('meName').textContent = '🐟 ' + myName;
      showGame();
      requestWakeLock();
    });
  }

  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('name').value.trim();
    if (!name) return showJoin('Please enter your name.');
    $('name').blur();
    join(name);
  });

  $('leaveBtn').addEventListener('click', () => {
    socket.emit('leave');
    joined = false;
    me = null;
    store.del('sb_name');
    showJoin();
  });

  socket.on('connect', () => {
    $('conn').classList.add('hidden');
    if (joined || myName) join(myName);
  });
  socket.on('disconnect', () => $('conn').classList.remove('hidden'));

  socket.on('kicked', () => {
    joined = false;
    me = null;
    store.del('sb_name');
    showJoin('You were removed by the Game Master.');
  });

  socket.on('me', (m) => {
    if (prevStatus === 'alive' && m.status === 'eaten') {
      chomped = performance.now();
      vibrate([250, 80, 400]);
    }
    prevStatus = m.status;
    if (m.phase === 'countdown') countdownEnd = performance.now() + m.countdownMs;
    me = m;
    $('meName').textContent = '🐟 ' + m.name;
    updateText();
  });

  // ---- Wake lock (keep phone screen on) -----------------------------------
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
      }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && joined) requestWakeLock();
  });

  function vibrate(p) {
    try { navigator.vibrate && navigator.vibrate(p); } catch {}
  }

  // ---- Tapping -------------------------------------------------------------
  let pendingTaps = 0;
  let localLift = 0;
  const bubbles = [];

  const canTap = () => me && me.phase === 'playing' && me.status === 'alive';

  $('gameView').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const top = canvas.getBoundingClientRect().top;
    e.preventDefault();
    if (canTap()) {
      pendingTaps++;
      localLift = Math.min(localLift + 1.2, 8);
    }
    for (let i = 0; i < 3; i++) {
      bubbles.push({ x: e.clientX + (Math.random() - 0.5) * 20, y: e.clientY - top, r: 3 + Math.random() * 6, vy: 60 + Math.random() * 80, life: 1 });
    }
  });
  $('gameView').addEventListener('touchstart', (e) => {
    if (!e.target.closest('button')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  setInterval(() => {
    if (pendingTaps > 0 && socket.connected) {
      socket.emit('tap', pendingTaps);
      pendingTaps = 0;
    }
  }, 100);

  // ---- Text ----------------------------------------------------------------
  function updateText() {
    if (!me) return;
    const left = Math.max(0, me.quota - me.kills);
    let big = '';
    let small = '';
    let cls = '';
    const alive = me.status === 'alive';

    if (me.status === 'spectator') {
      big = 'Game in progress';
      small = "You'll join the next game.\nWatch the big screen! 👀";
    } else if (me.phase === 'lobby') {
      big = "You're in! 🐟";
      small = 'Waiting for the Game Master to start…';
    } else if (me.status === 'eaten') {
      big = '🦈 CHOMP!';
      small = `You were eaten in round ${me.eatenRound}.\nFinished #${me.place}`;
      if (me.phase === 'gameOver' && me.winner) small += `\n🏆 Winner: ${me.winner}`;
      else small += ` · ${me.aliveCount} still swimming`;
    } else if (me.phase === 'gameOver') {
      big = alive ? '🏆 YOU WIN! 🏆' : 'Game over';
      small = alive ? 'Last fish swimming!' : `Winner: ${me.winner || '—'}`;
    } else if (me.phase === 'countdown') {
      cls = 'tap';
      small = `Round ${me.round} · Get ready to TAP!`;
    } else if (me.phase === 'playing' && alive) {
      big = 'TAP! TAP! TAP!';
      cls = 'tap';
      if (me.rank && me.rank <= left) {
        small = `⚠ DANGER! You're #${me.rank} closest to the shark!`;
        cls += ' danger';
      } else {
        small = `${left} more fish to be eaten`;
      }
    } else if (me.phase === 'roundOver' && alive) {
      big = 'You survived! 🎉';
      small = `Round ${me.round} done · ${me.aliveCount} fish left\nWait for the next round…`;
    }

    if (me.phase !== 'countdown' || !alive) $('big').textContent = big;
    $('small').textContent = small;
    $('small').style.whiteSpace = 'pre-line';
    $('msg').className = cls;
    $('info').textContent = me.round ? `Round ${me.round} · ${me.aliveCount} alive` : '';
    $('leaveBtn').classList.toggle('hidden', !(me.phase === 'lobby' || me.status === 'spectator'));
  }

  // ---- Rendering -----------------------------------------------------------
  const canvas = $('c');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  let shownDepth = 40;
  let chomped = 0;
  let lastBuzz = 0;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;

    if (!$('gameView').classList.contains('hidden')) {
      const playing = me && (me.phase === 'playing' || me.phase === 'countdown') && me.status === 'alive';
      let target = 35 + Math.sin(t * 1.3) * 3;
      if (me && me.status === 'alive' && me.phase !== 'lobby') target = me.y;
      localLift *= Math.pow(0.02, dt);
      shownDepth += (target - shownDepth) * Math.min(1, dt * 8);
      const depth = Math.max(0, playing ? shownDepth - localLift : shownDepth);
      const danger = me && me.status === 'alive' && me.phase === 'playing' ? Math.max(0, Math.min(1, (depth - 60) / 40)) : 0;

      Art.sea(ctx, W, H, t);

      // shark
      const s = Math.min(W * 0.45, 200);
      const sharkY = Art.depthToY(108, H);
      const sharkX = W / 2 + Math.sin(t * 0.7) * W * 0.25;
      const sharkDir = Math.cos(t * 0.7) >= 0 ? 1 : -1;
      const sinceChomp = (now - chomped) / 1000;
      const mouth = sinceChomp < 0.8 ? (sinceChomp < 0.3 ? 1 : 0) : danger;
      Art.shark(ctx, sharkX, sharkY, s, sharkDir, mouth, t);

      // me
      if (me && me.status !== 'eaten' && me.status !== 'spectator') {
        const fy = Art.depthToY(depth, H);
        const size = Math.min(W * 0.09, 38);
        const shake = danger > 0.5 ? (Math.random() - 0.5) * danger * 6 : 0;
        Art.fish(ctx, W / 2 + shake, fy, size, Art.hueOf(myId), 1, t * (1 + danger));
        ctx.fillStyle = '#fff';
        ctx.font = '800 15px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'center';
        ctx.fillText('YOU', W / 2, fy - size - 6);
      }

      // depth meter
      const top = Art.depthToY(0, H);
      const bottom = Art.depthToY(100, H);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(12, top, 8, bottom - top);
      const mg = ctx.createLinearGradient(0, top, 0, bottom);
      mg.addColorStop(0, '#2ee59d');
      mg.addColorStop(0.6, '#ffc93c');
      mg.addColorStop(1, '#ff2d55');
      ctx.fillStyle = mg;
      ctx.fillRect(12, top, 8, Math.max(0, Math.min(bottom - top, Art.depthToY(depth, H) - top)));

      // bubbles
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.y -= b.vy * dt;
        b.life -= dt * 1.2;
        if (b.life <= 0) { bubbles.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(255,255,255,${b.life * 0.8})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // danger vignette
      if (danger > 0) {
        const pulse = 0.6 + 0.4 * Math.sin(t * 12);
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
        g.addColorStop(0, 'rgba(255,0,40,0)');
        g.addColorStop(1, `rgba(255,0,40,${0.65 * danger * pulse})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        if (danger > 0.5 && now - lastBuzz > 450) {
          vibrate(35);
          lastBuzz = now;
        }
      }

      if (sinceChomp < 0.25) {
        ctx.fillStyle = `rgba(200,0,30,${0.6 * (1 - sinceChomp / 0.25)})`;
        ctx.fillRect(0, 0, W, H);
      }

      // countdown number
      if (me && me.phase === 'countdown' && me.status === 'alive') {
        const n = Math.max(1, Math.ceil((countdownEnd - now) / 1000));
        $('big').textContent = String(n);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
