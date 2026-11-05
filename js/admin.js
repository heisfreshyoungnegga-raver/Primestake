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
  // Set when this page was opened from a super admin's invite link:
  // the portal then shows its own admin account-creation page
  // instead of the login form (Prince, 2026-11-05).
  invite: new URLSearchParams(location.search).get('admin_invite') || '',
  inviteDone: '',
  bookingCodes: [], bcBuilder: [], bcMatch: '', bcMarket: '1X2', bcDraft: {}, lastCode: '',
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
// Full-screen viewer for a deposit's transaction screenshot; tap
// anywhere to close. The image arrives as a data URL from the API.
function showProof(src) {
  const old = $('#proofOverlay');
  if (old) old.remove();
  const d = document.createElement('div');
  d.id = 'proofOverlay';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:99;display:flex;align-items:center;justify-content:center;padding:16px';
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:100%;max-height:100%;border-radius:8px';
  d.appendChild(img);
  d.addEventListener('click', () => d.remove());
  document.body.appendChild(d);
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
    '<label>Phone number or email <input type="text" id="adPhone" required></label>' +
    '<label>Password <input type="password" id="adPass" required></label>' +
    '<button class="btn gold big" type="submit">Login</button></form>' +
    (state.offline ? '<p class="lock-note">Backend not configured yet — set DATABASE_URL and SESSION_SECRET in the Vercel project first.</p>' : '') +
    '<p class="modal-sub">' + (isSuperPortal
      ? 'Regular admin? Use the <a href="admin.html">Admin Portal</a>.'
      : 'Super admin? Use the <a href="super-admin.html">Super Admin Portal</a>.') + '</p>' +
    '</div>';
}
function tabsHTML() {
  const tabs = [['dashboard', 'Dashboard'], ['queue', 'Payout Queue'], ['users', 'Users'], ['support', 'Support'], ['earnings', 'My Earnings']];
  // Matches live ONLY in the Super Portal (Prince, 2026-11-05,
  // same rule as Oddaroa) — creating, going live and settling are
  // super admin work; feed + featured bets auto-settle server-side.
  if (isSuperPortal) tabs.splice(2, 0, ['matches', 'Matches']);
  if (superTools()) { tabs.splice(1, 0, ['guide', 'Setup Guide']); tabs.push(['codes', 'Booking Codes']); tabs.push(['control', 'Platform Control']); }
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
  return tabsHTML() +
    (superTools() ? '<div class="card"><h3>New here?</h3><p class="muted">The Setup Guide tab walks a new super admin through every job in this portal, with a named demo box for each card.</p><button class="btn gold" data-atab="guide">Open the Setup Guide</button></div>' : '') +
    '<div class="stats">' + grid + '</div>' + espnHTML() + queueHTML(true);
}
function queueHTML(compact) {
  const rows = state.queue.map(q =>
    '<div class="txrow"><div><b>' + esc(q.kind) + ' · ' + esc(q.phone) + '</b>' +
    '<div class="muted">' + fmtDate(q.created_at) + ' · ' + esc(q.method || '') + (q.external_ref ? ' · Ref ' + esc(q.external_ref) : '') + '</div></div>' +
    '<div>' + money(q.amount_ghs) + '</div>' +
    '<span>' + (q.has_proof ? '<button class="btn ghost sm" data-proof="' + q.id + '">Screenshot</button> ' : '') +
    // Withdrawals are decided by the super admin only (Prince's rule,
    // 2026-11-04) — everyone else sees the row but no action buttons.
    // The API enforces the same rule, so this is presentation only.
    ((q.kind === 'withdrawal' && !superTools())
      ? '<span class="muted">Super admin only</span>'
      : '<button class="btn gold sm" data-confirm="' + q.id + '">Confirm</button> ' +
        '<button class="btn ghost sm" data-reject="' + q.id + '">Reject</button>') + '</span></div>').join('');
  return '<div class="card"><h3>Deposits &amp; withdrawals queue</h3>' +
    (rows || '<p class="empty">Nothing waiting for review.</p>') + '</div>' +
    (compact ? '' : '<p class="muted">Confirming a deposit credits the player and counts it toward their withdrawal unlock. Rejecting a withdrawal refunds the held amount. Withdrawal decisions are super-admin only.</p>');
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
    (superTools() ? '<button class="btn ghost sm" data-bc-for="' + m.id + '">🎟 Code</button> ' : '') +
    (m.status === 'upcoming' ? '<button class="btn gold sm" data-golive="' + m.id + '">Go Live</button> ' : '') +
    (m.status === 'live' ? '<button class="btn ghost sm" data-score="' + m.id + '">Update Score</button> ' : '') +
    (m.status !== 'finished'
      ? (superTools()
        // Super admins set the correct/final score right in the row:
        // two small boxes (home, away) with the box name above them.
        ? '<span class="scorebox"><span class="sb-name">Final score · Home – Away</span>' +
          '<span class="sb-row"><input type="number" min="0" max="30" id="fsh-' + m.id + '" value="' + (m.score_home || 0) + '" aria-label="Home goals">' +
          '<span class="muted">–</span>' +
          '<input type="number" min="0" max="30" id="fsa-' + m.id + '" value="' + (m.score_away || 0) + '" aria-label="Away goals">' +
          '<button class="btn gold sm" data-setscore="' + m.id + '">Set Final Score</button></span></span>'
        : '<button class="btn ghost sm" data-settle="' + m.id + '">Settle</button>')
      : '') +
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
  const req = d.payout_request;
  const payCard = '<div class="card"><h3>Commission payout</h3>' + (req
    ? '<p class="muted">You asked for a payout of <b>' + money(req.amount_ghs) + '</b> · ' + fmtDate(req.created_at) + '. The super admin settles it from their portal — once paid, the money lands in your wallet balance on the site, ready to withdraw.</p>'
    : Number(c.pending_ghs || 0) > 0
      ? '<p class="muted">You have <b>' + money(c.pending_ghs) + '</b> waiting. Request a payout and the super admin will settle it into your wallet balance, ready to withdraw from the site Wallet.</p><button class="btn gold" data-request-payout>Request Payout</button>'
      : '<p class="muted">Nothing waiting right now. When users you invited deposit, your commission gathers here and you can request a payout.</p>') + '</div>';
  return tabsHTML() +
    '<div class="card"><h3>Your invite link</h3>' +
    '<p class="muted">Share this link — every user who registers through it is attributed to you, and you earn the commission rate the super admin sets on their deposits.</p>' +
    '<div class="manualbox"><div class="mannum" style="font-size:17px; letter-spacing:0">' + esc(siteLink(d.invite_path)) + '</div>' +
    '<button class="btn gold" data-copy="' + esc(siteLink(d.invite_path)) + '">Copy Link</button></div></div>' +
    '<div class="stats">' + stat('Commission earned', money(c.earned_ghs)) + stat('Paid out', money(c.paid_ghs)) + stat('Pending payout', money(c.pending_ghs)) + stat('Users invited', (d.invited_users || []).length) + '</div>' +
    payCard +
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
    '<div>earned ' + money(a.earned) + ' · paid ' + money(a.paid) + ' · <b>pending ' + money(a.pending) + '</b>' +
    (a.payout_requested_ghs != null ? '<div><b style="color:var(--gold)">Payout requested ' + money(a.payout_requested_ghs) + '</b></div>' : '') + '</div>' +
    (a.pending > 0 ? '<span><button class="btn gold sm" data-payout="' + a.id + '">Pay Out</button></span>' : '') + '</div>').join('');
  const userOpts = state.users.map(u => '<option value="' + u.id + '">' + esc(u.phone) + ' (' + esc(u.role) + ')</option>').join('');
  const inviteRows = state.invites.map(i =>
    '<div class="txrow"><div><b>' + esc(i.kind) + ' invite</b><div class="muted">expires ' + fmtDate(i.expires_at) + '</div></div>' +
    '<button class="btn ghost sm" data-copy="' + esc(siteLink('/admin.html?admin_invite=' + i.token)) + '">Copy Link</button></div>').join('');
  return tabsHTML() +
    '<div class="card"><h3>Switches</h3>' +
    '<div class="txrow"><div><b>ShinobiPay gateway</b><div class="muted">Off = instant MoMo deposits stop; manual transfer keeps working.</div></div>' +
    '<button class="btn ' + (on(s.gateway_enabled) ? 'gold' : 'ghost') + ' sm" data-toggle="gateway">' + (on(s.gateway_enabled) ? 'ON' : 'OFF') + '</button></div>' +
    '<div class="txrow"><div><b>Payouts</b><div class="muted">Frozen = users cannot request withdrawals and the queue cannot confirm them.</div></div>' +
    '<button class="btn ' + (on(s.payouts_frozen) ? 'gold' : 'ghost') + ' sm" data-toggle="freeze">' + (on(s.payouts_frozen) ? 'FROZEN' : 'OPEN') + '</button></div></div>' +
    '<div class="card"><h3>Commission rates</h3><form id="ratesForm" class="stack">' +
    '<label>Referral commission % (of a referred user\'s deposits, paid to whoever invited them) <input type="number" id="rateAdmin" step="0.1" min="0" max="100" value="' + esc(s.admin_commission_pct || '0') + '"></label>' +
    '<label>User cashback % (of their own deposit, credited back instantly) <input type="number" id="rateUser" step="0.1" min="0" max="100" value="' + esc(s.user_cashback_pct || '0') + '"></label>' +
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
// Setup Guide — super-admin portal only. Every demo below is a boxed
// example with its box name labelled above it, so a new super admin can
// match what they see here to the real card in Platform Control, the
// Payout Queue or Matches. Demo buttons are disabled on purpose: nothing
// in this tab can change the platform.
// Booking-code builder catalogue — market/pick labels match the
// player app exactly (server validates with the same keyFor map).
const BOOK_MARKETS = {
  '1X2': ['1', 'X', '2'],
  'Double Chance': ['1X', '12', 'X2'],
  'Over/Under 0.5': ['Over 0.5', 'Under 0.5'],
  'Over/Under 1.5': ['Over 1.5', 'Under 1.5'],
  'Over/Under 2.5': ['Over 2.5', 'Under 2.5'],
  'Over/Under 3.5': ['Over 3.5', 'Under 3.5'],
  'Over/Under 4.5': ['Over 4.5', 'Under 4.5'],
  'Both Teams To Score': ['Yes', 'No'],
  'Correct Score': ['1-0', '2-0', '2-1', '3-0', '3-1', '3-2', '4-0', '4-1', '4-2', '5-0', '5-1', '0-0', '1-1', '2-2', '3-3', '0-1', '0-2', '1-2', '0-3', '1-3', '2-3', '0-4', '1-4', '2-4', '0-5', '1-5'],
};
function bcMatchLabel(id) {
  const m = state.matches.find(x => x.id === id);
  return m ? m.home_team + ' vs ' + m.away_team : 'Match';
}
function codesHTML() {
  if (!superTools()) return tabsHTML() + '<div class="card"><p class="muted">Booking Codes live in the <a href="super-admin.html">Super Admin Portal</a> — super admins mint the codes and sell them to their users.</p></div>';
  const d = state.bcDraft || {};
  const open = state.matches.filter(m => m.status !== 'finished');
  const matchOpts = open.map(m =>
    '<option value="' + m.id + '"' + (state.bcMatch === m.id ? ' selected' : '') + '>' +
    esc(m.home_team) + ' vs ' + esc(m.away_team) + ' · ' + esc(m.league) + ' · ' + fmtDate(m.starts_at) + '</option>').join('');
  const market = state.bcMarket || '1X2';
  const marketOpts = Object.keys(BOOK_MARKETS).map(k => '<option' + (market === k ? ' selected' : '') + '>' + k + '</option>').join('');
  const pickOpts = BOOK_MARKETS[market].map(p => '<option>' + p + '</option>').join('');
  const built = state.bcBuilder.map((b, i) =>
    '<div class="txrow"><div><b>' + esc(b.label) + '</b><div class="muted">' + esc(b.market) + ' · ' + esc(b.pick) + '</div></div>' +
    '<span><button class="btn ghost sm" data-bc-rm="' + i + '">Remove</button></span></div>').join('');
  const codeRows = state.bookingCodes.map(c => {
    const sels = (Array.isArray(c.selections) ? c.selections : []).map(s =>
      '<div class="muted">' + esc(bcMatchLabel(s.match_id)) + ' — ' + esc(s.market) + ': <b>' + esc(s.pick) + '</b></div>').join('');
    return '<div class="txrow"><div><div class="mannum" style="font-size:22px; letter-spacing:2px">' + esc(c.code) + '</div>' +
      (c.label ? '<b>' + esc(c.label) + '</b>' : '') + sels +
      '<div class="muted">Used ' + c.uses + (c.max_uses ? ' of ' + c.max_uses : ' (unlimited)') + ' · ' + c.bets_placed + ' bet(s) placed' +
      (c.price_ghs ? ' · sold at ' + money(c.price_ghs) : '') +
      (c.expires_at ? ' · expires ' + fmtDate(c.expires_at) : ' · no expiry') +
      ' · by ' + esc(c.creator_phone || c.creator_email || '') + '</div></div>' +
      chip(c.status) +
      '<span><button class="btn gold sm" data-copy="' + esc(c.code) + '">Copy Code</button> ' +
      (c.status === 'active' ? '<button class="btn ghost sm" data-bc-revoke="' + c.id + '">Revoke</button>' : '') + '</span></div>';
  }).join('');
  return tabsHTML() +
    '<div class="card"><h3>🎟 Create a booking code</h3>' +
    '<p class="muted">Build the slip, tap Generate, and you get a <b>5-digit code</b> you can sell or share. A player enters the code on the Booking Codes page and your exact selections land on their betslip. A use is only counted when they actually place the bet.</p>' +
    '<div class="stack">' +
    '<label>Match <select id="bcMatch">' + (matchOpts || '<option value="">No open matches</option>') + '</select></label>' +
    '<div class="frow"><label>Market <select id="bcMarket">' + marketOpts + '</select></label>' +
    '<label>Pick <select id="bcPick">' + pickOpts + '</select></label></div>' +
    '<button class="btn ghost big" data-bc-add>Add Selection</button>' +
    (built || '<p class="empty">No selections yet — add at least one.</p>') +
    '<label>Label (optional) <input type="text" id="bcLabel" placeholder="e.g. Saturday sure slip" value="' + esc(d.label || '') + '"></label>' +
    '<div class="frow"><label>Price you sell it at, GHS (optional) <input type="number" step="0.01" min="0" id="bcPrice" placeholder="Blank = free" value="' + esc(d.price || '') + '"></label>' +
    '<label>Max uses (optional) <input type="number" step="1" min="1" id="bcMaxUses" placeholder="Blank = unlimited" value="' + esc(d.max || '') + '"></label>' +
    '<label>Expires in hours (optional) <input type="number" step="1" min="1" id="bcExp" placeholder="Blank = never" value="' + esc(d.exp || '') + '"></label></div>' +
    '<button class="btn gold big" data-bc-gen>Generate Booking Code</button>' +
    (state.lastCode ? '<div class="manualbox"><div class="mannum" style="font-size:26px; letter-spacing:3px">' + esc(state.lastCode) + '</div><button class="btn gold" data-copy="' + esc(state.lastCode) + '">Copy Code</button></div>' : '') +
    '</div></div>' +
    '<div class="card"><h3>Your booking codes</h3>' + (codeRows || '<p class="empty">No codes yet.</p>') + '</div>';
}
function guideHTML() {
  if (!superTools()) return tabsHTML() + '<div class="card"><p class="muted">The Setup Guide lives in the <a href="super-admin.html">Super Admin Portal</a>.</p></div>';
  const box = (name, inner) =>
    '<div class="gwrap"><div class="gname">' + name + '</div>' +
    '<div class="gbox"><span class="demotag">DEMO EXAMPLE</span>' + inner + '</div></div>';
  const dBtn = (label, gold) => '<button class="btn ' + (gold ? 'gold' : 'ghost') + ' sm" disabled>' + label + '</button>';
  return tabsHTML() +
    '<div class="card"><h3>Welcome, Super Admin</h3>' +
    '<p class="muted">This portal is the master key to PrimeStake: switches, commission rates, admin invites, role changes and balance edits live here and nowhere else. Work through the boxes below once and you know the whole job. Each box is named above it, exactly like the real card it teaches. Everything inside a box is a demo — the buttons do nothing.</p></div>' +
    '<div class="ggrid">' +
    box('1 · FIRST DAY CHECKLIST',
      '<ol class="gsteps">' +
      '<li>Open <b>Platform Control</b> and check the two switches (box 2).</li>' +
      '<li>Set the commission rates so your admins actually earn (box 3).</li>' +
      '<li>On <b>Dashboard</b>, run <b>Sync From ESPN</b> so today\'s matches load.</li>' +
      '<li>Invite your admins with an invite link (box 4), then verify them (box 5).</li>' +
      '<li>Check the <b>Payout Queue</b> every day and clear what is waiting (box 6).</li>' +
      '</ol>') +
    box('2 · SWITCHES — Platform Control',
      '<div class="txrow"><div><b>ShinobiPay gateway</b><div class="muted">ON = instant MoMo deposits work. OFF = manual transfer only.</div></div>' + dBtn('ON', true) + '</div>' +
      '<div class="txrow"><div><b>Payouts</b><div class="muted">OPEN = players can withdraw. FROZEN = withdrawals and queue confirmations stop.</div></div>' + dBtn('OPEN', true) + '</div>' +
      '<p class="muted">Find the real switches at the top of the <b>Platform Control</b> tab.</p>') +
    box('3 · COMMISSION RATES — Platform Control',
      '<div class="txrow"><div><b>Referral commission %</b><div class="muted">Paid to the admin who invited a player, on every deposit that player makes.</div></div><div><b>5%</b></div></div>' +
      '<div class="txrow"><div><b>User cashback %</b><div class="muted">Credited back to the player on their own deposit.</div></div><div><b>0%</b></div></div>' +
      '<p class="muted">Worked example: a player deposits <b>GHS 200.00</b> → the inviting admin earns <b>GHS 10.00</b> at 5%. At 0% nobody earns anything.</p>') +
    box('4 · ADMIN INVITES — Platform Control',
      '<p class="muted">A one-time link that expires. Share it privately with one person only.</p>' +
      '<div class="manualbox"><div class="mannum" style="font-size:13px; letter-spacing:0; word-break:break-all">https://primesstake.site/admin.html?admin_invite=DEMO-LINK-EXAMPLE</div></div>' +
      '<div class="txrow"><div><b>Admin link</b><div class="muted">Creates a <b>pending</b> admin — you verify them in box 5 before they can work.</div></div></div>' +
      '<div class="txrow"><div><b>Super admin link</b><div class="muted">Creates an <b>active</b> super admin at once. Same powers as you — share with extreme care.</div></div></div>') +
    box('5 · PENDING ADMIN VERIFICATIONS — Platform Control',
      '<div class="txrow"><div><b>0244 000 000</b><div class="muted">Demo Admin · applied today</div></div>' +
      '<span>' + dBtn('Verify Admin', true) + ' ' + dBtn('Remove') + '</span></div>' +
      '<p class="muted">Only verify people you personally invited. <b>Remove</b> deletes the pending account.</p>') +
    box('6 · PAYOUT QUEUE — Payout Queue tab',
      '<div class="txrow"><div><b>deposit · 0244 000 000</b><div class="muted">today · MoMo manual · Ref DEMO123</div></div>' +
      '<div>GHS 150.00</div><span>' + dBtn('Screenshot') + ' ' + dBtn('Confirm', true) + ' ' + dBtn('Reject') + '</span></div>' +
      '<p class="muted">For a manual deposit, open the <b>Screenshot</b> and match the amount and reference before you <b>Confirm</b> — confirming credits the player and counts toward their 6 deposits to unlock withdrawals. <b>Reject</b> on a withdrawal refunds the held amount.</p>') +
    box('7 · FEATURED MATCH — Matches tab',
      '<div class="txrow"><div><b>Accra Falcons vs Kumasi Royals</b><div class="muted">Featured · PrimeStake Featured · kicks off in 30 mins</div></div>' + chip('upcoming') + '</div>' +
      '<p class="muted">Three ways to fill the form: leave everything blank and the system invents teams, odds and the goal schedule; type only the two team names (tap the 🎲 dice for random names) and it fills the rest; or type your own odds and goals — what you type is always kept, only blanks are generated.</p>') +
    box('8 · BOOKING CODES — Booking Codes tab',
      '<div class="txrow"><div><div class="mannum" style="font-size:20px; letter-spacing:2px">48392</div><div class="muted">Saturday sure slip · Used 3 of 10 · sold at GHS 20.00</div></div>' + dBtn('Copy Code', true) + '</div>' +
      '<p class="muted">Mint a <b>5-digit code</b> for any slip you build — start from the 🎟 Code button on a match you just created. Sell the code to your users; when a player loads it, your exact selections land on their slip, and a use is counted only when they place the bet. Set max uses and an expiry so the code dies after matchday, and Revoke any code instantly.</p>') +
    box('9 · SAFETY RULES — read once, follow always',
      '<ol class="gsteps">' +
      '<li>A super admin invite link is a master key. Never post one publicly.</li>' +
      '<li>Never confirm a deposit you have not seen proof for.</li>' +
      '<li>Role changes and balance edits (Users tab) are super-admin only — double-check the account before you tap.</li>' +
      '<li>If money looks wrong, freeze payouts first (box 2), then investigate.</li>' +
      '</ol>') +
    '</div>';
}
// Random fictional team names for the featured-match dice buttons
// (the server has the same bank for fully-blank submissions).
const TEAM_A = ['Accra', 'Tema', 'Kumasi', 'Osu', 'Spintex', 'Takoradi', 'Madina', 'Legon', 'Achimota', 'Dansoman', 'Kasoa', 'Ho', 'Tamale', 'Cape Coast', 'Sunyani', 'Koforidua', 'Nungua', 'Teshie', 'Ashaiman', 'Winneba'];
const TEAM_B = ['Falcons', 'Royals', 'Iron', 'City', 'Stars', 'Lions', 'Warriors', 'United', 'Rovers', 'Athletic', 'Giants', 'Eagles', 'Sharks', 'Kings', 'Pirates', 'Rangers'];
function randomTeamName(taken) {
  let n = '';
  do { n = TEAM_A[Math.floor(Math.random() * TEAM_A.length)] + ' ' + TEAM_B[Math.floor(Math.random() * TEAM_B.length)]; } while (n === taken);
  return n;
}
function toLocalInput(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function featuredFormHTML() {
  if (!superTools()) return '';
  // Guided four-step layout (Prince's ask, 2026-11-03 late): the
  // old flat list confused even him on mobile. Every step says in
  // plain words what happens to a blank — it is created for you,
  // including single odds prices: fill any of 1/X/2 and the rest
  // are priced around yours.
  return '<div class="card"><h3>➕ Create a featured match</h3>' +
    '<p class="muted">Fill only what you want — <b>every blank is created for you</b> when you tap Create. The game goes live by itself at kickoff and settles itself at full time.</p>' +
    '<form id="featForm" class="stack">' +
    '<fieldset class="fstep"><legend>1 · Teams</legend>' +
    '<label>League <input type="text" id="ffLeague" placeholder="Blank = PrimeStake Featured"></label>' +
    '<div class="frow"><label>Home team <input type="text" id="ffHome" placeholder="Blank = random team"></label>' +
    '<button class="btn ghost" type="button" data-dice="ffHome">🎲</button></div>' +
    '<div class="frow"><label>Away team <input type="text" id="ffAway" placeholder="Blank = random team"></label>' +
    '<button class="btn ghost" type="button" data-dice="ffAway">🎲</button></div>' +
    '<p class="muted sm">🎲 picks a random team name on the spot.</p></fieldset>' +
    '<fieldset class="fstep"><legend>2 · Kickoff</legend>' +
    '<label>Starts at <input type="datetime-local" id="ffStart"></label>' +
    '<div class="chiprow"><button class="btn ghost sm" type="button" data-kick="15">In 15 min</button> <button class="btn ghost sm" type="button" data-kick="60">In 1 hour</button> <button class="btn ghost sm" type="button" data-kick="tonight">Tonight 7 PM</button></div>' +
    '<p class="muted sm">Blank = starts in 30 minutes.</p></fieldset>' +
    '<fieldset class="fstep"><legend>3 · Odds</legend>' +
    '<label>If any price is auto, who is favourite? <select id="ffFav"><option value="even">Even match</option><option value="home">Home — slight favourite</option><option value="home_strong">Home — strong favourite</option><option value="away">Away — slight favourite</option><option value="away_strong">Away — strong favourite</option></select></label>' +
    '<div class="ffodds">' +
    '<label>Home win (1) <input type="number" step="0.01" min="1.01" id="ff_o1" placeholder="Auto"></label>' +
    '<label>Draw (X) <input type="number" step="0.01" min="1.01" id="ff_ox" placeholder="Auto"></label>' +
    '<label>Away win (2) <input type="number" step="0.01" min="1.01" id="ff_o2" placeholder="Auto"></label></div>' +
    '<p class="muted sm">Fill any of them — even just one. The blanks are priced around the prices you set, and the full book (Double Chance, Over/Under, BTTS) is built from the final 1X2.</p></fieldset>' +
    '<fieldset class="fstep"><legend>4 · Goals (optional)</legend>' +
    '<label>Goal schedule <input type="text" id="ffGoals" placeholder="Blank = auto goals"></label>' +
    '<p class="muted sm">Write minute:side pairs like 12:home, 40:away, 78:home. Blank = goals generated to match the odds (the favourite scores more).</p></fieldset>' +
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
// The page an invited admin lands on: account creation that says
// plainly what is being created, instead of the player signup.
function inviteRegisterHTML() {
  return '<div class="profile"><h2>Create your admin account</h2>' +
    '<p class="modal-sub">You have been invited to join the PrimeStake admin team. Create your account below — it stays locked until the super admin verifies it, then you can log in here.</p>' +
    '<form id="adminInviteForm" class="stack">' +
    '<label>Full name <input type="text" id="invName" required></label>' +
    '<label>Phone number <input type="tel" id="invPhone" placeholder="05xxxxxxxx"></label>' +
    '<label>Email <input type="email" id="invEmail"></label>' +
    '<p class="modal-sub">Give a phone number or an email — either one becomes your login.</p>' +
    '<label>Password <input type="password" id="invPass" required></label>' +
    '<button class="btn gold big" type="submit">Create Admin Account</button></form>' +
    '<p class="modal-sub">Already have an admin account? <a href="admin.html">Go to login</a>.</p></div>';
}
function inviteDoneHTML() {
  return '<div class="profile"><h2>Account created</h2>' +
    '<p class="modal-sub">' + (state.inviteDone === 'active'
      ? 'Your account is active. Continue into the portal below.'
      : 'Your admin account is created and waiting for verification. The super admin will approve it from their portal — once approved, come back here and log in with your phone number or email and your password.') + '</p>' +
    (state.inviteDone === 'active'
      ? '<button class="btn gold big" id="inviteContinue">Continue to the Portal</button>'
      : '<a class="btn gold big" href="admin.html" style="display:block;text-align:center">Back to Login</a>') + '</div>';
}
function render() {
  const head = $('#adminHead');
  if (!state.user) {
    head.innerHTML = '';
    root.innerHTML = state.inviteDone ? inviteDoneHTML() : state.invite ? inviteRegisterHTML() : loginHTML();
    const cont = $('#inviteContinue');
    if (cont) cont.addEventListener('click', () => { state.inviteDone = ''; loadAll(); });
    return;
  }
  head.innerHTML = '<span class="userchip">' + esc(state.user.phone || state.user.email || '') + '</span> ' +
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
    state.tab === 'dashboard' ? dashboardHTML() :
    state.tab === 'guide' ? guideHTML() :
    state.tab === 'queue' ? tabsHTML() + queueHTML(false) :
    state.tab === 'matches' ? matchesHTML() :
    state.tab === 'users' ? usersHTML() :
    state.tab === 'earnings' ? earningsHTML() :
    state.tab === 'control' ? controlHTML() :
    state.tab === 'codes' ? codesHTML() : supportHTML();
}
async function loadAll() {
  try {
    const jobs = [
      api('/admin/stats'), api('/admin/queue'), api('/admin/matches'), api('/admin/users'), api('/admin/support'),
      api('/admin/settings').catch(() => null), api('/admin/my-dashboard').catch(() => null)
    ];
    if (superTools()) jobs.push(api('/admin/invite-admin').catch(() => null));
    if (superTools()) jobs.push(api('/admin/booking-codes').catch(() => null));
    const [stats, queue, matches, users, support, settings, myDash, invites, bCodes] = await Promise.all(jobs);
    state.stats = stats.stats; state.queue = queue.queue; state.matches = matches.matches;
    state.users = users.users; state.support = support.messages;
    if (settings) state.settings = settings.settings;
    if (myDash) state.myDash = myDash;
    if (invites) state.invites = invites.invites || [];
    if (bCodes) state.bookingCodes = bCodes.codes || [];
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
  const bcForBtn = e.target.closest('[data-bc-for]');
  if (bcForBtn) {
    state.bcMatch = bcForBtn.dataset.bcFor; state.bcBuilder = []; state.lastCode = ''; state.tab = 'codes';
    render();
    toast('Build this match\'s code: choose market + pick, Add Selection, then Generate.');
    return;
  }
  const bcAddBtn = e.target.closest('[data-bc-add]');
  if (bcAddBtn) {
    const mId = ($('#bcMatch') || {}).value;
    const market = ($('#bcMarket') || {}).value;
    const pick = ($('#bcPick') || {}).value;
    if (!mId) { toast('No open match to build on.'); return; }
    if (state.bcBuilder.some(b => b.matchId === mId)) { toast('One selection per match — remove the existing one first.'); return; }
    state.bcMatch = mId; state.bcMarket = market;
    state.bcBuilder.push({ matchId: mId, market, pick, label: bcMatchLabel(mId) });
    render();
    return;
  }
  const bcRmBtn = e.target.closest('[data-bc-rm]');
  if (bcRmBtn) { state.bcBuilder.splice(Number(bcRmBtn.dataset.bcRm), 1); render(); return; }
  const bcGenBtn = e.target.closest('[data-bc-gen]');
  if (bcGenBtn) {
    if (!state.bcBuilder.length) { toast('Add at least one selection first.'); return; }
    bcGenBtn.disabled = true; bcGenBtn.textContent = 'Generating…';
    try {
      const data = await api('/admin/booking-codes', {
        method: 'POST',
        body: {
          selections: state.bcBuilder.map(b => ({ match_id: b.matchId, market: b.market, pick: b.pick })),
          label: state.bcDraft.label || undefined,
          price_ghs: Number(state.bcDraft.price) || undefined,
          max_uses: Number(state.bcDraft.max) || undefined,
          expires_hours: Number(state.bcDraft.exp) || undefined,
        }
      });
      state.lastCode = data.booking_code.code;
      state.bcBuilder = []; state.bcDraft = {};
      toast('Booking code generated: ' + state.lastCode);
      loadAll();
    } catch (err) { toast(err.message); bcGenBtn.disabled = false; bcGenBtn.textContent = 'Generate Booking Code'; }
    return;
  }
  const bcRevokeBtn = e.target.closest('[data-bc-revoke]');
  if (bcRevokeBtn) {
    if (!confirm('Revoke this booking code? Players will no longer be able to load or bet it.')) return;
    try {
      await api('/admin/booking-codes', { method: 'POST', body: { revoke_id: bcRevokeBtn.dataset.bcRevoke } });
      toast('Code revoked.');
      loadAll();
    } catch (err) { toast(err.message); }
    return;
  }
  const diceBtn = e.target.closest('[data-dice]');
  if (diceBtn) {
    const input = $('#' + diceBtn.dataset.dice);
    const other = $('#' + (diceBtn.dataset.dice === 'ffHome' ? 'ffAway' : 'ffHome'));
    if (input) input.value = randomTeamName(other ? other.value : '');
    return;
  }
  const kickBtn = e.target.closest('[data-kick]');
  if (kickBtn) {
    const el = $('#ffStart');
    if (el) {
      const d = new Date();
      if (kickBtn.dataset.kick === 'tonight') {
        d.setHours(19, 0, 0, 0);
        if (d <= new Date()) d.setDate(d.getDate() + 1);
      } else {
        d.setMinutes(d.getMinutes() + Number(kickBtn.dataset.kick));
      }
      el.value = toLocalInput(d);
    }
    return;
  }
  const proofBtn = e.target.closest('[data-proof]');
  if (proofBtn) {
    try {
      const d = await api('/admin/deposit-proof?id=' + encodeURIComponent(proofBtn.dataset.proof));
      showProof(d.proof_image);
    } catch (err) { toast(err.message); }
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
  const reqPayoutBtn = e.target.closest('[data-request-payout]');
  if (reqPayoutBtn) {
    try {
      const data = await api('/admin/payout-request', { method: 'POST', body: {} });
      toast(data.already ? 'Payout already requested — the super admin has it.' : 'Payout requested: ' + money(data.request.amount_ghs) + '.');
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
  const setScoreBtn = e.target.closest('[data-setscore]');
  if (setScoreBtn) {
    const id = setScoreBtn.dataset.setscore;
    const m = state.matches.find(x => x.id === id);
    const sh = Number(($('#fsh-' + id) || {}).value), sa = Number(($('#fsa-' + id) || {}).value);
    if (!(sh >= 0) || !(sa >= 0)) { toast('Enter both the home and away scores first.'); return; }
    if (!confirm('Set the final score for ' + (m ? m.home_team + ' vs ' + m.away_team : 'this match') + ' to ' + sh + '–' + sa + ' and settle it? Winners will be paid.')) return;
    try {
      const data = await api('/admin/settle', { method: 'POST', body: { match_id: id, score_home: sh, score_away: sa } });
      toast('Settled ' + sh + '–' + sa + ': ' + data.selections_scored + ' selections, ' + data.bets_won + ' bets won, ' + data.bets_lost + ' lost.');
      loadAll();
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

document.addEventListener('change', e => {
  if (e.target.id === 'bcMatch') { state.bcMatch = e.target.value; render(); }
  else if (e.target.id === 'bcMarket') { state.bcMarket = e.target.value; render(); }
});
document.addEventListener('input', e => {
  const map = { bcLabel: 'label', bcPrice: 'price', bcMaxUses: 'max', bcExp: 'exp' };
  if (map[e.target.id]) state.bcDraft[map[e.target.id]] = e.target.value;
});

document.addEventListener('submit', async e => {
  if (e.target.id === 'adminLogin') {
    e.preventDefault();
    try {
      const data = await api('/auth/login', { method: 'POST', body: { identifier: $('#adPhone').value.trim(), password: $('#adPass').value } });
      if (!portalAllows(data.user)) {
        toast(isSuperPortal
          ? 'That account is not a super admin account — use the Admin Portal instead.'
          : 'That account is not an admin account.');
        return;
      }
      state.token = data.token;
      localStorage.setItem('ps_admin_token', data.token);
      state.user = data.user;
      loadAll();
    } catch (err) { toast(err.message); render(); }
  } else if (e.target.id === 'adminInviteForm') {
    e.preventDefault();
    const invPhone = $('#invPhone').value.trim();
    const invEmail = $('#invEmail').value.trim();
    if (!invPhone && !invEmail) { toast('Give a phone number or an email — you will log in with it.'); return; }
    try {
      const data = await api('/auth/register', {
        method: 'POST',
        body: {
          display_name: $('#invName').value.trim(),
          phone: invPhone,
          email: invEmail,
          password: $('#invPass').value,
          admin_invite: state.invite
        }
      });
      state.invite = '';
      history.replaceState(null, '', location.pathname);
      if (data.pending) {
        state.inviteDone = 'pending';
        render();
      } else if (data.token) {
        // A super-admin invite activates at once: sign straight in.
        state.token = data.token;
        localStorage.setItem('ps_admin_token', data.token);
        state.user = data.user;
        state.inviteDone = 'active';
        render();
      }
    } catch (err) {
      toast(err.message);
      if (String(err.message).includes('invite')) { state.invite = ''; render(); }
    }
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
    // Blank means AUTO on the server: names, odds (from the
    // favourite) and the goal schedule are generated there.
    const body = {
      league: $('#ffLeague').value.trim(), home_team: $('#ffHome').value.trim(), away_team: $('#ffAway').value.trim(),
      fav: $('#ffFav').value
    };
    if ($('#ffStart').value) body.starts_at = new Date($('#ffStart').value).toISOString();
    const o1 = Number($('#ff_o1').value), ox = Number($('#ff_ox').value), o2 = Number($('#ff_o2').value);
    // Any price he typed is sent — the server keeps typed prices
    // and prices only the blanks around them.
    if (o1 > 1) body.o1 = o1;
    if (ox > 1) body.ox = ox;
    if (o2 > 1) body.o2 = o2;
    const goalsText = $('#ffGoals').value.trim();
    if (goalsText) {
      body.goals = goalsText.split(',').map(x => x.trim()).filter(Boolean).map(part => {
        const [min, side] = part.split(':').map(y => (y || '').trim());
        return { minute: Number(min), side: side === 'away' ? 'away' : 'home' };
      }).filter(g => g.minute >= 1 && g.minute <= 90);
    }
    try {
      const data = await api('/admin/create-match', { method: 'POST', body });
      // Prince's flow (2026-11-04): after creating his match, the super
      // admin goes straight to minting its booking code.
      state.bcMatch = data.match.id; state.bcBuilder = []; state.lastCode = ''; state.tab = 'codes';
      toast('Created: ' + data.match.home_team + ' vs ' + data.match.away_team + ' — now build its booking code.');
      loadAll();
    } catch (err) { toast(err.message); }
  } else if (e.target.id === 'matchForm') {
    e.preventDefault();
    const keys = ['o1', 'ox', 'o2', 'dc1x', 'dc12', 'dcx2', 'over05', 'under05', 'over15', 'under15', 'over25', 'under25', 'over35', 'under35', 'over45', 'under45', 'gg', 'ng'];
    const odds = {};
    keys.forEach(k => { const v = Number($('#mf_' + k).value); if (v > 1) odds[k] = v; });
    try {
      const data = await api('/admin/matches', {
        method: 'POST',
        body: {
          league: $('#mfLeague').value.trim(), home_team: $('#mfHome').value.trim(),
          away_team: $('#mfAway').value.trim(),
          starts_at: new Date($('#mfStart').value).toISOString(), odds
        }
      });
      if (superTools() && data.match) {
        state.bcMatch = data.match.id; state.bcBuilder = []; state.lastCode = ''; state.tab = 'codes';
        toast('Match added — now build its booking code.');
      } else {
        toast('Match added.');
      }
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
