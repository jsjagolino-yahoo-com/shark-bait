(function () {
  const $ = (id) => document.getElementById(id);
  const socket = window.Display.socket;
  const STATUS_TEXT = ['in lobby', 'fighting', 'knocked out', 'spectating'];

  let key = new URLSearchParams(location.search).get('key');
  try { key = key || localStorage.getItem('bu_host_key'); } catch {}
  let state = null;

  function auth() {
    if (!key) return $('auth').classList.remove('hidden');
    socket.emit('host:auth', key, (res) => {
      if (res && res.ok) {
        try { localStorage.setItem('bu_host_key', key); } catch {}
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

  const say = (msg) => ($('msgLine').textContent = msg || '');
  const start = () => socket.emit('host:start', (res) => say(res && res.error));

  $('startBtn').addEventListener('click', start);
  $('resetBtn').addEventListener('click', () => {
    if (state && state.phase === 'fighting' && !confirm('Reset to lobby? This ends the current fight.')) return;
    socket.emit('host:reset', () => say(''));
  });
  $('playersBtn').addEventListener('click', () => $('drawer').classList.toggle('hidden'));
  $('closeDrawer').addEventListener('click', () => $('drawer').classList.add('hidden'));
  $('hideBtn').addEventListener('click', () => document.body.classList.add('hideControls'));

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('hideControls');
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (state && state.phase === 'lobby') start();
    }
  });

  let lastList = 0;
  socket.on('state', (s) => {
    state = s;
    const btn = $('startBtn');
    const connected = s.players.filter((p) => p[11] && p[6] !== 3).length;
    if (s.phase === 'lobby') {
      btn.textContent = `🥊 Start fight (${connected} players)`;
      btn.disabled = connected < 2;
    } else if (s.phase === 'gameOver') {
      btn.textContent = '🏆 Game over — reset for a rematch';
      btn.disabled = true;
    } else {
      btn.textContent = 'Fight in progress…';
      btn.disabled = true;
    }
    $('resetBtn').textContent = s.phase === 'gameOver' ? '↺ Rematch (back to lobby)' : '↺ Reset to lobby';
    document.body.classList.toggle('inRound', s.phase === 'countdown' || s.phase === 'fighting');
    if (s.phase !== 'lobby') say('');

    const now = performance.now();
    if (!$('drawer').classList.contains('hidden') && now - lastList > 500) {
      lastList = now;
      renderList();
    }
  });

  function renderList() {
    const animals = window.Display.animals();
    const rows = state.players.slice().sort((a, b) => a[6] - b[6] || b[12] - a[12] || b[4] - a[4]);
    $('drawerTitle').textContent = `Players (${rows.length})`;
    const list = $('plist');
    list.textContent = '';
    for (const [id, name, , , hp, , status, animal, , , , connected, kills, place] of rows) {
      const row = document.createElement('div');
      row.className = 'prow';
      const n = document.createElement('span');
      n.className = 'pn';
      n.textContent = (connected ? '' : '📵 ') + (animals[animal] || '') + ' ' + name;
      const st = document.createElement('span');
      st.className = 'ps';
      st.textContent = status === 1
        ? `${hp} HP · ${kills} KO`
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
