(function () {
  const $ = (id) => document.getElementById(id);
  const socket = window.Display.socket;
  const STATUS_TEXT = ['in lobby', 'alive', 'eaten', 'spectating'];

  let key = new URLSearchParams(location.search).get('key');
  try { key = key || localStorage.getItem('sb_host_key'); } catch {}
  let state = null;

  function auth() {
    if (!key) return $('auth').classList.remove('hidden');
    socket.emit('host:auth', key, (res) => {
      if (res && res.ok) {
        try { localStorage.setItem('sb_host_key', key); } catch {}
        document.body.classList.add('authed');
        $('auth').classList.add('hidden');
      } else {
        $('authErr').textContent = 'Wrong host key.';
        $('auth').classList.remove('hidden');
      }
    });
  }
  socket.on('connect', auth);

  $('authForm').addEventListener('submit', (e) => {
    e.preventDefault();
    key = $('keyInput').value;
    auth();
  });

  function say(msg) {
    $('msgLine').textContent = msg || '';
  }

  function start() {
    socket.emit('host:start', (res) => say(res && res.error));
  }

  $('startBtn').addEventListener('click', start);
  $('resetBtn').addEventListener('click', () => {
    if (state && state.phase !== 'lobby' && !confirm('Reset to lobby? This ends the current game.')) return;
    socket.emit('host:reset', () => say(''));
  });
  $('elim').addEventListener('change', () => {
    socket.emit('host:config', { elimPerRound: Number($('elim').value) });
  });
  $('focus').addEventListener('change', () => {
    socket.emit('host:config', { focus: $('focus').checked });
  });
  $('playersBtn').addEventListener('click', () => $('drawer').classList.toggle('hidden'));
  $('closeDrawer').addEventListener('click', () => $('drawer').classList.add('hidden'));
  $('hideBtn').addEventListener('click', () => document.body.classList.add('hideControls'));

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('hideControls');
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      start();
    }
  });

  let lastList = 0;
  socket.on('state', (s) => {
    state = s;
    const btn = $('startBtn');
    const connected = s.players.filter((p) => p[5]).length;
    if (s.phase === 'lobby') {
      btn.textContent = `▶ Start game (${connected} players)`;
      btn.disabled = connected < 2;
    } else if (s.phase === 'roundOver') {
      btn.textContent = `▶ Start round ${s.round + 1}`;
      btn.disabled = false;
    } else if (s.phase === 'gameOver') {
      btn.textContent = '🏆 Game over — reset for a new game';
      btn.disabled = true;
    } else {
      btn.textContent = `Round ${s.round} in progress…`;
      btn.disabled = true;
    }
    if (document.activeElement !== $('elim')) $('elim').value = s.elimPerRound;
    $('focus').checked = s.focus;
    document.body.classList.toggle('inRound', s.phase === 'countdown' || s.phase === 'playing');
    if (s.phase !== 'lobby') say('');

    const now = performance.now();
    if (!$('drawer').classList.contains('hidden') && now - lastList > 500) {
      lastList = now;
      renderList();
    }
  });

  function renderList() {
    const rows = state.players.slice().sort((a, b) => {
      if (a[3] !== b[3]) return a[3] === 1 ? -1 : b[3] === 1 ? 1 : a[3] - b[3];
      return b[2] - a[2];
    });
    $('drawerTitle').textContent = `Players (${rows.length})`;
    const list = $('plist');
    list.textContent = '';
    for (const [id, name, depth, status, , connected, place] of rows) {
      const row = document.createElement('div');
      row.className = 'prow';
      const n = document.createElement('span');
      n.className = 'pn';
      n.textContent = (connected ? '' : '📵 ') + name;
      const st = document.createElement('span');
      st.className = 'ps';
      st.textContent = status === 1 && state.phase !== 'lobby'
        ? `depth ${Math.round(depth)}`
        : STATUS_TEXT[status] + (place ? ` · #${place}` : '');
      const kick = document.createElement('button');
      kick.textContent = 'Kick';
      kick.addEventListener('click', () => {
        if (confirm(`Remove ${name} from the game?`)) socket.emit('host:kick', id);
      });
      row.append(n, st, kick);
      list.append(row);
    }
  }
})();
