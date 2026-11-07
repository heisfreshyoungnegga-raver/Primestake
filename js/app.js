// PrimeStake front end. All account, match, bet and wallet data comes
// from the PrimeStake API (/api). Nothing is faked locally: when the
// backend is not configured yet, pages say so instead of showing
// sample data.

const state = {
  view: 'home',
  league: 'All',
  market: '1X2',
  date: 'All',
  sport: 'Soccer',
  query: '',
  filtersOpen: false,
  matchId: null, prevView: 'home',
  cashoutArm: null,
  slip: new Map(), // key -> {matchId, matchLabel, league, market, pick, odd}
  user: null,
  token: localStorage.getItem('ps_token') || '',
  heroIdx: 0,
  matches: [],
  matchesLoaded: false,
  offline: false,
  myBets: [],
  betTab: 'ongoing',
  wallet: null,
  walletTab: 'instant',
  walletSection: 'deposit',
  referrals: null,
  momo: null,
  momoOff: false,
  verifyResult: '',
  slipCode: '',
  loadedCode: '', loadedCodeInfo: null,
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
// Correct Score: the standard 26 scorelines, keys cs<h><a> in the
// odds book (priced server-side in expandOdds). It stays out of
// MARKET_LIST on purpose — the match details page adds it itself, so
// the list-page Market filter and compact rows never render 26 picks.
const CS_GRID = [[1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [3, 2], [4, 0], [4, 1], [4, 2], [5, 0], [5, 1], [0, 0], [1, 1], [2, 2], [3, 3], [0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3], [0, 4], [1, 4], [2, 4], [0, 5], [1, 5]];
MARKET_KEYS['Correct Score'] = CS_GRID.map(([h, a]) => [h + '-' + a, 'cs' + h + a]);
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
    err.data = data;
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
    withdrawal_locked: 'Withdrawals are not available on your account yet — please contact support.',
    cashout_unavailable: 'Cashout is not available for this ticket right now.',
    bet_not_open: 'This ticket is no longer open.',
    match_finished: 'One of those matches has already finished.',
    one_selection_per_match: 'Only one selection per match on a slip.',
    market_unavailable: 'One of those markets is not available right now.',
    ticket_not_found: 'No ticket found with that code.',
    code_must_be_5_digits: 'Booking codes are exactly 5 digits.',
    code_not_found: 'That booking code does not exist.',
    code_revoked: 'That booking code has been revoked.',
    code_expired: 'That booking code has expired.',
    code_exhausted: 'That booking code has reached its use limit.',
    booking_code_not_found: 'That booking code does not exist.',
    booking_code_revoked: 'That booking code has been revoked.',
    booking_code_expired: 'That booking code has expired.',
    booking_code_exhausted: 'That booking code has reached its use limit.',
    booking_code_mismatch: 'Your slip no longer matches the booking code — load the code again to bet it.',
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
  if (['home', 'live', 'sports', 'virtual', 'match'].includes(state.view)) render();
}
function leagues() {
  return ['All', ...new Set(state.matches.map(m => m.league))];
}
function marketsFor(m) { return marketsForMarket(m, state.market); }
function marketsForMarket(m, market) {
  return (MARKET_KEYS[market] || [])
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
    time = '<span class="live-min">' + (m.minute != null ? m.minute + '&prime;' : 'LIVE') + '</span>';
  } else {
    time = '<span>' + fmtDate(m.starts_at) + '</span>';
  }
  // Live scores sit beside each team name (Prince's ask, 2026-11-03)
  // and update with the automatic ESPN refresh like the rest of the
  // row — no separate score column.
  const teamLine = (name, logo, score) =>
    '<div class="team">' + (logo ? '<img class="tlogo" src="' + esc(logo) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
    '<span class="tname">' + esc(name) + '</span>' +
    (score != null ? '<span class="tscore">' + score + '</span>' : '') + '</div>';
  return '<div class="mrow" data-match="' + m.id + '">' +
    (m.status === 'live' ? LIVE_BADGE : '') +
    '<div class="mtime">' + time + '</div>' +
    '<div class="mteams"><div class="league">' + esc(m.league) + '</div>' +
    teamLine(m.home, m.home_logo, m.status === 'live' ? m.sh : null) +
    teamLine(m.away, m.away_logo, m.status === 'live' ? m.sa : null) + '</div>' +
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
// Match details (Prince's ask, 2026-11-03): tapping a match card
// opens this page with EVERY market the system holds for the game —
// 1X2, Double Chance, every Over/Under line and BTTS — priced from
// the same ESPN-fed odds book the list uses. Selections add to the
// slip exactly like list odds (one selection per match).
function matchDetailsHTML() {
  const m = state.matches.find(x => x.id === state.matchId);
  const back = '<button class="btn ghost" data-back style="margin:10px 0">‹ Back</button>';
  if (!m) return back + '<div class="card"><h3>Match not available</h3><p class="muted">It may have finished or been removed.</p></div>';
  const when = m.status === 'live'
    ? '<span class="live-min">' + (m.minute != null ? m.minute + '&prime;' : 'LIVE') + '</span>'
    : esc(fmtDate(m.starts_at));
  const team = (name, logo, score) => '<div class="team">' + (logo ? '<img class="tlogo" src="' + esc(logo) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '<span class="tname">' + esc(name) + '</span>' + (score != null ? '<span class="tscore">' + score + '</span>' : '') + '</div>';
  let html = back + '<div class="card md-card">' + (m.status === 'live' ? LIVE_BADGE : '') + '<div class="league">' + esc(m.league) + '</div>' +
    '<div class="md-when">' + when + '</div>' +
    '<div class="md-teams">' + team(m.home, m.home_logo, m.status === 'live' ? m.sh : null) + team(m.away, m.away_logo, m.status === 'live' ? m.sa : null) + '</div></div>';
  const oddBtn = (market, o) => {
    const sel = state.slip.has(slipKey(m.id, market, o.label)) ? ' sel' : '';
    return '<button class="odd' + sel + '" data-odd="' + m.id + '" data-market="' + esc(market) + '" data-pick="' + esc(o.label) + '"><small>' + esc(o.label) + '</small>' + o.odd.toFixed(2) + '</button>';
  };
  for (const market of [...MARKET_LIST, 'Correct Score']) {
    const opts = marketsForMarket(m, market);
    if (!opts.length) continue;
    if (market === 'Correct Score') {
      // Grouped like the big books (Prince's reference screenshot):
      // the home team's winning scorelines, the draws, then the
      // away team's winning scorelines.
      const side = (o) => { const [h, a] = o.label.split('-').map(Number); return h > a ? 0 : h === a ? 1 : 2; };
      const groups = [[m.home + ' Win', 0], ['Draw', 1], [m.away + ' Win', 2]];
      html += '<div class="card md-sec"><h3>Correct Score</h3>' + groups.map(([title, g]) => {
        const go = opts.filter(o => side(o) === g);
        return go.length ? '<div class="md-sub">' + esc(title) + '</div><div class="md-odds">' + go.map(o => oddBtn(market, o)).join('') + '</div>' : '';
      }).join('') + '</div>';
      continue;
    }
    html += '<div class="card md-sec"><h3>' + esc(market) + '</h3><div class="md-odds">' + opts.map(o => oddBtn(market, o)).join('') + '</div></div>';
  }
  // Handicap (spread): ESPN publishes one line per game, so it is
  // not in MARKET_LIST (the line differs by match). The line in the
  // market name is the home team's; picks mirror it.
  if (m.odds && Number(m.odds.sph) > 1 && Number(m.odds.spa) > 1 && m.odds.sp_line != null) {
    const L = Number(m.odds.sp_line);
    const fmt = (x) => (x > 0 ? '+' : '') + x.toFixed(1);
    const market = 'Handicap ' + fmt(L);
    const opts = [
      { label: 'Home ' + fmt(L), odd: Number(m.odds.sph) },
      { label: 'Away ' + fmt(-L), odd: Number(m.odds.spa) },
    ];
    html += '<div class="card md-sec"><h3>' + esc(market) + '</h3><div class="md-odds">' + opts.map(o => {
      const sel = state.slip.has(slipKey(m.id, market, o.label)) ? ' sel' : '';
      return '<button class="odd' + sel + '" data-odd="' + m.id + '" data-market="' + esc(market) + '" data-pick="' + esc(o.label) + '"><small>' + esc(o.label) + '</small>' + o.odd.toFixed(2) + '</button>';
    }).join('') + '</div></div>';
  }
  return html;
}
function matchListHTML() {
  if (state.offline) {
    return '<div class="card"><h3>Matches are on their way</h3><p class="muted">The PrimeStake service is being set up right now. Fixtures and odds will appear here as soon as the backend goes live.</p></div>';
  }
  if (!state.matchesLoaded) return '<div class="skel"><i></i><i></i><i></i><i></i></div>';
  if (state.sport === 'Basketball') {
    return '<div class="card"><h3>Basketball is coming soon</h3>' +
      '<p class="muted">Basketball markets are not live yet. Soccer is open now with full markets on every match.</p>' +
      '<button class="btn gold" data-quick="Soccer">See soccer matches</button></div>';
  }
  const all = state.matches.filter(matchVisible);
  // No "EVENTS & MARKETS — N Matches Found" header (Prince removed it
  // 2026-11-03): the groups speak for themselves and the line ate space.
  let html = '';
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
// The repo stores the hero photos as base64 text (the git connector
// cannot carry binary files), so decode them client-side into usable
// URLs. If a host ever serves real JPEG bytes, a blob URL is used
// instead — both worlds work.
const heroUrls = {};
function loadHeroImages() {
  HERO_SLIDES.forEach(s => {
    if (!s.img || heroUrls[s.img]) return;
    heroUrls[s.img] = s.img;
    fetch(s.img).then(r => r.arrayBuffer()).then(buf => {
      const bytes = new Uint8Array(buf);
      if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        heroUrls[s.img] = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
      } else {
        heroUrls[s.img] = 'data:image/jpeg;base64,' + new TextDecoder().decode(buf).replace(/\s+/g, '');
      }
      if (state.view === 'home') render();
    }).catch(() => {});
  });
}
function heroHTML() {
  const s = HERO_SLIDES[state.heroIdx];
  return '<section class="hero"><img class="bg" src="' + (heroUrls[s.img] || s.img || 'assets/hero-stadium.jpg') + '" alt="">' +
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
  // The League/Market/When rows hide behind the Filters button
  // (Prince's UX call, 2026-11-03): the open panel pushed the matches
  // far down the page. Search stays visible at all times.
  const sliders = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h9M19 7h1M4 17h3M13 17h7"/><circle cx="16" cy="7" r="2.3"/><circle cx="10" cy="17" r="2.3"/></svg>';
  return '<section class="filtercard">' +
    '<div class="fbar"><div class="searchbar"><span class="sicon">⌕</span><input id="searchBox" type="search" placeholder="Search teams or leagues..." value="' + esc(state.query) + '"></div>' +
    '<button class="filterbtn' + (state.filtersOpen ? ' on' : '') + '" id="filterToggle" aria-expanded="' + !!state.filtersOpen + '">' + sliders + 'Filters<span class="fchev">' + (state.filtersOpen ? '▴' : '▾') + '</span></button></div>' +
    '<div class="frows' + (state.filtersOpen ? '' : ' closed') + '">' +
    row('League', 'league', leagues(), state.league) +
    row('Market', 'market', MARKET_LIST, state.market) +
    row('When', 'date', DATES, state.date) +
    '</div></section>';
}
// Home quick-access tiles (the icon row under the hero): each tile is a
// shortcut into a real view or filter. Icons are small inline SVGs drawn
// for PrimeStake; the Aviator tile carries the same HOT tag as Games.
const QICONS = {
  'Soccer': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7l3 2.2-1.1 3.6h-3.8L9 9.2 12 7z" fill="#141414" stroke="none"/><path d="M12 3v4M18.6 6.4L15 9.2M20.1 14.6l-4.7-1.3M15.4 20.2l-1.5-4.4M8.6 20.2l1.5-4.4M3.9 14.6l4.7-1.3M5.4 6.4L9 9.2"/></svg>',
  'Today': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15.5" r="1.4" fill="#141414" stroke="none"/></svg>',
  'Live': '<svg viewBox="0 0 24 24" fill="none" stroke="#d8232a" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="2.2" fill="#d8232a" stroke="none"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.8 5.8a9 9 0 0 0 0 12.4M18.2 5.8a9 9 0 0 1 0 12.4"/></svg>',
  'Aviator': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7" stroke-linejoin="round"><path d="M21 3L10.6 13.4M21 3l-6.6 18-3.8-7.6L3 9.6 21 3z"/></svg>',
  'Basketball': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3.2 12h17.6M12 3.2v17.6M5.6 5.6c3.4 3.6 3.4 9.2 0 12.8M18.4 5.6c-3.4 3.6-3.4 9.2 0 12.8"/></svg>',
  'Verify Bet': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 2.5V11c0 4.6-3 7.7-7 9.5C8 18.7 5 15.6 5 11V5.5L12 3z"/><path d="M9 11.6l2.2 2.2 4.3-4.3"/></svg>',
  'Booking Code': '<svg viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5V10a2.5 2.5 0 0 0 0 5v1.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V15a2.5 2.5 0 0 0 0-5V8.5z"/><path d="M13.5 8v1.6M13.5 11.2v1.6M13.5 14.4V16"/></svg>',
};
// Custom tile artwork (generated for PrimeStake, black-and-gold set).
// Like the hero photos, the files in assets/ hold base64 text, so they
// are decoded client-side; until a decode lands, the inline SVG shows.
const TILE_IMGS = {
  'Soccer': 'assets/icon-soccer.jpg',
  'Today': 'assets/icon-today.jpg',
  'Live': 'assets/icon-live.jpg',
  'Aviator': 'assets/icon-aviator.jpg',
  'Basketball': 'assets/icon-basketball.jpg',
  'Verify Bet': 'assets/icon-verify.jpg',
  'Booking Code': 'assets/icon-booking.jpg',
};
const tileUrls = {};
function loadTileImages() {
  Object.keys(TILE_IMGS).forEach(label => {
    const path = TILE_IMGS[label];
    if (tileUrls[label]) return;
    tileUrls[label] = path;
    fetch(path).then(r => r.arrayBuffer()).then(buf => {
      const bytes = new Uint8Array(buf);
      tileUrls[label] = (bytes[0] === 0xFF && bytes[1] === 0xD8)
        ? URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }))
        : 'data:image/jpeg;base64,' + new TextDecoder().decode(buf).replace(/\s+/g, '');
      if (state.view === 'home') render();
    }).catch(() => {});
  });
}
function quickHTML() {
  const tiles = [
    ['Soccer', ''],
    ['Today', ''],
    ['Live', ''],
    ['Aviator', 'hot'],
    ['Basketball', ''],
    ['Verify Bet', ''],
    ['Booking Code', ''],
  ];
  return '<div class="quickrow">' + tiles.map(([label, cls]) => {
    const u = tileUrls[label];
    const art = (u && (u.startsWith('data:') || u.startsWith('blob:')))
      ? '<img class="qimg" src="' + u + '" alt="">'
      : QICONS[label];
    return '<button class="qtile' + (cls ? ' ' + cls : '') + '" data-quick="' + label + '">' +
      (cls === 'hot' ? '<span class="qhot">HOT</span>' : '') +
      '<span class="qicon">' + art + '</span><span>' + label + '</span></button>';
  }).join('') + '</div>';
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
  // One sliding line (duplicated half for a seamless loop), not the
  // old 2x2 card grid — frees the space above the matches.
  const half = items.map(i =>
    '<span class="titem"><b>' + i[0] + '</b> ' + i[1] + '</span>').join('<span class="tdot">•</span>') +
    '<span class="tdot">•</span>';
  return '<div class="trustslide"><div class="trust-track">' + half + half + '</div></div>';
}

