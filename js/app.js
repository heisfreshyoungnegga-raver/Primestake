// PrimeStake front end. All account, match, bet and wallet data comes
// from the PrimeStake API (/api). Nothing is faked locally: when the
// backend is not configured yet, pages say so instead of showing
// sample data.

const state = {
  view: 'home',
  league: 'All',
  market: '1X2',
  date: 'All',
  query: '',
  slip: new Map(), // key -> {matchId, matchLabel, league, market, pick, odd}
  user: null,
  token: localStorage.getItem('ps_token') || '',
  heroIdx: 0,
  matches: [],
  matchesLoaded: false,
  offline: false,
  myBets: [],
  wallet: null,
  walletTab: 'instant',
  momo: null,
  momoOff: false,
  verifyResult: '',
  slipCode: '',
  supportMsgs: [],
};

const $ = (s, r = document) => r.querySelector(s);
const root = $('#viewRoot');

const MARKET_LIST = ['1X2', 'Double Chance', 'Over/Under 0.5', 'Over/Under 1.5', 'Over/Under 2.5', 'Over/Under 3.5', 'Over/Under 4.5', 'Both Teams To Score'];
const MARKET_KEYS = {
  '1X2': [['1', 'o1'], ['X', 'ox'], ['2', 'o2']],
  'Double Chance': [['1X', 'dc1x'], ['12', 'dc12'], ['X2', 'dcx2']],
  'Both Teams To Score': [['Yes', 'gg'], ['No', 'ng']],
};
// Every half-goal total line gets its market entry: keys over05..under45.
['0.5', '1.5', '2.5', '3.5', '4.5'].forEach(line => {
  const s = line.replace('.', '');
  MARKET_KEYS['Over/Under ' + line] = [['Over ' + line, 'over' + s], ['Under ' + line, 'under' + s]];
});
const DATES = ['All', 'Today', 'Live', 'Tomorrow'];

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 3600);
}
function esc(s) { return String(s == null ? '' : s).replace(/</g, '&lt;'); }
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function money(n) { return 'GHS ' + Number(n || 0).toFixed(2); }

/* ---------- API client ---------- */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let res;
  try {
    res = await fetch('/api' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    const err = new Error('network_error'); err.code = 'network_error'; throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && data.error === 'backend_not_configured') {
    state.offline = true;
    const err = new Error('backend_not_configured'); err.code = data.error; throw err;
  }
  if (!res.ok) {
    const err = new Error(data.error || 'request_failed');
    err.code = data.error || 'request_failed';
    err.detail = data.detail || '';
    throw err;
  }
  return data;
}
function errToast(e, fallback) {
  const map = {
    backend_not_configured: 'Service is being set up — the backend is not live yet. Please check back shortly.',
    network_error: 'Network problem — check your connection and try again.',
    insufficient_balance: 'Insufficient balance for that stake.',
    wrong_phone_or_password: 'Wrong phone number or password.',
    phone_already_registered: 'That phone number is already registered — log in instead.',
    password_too_short: 'Password must be at least 6 characters.',
    invalid_phone: 'Enter a valid phone number.',
    account_blocked: 'This account has been blocked. Contact support.',
    withdrawal_locked: 'Withdrawals are locked until you complete the required deposits.',
    match_finished: 'One of those matches has already finished.',
    one_selection_per_match: 'Only one selection per match on a slip.',
    market_unavailable: 'One of those markets is not available right now.',
    ticket_not_found: 'No ticket found with that code.',
    transaction_id_required: 'Enter the MoMo transaction ID from your confirmation.',
  };
  toast(map[e.code] || fallback || ('Something went wrong: ' + (e.detail || e.code || 'error')));
}

/* ---------- matches ---------- */
function normMatch(m) {
  return {
    id: m.id, league: m.league, home: m.home_team, away: m.away_team,
    status: m.status, minute: m.minute, sh: m.score_home, sa: m.score_away,
    starts_at: m.starts_at, odds: m.odds || {},
    home_logo: m.home_logo || '', away_logo: m.away_logo || '',
  };
}
async function loadMatches() {
  try {
    const data = await api('/matches');
    state.matches = data.matches.map(normMatch);
    state.matchesLoaded = true;
    state.offline = false;
  } catch (e) {
    state.matches = [];
    state.matchesLoaded = true;
    if (e.code !== 'backend_not_configured') console.warn('matches load failed', e.code);
  }
  if (['home', 'live', 'sports', 'virtual'].includes(state.view)) render();
}
function leagues() {
  return ['All', ...new Set(state.matches.map(m => m.league))];
}
function marketsFor(m) {
  return MARKET_KEYS[state.market]
    .map(([label, key]) => ({ label, odd: Number(m.odds[key]) }))
    .filter(o => o.odd > 1);
}
function slipKey(matchId, market, pick) { return matchId + '|' + market + '|' + pick; }

