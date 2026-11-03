const { sql } = require('./_lib');

// ESPN fixture sync, shared by the admin Sync button and the automatic
// live refresh. Pulls scoreboards from ESPN's public API (no key needed)
// and upserts matches by ESPN event id. Teams, kickoff times, live
// status, scores and ESPN CDN logo URLs come straight from the feed.
// Odds: ESPN carries DraftKings prices on many fixtures — moneyline and
// totals are converted to decimal; Double Chance is priced from the 1X2
// book with standard bookmaking maths. Fixtures without ESPN odds
// import with empty odds for the admin to price.
const LEAGUES = {
  'eng.1': 'England Premier League',
  'esp.1': 'Spain LaLiga',
  'ita.1': 'Italy Serie A',
  'ger.1': 'Germany Bundesliga',
  'fra.1': 'France Ligue 1',
  'por.1': 'Portugal Primeira Liga',
  'ned.1': 'Netherlands Eredivisie',
  'uefa.champions': 'UEFA Champions League',
  'uefa.europa': 'UEFA Europa League',
  'gha.1': 'Ghana Premier League',
  'usa.1': 'MLS',
};

function americanToDecimal(v) {
  const n = Number(String(v).replace('+', ''));
  if (!Number.isFinite(n) || n === 0) return null;
  const dec = n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
  return Math.round(dec * 100) / 100;
}
function logoOf(team) {
  if (!team) return null;
  if (team.logo) return team.logo;
  if (Array.isArray(team.logos) && team.logos[0] && team.logos[0].href) return team.logos[0].href;
  if (team.id) return `https://a.espncdn.com/i/teamlogos/soccer/500/${team.id}.png`;
  return null;
}
// Poisson goal model: bookmakers price alternate total lines off the
// main line. We recover the market's expected total goals (mu) from
// ESPN's Over/Under 2.5 price, then price the other half-goal lines
// from the same distribution, carrying the main line's margin.
function poissonCdf(k, mu) {
  let term = Math.exp(-mu), sum = term;
  for (let i = 1; i <= k; i++) { term *= mu / i; sum += term; }
  return sum;
}
function solveMu(pOver25) {
  let lo = 0.3, hi = 7;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const p = 1 - poissonCdf(2, mid);
    if (p < pOver25) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
function addTotalLadder(odds) {
  if (!odds.over25 || !odds.under25) return;
  const rawOver = 1 / odds.over25, rawUnder = 1 / odds.under25;
  const margin = rawOver + rawUnder; // book overround, ~1.05
  const mu = solveMu(rawOver / margin);
  [0.5, 1.5, 3.5, 4.5].forEach(line => {
    const suffix = String(line).replace('.', '');
    const pOver = 1 - poissonCdf(Math.floor(line), mu);
    const pUnder = 1 - pOver;
    if (pOver < 0.03 || pOver > 0.97) return;
    const o = Math.round((1 / pOver) / margin * 100) / 100;
    const u = Math.round((1 / pUnder) / margin * 100) / 100;
    if (o > 1.01) odds['over' + suffix] = o;
    if (u > 1.01) odds['under' + suffix] = u;
  });
}
function oddsFromEspn(comp) {
  const o = (comp.odds || [])[0];
  if (!o) return {};
  const odds = {};
  const ml = o.moneyline || {};
  const home = americanToDecimal(ml.home && ml.home.close && ml.home.close.odds);
  const away = americanToDecimal(ml.away && ml.away.close && ml.away.close.odds);
  const draw = americanToDecimal((o.drawOdds && o.drawOdds.moneyLine) ?? (ml.draw && ml.draw.close && ml.draw.close.odds));
  if (home) odds.o1 = home;
  if (draw) odds.ox = draw;
  if (away) odds.o2 = away;
  const tot = o.total || {};
  const overLine = tot.over && tot.over.close && tot.over.close.line;
  if (overLine === 'o2.5') {
    const over = americanToDecimal(tot.over.close.odds);
    const under = americanToDecimal(tot.under && tot.under.close && tot.under.close.odds);
    if (over) odds.over25 = over;
    if (under) odds.under25 = under;
  }
  addTotalLadder(odds);
  // Double Chance priced from the 1X2 book: combined fair price of the
  // two covered outcomes, which already carries the book's margin.
  if (odds.o1 && odds.ox) odds.dc1x = Math.round((odds.o1 * odds.ox) / (odds.o1 + odds.ox) * 100) / 100;
  if (odds.o1 && odds.o2) odds.dc12 = Math.round((odds.o1 * odds.o2) / (odds.o1 + odds.o2) * 100) / 100;
  if (odds.ox && odds.o2) odds.dcx2 = Math.round((odds.ox * odds.o2) / (odds.ox + odds.o2) * 100) / 100;
  Object.keys(odds).forEach(k => { if (!(odds[k] > 1)) delete odds[k]; });
  return odds;
}
function mapEvent(ev, leagueName) {
  const comp = (ev.competitions || [])[0];
  if (!comp) return null;
  const home = comp.competitors.find(c => c.homeAway === 'home');
  const away = comp.competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;
  const stateName = ev.status && ev.status.type && ev.status.type.state;
  const status = stateName === 'in' ? 'live' : stateName === 'post' ? 'finished' : 'upcoming';
  let minute = null;
  if (status === 'live' && ev.status.displayClock) {
    const parsed = parseInt(ev.status.displayClock, 10);
    if (Number.isFinite(parsed)) minute = parsed;
  }
  return {
    external_ref: 'espn:' + ev.id,
    league: leagueName,
    home_team: home.team.displayName || home.team.name,
    away_team: away.team.displayName || away.team.name,
    home_logo: logoOf(home.team),
    away_logo: logoOf(away.team),
    starts_at: ev.date,
    status,
    minute,
    score_home: Number(home.score || 0),
    score_away: Number(away.score || 0),
    odds: oddsFromEspn(comp),
  };
}

async function upsertMatch(m) {
  await sql(
    `insert into matches (league, home_team, away_team, starts_at, status, minute, score_home, score_away, odds, external_ref, home_logo, away_logo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     on conflict (external_ref) where external_ref is not null
     do update set league = excluded.league, home_team = excluded.home_team, away_team = excluded.away_team,
       starts_at = excluded.starts_at, status = excluded.status, minute = excluded.minute,
       score_home = excluded.score_home, score_away = excluded.score_away,
       home_logo = excluded.home_logo, away_logo = excluded.away_logo,
       odds = case when excluded.odds::text = '{}' then matches.odds else excluded.odds end`,
    [m.league, m.home_team, m.away_team, m.starts_at, m.status, m.minute, m.score_home, m.score_away,
     JSON.stringify(m.odds), m.external_ref, m.home_logo, m.away_logo]
  );
}

async function fetchDay(slug, ymd) {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${ymd}&limit=100`, {
    headers: { 'User-Agent': 'PrimeStake/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('espn_' + r.status);
  return r.json();
}

function ymdOf(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// Full sweep used by the admin Sync button: every league, one scoreboard
// per day (ESPN rejects date ranges). Sequential per league so a manual
// sync stays gentle on the feed.
async function syncLeagues(leagues, offsets) {
  const report = {};
  let imported = 0, withOdds = 0;
  for (const slug of leagues) {
    let count = 0, oddsCount = 0, failed = false;
    for (const offset of offsets) {
      let data;
      try {
        data = await fetchDay(slug, ymdOf(offset));
      } catch (e) { failed = true; continue; }
      for (const ev of data.events || []) {
        const m = mapEvent(ev, (data.leagues && data.leagues[0] && data.leagues[0].name) || LEAGUES[slug]);
        if (!m) continue;
        await upsertMatch(m);
        count++;
        if (m.odds.o1) oddsCount++;
      }
    }
    report[slug] = { matches: count, with_odds: oddsCount, failed };
    imported += count; withOdds += oddsCount;
  }
  return { report, imported, withOdds };
}

// Light refresh: yesterday + today for every league, all in parallel.
// This is what turns matches live, moves their scores and minutes, and
// retires finished ones — in seconds rather than a 99-call sweep.
async function refreshToday() {
  const jobs = [];
  for (const slug of Object.keys(LEAGUES)) {
    for (const offset of [-1, 0]) {
      jobs.push(
        fetchDay(slug, ymdOf(offset))
          .then(async data => {
            for (const ev of data.events || []) {
              const m = mapEvent(ev, (data.leagues && data.leagues[0] && data.leagues[0].name) || LEAGUES[slug]);
              if (m) await upsertMatch(m);
            }
          })
          .catch(() => {})
      );
    }
  }
  await Promise.all(jobs);
}

// Gate for the public match list: at most one refresh runs per
// REFRESH_MS across every visitor and both hosts. The stamp lives in
// operator_settings and is claimed with one atomic upsert, so parallel
// requests can never stampede the feed. Any failure is swallowed by the
// caller — the list must never break because ESPN hiccuped.
const REFRESH_MS = 120000;
async function maybeRefreshLive() {
  const now = Date.now();
  const claimed = await sql(
    `insert into operator_settings (key, value) values ('espn_refresh_at', $1)
     on conflict (key) do update set value = excluded.value
       where operator_settings.value ~ '^[0-9]+$' and operator_settings.value::bigint <= $2
     returning key`,
    [String(now), String(now - REFRESH_MS)]
  );
  if (!claimed.length) return false;
  await refreshToday();
  return true;
}

module.exports = { LEAGUES, mapEvent, oddsFromEspn, syncLeagues, refreshToday, maybeRefreshLive };
