// PrimeStake Admin — separate operator back office. Not linked from the
// public site. Uses the same API with an admin-role account.
const state = {
  token: localStorage.getItem('ps_admin_token') || '',
  user: null,
  tab: 'dashboard',
  stats: null, queue: [], matches: [], users: [], support: [],
  offline: false,
};
const $ = (s, r = document) => r.querySelector(s);
const root = $('#adminRoot');
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3600);
}
function esc(s) { return String(s == null ? '' : s).replace(/</g, '&lt;'); }
function money(n) { return 'GHS ' + Number(n || 0).toFixed(2); }
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && data.error === 'backend_not_configured') {
    state.offline = true;
    throw new Error('Backend not configured yet — set DATABASE_URL and SESSION_SECRET in Vercel first.');
  }
  if (!res.ok) throw new Error(data.detail || data.error || 'request_failed');
  return data;
}
function chip(s) {
  const cls = s === 'completed' || s === 'won' || s === 'active' ? 'completed' : s === 'rejected' || s === 'lost' || s === 'blocked' ? 'rejected' : 'pending';
  return '<span class="st st-' + cls + '">' + String(s).toUpperCase() + '</span>';
}

function loginHTML() {
  return '<div class="profile"><h2>Admin Login</h2>' +
    '<p class="modal-sub">Operator accounts only. This page is not linked from the public site.</p>' +
    '<form id="adminLogin" class="stack">' +
    '<label>Phone number <input type="tel" id="adPhone" required></label>' +
    '<label>Password <input type="password" id="adPass" required></label>' +
    '<button class="btn gold big" type="submit">Login</button></form>' +
    (state.offline ? '<p class="lock-note">Backend not configured yet — set DATABASE_URL and SESSION_SECRET in the Vercel project first.</p>' : '') +
    '</div>';
}
function tabsHTML() {
  const tabs = [['dashboard', 'Dashboard'], ['queue', 'Payout Queue'], ['matches', 'Matches'], ['users', 'Users'], ['support', 'Support']];
  return '<div class="wtabs">' + tabs.map(([k, label]) =>
    '<button class="' + (state.tab === k ? 'on' : '') + '" data-atab="' + k + '">' + label + '</button>').join('') + '</div>';
}
const ESPN_LEAGUES = [
  ['eng.1', 'Premier League'], ['esp.1', 'La Liga'], ['ita.1', 'Serie A'],
  ['ger.1', 'Bundesliga'], ['fra.1', 'Ligue 1'], ['por.1', 'Primeira Liga'],
  ['ned.1', 'Eredivisie'], ['uefa.champions', 'Champions League'],
  ['uefa.europa', 'Europa League'], ['gha.1', 'Ghana Premier League'], ['usa.1', 'MLS'],
];
function espnHTML() {
  const boxes = ESPN_LEAGUES.map(([slug, name]) =>
    '<label class="checkrow"><input type="checkbox" class="espn-league" value="' + slug + '" checked> ' + name + '</label>').join('');
  return '<div class="card"><h3>ESPN fixture sync</h3>' +
    '<p class="muted">Pulls fixtures, live scores and team logos from ESPN for the next 7 days (plus yesterday). Matches with ESPN odds import priced; the rest import ready for you to price. Syncing again updates scores and status without duplicating matches.</p>' +
    '<div class="espn-grid">' + boxes + '</div>' +
    '<button class="btn gold big" id="espnSync">Sync From ESPN</button>' +
    '<p class="muted" id="espnResult"></p></div>';
}
function dashboardHTML() {
  const s = state.stats;
  const grid = s ? [
    ['Users', s.users], ['Blocked users', s.blocked_users],
    ['Bets today', s.bets_today], ['Open bets', s.open_bets],
    ['Stakes today', money(s.stakes_today_ghs)],
    ['Pending deposits', s.pending_deposits], ['Pending withdrawals', s.pending_withdrawals],
    ['Open support', s.open_support],
  ].map(([l, v]) => '<div class="stat"><div class="muted">' + l + '</div><div class="stat-v">' + v + '</div></div>').join('') : '<p class="muted">Loading…</p>';
  return tabsHTML() + '<div class="stats">' + grid + '</div>' + espnHTML() + queueHTML(true);
}
function queueHTML(compact) {
  const rows = state.queue.map(q =>
    '<div class="txrow"><div><b>' + esc(q.kind) + ' · ' + esc(q.phone) + '</b>' +
    '<div class="muted">' + fmtDate(q.created_at) + ' · ' + esc(q.method || '') + (q.external_ref ? ' · Ref ' + esc(q.external_ref) : '') + '</div></div>' +
    '<div>' + money(q.amount_ghs) + '</div>' +
    '<span><button class="btn gold sm" data-confirm="' + q.id + '">Confirm</button> ' +
    '<button class="btn ghost sm" data-reject="' + q.id + '">Reject</button></span></div>').join('');
  return '<div class="card"><h3>Deposits &amp; withdrawals queue</h3>' +
    (rows || '<p class="empty">Nothing waiting for review.</p>') + '</div>' +
    (compact ? '' : '<p class="muted">Confirming a deposit credits the player and counts it toward their withdrawal unlock. Rejecting a withdrawal refunds the held amount.</p>');
}
function matchesHTML() {
  const form = '<div class="card"><h3>Add a match</h3><form id="matchForm" class="stack">' +
    '<label>League <input type="text" id="mfLeague" placeholder="England Premier League" required></label>' +
    '<label>Home team <input type="text" id="mfHome" required></label>' +
    '<label>Away team <input type="text" id="mfAway" required></label>' +
    '<label>Start time <input type="datetime-local" id="mfStart" required></label>' +
    '<div class="oddsgrid">' +
    [['1 (home)', 'o1'], ['X (draw)', 'ox'], ['2 (away)', 'o2'], ['1X', 'dc1x'], ['12', 'dc12'], ['X2', 'dcx2'], ['Over 0.5', 'over05'], ['Under 0.5', 'under05'], ['Over 1.5', 'over15'], ['Under 1.5', 'under15'], ['Over 2.5', 'over25'], ['Under 2.5', 'under25'], ['Over 3.5', 'over35'], ['Under 3.5', 'under35'], ['Over 4.5', 'over45'], ['Under 4.5', 'under45'], ['GG (both score)', 'gg'], ['NG', 'ng']]
      .map(([l, k]) => '<label>' + l + ' <input type="number" step="0.01" min="1.01" id="mf_' + k + '"></label>').join('') +
    '</div><button class="btn gold big" type="submit">Add Match</button></form></div>';
  const rows = state.matches.map(m =>
    '<div class="txrow"><div><b>' + esc(m.home_team) + ' vs ' + esc(m.away_team) + '</b>' +
    '<div class="muted">' + (m.external_ref && String(m.external_ref).indexOf('espn:') === 0 ? 'ESPN · ' : 'Manual · ') + esc(m.league) + ' · ' + fmtDate(m.starts_at) + ' · ' + m.score_home + '-' + m.score_away + (m.minute != null ? ' · ' + m.minute + "'" : '') + '</div></div>' +
    chip(m.status) +
    '<span>' +
    (m.status === 'upcoming' ? '<button class="btn gold sm" data-golive="' + m.id + '">Go Live</button> ' : '') +
    (m.status === 'live' ? '<button class="btn ghost sm" data-score="' + m.id + '">Update Score</button> ' : '') +
    (m.status !== 'finished' ? '<button class="btn ghost sm" data-settle="' + m.id + '">Settle</button>' : '') +
    '</span></div>').join('');
  return tabsHTML() + form + '<div class="card"><h3>Matches</h3>' + (rows || '<p class="empty">No matches yet.</p>') + '</div>';
}
function usersHTML() {
  const rows = state.users.map(u =>
    '<div class="txrow"><div><b>' + esc(u.phone) + '</b>' +
    '<div class="muted">' + esc(u.display_name || '') + ' · joined ' + fmtDate(u.created_at) + ' · ' + u.deposits_completed + ' deposits · ' + u.bets_count + ' bets</div></div>' +
    '<div>' + money(u.balance_ghs) + '</div>' + chip(u.status) +
    '<span class="muted">' + esc(u.role) + '</span>' +
    '<span><button class="btn ghost sm" data-block="' + u.id + '" data-to="' + (u.status === 'blocked' ? 'active' : 'blocked') + '">' + (u.status === 'blocked' ? 'Unblock' : 'Block') + '</button>' +
    (state.user && state.user.role === 'super_admin' && u.id !== state.user.id
      ? ' <button class="btn ghost sm" data-role="' + u.id + '" data-as="admin">Make Admin</button>' +
        ' <button class="btn ghost sm" data-role="' + u.id + '" data-as="super_admin">Make Super</button>' +
        ' <button class="btn ghost sm" data-role="' + u.id + '" data-as="player">Make Player</button>'
      : '') + '</span></div>').join('');
  return tabsHTML() + '<div class="card"><h3>Users</h3>' + (rows || '<p class="empty">No users yet.</p>') + '</div>';
}
function supportHTML() {
  const rows = state.support.map(m =>
    '<div class="txrow"><div><b>' + esc(m.subject) + '</b>' +
    '<div class="muted">' + esc(m.phone || '') + ' · ' + fmtDate(m.created_at) + '</div>' +
    '<div>' + esc(m.body) + '</div></div>' + chip(m.status) +
    (m.status === 'open' ? '<span><button class="btn gold sm" data-answer="' + m.id + '">Mark Answered</button></span>' : '') + '</div>').join('');
  return tabsHTML() + '<div class="card"><h3>Support inbox</h3>' + (rows || '<p class="empty">No messages.</p>') + '</div>';
}
function render() {
  const head = $('#adminHead');
  if (!state.user) {
    head.innerHTML = '';
    root.innerHTML = loginHTML();
    return;
  }
  head.innerHTML = '<span class="userchip">' + esc(state.user.phone) + '</span> ' +
    '<button class="btn ghost" id="adminLogout">Logout</button>';
  $('#adminLogout').addEventListener('click', () => {
    state.user = null; state.token = '';
    localStorage.removeItem('ps_admin_token');
    render();
  });
  root.innerHTML =
    state.tab === 'dashboard' ? dashboardHTML() :
    state.tab === 'queue' ? tabsHTML() + queueHTML(false) :
    state.tab === 'matches' ? matchesHTML() :
    state.tab === 'users' ? usersHTML() : supportHTML();
}
async function loadAll() {
  try {
    const [stats, queue, matches, users, support] = await Promise.all([
      api('/admin/stats'), api('/admin/queue'), api('/admin/matches'), api('/admin/users'), api('/admin/support')
    ]);
    state.stats = stats.stats; state.queue = queue.queue; state.matches = matches.matches;
    state.users = users.users; state.support = support.messages;
  } catch (e) { toast(e.message); }
  render();
}

