(function () {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  let myId = store.get('bu_id');
  if (!myId || !/^[A-Za-z0-9-]{8,40}$/.test(myId)) {
    myId = (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 32);
    store.set('bu_id', myId);
  }
  let myName = store.get('bu_name') || '';
  let myGroup = store.get('bu_group');
  myGroup = myGroup == null || myGroup === '' ? null : Number(myGroup);
  let GROUPS = [];
  const gColor = (g) => (GROUPS[g] && GROUPS[g].color) || '#ffffff';
  function renderGroupButtons() {
    const box = $('groupPick');
    box.textContent = '';
    GROUPS.forEach((g, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = g.key;
      b.style.color = g.color;
      if (i === myGroup) b.className = 'sel';
      b.addEventListener('click', () => {
        myGroup = i;
        store.set('bu_group', String(i));
        renderGroupButtons();
      });
      box.append(b);
    });
  }
  let joined = false;
  let me = null;
  let lastHp = null;
  let countdownEnd = 0;

  const socket = io({ transports: ['websocket', 'polling'] });

  // ---- Join ----------------------------------------------------------------
  $('name').value = myName;

  function showJoin(err) {
    $('joinView').classList.remove('hidden');
    $('padView').classList.add('hidden');
    $('joinErr').textContent = err || '';
  }

  function join(name) {
    socket.emit('join', { id: myId, name, group: myGroup }, (res) => {
      if (!res || res.error) {
        joined = false;
        return showJoin(res ? res.error : 'Could not join.');
      }
      joined = true;
      myName = res.name;
      store.set('bu_name', myName);
      $('joinView').classList.add('hidden');
      $('padView').classList.remove('hidden');
      requestWakeLock();
      if (store.get('bu_watch') === '1' && !$('padView').classList.contains('watching')) setWatching(true);
    });
  }

  $('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('name').value.trim();
    if (!name) return showJoin('Please enter your name.');
    if (myGroup == null) return showJoin('Please pick your group.');
    $('name').blur();
    join(name);
  });

  $('leaveBtn').addEventListener('click', () => {
    socket.emit('leave');
    joined = false;
    me = null;
    store.del('bu_name');
    showJoin();
  });

  socket.on('connect', () => {
    $('conn').classList.add('hidden');
    sentDir = '';
    if (joined || myName) join(myName);
  });
  socket.on('disconnect', () => $('conn').classList.remove('hidden'));
  socket.on('kicked', () => {
    joined = false;
    me = null;
    store.del('bu_name');
    showJoin('You were removed by the Game Master.');
  });

  socket.on('me', (m) => {
    if (lastHp != null && m.hp < lastHp && m.status !== 'waiting') {
      vibrate(m.hp <= 0 ? [300, 80, 400] : 60);
      $('padView').classList.add('hurt');
      setTimeout(() => $('padView').classList.remove('hurt'), 150);
    }
    lastHp = m.hp;
    if (m.phase === 'countdown') countdownEnd = performance.now() + m.countdownMs;
    me = m;
    render();
  });

  // ---- Wake lock / vibration --------------------------------------------------
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

  // ---- Controls --------------------------------------------------------------
  let dir = { dx: 0, dy: 0 };
  let sentDir = '';
  function setDir(dx, dy) {
    dir = { dx, dy };
    $('up').classList.toggle('on', dy < 0);
    $('down').classList.toggle('on', dy > 0);
    $('left').classList.toggle('on', dx < 0);
    $('right').classList.toggle('on', dx > 0);
    const key = dx + ',' + dy;
    if (key !== sentDir && socket.connected) {
      socket.emit('input', dir);
      sentDir = key;
    }
  }
  // keep the server in sync even if a packet was missed
  setInterval(() => {
    if (socket.connected && (dir.dx || dir.dy)) socket.emit('input', dir);
  }, 500);

  const pad = $('dpad');
  let padPointer = null;
  function padMove(e) {
    const r = pad.getBoundingClientRect();
    const vx = e.clientX - (r.left + r.width / 2);
    const vy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(vx, vy);
    const knob = $('knob');
    const max = r.width * 0.32;
    const k = Math.min(1, max / (len || 1));
    knob.style.transform = `translate(${vx * k}px, ${vy * k}px)`;
    if (len < r.width * 0.12) return setDir(0, 0);
    const oct = Math.round(Math.atan2(vy, vx) / (Math.PI / 4)); // 8 directions
    const dirs = { 0: [1, 0], 1: [1, 1], 2: [0, 1], 3: [-1, 1], 4: [-1, 0], '-4': [-1, 0], '-3': [-1, -1], '-2': [0, -1], '-1': [1, -1] };
    const [dx, dy] = dirs[oct];
    setDir(dx, dy);
  }
  function padEnd(e) {
    if (e.pointerId !== padPointer) return;
    padPointer = null;
    $('knob').style.transform = '';
    setDir(0, 0);
  }
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    padPointer = e.pointerId;
    try { pad.setPointerCapture(e.pointerId); } catch {}
    padMove(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId === padPointer) padMove(e);
  });
  pad.addEventListener('pointerup', padEnd);
  pad.addEventListener('pointercancel', padEnd);
  pad.addEventListener('lostpointercapture', padEnd);

  const hitBtn = $('hitBtn');
  let holdTimer = null;
  function hit() {
    if (socket.connected) socket.emit('attack');
  }
  hitBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hitBtn.classList.add('down');
    hit();
    vibrate(15);
    clearInterval(holdTimer);
    holdTimer = setInterval(hit, 400); // hold to keep swinging
  });
  const hitUp = () => {
    hitBtn.classList.remove('down');
    clearInterval(holdTimer);
  };
  hitBtn.addEventListener('pointerup', hitUp);
  hitBtn.addEventListener('pointercancel', hitUp);
  hitBtn.addEventListener('pointerleave', hitUp);

  $('padView').addEventListener('touchstart', (e) => {
    if (!e.target.closest('#tools, #avatarWrap, #nameRow')) e.preventDefault();
  }, { passive: false });

  // ---- Pick your animal head (lobby only) ---------------------------------------------
  let ANIMALS = [];
  fetch('/api/info').then((r) => r.json()).then((info) => {
    ANIMALS = info.animals;
    GROUPS = info.groups || [];
    renderGroupButtons();
    render();
  }).catch(() => {});
  const canPick = () => me && ((me.phase === 'lobby' && me.status === 'waiting') || me.status === 'spectator');
  function openPicker() {
    if (!canPick() || !ANIMALS.length) return;
    const grid = $('pickGrid');
    grid.textContent = '';
    grid.className = '';
    $('pickTitle').textContent = 'Pick your head';
    ANIMALS.forEach((a, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a;
      if (a === me.animal) b.className = 'sel';
      b.addEventListener('click', () => {
        socket.emit('setAnimal', i);
        $('picker').classList.add('hidden');
        vibrate(20);
      });
      grid.append(b);
    });
    $('picker').classList.remove('hidden');
  }
  $('avatarWrap').addEventListener('click', openPicker);

  // Change group (lobby only): same picker, one big button per group.
  function openGroupPicker() {
    if (!canPick() || !GROUPS.length) return;
    const grid = $('pickGrid');
    grid.textContent = '';
    grid.className = 'groupGrid';
    $('pickTitle').textContent = 'Pick your group';
    GROUPS.forEach((g, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = g.key;
      b.style.color = g.color;
      if (i === me.group) b.className = 'sel';
      b.addEventListener('click', () => {
        myGroup = i;
        store.set('bu_group', String(i));
        socket.emit('setGroup', i);
        $('picker').classList.add('hidden');
        vibrate(20);
      });
      grid.append(b);
    });
    $('picker').classList.remove('hidden');
  }
  $('groupChip').addEventListener('click', openGroupPicker);
  $('pickClose').addEventListener('click', () => $('picker').classList.add('hidden'));

  // ---- Arena view on the phone ----------------------------------------------------------
  function setWatching(on) {
    $('padView').classList.toggle('watching', on);
    $('watchBtn').classList.toggle('on', on);
    $('watchBtn').textContent = on ? '📺 Hide arena' : '📺 Watch arena';
    $('watch').classList.toggle('hidden', !on);
    // the arena view only connects while it is open, to save data
    if (on && !$('watch').getAttribute('src')) $('watch').setAttribute('src', '/screen?watch=1');
    if (!on) $('watch').removeAttribute('src');
    store.set('bu_watch', on ? '1' : '0');
  }
  $('watchBtn').addEventListener('click', () => setWatching(!$('padView').classList.contains('watching')));
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // keyboard support (handy for testing on a laptop)
  const keys = new Set();
  const keyDir = () => setDir(
    (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0),
    (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0),
  );
  document.addEventListener('keydown', (e) => {
    if (!joined || e.target.tagName === 'INPUT') return;
    if (e.key === ' ' || e.key === 'j') {
      e.preventDefault();
      if (!e.repeat) hit();
      return;
    }
    keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    keyDir();
  });
  document.addEventListener('keyup', (e) => {
    keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (joined) keyDir();
  });

  // ---- Rendering -------------------------------------------------------------
  function render() {
    if (!me) return;
    $('meName').textContent = me.name;
    $('meName').style.color = gColor(me.group);
    const grp = GROUPS[me.group];
    $('groupChip').textContent = grp ? grp.key : '';
    $('groupChip').style.color = grp ? grp.color : '';
    $('groupChip').classList.toggle('can', !!canPick());
    $('avatar').textContent = me.animal;
    $('avatar').style.background = `hsl(${me.hue} 70% 45%)`;
    $('avatar').style.borderColor = `hsl(${me.hue} 80% 70%)`;
    const pct = Math.max(0, (me.hp / me.maxHp) * 100);
    $('hpFill').style.width = pct + '%';
    $('hpFill').style.background = pct > 50 ? 'var(--ok)' : pct > 25 ? 'var(--gold)' : 'var(--hot)';
    $('hpText').textContent = `${me.hp} / ${me.maxHp} HP`;
    $('kills').firstChild.textContent = me.kills;

    let big = '', small = '', warn = false;
    const canFight = me.status === 'alive' && me.phase === 'fighting';
    const canPractice = me.status === 'waiting' && me.phase === 'lobby';

    if (me.status === 'spectator') {
      big = 'Fight in progress';
      small = "You'll join the next game.\nWatch the big screen! 👀";
    } else if (me.phase === 'lobby') {
      big = 'Practice time!';
      small = 'Move with the arrows, swing with HIT.\nNo damage until the Game Master starts.\nTap your face ✏️ to pick a new animal.';
    } else if (me.status === 'dead') {
      big = '💀 K.O.!';
      small = `Knocked out by ${me.killer}\nFinished #${me.place} · ${me.kills} KO${me.kills === 1 ? '' : 's'}`;
      if (me.phase === 'gameOver' && me.winner) small += `\n🏆 Winner: ${me.winner}`;
      else small += `\n${me.aliveCount} fighters left`;
    } else if (me.phase === 'gameOver') {
      big = me.status === 'alive' ? '🏆 YOU WIN! 🏆' : 'Game over';
      small = me.status === 'alive' ? `Last fighter standing with ${me.kills} KOs!` : `Winner: ${me.winner || '—'}`;
    } else if (me.phase === 'countdown') {
      small = me.aliveCount <= 2 ? `Round ${me.round} · FINAL ROUND!` : `Round ${me.round} · ${me.quota} fighters will be knocked out`;
    } else if (me.phase === 'roundOver' && me.status === 'alive') {
      big = 'You survived! 💪';
      small = `Round ${me.round} done · ${me.aliveCount} fighters left
You'll be healed to full HP.
Wait for the next round…`;
    } else if (canFight) {
      big = 'FIGHT!';
      small = `Round ${me.round} · ${Math.max(0, me.quota - me.roundKos)} more KOs to end it
${me.aliveCount} of ${me.total} fighters left`;
      if (me.outside) {
        warn = true;
        small = '⚠ Outside the arena! Move to the center!';
      } else if (me.shrinkInMs != null && me.shrinkInMs > 0 && me.shrinkInMs <= 10000) {
        small += `\nArena shrinks in ${Math.ceil(me.shrinkInMs / 1000)}s`;
      }
    }
    if (me.phase !== 'countdown' || me.status !== 'alive') $('big').textContent = big;
    $('small').textContent = small;
    $('status').className = warn ? 'warn' : '';
    $('controls').classList.toggle('off', !(canFight || canPractice));
    $('leaveBtn').classList.toggle('hidden', !(me.phase === 'lobby' || me.status === 'spectator'));
    $('avatarWrap').classList.toggle('can', !!canPick());
    $('padView').classList.toggle('dead', me.status === 'dead');
    if (!canPick()) $('picker').classList.add('hidden');
  }

  // animated mini preview of your own fighter + countdown number
  const pctx = $('preview').getContext('2d');
  let swingStart = -1;
  hitBtn.addEventListener('pointerdown', () => (swingStart = performance.now()));
  function frame(now) {
    if (me && !$('padView').classList.contains('hidden')) {
      pctx.clearRect(0, 0, 240, 240);
      const sp = swingStart >= 0 ? (now - swingStart) / 300 : -1;
      const down = me.status === 'dead';
      Art.fighter(pctx, down ? 200 : 120, down ? 200 : 222, down ? 1.5 : 2, {
        hue: me.hue,
        animal: me.animal,
        facing: 1,
        t: now / 1000,
        walking: !!(dir.dx || dir.dy),
        swingP: sp >= 0 && sp < 1 ? sp : -1,
        fall: me.status === 'dead' ? 1 : 0,
      });
      if (me.phase === 'countdown' && me.status === 'alive') {
        $('big').textContent = String(Math.max(1, Math.ceil((countdownEnd - now) / 1000)));
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