function matchVisible(m) {
  if (state.view === 'live' && m.status !== 'live') return false;
  if (state.view === 'sports' && m.status !== 'upcoming') return false;
  if (state.view === 'virtual' && !/virtual/i.test(m.league)) return false;
  if (['home', 'live', 'sports'].includes(state.view) && state.league !== 'All' && m.league !== state.league) return false;
  const start = new Date(m.starts_at);
  const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (state.date === 'Live' && m.status !== 'live') return false;
  if (state.date === 'Today' && m.status !== 'live' && !sameDay(start, now)) return false;
  if (state.date === 'Tomorrow') {
    const t = new Date(now); t.setDate(t.getDate() + 1);
    if (!sameDay(start, t)) return false;
  }
  if (state.query) {
    const hay = (m.home + ' ' + m.away + ' ' + m.league).toLowerCase();
    if (!hay.includes(state.query.toLowerCase())) return false;
  }
  return true;
}
function oddsHTML(m) {
  const opts = marketsFor(m);
  if (!opts.length) return '<span class="more">Odds soon</span>';
  return '<span class="mkt">' + state.market + '</span>' + opts.map(o => {
    const sel = state.slip.has(slipKey(m.id, state.market, o.label)) ? ' sel' : '';
    return '<button class="odd' + sel + '" data-odd="' + m.id + '" data-pick="' + esc(o.label) + '">' +
      '<small>' + esc(o.label) + '</small>' + o.odd.toFixed(2) + '</button>';
  }).join('');
}
function rowHTML(m) {
  let time;
  if (m.status === 'live') {
    time = '<span class="live-min">' + (m.minute != null ? m.minute + '&prime;' : 'LIVE') + '</span>' +
      '<span class="score">' + m.sh + ' - ' + m.sa + '</span>';
  } else {
    time = '<span>' + fmtDate(m.starts_at) + '</span>';
  }
  return '<div class="mrow">' +
    '<div class="mtime">' + time + '</div>' +
    '<div class="mteams"><div class="league">' + esc(m.league) + '</div>' +
    '<div class="team">' + (m.home_logo ? '<img class="tlogo" src="' + esc(m.home_logo) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + esc(m.home) + '</div>' +
    '<div class="team">' + (m.away_logo ? '<img class="tlogo" src="' + esc(m.away_logo) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + esc(m.away) + '</div></div>' +
    '<div class="odds">' + oddsHTML(m) + '</div></div>';
}
function groupHTML(title, list, live) {
  if (!list.length) return '';
  return '<section class="group' + (live ? ' live-group' : '') + '"><div class="group-head' + (live ? ' live' : '') + '">' +
    '<span>' + title + '</span><span class="cnt">' + list.length + ' events</span></div>' +
    list.map(rowHTML).join('') + '</section>';
}
function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'TODAY';
  const t = new Date(now); t.setDate(t.getDate() + 1);
  if (sameDay(d, t)) return 'TOMORROW';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short' }).toUpperCase();
}
function matchListHTML() {
  if (state.offline) {
    return '<div class="card"><h3>Matches are on their way</h3><p class="muted">The PrimeStake service is being set up right now. Fixtures and odds will appear here as soon as the backend goes live.</p></div>';
  }
  if (!state.matchesLoaded) return '<div class="skel"><i></i><i></i><i></i><i></i></div>';
  const all = state.matches.filter(matchVisible);
  let html = '<p class="count">EVENTS &amp; MARKETS — <b>' + all.length + ' Matches Found</b></p>';
  html += groupHTML('LIVE MATCHES', all.filter(m => m.status === 'live'), true);
  const byDay = {};
  all.filter(m => m.status === 'upcoming').forEach(m => {
    const k = dayLabel(m.starts_at);
    (byDay[k] = byDay[k] || []).push(m);
  });
  Object.keys(byDay).forEach(d => { html += groupHTML(d, byDay[d], false); });
  if (!all.length) html += '<p class="empty">No matches fit these filters right now.</p>';
  return html;
}
function heroHTML() {
  const s = HERO_SLIDES[state.heroIdx];
  return '<section class="hero"><img class="bg" src="' + (s.img || 'assets/hero-stadium.jpg') + '" alt="">' +
    '<div class="hero-in"><p class="kicker">' + s.kicker + '</p><h1>' + s.title + '</h1>' +
    '<p>' + s.sub + '</p><button class="btn gold" data-hero-cta>' + s.cta + '</button></div>' +
    '<span class="hero-count">' + (state.heroIdx + 1) + ' of ' + HERO_SLIDES.length + '</span>' +
    '<div class="hero-dots">' + HERO_SLIDES.map((_, i) => '<i class="' + (i === state.heroIdx ? 'on' : '') + '"></i>').join('') + '</div></section>';
}
function filtersHTML() {
  const chips = (list, kind, cur) => list
    .map(x => '<button class="chip' + (x === cur ? ' on' : '') + '" data-chip="' + kind + '" data-val="' + esc(x) + '">' + esc(x) + '</button>')
    .join('');
  const row = (label, kind, list, cur) =>
    '<div class="frow2"><span class="flabel">' + label + '</span><div class="fchips">' + chips(list, kind, cur) + '</div></div>';
  return '<section class="filtercard">' +
    '<div class="fcard-head"><h3>Find your match</h3><span class="fcard-hint">Filter by league, market and day</span></div>' +
    '<div class="searchbar"><span class="sicon">⌕</span><input id="searchBox" type="search" placeholder="Search teams or leagues..." value="' + esc(state.query) + '"></div>' +
    row('League', 'league', leagues(), state.league) +
    row('Market', 'market', MARKET_LIST, state.market) +
    row('When', 'date', DATES, state.date) +
    '</section>';
}
function quickHTML() {
  const q = ['Soccer', 'Today', 'Games', 'Verify Bet', 'Booking Codes', 'All'];
  return '<div class="quickrow">' + q.map(x => '<button class="quick" data-quick="' + x + '">' + x + '</button>').join('') + '</div>';
}
function promoStripHTML() {
  const p = PROMOS[0];
  return '<button class="promostrip" data-nav="promos"><span class="gtag">' + p.tag + '</span>' +
    '<span><b>' + p.title + '</b> — see what is on offer</span><span class="ps-arrow">›</span></button>';
}
function trustStripHTML() {
  const items = [
    ['Fast payouts', 'MoMo withdrawals after review'],
    ['Manual MoMo deposits', 'Credited on confirmation'],
    ['Booking codes', 'Share slips with one code'],
    ['24/7 support', 'FAQs and in-app messages'],
  ];
  return '<div class="truststrip">' + items.map(i =>
    '<div class="trust"><b>' + i[0] + '</b><span>' + i[1] + '</span></div>').join('') + '</div>';
}

/* ---------- account pages ---------- */
function gateHTML(title) {
  return '<div class="profile"><h2>' + title + '</h2>' +
    '<p class="modal-sub">Log in to see this page.</p>' +
    '<button class="btn gold big" data-open-auth>Login</button></div>';
}
function statusChip(s) {
  const cls = s === 'completed' || s === 'won' ? 'completed' : s === 'rejected' || s === 'lost' ? 'rejected' : 'pending';
  return '<span class="st st-' + cls + '">' + String(s).toUpperCase() + '</span>';
}
function profileHTML() {
  if (!state.user) {
    return '<div class="profile"><h2>ME Profile</h2>' +
      '<p class="modal-sub">Log in to see your account, bets and balance.</p>' +
      '<button class="btn gold big" data-open-auth>Login</button></div>';
  }
  return '<div class="profile"><h2>' + esc(state.user.phone) + '</h2>' +
    '<div>Balance</div><div class="bal">' + money(state.user.balance_ghs) + '</div>' +
    '<button class="prow" data-nav="bets">My Bets <span>›</span></button>' +
    '<button class="prow" data-nav="wallet">Wallet &amp; Transactions <span>›</span></button>' +
    '<button class="prow" data-nav="verify">Verify Bet <span>›</span></button>' +
    '<button class="prow" data-nav="booking">Booking Codes <span>›</span></button>' +
    '<button class="prow" data-nav="promos">Promotions <span>›</span></button>' +
    '<button class="prow" data-nav="support">Support <span>›</span></button>' +
    '<button class="prow" data-nav="settings">Settings <span>›</span></button>' +
    '<button class="btn ghost" id="logoutBtn" style="color:var(--live);border-color:var(--live)">Logout</button></div>';
}
function betCardHTML(b) {
  const legs = (b.selections || []).map(l =>
    '<div class="leg"><span>' + esc(l.home_team || '') + ' vs ' + esc(l.away_team || '') + '</span>' +
    '<span>' + esc(l.pick) + ' · ' + esc(l.market) + ' · <b>' + Number(l.odds).toFixed(2) + '</b></span>' +
    '<span class="legres">' + esc(l.result || '') + '</span></div>').join('');
  return '<div class="card"><div class="card-head"><b>' + esc(b.code) + '</b>' + statusChip(b.status) + '</div>' +
    '<p class="muted">' + fmtDate(b.placed_at) + '</p>' + legs +
    '<div class="card-row"><span>Stake</span><b>' + money(b.stake_ghs) + '</b></div>' +
    '<div class="card-row"><span>Total odds</span><b>' + Number(b.total_odds).toFixed(2) + '</b></div>' +
    '<div class="card-row"><span>Potential win</span><b>' + money(b.potential_ghs) + '</b></div></div>';
}
function betsHTML() {
  if (!state.user) return gateHTML('My Bets');
  return '<h2>My Bets</h2>' +
    (state.myBets.length ? state.myBets.map(betCardHTML).join('') : '<p class="empty">No bets yet — add odds to your slip and place your first bet.</p>');
}
async function loadBets() {
  try {
    const data = await api('/bets/mine');
    state.myBets = data.bets;
  } catch (e) { state.myBets = []; }
  if (state.view === 'bets') render();
}
function withdrawCardHTML(w) {
  const n = w.deposits_completed, req = w.deposits_required;
  const unlocked = w.withdrawals_unlocked;
  const pct = Math.min(100, Math.round(n / req * 100));
  return '<div class="card"><h3>Withdraw</h3>' +
    '<p class="muted">Withdrawal rule: you must complete <b>' + req + ' deposits</b> before you can withdraw.</p>' +
    '<div class="lockrow"><span>Deposits completed</span><b>' + n + ' / ' + req + '</b></div>' +
    '<div class="lockbar"><div class="lockfill" style="width:' + pct + '%"></div></div>' +
    (unlocked
      ? '<p class="unlock-note">Withdrawals unlocked — you have completed ' + n + ' deposits.</p>'
      : '<p class="lock-note">Withdrawals locked — ' + (req - n) + ' more confirmed deposit(s) needed. Manual deposits count once they are confirmed.</p>') +
    '<form id="withdrawForm" class="stack">' +
    '<label>Amount (GHS) <input type="number" id="wdAmt" min="1" value="50" required></label>' +
    '<label>Pay to <select id="wdMethod"><option>MTN MoMo</option><option>Telecel Cash</option><option>AT Money</option></select></label>' +
    '<button class="btn gold big" type="submit"' + (unlocked ? '' : ' disabled') + '>Request Withdrawal</button></form>' +
    '<p class="muted">The amount is held from your balance when you request; it is paid out after review. A rejected request refunds the hold.</p></div>';
}
/* ----- Instant MoMo deposit (ShinobiPay direct push) ----- */
function detectNetworkJS(raw) {
  const digits = String(raw || '').replace(/[\s+]/g, '');
  const local = digits.startsWith('233') ? '0' + digits.slice(3) : digits;
  const p = local.slice(0, 3);
  if (['024', '025', '053', '054', '055', '059'].includes(p)) return 'MTN';
  if (['020', '050'].includes(p)) return 'TELECEL';
  if (['026', '027', '056', '057'].includes(p)) return 'AIRTELTIGO';
  return null;
}
function syncMomoFee() {
  const line = $('#mmFeeLine');
  if (!line) return;
  const amt = parseFloat(($('#mmAmt') || {}).value) || 0;
  line.textContent = amt > 0
    ? 'Your phone will ask you to approve GHS ' + (amt * 1.025).toFixed(2) + ' (includes the 2.5% processing fee). Your wallet is credited exactly GHS ' + amt.toFixed(2) + '.'
    : '';
}
let momoTimer = null;
function stopMomoPoll() { if (momoTimer) { clearInterval(momoTimer); momoTimer = null; } }
function startMomoPoll() {
  stopMomoPoll();
  let tries = 0;
  momoTimer = setInterval(async () => {
    tries++;
    if (!state.momo || state.momo.phase !== 'wait' || state.view !== 'wallet' || tries > 45) { stopMomoPoll(); return; }
    try {
      const d = await api('/wallet/deposit-status?reference=' + encodeURIComponent(state.momo.reference));
      if (d.status === 'succeeded') {
        stopMomoPoll();
        state.momo = null;
        toast('Deposit confirmed — your wallet has been credited.');
        loadWallet();
      } else if (d.status === 'failed') {
        stopMomoPoll();
        state.momo = { phase: 'failed', message: 'The payment did not go through. Nothing was charged.' };
        render();
      }
    } catch (e) { /* keep waiting — the webhook is the real signal */ }
  }, 4000);
}
function momoPanelHTML() {
  const m = state.momo;
  if (state.momoOff) {
    return '<div class="card"><h3>Mobile Money</h3>' +
      '<p class="muted">Instant mobile money deposits are being switched on. Please use <b>Manual transfer</b> for now — it is confirmed and credited by our team.</p></div>';
  }
  if (m && m.phase === 'wait') {
    return '<div class="card"><h3>Check your phone</h3>' +
      '<p>We sent a payment prompt to <b>' + esc(m.phone) + '</b>. Approve it with your MoMo PIN to deposit <b>' + money(m.amount) + '</b>.</p>' +
      (m.ussd ? '<p class="muted">No prompt? Dial <b>' + esc(m.ussd) + '</b> and approve the pending transaction from your MoMo menu.</p>' : '') +
      '<p class="muted">Waiting for confirmation… your balance updates automatically once the payment lands. Do not pay twice.</p>' +
      '<button class="btn" data-momo-cancel>Cancel</button></div>';
  }
  if (m && m.phase === 'otp') {
    return '<div class="card"><h3>Enter the code</h3>' +
      '<p class="muted">Your network sent a one-time code for the deposit of <b>' + money(m.amount) + '</b>. Enter it to finish.</p>' +
      '<form id="momoOtpForm" class="stack"><label>One-time code <input type="text" id="mmOtp" inputmode="numeric" autocomplete="one-time-code" required></label>' +
      '<button class="btn gold big" type="submit">Confirm Code</button></form>' +
      '<button class="btn" data-momo-cancel>Cancel</button></div>';
  }
  if (m && m.phase === 'failed') {
    return '<div class="card"><h3>Payment not completed</h3>' +
      '<p class="lock-note">' + esc(m.message || 'The payment did not go through. Nothing was charged.') + '</p>' +
      '<button class="btn gold" data-momo-reset>Try Again</button></div>';
  }
  const phone = state.user ? state.user.phone : '';
  return '<div class="card"><h3>Mobile Money</h3>' +
    '<form id="momoForm" class="stack">' +
    '<label>Amount (GHS) <input type="number" id="mmAmt" min="1" max="5000" step="0.01" value="50" required></label>' +
    '<label>MoMo number <input type="tel" id="mmPhone" value="' + esc(phone) + '" required></label>' +
    '<label>Network <select id="mmNet"><option value="MTN">MTN Mobile Money</option><option value="TELECEL">Telecel Cash</option><option value="AIRTELTIGO">AT Money</option></select></label>' +
    '<p class="muted" id="mmFeeLine"></p>' +
    '<button class="btn gold big" type="submit">Send Payment Prompt</button></form>' +
    '<p class="muted">A prompt is sent to your phone — approve it with your PIN and your wallet is credited automatically.</p></div>';
}

function walletHTML() {
  if (!state.user) return gateHTML('Wallet');
  const w = state.wallet;
  if (!w) return '<h2>Wallet</h2><div class="skel"><i></i><i></i><i></i></div>';
  const tx = w.transactions.map(t =>
    '<div class="txrow"><div><b>' + esc(t.kind.replace('_', ' ')) + '</b><div class="muted">' + fmtDate(t.created_at) + ' · ' + esc(t.method || '') + '</div></div>' +
    '<div class="' + (t.amount_ghs >= 0 ? 'amt pos' : 'amt') + '">' + (t.amount_ghs >= 0 ? '+' : '−') + 'GHS ' + Math.abs(t.amount_ghs).toFixed(2) + '</div>' +
    statusChip(t.status) + '</div>').join('');
  const md = w.manual_deposit;
  const manual = state.walletTab === 'manual';
  const depositPanel = manual
    ? '<div class="card"><h3>Manual transfer — ' + esc(md.network) + '</h3>' +
      '<div class="manualbox"><div class="muted">Send money to</div>' +
      '<div class="mannum">' + esc(md.number.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3')) + '</div>' +
      '<div class="manname">' + esc(md.name) + '</div>' +
      '<button class="btn gold" data-copy="' + esc(md.number) + '">Copy Number</button></div>' +
      '<ol class="steps"><li>Dial *170# and send the amount to the number above.</li>' +
      '<li>Check the name on the confirmation screen shows <b>' + esc(md.name) + '</b> before you enter your PIN.</li>' +
      '<li>Use your account phone number as the reference.</li>' +
      '<li>Fill the confirmation below — your balance is credited once the payment is confirmed.</li></ol>' +
      '<form id="manualDepForm" class="stack">' +
      '<label>Amount sent (GHS) <input type="number" id="mdAmt" min="1" value="50" required></label>' +
      '<label>Your MoMo number <input type="tel" id="mdPhone" placeholder="05X XXX XXXX" required></label>' +
      '<label>Transaction ID / reference <input type="text" id="mdRef" placeholder="e.g. 12345678901" required></label>' +
      '<button class="btn gold big" type="submit">I Have Sent It — Confirm Deposit</button></form></div>'
    : momoPanelHTML();
  return '<h2>Wallet</h2>' +
    '<div class="card"><div class="muted">Balance</div><div class="bal">' + money(w.balance_ghs) + '</div>' +
    '<div class="muted">Confirmed deposits: ' + w.deposits_completed + ' of ' + w.deposits_required + ' needed to unlock withdrawals</div></div>' +
    '<div class="wtabs"><button class="' + (manual ? '' : 'on') + '" data-wtab="instant">Mobile Money</button>' +
    '<button class="' + (manual ? 'on' : '') + '" data-wtab="manual">Manual transfer</button></div>' +
    depositPanel +
    withdrawCardHTML(w) +
    '<h3>Transactions</h3><div class="card">' + (tx || '<p class="empty">No transactions yet.</p>') + '</div>';
}
async function loadWallet() {
  try {
    state.wallet = await api('/wallet');
  } catch (e) { state.wallet = null; }
  if (state.view === 'wallet') render();
  if (state.wallet && state.user) { state.user.balance_ghs = state.wallet.balance_ghs; syncHeader(); }
}
function verifyHTML() {
  return '<h2>Verify Bet</h2><p class="muted">Enter a bet code to see its selections and status.</p>' +
    '<form id="verifyForm" class="stack card"><label>Bet code <input type="text" id="verifyCode" placeholder="PB-XXXXXX" required></label>' +
    '<button class="btn gold big" type="submit">Verify</button></form>' +
    '<div id="verifyOut">' + state.verifyResult + '</div>';
}
function bookingHTML() {
  return '<h2>Booking Codes</h2>' +
    '<div class="card"><h3>Generate from your betslip</h3>' +
    '<p class="muted">A slip code packs your current selections into one code that recreates them on any device. ' +
    (state.slip.size ? state.slip.size + ' selection(s) on your slip.' : 'Your slip is empty — add odds first.') + '</p>' +
    '<button class="btn gold big" data-gen-code>Generate Slip Code</button>' +
    (state.slipCode ? '<p class="bigcode">' + esc(state.slipCode) + '</p>' : '') + '</div>' +
    '<div class="card"><h3>Load a code</h3><form id="bookingLoadForm" class="stack">' +
    '<label>Slip code <input type="text" id="loadCode" placeholder="Paste a slip code" required></label>' +
    '<button class="btn gold big" type="submit">Load Code</button></form></div>';
}
function promosHTML() {
  return '<h2>Promotions</h2><div class="promos">' + PROMOS.map(p =>
    '<div class="card"><span class="gtag">' + p.tag + '</span><h3>' + p.title + '</h3><p>' + p.body + '</p></div>').join('') +
    '</div><p class="muted">All promotions are subject to terms and account verification. 18+ only.</p>';
}
function supportHTML() {
  const faq = FAQS.map(f => '<details class="faq"><summary>' + f.q + '</summary><p>' + f.a + '</p></details>').join('');
  const msgs = state.supportMsgs.map(m =>
    '<div class="leg"><span>' + esc(m.subject) + '</span><span class="legres">' + esc(m.status) + '</span></div>').join('');
  return '<h2>Support</h2><div class="card"><h3>FAQs</h3>' + faq + '</div>' +
    '<div class="card"><h3>Message support</h3>' + msgs +
    (state.user
      ? '<form id="supportForm" class="stack"><label>Subject <input type="text" id="supportSubject" placeholder="What is it about?" required></label>' +
        '<label>Your message <input type="text" id="supportText" placeholder="How can we help?" required></label>' +
        '<button class="btn gold big" type="submit">Send Message</button></form>'
      : '<p class="muted">Log in to message the support team. Guests can browse the FAQs without an account.</p>') + '</div>';
}
async function loadSupport() {
  if (!state.user) return;
  try {
    const data = await api('/support');
    state.supportMsgs = data.messages;
  } catch (e) { /* keep current */ }
  if (state.view === 'support') render();
}
function settingsHTML() {
  if (!state.user) return gateHTML('Settings');
  return '<h2>Settings</h2><div class="card stack">' +
    '<div class="card-row"><span>Phone</span><b>' + esc(state.user.phone) + '</b></div>' +
    '<div class="card-row"><span>Region / currency</span><b>Ghana · GHS</b></div>' +
    '<h3>Change password</h3><form id="passwordForm" class="stack">' +
    '<label>Current password <input type="password" id="pwCurrent" required></label>' +
    '<label>New password <input type="password" id="pwNew" required></label>' +
    '<button class="btn gold big" type="submit">Update Password</button></form></div>';
}
function gamesHTML() {
  const tiles = GAMES.map(g =>
    '<button class="gtile ' + g.cls + '" data-game="' + esc(g.name) + '">' +
    (g.tag ? '<span class="gtag">' + g.tag + '</span>' : '') +
    '<span class="gname">' + esc(g.name) + '</span><span class="gnote">' + esc(g.note) + ' · Coming soon</span></button>'
  ).join('');
  return '<h2>Games</h2><div class="gamesgrid">' + tiles + '</div>' +
    '<div class="howto"><h3>Coming soon</h3><p>Casino games launch with our game provider integration. Sports betting is open now — head to the match list to play.</p></div>';
}

function viewHTML() {
  switch (state.view) {
    case 'games': return gamesHTML();
    case 'profile': return profileHTML();
    case 'bets': return betsHTML();
    case 'wallet': return walletHTML();
    case 'verify': return verifyHTML();
    case 'booking': return bookingHTML();
    case 'promos': return promosHTML();
    case 'support': return supportHTML();
    case 'settings': return settingsHTML();
    case 'live':
    case 'sports':
    case 'virtual':
      return filtersHTML() + matchListHTML();
    default:
      return heroHTML() + promoStripHTML() + trustStripHTML() + quickHTML() + filtersHTML() + matchListHTML();
  }
}
function render() {
  root.innerHTML = viewHTML();
  document.querySelectorAll('.navlink').forEach(b =>
    b.classList.toggle('active', b.dataset.nav === state.view));
  if ($('#mmFeeLine')) syncMomoFee();
}

/* ---------- betslip ---------- */
function renderSlip() {
  $('#slipCount').textContent = state.slip.size;
  const body = $('#slipBody');
  const foot = $('#slipFoot');
  if (!state.slip.size) {
    body.innerHTML = '<p class="empty">Your betslip is empty.<br>Tap any odd to add a selection.</p>';
    foot.innerHTML = '';
    return;
  }
  body.innerHTML = [...state.slip.entries()].map(([key, s]) =>
    '<div class="sel"><div class="s-top"><span class="s-match">' + esc(s.matchLabel) + '</span>' +
    '<button class="rm" data-rm="' + esc(key) + '">Remove</button></div>' +
    '<span class="s-pick">' + esc(s.league) + ' · ' + esc(s.market) + ' · ' + esc(s.pick) + '</span>' +
    '<span class="s-odd">' + s.odd.toFixed(2) + '</span></div>'
  ).join('');
  const total = [...state.slip.values()].reduce((acc, s) => acc * s.odd, 1);
  foot.innerHTML =
    '<div class="row"><span>Stake (GHS)</span><input type="number" id="stakeIn" min="1" value="10"></div>' +
    '<div class="row"><span>Total odds</span><b>' + total.toFixed(2) + '</b></div>' +
    '<div class="row"><span>Potential win</span><b id="potWin">' + money(10 * total) + '</b></div>' +
    '<button class="btn gold big" id="placeBet">Place Bet</button>';
  $('#stakeIn').addEventListener('input', e => {
    const v = parseFloat(e.target.value) || 0;
    $('#potWin').textContent = money(v * total);
  });
  $('#placeBet').addEventListener('click', placeBet);
}
async function placeBet() {
  if (!state.user) { closeSlip(); openAuth('login'); toast('Log in to place a bet'); return; }
  const stake = parseFloat(($('#stakeIn') || {}).value) || 0;
  if (!(stake > 0)) { toast('Enter a stake amount'); return; }
  const btn = $('#placeBet');
  btn.disabled = true; btn.textContent = 'Placing…';
  try {
    const selections = [...state.slip.values()].map(s => ({ match_id: s.matchId, market: s.market, pick: s.pick }));
    const data = await api('/bets/place', { method: 'POST', body: { selections, stake_ghs: stake } });
    state.slip.clear();
    renderSlip();
    closeSlip();
    toast('Bet placed — your ticket code is ' + data.code);
    await refreshUser();
    state.view = 'bets';
    render();
    loadBets();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Place Bet';
    errToast(e, 'Bet could not be placed.');
  }
}
function openSlip() { $('#slipDrawer').classList.add('open'); $('#scrim').classList.add('on'); }
function closeSlip() { $('#slipDrawer').classList.remove('open'); $('#scrim').classList.remove('on'); }

/* ---------- auth ---------- */
let authMode = 'login';
function openAuth(mode) {
  authMode = mode || 'login';
  syncAuth();
  $('#authWrap').classList.add('open');
}
function closeAuth() { $('#authWrap').classList.remove('open'); }
function syncAuth() {
  const login = authMode === 'login';
  $('#authTitle').textContent = login ? 'Welcome Back' : 'Create Account';
  $('#authSub').textContent = login ? 'Log in to your PrimeStake account' : 'Register a new PrimeStake account';
  $('#tabLogin').classList.toggle('active', login);
  $('#tabRegister').classList.toggle('active', !login);
  $('#authSubmit').textContent = login ? 'Login' : 'Register';
  const nameRow = $('#authNameRow');
  if (nameRow) nameRow.style.display = login ? 'none' : '';
  $('#authAlt').innerHTML = login
    ? 'Don\'t have an account? <a href="#" id="authAltLink">Register</a>'
    : 'Already have an account? <a href="#" id="authAltLink">Login</a>';
  $('#authAltLink').addEventListener('click', e => {
    e.preventDefault();
    authMode = login ? 'register' : 'login';
    syncAuth();
  });
}
function openMenu() { $('#drawerWrap').hidden = false; }
function closeMenu() { const w = $('#drawerWrap'); if (w) w.hidden = true; }
function syncHeader() {
  const ha = $('#headActions');
  if (state.user) {
    ha.innerHTML = '<span class="userchip">' + esc(state.user.phone) + ' · ' + money(state.user.balance_ghs) + '</span>';
  } else {
    ha.innerHTML = '<button class="btn ghost" id="loginBtn">Login</button>' +
      '<button class="btn gold" id="registerBtn">Register</button>';
    $('#loginBtn').addEventListener('click', () => openAuth('login'));
    $('#registerBtn').addEventListener('click', () => openAuth('register'));
  }
}
async function refreshUser() {
  if (!state.token) return;
  try {
    const data = await api('/auth/me');
    state.user = data.user;
  } catch (e) {
    if (e.code === 'not_logged_in') { state.user = null; state.token = ''; localStorage.removeItem('ps_token'); }
  }
  syncHeader();
}

/* ---------- global events ---------- */
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { closeMenu();
    e.preventDefault();
    state.view = nav.dataset.nav;
    render();
    if (state.view === 'bets') loadBets();
    if (state.view === 'wallet') loadWallet();
    if (state.view === 'support') loadSupport();
    return;
  }
  const chip = e.target.closest('[data-chip]');
  if (chip) {
    state[chip.dataset.chip] = chip.dataset.val;
    render();
    const sb = $('#searchBox');
    if (sb) sb.focus();
    return;
  }
  const odd = e.target.closest('[data-odd]');
  if (odd) {
    const m = state.matches.find(x => x.id === odd.dataset.odd);
    if (!m) return;
    const pick = odd.dataset.pick;
    const key = slipKey(m.id, state.market, pick);
    if (state.slip.has(key)) {
      state.slip.delete(key);
    } else {
      [...state.slip.keys()].forEach(k => {
        if (k.startsWith(m.id + '|')) state.slip.delete(k);
      });
      const o = marketsFor(m).find(x => x.label === pick);
      if (!o) return;
      state.slip.set(key, {
        matchId: m.id,
        matchLabel: m.home + ' vs ' + m.away,
        league: m.league, market: state.market, pick, odd: o.odd,
      });
    }
    renderSlip();
    render();
    return;
  }
  const rm = e.target.closest('[data-rm]');
  if (rm) { state.slip.delete(rm.dataset.rm); renderSlip(); render(); return; }
  const quick = e.target.closest('[data-quick]');
  if (quick) {
    const q = quick.dataset.quick;
    if (q === 'Soccer') { state.view = 'sports'; render(); }
    else if (q === 'Today') { state.view = 'home'; state.date = 'Today'; render(); }
    else if (q === 'All') { state.view = 'home'; state.league = 'All'; state.date = 'All'; state.query = ''; render(); }
    else if (q === 'Games') { state.view = 'games'; render(); }
    else if (q === 'Verify Bet') { state.view = 'verify'; render(); }
    else if (q === 'Booking Codes') { state.view = 'booking'; render(); }
    return;
  }
  const game = e.target.closest('[data-game]');
  if (game) { toast(game.dataset.game + ' launches soon with our games provider.'); return; }
  if (e.target.closest('[data-hero-cta]')) {
    const cta = HERO_SLIDES[state.heroIdx].cta;
    if (cta === 'See Games') { state.view = 'games'; render(); }
    else { state.view = 'live'; render(); }
    return;
  }
  if (e.target.closest('[data-open-auth]')) { openAuth('login'); return; }
  if (e.target.closest('[data-gen-code]')) {
    if (!state.slip.size) { toast('Add at least one odd to your slip first'); return; }
    const payload = [...state.slip.values()].map(s => ({ m: s.matchId, k: s.market, p: s.pick }));
    state.slipCode = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    render();
    toast('Slip code generated — share it to recreate this slip anywhere');
    return;
  }
  const wt = e.target.closest('[data-wtab]');
  if (wt) { state.walletTab = wt.dataset.wtab; render(); return; }
  if (e.target.closest('[data-momo-cancel]') || e.target.closest('[data-momo-reset]')) {
    stopMomoPoll(); state.momo = null; render(); return;
  }
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    if (navigator.clipboard) navigator.clipboard.writeText(cp.dataset.copy).catch(() => {});
    toast('MoMo number copied: ' + cp.dataset.copy);
    return;
  }
  if (e.target.id === 'logoutBtn') {
    state.user = null;
    state.token = '';
    localStorage.removeItem('ps_token');
    state.wallet = null;
    state.myBets = [];
    syncHeader();
    render();
    toast('Logged out');
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'mmAmt') syncMomoFee();
  if (e.target.id === 'mmPhone') {
    const n = detectNetworkJS(e.target.value);
    const sel = $('#mmNet');
    if (n && sel) sel.value = n;
  }
});