/* ---------- account pages ---------- */
function gateHTML(title) {
  return '<div class="profile"><h2>' + title + '</h2>' +
    '<p class="modal-sub">Log in to see this page.</p>' +
    '<button class="btn gold big" data-open-auth>Login</button></div>';
}
function statusChip(s) {
  const cls = s === 'completed' || s === 'won' || s === 'cashed_out' ? 'completed' : s === 'rejected' || s === 'lost' ? 'rejected' : 'pending';
  const label = s === 'cashed_out' ? 'CASHED OUT' : String(s).toUpperCase();
  return '<span class="st st-' + cls + '">' + label + '</span>';
}
// Small red LIVE pill pinned to a live match card's top-right corner
// (Prince's ask 2026-11-07) — used by the home list, match details and
// betslip selections; admin.js carries its own copy for the portals.
const LIVE_BADGE = '<span class="livebadge">LIVE</span>';
function profileHTML() {
  if (!state.user) {
    return '<div class="profile"><h2>ME Profile</h2>' +
      '<p class="modal-sub">Log in to see your account, bets and balance.</p>' +
      '<button class="btn gold big" data-open-auth>Login</button></div>';
  }
  return '<div class="profile"><h2>' + esc(state.user.phone || state.user.email || '') + '</h2>' +
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
// Referral links are an admin-tier tool only (Prince's rule,
// 2026-11-03): players no longer see a Refer & Earn block — the
// link, the referred list and the earnings live in the admin and
// super admin portals (My Earnings) for admin accounts only.
// Shrink a picked screenshot to a modest JPEG data URL so it can
// ride along with the manual-deposit confirmation (stored on the
// transaction row; the reviewing admin opens it from the queue).
function shrinkImage(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1280 / Math.max(img.width || 1, img.height || 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
function betCardHTML(b) {
  const legs = (b.selections || []).map(l => {
    // Live legs wear the same pulsing LIVE chip + score + minute
    // the Super Admin Matches tab shows (Prince's ask 2026-11-05);
    // a finished-but-unsettled leg shows its FT score.
    let res;
    if (l.match_status === 'live') {
      res = '<span class="st st-live">● LIVE' + (l.live_minute != null ? ' ' + l.live_minute + '&prime;' : '') + '</span> <b>' +
        (l.live_home || 0) + '-' + (l.live_away || 0) + '</b>';
    } else if (l.match_status === 'finished') {
      res = '<span class="legres">FT ' + (l.live_home || 0) + '-' + (l.live_away || 0) + '</span>';
    } else {
      res = '<span class="legres">' + esc(l.result || '') + '</span>';
    }
    return '<div class="leg"><span>' + esc(l.home_team || '') + ' vs ' + esc(l.away_team || '') + '</span>' +
      '<span>' + esc(l.pick) + ' · ' + esc(l.market) + ' · <b>' + Number(l.odds).toFixed(2) + '</b></span>' +
      '<span class="legstate">' + res + '</span></div>';
  }).join('');
  let foot = '';
  if (b.status === 'cashed_out' && b.cashout_ghs != null) {
    foot = '<div class="card-row"><span>Cashed out</span><b>' + money(b.cashout_ghs) + '</b></div>';
  } else if (b.status === 'open' && b.cashout_offer) {
    const armed = state.cashoutArm && state.cashoutArm.id === b.id && Date.now() - state.cashoutArm.at < 5000;
    foot = '<button class="btn gold big" data-cashout="' + b.id + '">' +
      (armed ? 'Tap again to confirm — ' : '') + 'Cashout ' + money(b.cashout_offer) + '</button>';
  }
  const won = b.status === 'won';
  return '<div class="card' + (won ? ' woncard' : '') + '"><div class="card-head"><b>' + esc(b.code) +
    (won ? trophyMiniHTML() : '') + '</b>' + statusChip(b.status) + '</div>' +
    '<p class="muted">' + fmtDate(b.placed_at) + '</p>' + legs +
    '<div class="card-row"><span>Stake</span><b>' + money(b.stake_ghs) + '</b></div>' +
    '<div class="card-row"><span>Total odds</span><b>' + Number(b.total_odds).toFixed(2) + '</b></div>' +
    (won
      ? '<div class="card-row"><span>Winnings</span><b class="winamt">' + money(b.potential_ghs) + '</b></div>'
      : '<div class="card-row"><span>Potential win</span><b>' + money(b.potential_ghs) + '</b></div>') + foot + '</div>';
}
function betsHTML() {
  if (!state.user) return gateHTML('My Bets');
  // Sorted tabs (Prince's ask 2026-11-07): Ongoing = open tickets,
  // Settled = won or cashed out, Lost = lost. Counts ride on the tabs.
  const tab = state.betTab || 'ongoing';
  const groups = {
    ongoing: state.myBets.filter(b => b.status === 'open'),
    settled: state.myBets.filter(b => b.status === 'won' || b.status === 'cashed_out'),
    lost: state.myBets.filter(b => b.status === 'lost'),
  };
  const tabBtn = (key, label) =>
    '<button class="' + (tab === key ? 'on' : '') + '" data-btab="' + key + '">' + label +
    ' <span class="cnt">' + groups[key].length + '</span></button>';
  const tabs = '<div class="wtabs btabs">' + tabBtn('ongoing', 'Ongoing') +
    tabBtn('settled', 'Settled') + tabBtn('lost', 'Lost') + '</div>';
  const emptyMsg = {
    ongoing: 'No ongoing bets — your open tickets will show here.',
    settled: 'No settled bets yet — won and cashed-out tickets land here.',
    lost: 'No lost bets. Keep it that way.',
  }[tab];
  const anyOffer = tab === 'ongoing' && groups.ongoing.some(b => b.cashout_offer);
  return '<h2>My Bets</h2>' + tabs +
    (anyOffer ? '<div class="card cashbar"><b>Cashout available now!</b><p class="muted">Settle an open ticket early and take the offer on it below.</p></div>' : '') +
    (groups[tab].length ? groups[tab].map(betCardHTML).join('') : '<p class="empty">' + emptyMsg + '</p>');
}
async function loadBets() {
  try {
    const data = await api('/bets/mine');
    state.myBets = data.bets;
  } catch (e) { state.myBets = []; }
  if (state.view === 'bets') render();
  maybeCelebrateWins();
  // While any leg is live, keep My Bets fresh on its own so the
  // score and minute move without the player refreshing.
  clearTimeout(state.betsTimer);
  const anyLive = (state.myBets || []).some(b => b.status === 'open' &&
    (b.selections || []).some(s => s.match_status === 'live'));
  if (anyLive) {
    state.betsTimer = setTimeout(() => { if (state.view === 'bets') loadBets(); }, 30000);
  }
}
/* ----- Winning trophy (Prince's ask 2026-11-05): a hand-drawn gold
   cup, PrimeStake-style. It badges won tickets in My Bets, and the
   first time a freshly-won bet is seen the player gets the full
   celebration: rotating light rays, falling confetti, the trophy
   floating over the amount won. Seen wins are remembered per device
   so the party fires once per winning ticket. ----- */
/* The real cup photo (Prince's ask 2026-11-05): a generated gold
   trophy with its background removed, stored like the other assets
   as base64 text in assets/trophy-cup.png and decoded on load. The
   hand-drawn SVG below stays as the instant fallback until the photo
   arrives (and forever if the fetch fails). */
let trophyURL = '';
function loadTrophyImage() {
  fetch('assets/trophy-cup.png').then(r => r.text()).then(t => {
    const clean = t.replace(/\s+/g, '');
    if (clean.length > 1000) {
      trophyURL = 'data:image/png;base64,' + clean;
      if (state.view === 'bets') render();
    }
  }).catch(() => {});
}
function trophyHeroHTML() {
  return trophyURL
    ? '<img class="trophy-photo" src="' + trophyURL + '" alt="Winning trophy">'
    : trophySVG();
}
function trophyMiniHTML() {
  return trophyURL
    ? '<img class="trophy-mini-img" src="' + trophyURL + '" alt="">'
    : trophySVG('trophy-mini');
}
function trophySVG(cls) {
  return '<svg class="' + (cls || 'trophy-svg') + '" viewBox="0 0 200 162" fill="none" aria-hidden="true">' +
    '<defs>' +
    '<linearGradient id="tgold" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#ffedb0"/><stop offset=".38" stop-color="#f5c518"/>' +
    '<stop offset=".75" stop-color="#d19a06"/><stop offset="1" stop-color="#8a6108"/></linearGradient>' +
    '<linearGradient id="tgold2" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#c9930a"/><stop offset=".5" stop-color="#ffe98a"/><stop offset="1" stop-color="#c9930a"/></linearGradient>' +
    '</defs>' +
    '<path d="M30 12l2.4 6.2 6.2 2.4-6.2 2.4L30 29.2l-2.4-6.2-6.2-2.4 6.2-2.4z" fill="#ffd94d"/>' +
    '<path d="M168 6l1.9 4.9 4.9 1.9-4.9 1.9L168 19.6l-1.9-4.9-4.9-1.9 4.9-1.9z" fill="#ffe98a"/>' +
    '<path d="M177 50l1.5 3.9 3.9 1.5-3.9 1.5-1.5 3.9-1.5-3.9-3.9-1.5 3.9-1.5z" fill="#ffd94d"/>' +
    '<path d="M61 42C36 44 32 76 63 84" stroke="url(#tgold)" stroke-width="10" stroke-linecap="round"/>' +
    '<path d="M139 42c25 2 29 34-2 42" stroke="url(#tgold)" stroke-width="10" stroke-linecap="round"/>' +
    '<path d="M58 30h84v30c0 27-18 46-42 46S58 87 58 60z" fill="url(#tgold)"/>' +
    '<ellipse cx="100" cy="30" rx="42" ry="6" fill="url(#tgold2)"/>' +
    '<path d="M66 38c0 22 6 40 16 50-14-4-24-22-24-42 0-3 4-8 8-8z" fill="#fff" opacity=".28"/>' +
    '<path d="M100 50l3.3 10.7 11.3-.7-8.6 7.2 2.7 11-8.7-6.8-8.7 6.8 2.7-11-8.6-7.2 11.3.7z" fill="#fff6cf" stroke="#8a6108" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<rect x="91" y="104" width="18" height="13" rx="2" fill="url(#tgold)"/>' +
    '<ellipse cx="100" cy="119" rx="17" ry="4" fill="url(#tgold2)"/>' +
    '<path d="M76 123h48l7 15H69z" fill="url(#tgold)"/>' +
    '<rect x="62" y="138" width="76" height="13" rx="3" fill="url(#tgold2)"/>' +
    '<rect x="80" y="142" width="40" height="5" rx="2.5" fill="#8a6108" opacity=".55"/>' +
    '<path d="M38 128q62 20 124 0" stroke="#c9930a" stroke-width="3" stroke-linecap="round"/>' +
    '<g fill="url(#tgold)" stroke="#8a6108" stroke-width=".6">' +
    '<ellipse cx="46" cy="98" rx="7" ry="3" transform="rotate(-42 46 98)"/>' +
    '<ellipse cx="40" cy="110" rx="7" ry="3" transform="rotate(-24 40 110)"/>' +
    '<ellipse cx="42" cy="122" rx="7" ry="3" transform="rotate(-8 42 122)"/>' +
    '<ellipse cx="154" cy="98" rx="7" ry="3" transform="rotate(42 154 98)"/>' +
    '<ellipse cx="160" cy="110" rx="7" ry="3" transform="rotate(24 160 110)"/>' +
    '<ellipse cx="158" cy="122" rx="7" ry="3" transform="rotate(8 158 122)"/>' +
    '</g></svg>';
}
function celebratedWins() {
  try { return JSON.parse(localStorage.getItem('ps_celebrated_wins') || '[]'); } catch (e) { return []; }
}
function maybeCelebrateWins() {
  if (!state.user || document.getElementById('winWrap')) return;
  const seen = celebratedWins();
  const fresh = (state.myBets || []).filter(b => b.status === 'won' && !seen.includes(b.id));
  if (!fresh.length) return;
  const total = fresh.reduce((s, b) => s + Number(b.potential_ghs || 0), 0);
  state.pendingWinIds = fresh.map(b => b.id);
  showWinModal(fresh, total);
}
function showWinModal(wins, total) {
  closeWinModal(false);
  const cols = ['#f5c518', '#ffe98a', '#2ecc71', '#ffffff', '#c9930a'];
  let confetti = '';
  for (let i = 0; i < 26; i++) {
    confetti += '<i class="confetti" style="left:' + Math.round(Math.random() * 100) + '%;background:' +
      cols[i % cols.length] + ';animation-delay:' + (Math.random() * 0.9).toFixed(2) +
      's;animation-duration:' + (2.4 + Math.random() * 1.8).toFixed(2) + 's"></i>';
  }
  const codes = wins.map(b => esc(b.code)).join(', ');
  const el = document.createElement('div');
  el.className = 'modalwrap open winwrap';
  el.id = 'winWrap';
  el.innerHTML = '<div class="modal winmodal">' +
    '<div class="winrays"></div>' + confetti +
    '<button class="iconbtn modal-x" data-close-win aria-label="Close">&times;</button>' +
    '<div class="trophy-hero">' + trophyHeroHTML() + '</div>' +
    '<h2 class="win-title">YOU WON!</h2>' +
    '<p class="modal-sub">' + (wins.length > 1 ? wins.length + ' winning tickets: ' + codes : 'Winning ticket ' + codes) + '</p>' +
    '<div class="win-amount">' + money(total) + '</div>' +
    '<p class="muted">Your winnings are already in your wallet. Well played, champion.</p>' +
    '<button class="btn gold big" data-close-win>Collect your glory</button>' +
    '</div>';
  document.body.appendChild(el);
}
function closeWinModal(markSeen) {
  const el = document.getElementById('winWrap');
  if (el) el.remove();
  if (markSeen && state.pendingWinIds) {
    try {
      localStorage.setItem('ps_celebrated_wins',
        JSON.stringify(celebratedWins().concat(state.pendingWinIds).slice(-200)));
    } catch (e) { /* private mode: the party may repeat, never break */ }
    state.pendingWinIds = null;
  }
}
function withdrawCardHTML(w) {
  // The deposit-count withdrawal rule is enforced server-side by the
  // database trigger. Since Prince's Stakeza-style redesign
  // (2026-11-03, reversing the morning's invisible-rule call), a
  // not-yet-eligible request opens the verification prompt below,
  // which shows how many deposits remain — it no longer hides
  // behind the generic support toast.
  return '<div class="card"><h3>Withdraw</h3>' +
    '<form id="withdrawForm" class="stack">' +
    '<label>Amount (GHS) <input type="number" id="wdAmt" min="1" value="50" required></label>' +
    '<label>Pay to <select id="wdMethod"><option>MTN MoMo</option><option>Telecel Cash</option><option>AT Money</option></select></label>' +
    '<button class="btn gold big" type="submit">Request Withdrawal</button></form>' +
    '<p class="muted">The amount is held from your balance when you request; it is paid out after review. A rejected request refunds the hold.</p></div>';
}
// Verification prompt (Stakeza-style, Prince's ask 2026-11-03): a
// player short of the required deposits who requests a withdrawal
// gets this instead of a dead-end toast — how many deposits remain,
// a progress bar, and a straight path to the deposit form.
function showVerifyModal(info) {
  closeVerifyModal();
  const done = Number(info && info.deposits_done) || 0;
  const required = Number(info && info.deposits_required) || 6;
  const remaining = Math.max(required - done, 0);
  const pct = Math.min(100, Math.round((done / required) * 100));
  const el = document.createElement('div');
  el.className = 'modalwrap open';
  el.id = 'verifyWrap';
  el.innerHTML = '<div class="modal">' +
    '<button class="iconbtn modal-x" data-close-verify aria-label="Close">&times;</button>' +
    '<p class="modal-sub">First verification</p>' +
    '<h2>Complete your verification</h2>' +
    '<p>Make <b>' + remaining + ' more deposit' + (remaining === 1 ? '' : 's') + '</b> to unlock withdrawals on your PrimeStake account.</p>' +
    '<div class="vbar"><i style="width:' + pct + '%"></i></div>' +
    '<p class="muted">' + done + ' of ' + required + ' deposits completed</p>' +
    '<button class="btn gold big" data-goto-deposit>Deposit now</button>' +
    '<button class="btn ghost big" data-done-verify>I\'ve completed a deposit</button>' +
    '<p class="muted">Deposits go to your own betting wallet. The money stays yours to bet with — it is not a fee, and nothing is taken from your balance to release a withdrawal.</p>' +
    '</div>';
  document.body.appendChild(el);
}
function closeVerifyModal() {
  const el = $('#verifyWrap');
  if (el) el.remove();
}
// Withdrawal sent confirmation (Prince's reference screenshot,
// 2026-11-07): shown the moment a withdrawal request succeeds —
// Transactions goes to the wallet history, Home goes back to the
// match list. Replaces the old plain toast.
function showWithdrawSentModal() {
  closeWithdrawSentModal();
  const el = document.createElement('div');
  el.className = 'modalwrap open';
  el.id = 'wdSentWrap';
  el.innerHTML = '<div class="modal wdmodal">' +
    '<h2>Withdrawal sent</h2>' +
    '<p class="wdmsg">Your withdrawal is on its way. It is usually paid within a few minutes.</p>' +
    '<div class="wdfoot">' +
    '<button type="button" data-wd-tx>Transactions</button>' +
    '<button type="button" data-wd-home>Home</button>' +
    '</div></div>';
  document.body.appendChild(el);
}
function closeWithdrawSentModal() {
  const el = $('#wdSentWrap');
  if (el) el.remove();
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
  // Gateway deposits use Prince's preset amounts: the chips are the ONLY
  // way to set the amount. The amount box is read-only (Prince, 2026-11-06:
  // a client complained users could tap the box and type GHS 1 even though
  // the minimum is 300 — what the user selects is what goes through).
  const presets = [300, 500, 1000, 1500, 2000];
  return '<div class="card"><h3>Mobile Money</h3>' +
    '<form id="momoForm" class="stack">' +
    '<div class="amtrow">' + presets.map(a =>
      '<button type="button" class="amtchip' + (a === 300 ? ' on' : '') + '" data-amt="' + a + '">GHS ' + a.toLocaleString('en-GB') + '</button>').join('') + '</div>' +
    '<label>Amount (GHS) <input type="text" id="mmAmt" value="300" readonly tabindex="-1"></label>' +
    '<p class="muted">Minimum deposit is GHS 300. Tap an amount above to select it — the amount cannot be typed in.</p>' +
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
      '<div class="amtrow">' + [300, 500, 1000, 1500, 2000].map(a =>
        '<button type="button" class="amtchip' + (a === 300 ? ' on' : '') + '" data-mdamt="' + a + '">GHS ' + a.toLocaleString('en-GB') + '</button>').join('') + '</div>' +
      '<label>Amount sent (GHS) <input type="text" id="mdAmt" value="300" readonly tabindex="-1"></label>' +
      '<p class="muted">Minimum deposit is GHS 300. Tap the amount you sent above — the amount cannot be typed in.</p>' +
      '<label>Your MoMo number <input type="tel" id="mdPhone" placeholder="05X XXX XXXX" required></label>' +
      '<label>Transaction ID / reference <input type="text" id="mdRef" placeholder="e.g. 12345678901" required></label>' +
      '<label>Screenshot of the transaction (optional) <input type="file" id="mdProof" accept="image/*"></label>' +
      '<button class="btn gold big" type="submit">I Have Sent It — Confirm Deposit</button></form></div>'
    : momoPanelHTML();
  // Deposit, Withdraw and History are separate views inside the wallet.
  const sec = state.walletSection;
  const sectionTabs = '<div class="wtabs">' +
    [['deposit', 'Deposit'], ['withdraw', 'Withdraw'], ['history', 'History']].map(([k, label]) =>
      '<button class="' + (sec === k ? 'on' : '') + '" data-wsec="' + k + '">' + label + '</button>').join('') + '</div>';
  let sectionBody = '';
  if (sec === 'deposit') {
    sectionBody = '<div class="wtabs"><button class="' + (manual ? '' : 'on') + '" data-wtab="instant">Mobile Money</button>' +
      '<button class="' + (manual ? 'on' : '') + '" data-wtab="manual">Manual transfer</button></div>' + depositPanel;
  } else if (sec === 'withdraw') {
    sectionBody = withdrawCardHTML(w);
  } else {
    sectionBody = '<div class="card"><h3>Transactions</h3>' + (tx || '<p class="empty">No transactions yet.</p>') + '</div>';
  }
  return '<h2>Wallet</h2>' +
    '<div class="card"><div class="muted">Balance</div><div class="bal">' + money(w.balance_ghs) + '</div></div>' +
    sectionTabs + sectionBody;
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
  const lc = state.loadedCodeInfo;
  return '<h2>Booking Codes</h2>' +
    '<div class="card"><h3>Load a booking code</h3>' +
    '<p class="muted">Bought a code from the super admin? Enter the 5-digit code and his exact slip lands on your betslip at current odds.</p>' +
    '<form id="bookingCodeForm" class="stack">' +
    '<label>Booking code <input type="text" id="bkCode" inputmode="numeric" maxlength="5" placeholder="5-digit code" required></label>' +
    '<button class="btn gold big" type="submit">Load Booking Code</button></form>' +
    (state.loadedCode ? '<p class="bigcode">' + esc(state.loadedCode) + '</p>' +
      '<p class="muted">Your slip is tied to booking code ' + esc(state.loadedCode) +
      (lc && lc.label ? ' — “' + esc(lc.label) + '”' : '') +
      (lc && lc.price_ghs ? ' · sold at ' + money(lc.price_ghs) : '') +
      '. Bet it exactly as loaded — changing a selection unties it from the code.</p>' : '') + '</div>' +
    '<div class="card"><h3>Generate from your betslip</h3>' +
    '<p class="muted">A personal slip code packs your current selections into one code that recreates them on any device. ' +
    (state.slip.size ? state.slip.size + ' selection(s) on your slip.' : 'Your slip is empty — add odds first.') + '</p>' +
    '<button class="btn gold big" data-gen-code>Generate Slip Code</button>' +
    (state.slipCode ? '<p class="bigcode">' + esc(state.slipCode) + '</p>' : '') + '</div>' +
    '<div class="card"><h3>Load a personal slip code</h3><form id="bookingLoadForm" class="stack">' +
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
    '<div class="card-row"><span>Phone / email</span><b>' + esc(state.user.phone || state.user.email || '') + '</b></div>' +
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
    case 'match': return matchDetailsHTML();
    case 'live':
    case 'sports':
    case 'virtual':
      return filtersHTML() + matchListHTML();
    default:
      return heroHTML() + quickHTML() + promoStripHTML() + trustStripHTML() + filtersHTML() + matchListHTML();
  }
}
function render() {
  root.innerHTML = viewHTML();
  document.querySelectorAll('.navlink').forEach(b =>
    b.classList.toggle('active', b.dataset.nav === state.view));
  document.querySelectorAll('.bn-item').forEach(b =>
    b.classList.toggle('on', b.dataset.nav === state.view));
  if ($('#mmFeeLine')) syncMomoFee();
}

/* ---------- betslip ---------- */
function renderSlip() {
  $('#slipCount').textContent = state.slip.size;
  const bnCount = $('#bnSlipCount');
  if (bnCount) bnCount.textContent = state.slip.size;
  const body = $('#slipBody');
  const foot = $('#slipFoot');
  if (!state.slip.size) {
    body.innerHTML = '<p class="empty">Your betslip is empty.<br>Tap any odd to add a selection.</p>';
    foot.innerHTML = '';
    return;
  }
  body.innerHTML = [...state.slip.entries()].map(([key, s]) => {
    const mm = state.matches.find(x => x.id === s.matchId);
    return '<div class="sel">' + (mm && mm.status === 'live' ? LIVE_BADGE : '') + '<div class="s-top"><span class="s-match">' + esc(s.matchLabel) + '</span>' +
    '<button class="rm" data-rm="' + esc(key) + '">Remove</button></div>' +
    '<span class="s-pick">' + esc(s.league) + ' · ' + esc(s.market) + ' · ' + esc(s.pick) + '</span>' +
    '<span class="s-odd">' + s.odd.toFixed(2) + '</span></div>';
  }).join('');
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
    const data = await api('/bets/place', { method: 'POST', body: { selections, stake_ghs: stake, booking_code: state.loadedCode || undefined } });
    state.slip.clear();
    state.loadedCode = ''; state.loadedCodeInfo = null;
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
  // Admin-invite registration gets the email field and an optional
  // phone (either identifier works at login); login is labelled for both.
  const hasInvite = !!localStorage.getItem('ps_admin_invite');
  const emailRow = $('#authEmailRow');
  if (emailRow) emailRow.style.display = (!login && hasInvite) ? '' : 'none';
  const phoneInput = $('#authPhone');
  if (phoneInput) phoneInput.required = login || !hasInvite;
  const phoneLabel = $('#authPhoneLabel');
  if (phoneLabel) phoneLabel.textContent = login ? 'Phone number or email' : (hasInvite ? 'Phone number (optional if you gave an email)' : 'Phone number');
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
    // Header shows the account balance plus a Deposit shortcut (Prince's
    // layout, 2026-11-03 — he first asked for the number here, then chose
    // the balance instead; the number lives in ME Profile). The button's
    // own listener primes the wallet on the deposit section before the
    // shared nav handler switches the view.
    ha.innerHTML = '<span class="userchip">' + money(state.user.balance_ghs) + '</span>' +
      '<button class="btn gold" id="headDeposit" data-nav="wallet">Deposit</button>';
    $('#headDeposit').addEventListener('click', () => {
      state.walletSection = 'deposit';
      state.walletTab = 'instant';
    });
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
    // Top-nav sections always open on the default soccer book; the
    // Basketball tile is the only way into the basketball placeholder.
    if (['home', 'live', 'sports', 'virtual'].includes(state.view)) state.sport = 'Soccer';
    render();
    if (state.view === 'bets') loadBets();
    if (state.view === 'wallet') loadWallet();
    if (state.view === 'support') loadSupport();
    return;
  }
  if (e.target.closest('#filterToggle')) {
    // Flip the rows in place (no re-render, so search text/focus and
    // scroll stay put); state.filtersOpen keeps later renders in sync.
    state.filtersOpen = !state.filtersOpen;
    const rows = $('.frows');
    if (rows) rows.classList.toggle('closed', !state.filtersOpen);
    const fb = $('#filterToggle');
    fb.classList.toggle('on', state.filtersOpen);
    fb.setAttribute('aria-expanded', String(state.filtersOpen));
    const ch = fb.querySelector('.fchev');
    if (ch) ch.textContent = state.filtersOpen ? '▴' : '▾';
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
    // Details-page buttons carry their own market; list buttons use
    // the market chosen in the filter chips.
    const market = odd.dataset.market || state.market;
    const key = slipKey(m.id, market, pick);
    if (state.slip.has(key)) {
      state.slip.delete(key);
    } else {
      [...state.slip.keys()].forEach(k => {
        if (k.startsWith(m.id + '|')) state.slip.delete(k);
      });
      const o = marketsForMarket(m, market).find(x => x.label === pick);
      if (!o) return;
      state.slip.set(key, {
        matchId: m.id,
        matchLabel: m.home + ' vs ' + m.away,
        league: m.league, market, pick, odd: o.odd,
      });
    }
    // Any manual change unties the slip from a loaded booking code.
    state.loadedCode = ''; state.loadedCodeInfo = null;
    renderSlip();
    render();
    return;
  }
  if (e.target.closest('[data-back]')) {
    state.view = state.prevView || 'home';
    state.matchId = null;
    render();
    return;
  }
  if (e.target.id === 'verifyWrap' || e.target.closest('[data-close-verify]')) {
    closeVerifyModal();
    return;
  }
  if (e.target.id === 'wdSentWrap') {
    closeWithdrawSentModal();
    return;
  }
  if (e.target.closest('[data-wd-tx]')) {
    closeWithdrawSentModal();
    state.view = 'wallet';
    state.walletSection = 'history';
    loadWallet();
    render();
    return;
  }
  if (e.target.closest('[data-wd-home]')) {
    closeWithdrawSentModal();
    state.view = 'home';
    render();
    return;
  }
  if (e.target.id === 'winWrap' || e.target.closest('[data-close-win]')) {
    closeWinModal(true);
    return;
  }
  if (e.target.closest('[data-done-verify]')) {
    closeVerifyModal();
    loadWallet();
    return;
  }
  if (e.target.closest('[data-goto-deposit]')) {
    closeVerifyModal();
    const amt = $('#mmAmt');
    if (amt) amt.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const coBtn = e.target.closest('[data-cashout]');
  if (coBtn) {
    const id = coBtn.dataset.cashout;
    if (!(state.cashoutArm && state.cashoutArm.id === id && Date.now() - state.cashoutArm.at < 5000)) {
      state.cashoutArm = { id, at: Date.now() };
      render();
      return;
    }
    state.cashoutArm = null;
    api('/bets/cashout', { method: 'POST', body: { bet_id: id } })
      .then(d => {
        toast('Cashed out ' + money(d.cashout_ghs) + ' — credited to your balance.');
        refreshUser();
        loadBets();
      })
      .catch(err => { errToast(err, 'Cashout failed.'); loadBets(); });
    return;
  }
  const mrow = e.target.closest('[data-match]');
  if (mrow && !e.target.closest('button, a, input, select, textarea')) {
    state.prevView = ['home', 'live', 'sports', 'virtual'].includes(state.view) ? state.view : 'home';
    state.matchId = mrow.dataset.match;
    state.view = 'match';
    render();
    window.scrollTo(0, 0);
    return;
  }
  const rm = e.target.closest('[data-rm]');
  if (rm) { state.slip.delete(rm.dataset.rm); state.loadedCode = ''; state.loadedCodeInfo = null; renderSlip(); render(); return; }
  const amtChip = e.target.closest('[data-amt]');
  if (amtChip) {
    const inp = $('#mmAmt');
    if (inp) { inp.value = amtChip.dataset.amt; syncMomoFee(); }
    document.querySelectorAll('.amtchip').forEach(c => c.classList.toggle('on', c === amtChip));
    return;
  }
  const mdChip = e.target.closest('[data-mdamt]');
  if (mdChip) {
    const inp = $('#mdAmt');
    if (inp) inp.value = mdChip.dataset.mdamt;
    document.querySelectorAll('[data-mdamt]').forEach(c => c.classList.toggle('on', c === mdChip));
    return;
  }
  const quick = e.target.closest('[data-quick]');
  if (quick) {
    const q = quick.dataset.quick;
    if (q === 'Soccer') { state.sport = 'Soccer'; state.view = 'sports'; render(); }
    else if (q === 'Today') { state.sport = 'Soccer'; state.view = 'home'; state.date = 'Today'; render(); }
    else if (q === 'Live') { state.sport = 'Soccer'; state.view = 'live'; render(); }
    else if (q === 'Aviator') { state.view = 'games'; render(); }
    else if (q === 'Basketball') { state.sport = 'Basketball'; state.view = 'sports'; render(); }
    else if (q === 'Verify Bet') { state.view = 'verify'; render(); }
    else if (q === 'Booking Code') { state.view = 'booking'; render(); }
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
  const bt = e.target.closest('[data-btab]');
  if (bt) { state.betTab = bt.dataset.btab; render(); return; }
  const wsec = e.target.closest('[data-wsec]');
  if (wsec) { state.walletSection = wsec.dataset.wsec; render(); return; }
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
  if (e.target.id === 'mmAmt') {
    syncMomoFee();
    document.querySelectorAll('.amtchip').forEach(c =>
      c.classList.toggle('on', Number(c.dataset.amt) === Number(e.target.value)));
  }
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
    if (!(amt >= 300)) { toast('Minimum deposit is GHS 300 — tap an amount to select it.'); return; }
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
      if (err.code === 'provider_not_configured' || err.code === 'gateway_disabled') {
        state.momoOff = true;
        render();
        toast('Instant deposits are switched off right now — please use Manual transfer.');
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
    if (!((parseFloat($('#mdAmt').value) || 0) >= 300)) { toast('Minimum deposit is GHS 300 — tap an amount to select it.'); return; }
    try {
      const body = { amount_ghs: parseFloat($('#mdAmt').value) || 0, sender_phone: $('#mdPhone').value.trim(), external_ref: $('#mdRef').value.trim() };
      const pf = $('#mdProof');
      if (pf && pf.files && pf.files[0]) {
        const proof = await shrinkImage(pf.files[0]);
        if (proof) body.proof_image = proof;
      }
      await api('/wallet/deposit-manual', { method: 'POST', body });
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
      showWithdrawSentModal();
      loadWallet();
    } catch (err) {
      if (err.code === 'withdrawal_locked') { showVerifyModal(err.data || {}); return; }
      errToast(err, 'Withdrawal request failed.');
    }
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
  } else if (id === 'bookingCodeForm') {
    e.preventDefault();
    const code = $('#bkCode').value.replace(/\D/g, '').slice(0, 5);
    if (code.length !== 5) { toast('Booking codes are exactly 5 digits.'); return; }
    if (!state.user) { openAuth('login'); toast('Log in to load a booking code'); return; }
    try {
      const data = await api('/bets/booking-resolve', { method: 'POST', body: { code } });
      state.slip.clear();
      let added = 0, skipped = 0;
      data.selections.forEach(s => {
        if (!s.available) { skipped++; return; }
        state.slip.set(slipKey(s.match_id, s.market, s.pick), {
          matchId: s.match_id, matchLabel: s.home_team + ' vs ' + s.away_team,
          league: s.league, market: s.market, pick: s.pick, odd: s.odd,
        });
        added++;
      });
      if (!added) {
        state.loadedCode = ''; state.loadedCodeInfo = null;
        toast('Every match on that code has finished — the slip cannot be loaded.');
        render();
        return;
      }
      state.loadedCode = data.code;
      state.loadedCodeInfo = { label: data.label, price_ghs: data.price_ghs };
      renderSlip();
      render();
      toast('Booking code loaded — ' + added + ' selection(s) at current odds' + (skipped ? ', ' + skipped + ' unavailable and skipped' : ''));
      openSlip();
    } catch (err) { errToast(err, 'That booking code could not be loaded.'); }
  } else if (id === 'bookingLoadForm') {
    e.preventDefault();
    const raw = $('#loadCode').value.trim();
    try {
      const payload = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/')))));
      let added = 0;
      state.slip.clear();
      state.loadedCode = ''; state.loadedCodeInfo = null;
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
$('#bnSlip').addEventListener('click', openSlip);
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
  const emailEl = $('#authEmail');
  const email = emailEl ? emailEl.value.trim() : '';
  // An admin invite may register with email alone (no phone); every
  // other path needs phone + password. Login takes either identifier.
  const inviteRegister = authMode === 'register' && !!localStorage.getItem('ps_admin_invite');
  if (!password || (!phone && !(inviteRegister && email))) return;
  const btn = $('#authSubmit');
  btn.disabled = true;
  try {
    const path = authMode === 'login' ? '/auth/login' : '/auth/register';
    const body = authMode === 'login' ? { identifier: phone, password } : { phone, password };
    if (authMode === 'register') {
      if (email) body.email = email;
      const nameEl = $('#authName');
      if (nameEl && nameEl.value.trim()) body.display_name = nameEl.value.trim();
    }
    if (authMode === 'register') {
      const ref = localStorage.getItem('ps_ref');
      const inv = localStorage.getItem('ps_admin_invite');
      if (ref) body.ref = ref;
      if (inv) body.admin_invite = inv;
    }
    const data = await api(path, { method: 'POST', body });
    if (data.pending) {
      localStorage.removeItem('ps_admin_invite');
      closeAuth();
      toast('Admin account created — it is pending verification by the super admin. You can log in once it is verified.');
      return;
    }
    if (authMode === 'register') {
      localStorage.removeItem('ps_admin_invite');
      localStorage.removeItem('ps_ref');
    }
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

// Live scores keep moving while a match view is open: re-pull the feed
// about once a minute (the API refreshes from ESPN itself when stale,
// and loadMatches re-renders the match views).
setInterval(() => {
  if (document.hidden) return;
  if (['home', 'live', 'sports', 'virtual', 'match'].includes(state.view)) loadMatches();
}, 60000);

// Invite links land here first: remember the attribution / invite
// token, then let registration pick it up.
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('ref')) localStorage.setItem('ps_ref', urlParams.get('ref'));
if (urlParams.get('admin_invite')) localStorage.setItem('ps_admin_invite', urlParams.get('admin_invite'));
loadHeroImages();
loadTileImages();
loadTrophyImage();
if (urlParams.get('admin_invite')) openAuth('register');
// A referral link is for a NEW account (Prince hit this himself on
// 2026-11-03: opening his own link while signed in just showed him
// his logged-in site and looked broken). So: signed-out visitors go
// straight to the register form, and signed-in users get told why
// the link cannot attach to the account they are already in.
if (urlParams.get('ref')) {
  if (state.token) {
    setTimeout(() => toast('You are already signed in — referral links are for new accounts. Share this link with someone new, or log out first to register under it.'), 600);
  } else {
    openAuth('register');
  }
}

// boot: restore session, then load real matches
$('#burgerBtn').addEventListener('click', openMenu);
$('#drawerClose').addEventListener('click', closeMenu);
$('#drawerShade').addEventListener('click', closeMenu);

(async () => {
  renderSlip();
  render();
  if (state.token) await refreshUser();
  if (state.user) loadBets();
  loadMatches();
})();
