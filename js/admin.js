// PrimeStake back office — TWO separate portals sharing this console:
//   admin.html        -> the Admin Portal (admin accounts)
//   super-admin.html  -> the Super Admin Portal (super_admin accounts only)
// The portal is fixed by the page (window.PS_PORTAL). Super-only powers
// (Platform Control, role changes, balance edits, invites, featured
// matches) exist ONLY inside the Super Admin Portal, even for a
// super_admin who signs in to the Admin Portal. The API also enforces
// the super_admin role server-side; this split is the operator-facing
// separation Prince asked for on 2026-11-03.
const PORTAL = window.PS_PORTAL === 'super' ? 'super' : 'admin';
const isSuperPortal = PORTAL === 'super';
function portalAllows(user) {
  if (!user) return false;
  return isSuperPortal
    ? user.role === 'super_admin'
    : user.role === 'admin' || user.role === 'super_admin';
}
function superTools() {
  return isSuperPortal && !!state.user && state.user.role === 'super_admin';
}
const state = {
  token: localStorage.getItem('ps_admin_token') || '',
  user: null,
  tab: 'dashboard',
  stats: null, queue: [], matches: [], users: [], support: [],
  settings: null, myDash: null, invites: [], lastInvite: '',
  pwdPrompt: false, pwdSkipped: false,
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
  return '<div class="profile"><h2>' + (isSuperPortal ? 'Super Admin Login' : 'Admin Login') + '</h2>' +
    '<p class="modal-sub">' + (isSuperPortal
      ? 'Super admin accounts only. Platform Control lives here, not in the Admin Portal.'
      : 'Admin accounts only. This page is not linked from the public site.') + '</p>' +
    '<form id="adminLogin" class="stack">' +
    '<label>Phone number <input type="tel" id="adPhone" required></label>' +
    '<label>Password <input type="password" id="adPass" required></label>' +
    '<button class="btn gold big" type="submit">Login</button></form>' +
    (state.offline ? '<p class="lock-note">Backend not configured yet — set DATABASE_URL and SESSION_SECRET in the Vercel project first.</p>' : '') +
    '<p class="modal-sub">' + (isSuperPortal
      ? 'Regular admin? Use the <a href="admin.html">Admin Portal</a>.'
      : 'Super admin? Use the <a href="super-admin.html">Super Admin Portal</a>.') + '</p>' +
    '</div>';
}
// The super-admin change-password prompt card (3rd sign-in rule):
// sits on top of every tab until the password is changed or Skip
// is tapped; Skip only snoozes it to the next sign-in.
function pwdPromptHTML() {
  return '<div class="card" style="border:2px solid var(--accent)"><h3>Change your password</h3>' +
    '<p class="muted">This is your 3rd sign-in as super admin. For security, set a fresh password now — or skip and you will be asked again on your next sign-in.</p>' +
    '<form id="pwdChangeForm" class="stack">' +
    '<label>Current password <input type="password" id="pwdCur" required></label>' +
    '<label>New password (at least 6 characters) <input type="password" id="pwdNew" required minlength="6"></label>' +
    '<div><button class="btn gold" type="submit">Change password</button> ' +
    '<button class="btn ghost" type="button" id="pwdSkip">Skip for now</button></div></form></div>';
}
function tabsHTML() {
  const tabs = [['dashboard', 'Dashboard'], ['queue', 'Payout Queue'], ['matches', 'Matches'], ['users', 'Users'], ['support', 'Support'], ['earnings', 'My Earnings']];
  if (superTools()) tabs.push(['control', 'Platform Control']);
  return '<div class="wtabs">' + tabs.map(([k, label]) =>
    '<button class="' + (state.tab === k ? 'on' : '') + '" data-atab="' + k + '">' + label + '</button>').join('') + '</div>';
}
function siteLink(path) { return location.origin + path; }
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
    '<div class="muted">' + (m.external_ref && String(m.external_ref).indexOf('espn:') === 0 ? 'ESPN · ' : m.external_ref && String(m.external_ref).indexOf('custom:') === 0 ? 'Featured · ' : 'Manual · ') + esc(m.league) + ' · ' + fmtDate(m.starts_at) + ' · ' + m.score_home + '-' + m.score_away + (m.minute != null ? ' · ' + m.minute + "'" : '') + '</div></div>' +
    chip(m.status) +
    '<span>' +
    (m.status === 'upcoming' ? '<button class="btn gold sm" data-golive="' + m.id + '">Go Live</button> ' : '') +
    (m.status === 'live' ? '<button class="btn ghost sm" data-score="' + m.id + '">Update Score</button> ' : '') +
    (m.status !== 'finished' ? '<button class="btn ghost sm" data-settle="' + m.id + '">Settle</button>' : '') +
    '</span></div>').join('');
  return tabsHTML() + featuredFormHTML() + form + '<div class="card"><h3>Matches</h3>' + (rows || '<p class="empty">No matches yet.</p>') + '</div>';
}
function usersHTML() {
  const rows = state.users.map(u =>
    '<div class="txrow"><div><b>' + esc(u.phone) + '</b>' +
    '<div class="muted">' + esc(u.display_name || '') + ' · joined ' + fmtDate(u.created_at) + ' · ' + u.deposits_completed + ' deposits · ' + u.bets_count + ' bets' + (u.inviter_phone ? ' · invited by ' + esc(u.inviter_phone) : '') + '</div></div>' +
    '<div>' + money(u.balance_ghs) + '</div>' + chip(u.status) +
    '<span class="muted">' + esc(u.role) + '</span>' +
    '<span>' + (superTools() ? '<button class="btn ghost sm" data-bal-edit="' + u.id + '">Edit Balance</button> ' : '') +
    '<button class="btn ghost sm" data-block="' + u.id + '" data-to="' + (u.status === 'blocked' ? 'active' : 'blocked') + '">' + (u.status === 'blocked' ? 'Unblock' : 'Block') + '</button>' +
    (superTools() && u.id !== state.user.id
      ? ' <button class="btn ghost sm" data-role="' + u.id + '" data-as="admin">Make Admin</button>' +
        ' <button class="btn ghost sm" data-role="' + u.id + '" data-as="super_admin">Make Super</button>' +
        ' <button class="btn ghost sm" data-role="' + u.id + '" data-as="player">Make Player</button>' +
        ' <button class="btn ghost sm" data-del-user="' + u.id + '">Delete</button>'
      : '') + '</span></div>').join('');
  return tabsHTML() + '<div class="card"><h3>Users</h3>' + (rows || '<p class="empty">No users yet.</p>') + '</div>';
}
function earningsHTML() {
  const d = state.myDash;
  if (!d) return tabsHTML() + '<div class="card"><p class="muted">Loading your dashboard…</p></div>';
  const c = d.commissions || {};
  const stat = (l, v) => '<div class="stat"><div class="muted">' + l + '</div><div class="stat-v">' + v + '</div></div>';
  const invited = (d.invited_users || []).map(u =>
    '<div class="txrow"><div><b>' + esc(u.phone) + '</b><div class="muted">' + esc(u.display_name || '') + ' · joined ' + fmtDate(u.created_at) + '</div></div>' +
    '<div>' + money(u.deposits_ghs) + ' deposited</div></div>').join('');
  const recent = (d.recent || []).map(r =>
    '<div class="txrow"><div><b>' + money(r.amount_ghs) + '</b><div class="muted">' + r.pct + '% of ' + money(r.basis_ghs) + ' · from ' + esc(r.from_phone) + ' · ' + fmtDate(r.created_at) + '</div></div>' +
    (r.paid_at ? chip('completed') : chip('pending')) + '</div>').join('');
  return tabsHTML() +
    '<div class="card"><h3>Your invite link</h3>' +
    '<p class="muted">Share this link — every user who registers through it is attributed to you, and you earn the commission rate the super admin sets on their deposits.</p>' +
    '<div class="manualbox"><div class="mannum" style="font-size:17px; letter-spacing:0">' + esc(siteLink(d.invite_path)) + '</div>' +
    '<button class="btn gold" data-copy="' + esc(siteLink(d.invite_path)) + '">Copy Link</button></div></div>' +
    '<div class="stats">' + stat('Commission earned', money(c.earned_ghs)) + stat('Paid out', money(c.paid_ghs)) + stat('Pending payout', money(c.pending_ghs)) + stat('Users invited', (d.invited_users || []).length) + '</div>' +
    '<div class="card"><h3>Users you invited</h3>' + (invited || '<p class="empty">No invited users yet — share your link.</p>') + '</div>' +
    '<div class="card"><h3>Recent commissions</h3>' + (recent || '<p class="empty">No commissions yet. They land here when an invited user\'s deposit is confirmed.</p>') + '</div>';
}
function controlHTML() {
  if (!superTools()) return tabsHTML() + '<div class="card"><p class="muted">Platform Control lives in the <a href="super-admin.html">Super Admin Portal</a>.</p></div>';
  const s = state.settings || {};
  const on = (v) => v === '1';
  const pending = state.users.filter(u => u.role === 'admin' && u.status === 'pending');
  const pendingRows = pending.map(u =>
    '<div class="txrow"><div><b>' + esc(u.phone) + '</b><div class="muted">' + esc(u.display_name || '') + ' · applied ' + fmtDate(u.created_at) + '</div></div>' +
    '<span><button class="btn gold sm" data-verify="' + u.id + '">Verify Admin</button> ' +
    '<button class="btn ghost sm" data-remove-admin="' + u.id + '">Remove</button></span></div>').join('');
  const commRows = ((state.myDash && state.myDash.admins) || []).map(a =>
    '<div class="txrow"><div><b>' + esc(a.phone) + '</b><div class="muted">' + esc(a.role) + ' · ' + a.invited_count + ' invited users</div></div>' +
    '<div>earned ' + money(a.earned) + ' · paid ' + money(a.paid) + ' · <b>pending ' + money(a.pending) + '</b></div>' +
    (a.pending > 0 ? '<span><button class="btn gold sm" data-payout="' + a.id + '">Pay Out</button></span>' : '') + '</div>').join('');
  const userOpts = state.users.map(u => '<option value="' + u.id + '">' + esc(u.phone) + ' (' + esc(u.role) + ')</option>').join('');
  const inviteRows = state.invites.map(i =>
    '<div class="txrow"><div><b>' + esc(i.kind) + ' invite</b><div class="muted">expires ' + fmtDate(i.expires_at) + '</div></div>' +
    '<button class="btn ghost sm" data-copy="' + esc(siteLink('/?admin_invite=' + i.token)) + '">Copy Link</button></div>').join('');
  return tabsHTML() +
    '<div class="card"><h3>Switches</h3>' +
    '<div class="txrow"><div><b>ShinobiPay gateway</b><div class="muted">Off = instant MoMo deposits stop; manual transfer keeps working.</div></div>' +
    '<button class="btn ' + (on(s.gateway_enabled) ? 'gold' : 'ghost') + ' sm" data-toggle="gateway">' + (on(s.gateway_enabled) ? 'ON' : 'OFF') + '</button></div>' +
    '<div class="txrow"><div><b>Payouts</b><div class="muted">Frozen = users cannot request withdrawals and the queue cannot confirm them.</div></div>' +
    '<button class="btn ' + (on(s.payouts_frozen) ? 'gold' : 'ghost') + ' sm" data-toggle="freeze">' + (on(s.payouts_frozen) ? 'FROZEN' : 'OPEN') + '</button></div></div>' +
    '<div class="card"><h3>Commission rates</h3><form id="ratesForm" class="stack">' +
    '<label>Referral commission % (of a referred user\'s deposits, paid to whoever invited them) <input type="number" id="rateAdmin" step="0.1" min="0" max="50" value="' + esc(s.admin_commission_pct || '0') + '"></label>' +
    '<label>User cashback % (of their own deposit, credited back instantly) <input type="number" id="rateUser" step="0.1" min="0" max="50" value="' + esc(s.user_cashback_pct || '0') + '"></label>' +
    '<button class="btn gold big" type="submit">Save Rates</button></form></div>' +
    '<div class="card"><h3>Give a bonus</h3><form id="bonusForm" class="stack">' +
    '<label>Who <select id="bonusScope"><option value="all">All active players</option><option value="one">One account</option></select></label>' +
    '<label>Account (for "One account") <select id="bonusUser">' + userOpts + '</select></label>' +
    '<label>Amount (GHS) <input type="number" id="bonusAmt" step="0.01" min="0.01" required></label>' +
    '<label>Note <input type="text" id="bonusNote" placeholder="e.g. Weekend bonus"></label>' +
    '<button class="btn gold big" type="submit">Send Bonus</button></form></div>' +
    '<div class="card"><h3>Admin invites</h3>' +
    '<p class="muted">A timed, one-time link. An <b>admin</b> link creates a pending admin you verify below. A <b>super admin</b> link creates an active super admin immediately — share those carefully.</p>' +
    (state.lastInvite ? '<div class="manualbox"><div class="mannum" style="font-size:14px; letter-spacing:0; word-break:break-all">' + esc(state.lastInvite) + '</div><button class="btn gold" data-copy="' + esc(state.lastInvite) + '">Copy Link</button></div>' : '') +
    '<form id="inviteForm" class="stack">' +
    '<label>Link type <select id="invKind"><option value="admin">Admin (needs verification)</option><option value="super_admin">Super admin (active at once)</option></select></label>' +
    '<label>Expires after (hours) <input type="number" id="invHours" value="48" min="1" max="168"></label>' +
    '<button class="btn gold big" type="submit">Generate Invite Link</button></form>' +
    (inviteRows ? '<h4>Outstanding links</h4>' + inviteRows : '') + '</div>' +
    '<div class="card"><h3>Pending admin verifications</h3>' + (pendingRows || '<p class="empty">No admins waiting for verification.</p>') + '</div>' +
    '<div class="card"><h3>Referral commissions</h3>' + (commRows || '<p class="empty">No referral earnings yet.</p>') + '</div>';
}
function featuredFormHTML() {
  if (!superTools()) return '';
  return '<div class="card"><h3>Create a featured match (super admin)</h3>' +
    '<p class="muted">Your own game: it goes live by itself at kickoff, the clock and score run from your goal schedule, and it settles on the final scheduled score. Double Chance, Over/Under and BTTS prices are built from your 1X2 line.</p>' +
    '<form id="featForm" class="stack">' +
    '<label>League <input type="text" id="ffLeague" placeholder="PrimeStake Featured" required></label>' +
    '<label>Home team <input type="text" id="ffHome" required></label>' +
    '<label>Away team <input type="text" id="ffAway" required></label>' +
    '<label>Kickoff <input type="datetime-local" id="ffStart" required></label>' +
    '<div class="oddsgrid">' +
    '<label>1 (home) <input type="number" step="0.01" min="1.01" id="ff_o1" required></label>' +
    '<label>X (draw) <input type="number" step="0.01" min="1.01" id="ff_ox" required></label>' +
    '<label>2 (away) <input type="number" step="0.01" min="1.01" id="ff_o2" required></label></div>' +
    '<label>Goal schedule — minute:side, comma separated <input type="text" id="ffGoals" placeholder="e.g. 23:home, 57:away, 81:home"></label>' +
    '<button class="btn gold big" type="submit">Create Featured Match</button></form></div>';
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
    (isSuperPortal
      ? '<a class="btn ghost" href="admin.html">Admin Portal</a> '
      : (state.user.role === 'super_admin' ? '<a class="btn ghost" href="super-admin.html">Super Portal</a> ' : '')) +
    '<button class="btn ghost" id="adminLogout">Logout</button>';
  $('#adminLogout').addEventListener('click', () => {
    state.user = null; state.token = '';
    localStorage.removeItem('ps_admin_token');
    render();
  });
  root.innerHTML =
    (state.pwdPrompt && !state.pwdSkipped ? pwdPromptHTML() : '') +
    (state.tab === 'dashboard' ? dashboardHTML() :
    state.tab === 'queue' ? tabsHTML() + queueHTML(false) :
    state.tab === 'matches' ? matchesHTML() :
    state.tab === 'users' ? usersHTML() :
    state.tab === 'earnings' ? earningsHTML() :
    state.tab === 'control' ? controlHTML() : supportHTML());
  const skipBtn = $('#pwdSkip');
  if (skipBtn) skipBtn.addEventListener('click', () => { state.pwdSkipped = true; render(); });
}
async function loadAll() {
  try {
    const jobs = [
      api('/admin/stats'), api('/admin/queue'), api('/admin/matches'), api('/admin/users'), api('/admin/support'),
      api('/admin/settings').catch(() => null), api('/admin/my-dashboard').catch(() => null)
    ];
    if (superTools()) jobs.push(api('/admin/invite-admin').catch(() => null));
    const [stats, queue, matches, users, support, settings, myDash, invites] = await Promise.all(jobs);
    state.stats = stats.stats; state.queue = queue.queue; state.matches = matches.matches;
    state.users = users.users; state.support = support.messages;
    if (settings) state.settings = settings.settings;
    if (myDash) state.myDash = myDash;
    if (invites) state.invites = invites.invites || [];
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
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    if (navigator.clipboard) navigator.clipboard.writeText(copyBtn.dataset.copy).catch(() => {});
    toast('Copied: ' + copyBtn.dataset.copy);
    return;
  }
  const toggleBtn = e.target.closest('[data-toggle]');
  if (toggleBtn) {
    const s = state.settings || {};
    try {
      const body = toggleBtn.dataset.toggle === 'gateway'
        ? { gateway_enabled: s.gateway_enabled !== '1' }
        : { payouts_frozen: s.payouts_frozen !== '1' };
      const data = await api('/admin/settings', { method: 'POST', body });
      state.settings = data.settings;
      toast('Settings saved.');
      render();
    } catch (err) { toast(err.message); }
    return;
  }
  const verifyBtn = e.target.closest('[data-verify]');
  if (verifyBtn) {
    try { await api('/admin/verify-admin', { method: 'POST', body: { id: verifyBtn.dataset.verify, action: 'verify' } }); toast('Admin verified.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const removeBtn = e.target.closest('[data-remove-admin]');
  if (removeBtn) {
    try { await api('/admin/verify-admin', { method: 'POST', body: { id: removeBtn.dataset.removeAdmin, action: 'remove' } }); toast('Admin removed.'); loadAll(); }
    catch (err) { toast(err.message); }
    return;
  }
  const payoutBtn = e.target.closest('[data-payout]');
  if (payoutBtn) {
    try {
      const data = await api('/admin/payout', { method: 'POST', body: { earner_id: payoutBtn.dataset.payout } });
      toast('Paid out ' + money(data.paid_ghs) + ' (' + data.entries + ' entries).');
      loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
  const balBtn = e.target.closest('[data-bal-edit]');
  if (balBtn) {
    const u = state.users.find(x => x.id === balBtn.dataset.balEdit);
    const delta = prompt('Adjust balance for ' + (u ? u.phone : '') + ' (current ' + (u ? money(u.balance_ghs) : '') + '). Enter a signed amount, e.g. 50 or -20:');
    if (delta === null) return;
    const note = prompt('Reason for this adjustment (shown in their transactions):', 'Balance adjustment');
    if (note === null) return;
    try {
      const data = await api('/admin/balance-edit', { method: 'POST', body: { id: balBtn.dataset.balEdit, delta_ghs: Number(delta), note } });
      toast('New balance: ' + money(data.balance_ghs));
      loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
  const delBtn = e.target.closest('[data-del-user]');
  if (delBtn) {
    const u = state.users.find(x => x.id === delBtn.dataset.delUser);
    if (!confirm('Permanently delete ' + (u ? u.phone : 'this account') + ' and all its bets, deposits and history? This cannot be undone.')) return;
    try {
      const data = await api('/admin/delete-user', { method: 'POST', body: { id: delBtn.dataset.delUser } });
      toast('Deleted ' + data.deleted + '.');
      loadAll();
    } catch (err) { toast(err.message); }
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
      if (!portalAllows(data.user)) {
        toast(isSuperPortal
          ? 'That account is not a super admin account — use the Admin Portal instead.'
          : 'That account is not an admin account.');
        return;
      }
      state.token = data.token;
      localStorage.setItem('ps_admin_token', data.token);
      state.user = data.user;
      // Super-admin 3rd-sign-in password prompt (server decides via
      // data.pwdPrompt); Skip hides it for this session only.
      state.pwdPrompt = !!data.pwdPrompt;
      state.pwdSkipped = false;
      loadAll();
    } catch (err) { toast(err.message); render(); }
  } else if (e.target.id === 'pwdChangeForm') {
    e.preventDefault();
    try {
      await api('/auth/password', { method: 'POST', body: { current_password: $('#pwdCur').value, new_password: $('#pwdNew').value } });
      state.pwdPrompt = false;
      toast('Password changed. You will not be asked again.');
      render();
    } catch (err) { toast(err.message); }
  } else if (e.target.id === 'ratesForm') {
    e.preventDefault();
    try {
      const data = await api('/admin/settings', {
        method: 'POST',
        body: { admin_commission_pct: Number($('#rateAdmin').value), user_cashback_pct: Number($('#rateUser').value) }
      });
      state.settings = data.settings;
      toast('Rates saved.');
      render();
    } catch (err) { toast(err.message); }
  } else if (e.target.id === 'bonusForm') {
    e.preventDefault();
    const scope = $('#bonusScope').value;
    try {
      const data = await api('/admin/bonus', {
        method: 'POST',
        body: { scope, user_id: scope === 'one' ? $('#bonusUser').value : undefined, amount_ghs: Number($('#bonusAmt').value), note: $('#bonusNote').value.trim() || undefined }
      });
      toast('Bonus sent to ' + data.credited + ' account(s): ' + money(data.amount_ghs) + ' each.');
      loadAll();
    } catch (err) { toast(err.message); }
  } else if (e.target.id === 'inviteForm') {
    e.preventDefault();
    try {
      const data = await api('/admin/invite-admin', {
        method: 'POST',
        body: { kind: $('#invKind').value, hours: Number($('#invHours').value) || 48 }
      });
      state.lastInvite = siteLink(data.path);
      toast('Invite link generated — it expires ' + fmtDate(data.expires_at) + '.');
      loadAll();
    } catch (err) { toast(err.message); }
  } else if (e.target.id === 'featForm') {
    e.preventDefault();
    const goals = $('#ffGoals').value.split(',').map(x => x.trim()).filter(Boolean).map(part => {
      const [min, side] = part.split(':').map(y => (y || '').trim());
      return { minute: Number(min), side: side === 'away' ? 'away' : 'home' };
    }).filter(g => g.minute >= 1 && g.minute <= 90);
    try {
      await api('/admin/create-match', {
        method: 'POST',
        body: {
          league: $('#ffLeague').value.trim(), home_team: $('#ffHome').value.trim(), away_team: $('#ffAway').value.trim(),
          starts_at: new Date($('#ffStart').value).toISOString(),
          o1: Number($('#ff_o1').value), ox: Number($('#ff_ox').value), o2: Number($('#ff_o2').value), goals
        }
      });
      toast('Featured match created — it plays by the clock from kickoff.');
      loadAll();
    } catch (err) { toast(err.message); }
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
      if (portalAllows(data.user)) { state.user = data.user; loadAll(); return; }
      // Valid admin-tier session, wrong portal for this account: keep the
      // token (it belongs to the other portal) and just show this login.
      if (data.user.role === 'admin' || data.user.role === 'super_admin') { render(); return; }
    } catch (e) { /* fall through to login */ }
    state.token = '';
    localStorage.removeItem('ps_admin_token');
    render();
  }
})();