document.addEventListener('submit', async e => {
  const id = e.target.id;
  if (id === 'momoForm') {
    e.preventDefault();
    const amt = parseFloat($('#mmAmt').value) || 0;
    const phone = $('#mmPhone').value.trim();
    try {
      const d = await api('/wallet/deposit-momo', {
        method: 'POST',
        body: { amount_ghs: amt, phone, network: $('#mmNet').value }
      });
      if (d.next_action && d.next_action.type === 'submit_otp') {
        state.momo = { phase: 'otp', reference: d.reference, phone, amount: amt };
      } else if (d.status === 'unknown') {
        state.momo = { phase: 'failed', message: d.detail || 'We could not confirm the payment request. If a prompt arrives, approve it once — do not pay twice.' };
      } else {
        state.momo = { phase: 'wait', reference: d.reference, phone, amount: amt, ussd: d.next_action && d.next_action.ussd_fallback };
        startMomoPoll();
      }
      render();
    } catch (err) {
      if (err.code === 'provider_not_configured') {
        state.momoOff = true;
        render();
        toast('Instant deposits are being switched on — please use Manual transfer.');
      } else {
        state.momo = { phase: 'failed', message: err.detail || 'The payment could not be started. Nothing was charged.' };
        render();
      }
    }
  } else if (id === 'momoOtpForm') {
    e.preventDefault();
    try {
      await api('/wallet/deposit-otp', {
        method: 'POST',
        body: { reference: state.momo.reference, otp: $('#mmOtp').value.trim() }
      });
      state.momo.phase = 'wait';
      startMomoPoll();
      render();
    } catch (err) { toast(err.detail || 'That code was not accepted — check it and try again.'); }
  } else if (id === 'manualDepForm') {
    e.preventDefault();
    try {
      await api('/wallet/deposit-manual', {
        method: 'POST',
        body: { amount_ghs: parseFloat($('#mdAmt').value) || 0, sender_phone: $('#mdPhone').value.trim(), external_ref: $('#mdRef').value.trim() }
      });
      toast('Deposit confirmation received — your balance is credited once the payment is confirmed.');
      loadWallet();
    } catch (err) { errToast(err, 'Deposit confirmation failed.'); }
  } else if (id === 'withdrawForm') {
    e.preventDefault();
    try {
      await api('/wallet/withdraw', {
        method: 'POST',
        body: { amount_ghs: parseFloat($('#wdAmt').value) || 0, method: $('#wdMethod').value }
      });
      toast('Withdrawal requested — the amount is held and paid out after review.');
      loadWallet();
    } catch (err) { errToast(err, 'Withdrawal request failed.'); }
  } else if (id === 'verifyForm') {
    e.preventDefault();
    const code = $('#verifyCode').value.trim().toUpperCase();
    try {
      const data = await api('/bets/verify?code=' + encodeURIComponent(code));
      const t = data.ticket;
      state.verifyResult = betCardHTML({
        code: t.code, status: t.status, placed_at: t.placed_at,
        stake_ghs: t.stake_ghs, total_odds: t.total_odds, potential_ghs: t.potential_ghs,
        selections: t.selections,
      });
    } catch (err) {
      state.verifyResult = '<div class="card"><b>Ticket not found</b><p class="muted">No bet carries the code ' + esc(code) + '.</p></div>';
    }
    render();
  } else if (id === 'bookingLoadForm') {
    e.preventDefault();
    const raw = $('#loadCode').value.trim();
    try {
      const payload = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/')))));
      let added = 0;
      state.slip.clear();
      payload.forEach(item => {
        const m = state.matches.find(x => x.id === item.m);
        if (!m) return;
        const prevMarket = state.market;
        state.market = item.k;
        const o = marketsFor(m).find(x => x.label === item.p);
        state.market = prevMarket;
        if (!o) return;
        state.slip.set(slipKey(m.id, item.k, item.p), {
          matchId: m.id, matchLabel: m.home + ' vs ' + m.away,
          league: m.league, market: item.k, pick: item.p, odd: o.odd,
        });
        added++;
      });
      renderSlip();
      if (added) { toast('Slip loaded — ' + added + ' selection(s) at current odds'); openSlip(); }
      else toast('That code has no selections for matches currently listed.');
    } catch (err) {
      toast('That slip code could not be read.');
    }
  } else if (id === 'supportForm') {
    e.preventDefault();
    try {
      await api('/support', {
        method: 'POST',
        body: { subject: $('#supportSubject').value.trim(), body: $('#supportText').value.trim() }
      });
      toast('Message sent — support will reply here.');
      loadSupport();
    } catch (err) { errToast(err, 'Message could not be sent.'); }
  } else if (id === 'passwordForm') {
    e.preventDefault();
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { current_password: $('#pwCurrent').value, new_password: $('#pwNew').value }
      });
      toast('Password updated.');
      e.target.reset();
    } catch (err) { errToast(err, 'Password change failed.'); }
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'searchBox') {
    state.query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const sb = $('#searchBox');
    if (sb) { sb.focus(); sb.setSelectionRange(pos, pos); }
  }
});