document.addEventListener('click', async e => {
  if (e.target.id === 'espnSync') {
    const leagues = [...document.querySelectorAll('.espn-league:checked')].map(x => x.value);
    if (!leagues.length) { toast('Pick at least one league.'); return; }
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'Syncing…';
    try {
      const data = await api('/admin/espn-sync', { method: 'POST', body: { leagues, days: 7 } });
      const el = $('#espnResult');
      if (el) el.textContent = 'Imported ' + data.imported + ' matches (' + data.with_odds + ' with ESPN odds).';
      toast('ESPN sync done: ' + data.imported + ' matches.');
      loadAll();
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Sync From ESPN'; }
    return;
  }
  const roleBtn = e.target.closest('[data-role]');
  if (roleBtn) {
    try { await api('/admin/promote', { method: 'POST', body: { id: roleBtn.dataset.role, role: roleBtn.dataset.as } }); toast('Role updated.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const tab = e.target.closest('[data-atab]');
  if (tab) { state.tab = tab.dataset.atab; render(); return; }
  const confirmBtn = e.target.closest('[data-confirm]');
  if (confirmBtn) {
    try { await api('/admin/confirm', { method: 'POST', body: { id: confirmBtn.dataset.confirm } }); toast('Confirmed.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const rejectBtn = e.target.closest('[data-reject]');
  if (rejectBtn) {
    try { await api('/admin/reject', { method: 'POST', body: { id: rejectBtn.dataset.reject } }); toast('Rejected.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const blockBtn = e.target.closest('[data-block]');
  if (blockBtn) {
    try { await api('/admin/block', { method: 'POST', body: { id: blockBtn.dataset.block, status: blockBtn.dataset.to } }); toast('User updated.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const answerBtn = e.target.closest('[data-answer]');
  if (answerBtn) {
    try { await api('/admin/support', { method: 'POST', body: { id: answerBtn.dataset.answer, status: 'answered' } }); toast('Marked answered.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const liveBtn = e.target.closest('[data-golive]');
  if (liveBtn) {
    try { await api('/admin/matches', { method: 'PATCH', body: { id: liveBtn.dataset.golive, status: 'live', minute: 0 } }); toast('Match is live.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const scoreBtn = e.target.closest('[data-score]');
  if (scoreBtn) {
    const m = state.matches.find(x => x.id === scoreBtn.dataset.score);
    const sh = prompt('Home score', m ? m.score_home : 0);
    if (sh === null) return;
    const sa = prompt('Away score', m ? m.score_away : 0);
    if (sa === null) return;
    const min = prompt('Minute', m && m.minute != null ? m.minute : 45);
    try {
      await api('/admin/matches', { method: 'PATCH', body: { id: m.id, score_home: Number(sh), score_away: Number(sa), minute: min === null ? undefined : Number(min) } });
      toast('Score updated.'); loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
  const settleBtn = e.target.closest('[data-settle]');
  if (settleBtn) {
    const m = state.matches.find(x => x.id === settleBtn.dataset.settle);
    const sh = prompt('FINAL home score for ' + (m ? m.home_team : ''), m ? m.score_home : 0);
    if (sh === null) return;
    const sa = prompt('FINAL away score for ' + (m ? m.away_team : ''), m ? m.score_away : 0);
    if (sa === null) return;
    try {
      const data = await api('/admin/settle', { method: 'POST', body: { match_id: m.id, score_home: Number(sh), score_away: Number(sa) } });
      toast('Settled: ' + data.selections_scored + ' selections, ' + data.bets_won + ' bets won, ' + data.bets_lost + ' lost.');
      loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
});

document.addEventListener('submit', async e => {
  if (e.target.id === 'adminLogin') {
    e.preventDefault();
    try {
      const data = await api('/auth/login', { method: 'POST', body: { phone: $('#adPhone').value.trim(), password: $('#adPass').value } });
      if (data.user.role !== 'admin' && data.user.role !== 'super_admin') { toast('That account is not an admin account.'); return; }
      state.token = data.token;
      localStorage.setItem('ps_admin_token', data.token);
      state.user = data.user;
      loadAll();
    } catch (err) { toast(err.message); render(); }
  } else if (e.target.id === 'matchForm') {
    e.preventDefault();
    const keys = ['o1', 'ox', 'o2', 'dc1x', 'dc12', 'dcx2', 'over05', 'under05', 'over15', 'under15', 'over25', 'under25', 'over35', 'under35', 'over45', 'under45', 'gg', 'ng'];
    const odds = {};
    keys.forEach(k => { const v = Number($('#mf_' + k).value); if (v > 1) odds[k] = v; });
    try {
      await api('/admin/matches', {
        method: 'POST',
        body: {
          league: $('#mfLeague').value.trim(), home_team: $('#mfHome').value.trim(),
          away_team: $('#mfAway').value.trim(),
          starts_at: new Date($('#mfStart').value).toISOString(), odds
        }
      });
      toast('Match added.');
      loadAll();
    } catch (err) { toast(err.message); }
  }
});

(async () => {
  render();
  if (state.token) {
    try {
      const data = await api('/auth/me');
      if (data.user.role === 'admin' || data.user.role === 'super_admin') { state.user = data.user; loadAll(); return; }
    } catch (e) { /* fall through to login */ }
    state.token = '';
    localStorage.removeItem('ps_admin_token');
    render();
  }
})();