$('#slipFab').addEventListener('click', openSlip);
$('#slipClose').addEventListener('click', closeSlip);
$('#scrim').addEventListener('click', closeSlip);
$('#loginBtn').addEventListener('click', () => openAuth('login'));
$('#registerBtn').addEventListener('click', () => openAuth('register'));
$('#authClose').addEventListener('click', closeAuth);
$('#tabLogin').addEventListener('click', () => { authMode = 'login'; syncAuth(); });
$('#tabRegister').addEventListener('click', () => { authMode = 'register'; syncAuth(); });
$('#forgotLink').addEventListener('click', e => {
  e.preventDefault();
  toast('Password help: message Support with your phone number and we will help you back in.');
});
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const phone = $('#authPhone').value.trim();
  const password = $('#authPass').value;
  if (!phone || !password) return;
  const btn = $('#authSubmit');
  btn.disabled = true;
  try {
    const path = authMode === 'login' ? '/auth/login' : '/auth/register';
    const body = { phone, password };
    if (authMode === 'register') {
      const nameEl = $('#authName');
      if (nameEl && nameEl.value.trim()) body.display_name = nameEl.value.trim();
    }
    const data = await api(path, { method: 'POST', body });
    state.token = data.token;
    localStorage.setItem('ps_token', data.token);
    state.user = data.user;
    syncHeader();
    closeAuth();
    toast(authMode === 'login' ? 'Welcome back' : 'Account created — welcome to PrimeStake');
    render();
    if (state.view === 'wallet') loadWallet();
    if (state.view === 'bets') loadBets();
  } catch (err) {
    errToast(err, 'Something went wrong.');
  } finally {
    btn.disabled = false;
  }
});

// hero auto-advance
setInterval(() => {
  if (state.view !== 'home') return;
  state.heroIdx = (state.heroIdx + 1) % HERO_SLIDES.length;
  if ($('.hero')) render();
}, 6000);

// boot: restore session, then load real matches
$('#burgerBtn').addEventListener('click', openMenu);
$('#drawerClose').addEventListener('click', closeMenu);
$('#drawerShade').addEventListener('click', closeMenu);

(async () => {
  renderSlip();
  render();
  if (state.token) await refreshUser();
  loadMatches();
})();
