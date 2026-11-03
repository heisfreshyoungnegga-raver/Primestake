const crypto = require('crypto');
const { sql, readBody, send, guard, requireSuperAdmin, ensureAdminTables, expandOdds } = require('../../_lib');

// Super admin only: create a "featured" match that plays like a real
// one. Two ways in (Prince's design, 2026-11-03):
//  - MANUAL: the super admin sets league, teams, kickoff, the 1X2
//    prices and the goal schedule (which minute each goal lands).
//  - AUTO: whatever he leaves blank is generated — fictional team
//    names from the bank below, odds priced from who he makes the
//    favourite, and a random goal schedule that matches the odds
//    (the favourite scores more). He can type only the team names,
//    or nothing at all.
// The public feed derives the live clock and score from the goal
// schedule, settlement uses the scheduled final score, and the full
// odds book (Double Chance, Over/Under ladder, BTTS) is priced from
// the 1X2 line.
const NAME_A = ['Accra', 'Tema', 'Kumasi', 'Osu', 'Spintex', 'Takoradi', 'Madina', 'Legon', 'Achimota', 'Dansoman', 'Kasoa', 'Ho', 'Tamale', 'Cape Coast', 'Sunyani', 'Koforidua', 'Nungua', 'Teshie', 'Ashaiman', 'Winneba'];
const NAME_B = ['Falcons', 'Royals', 'Iron', 'City', 'Stars', 'Lions', 'Warriors', 'United', 'Rovers', 'Athletic', 'Giants', 'Eagles', 'Sharks', 'Kings', 'Pirates', 'Rangers'];
const pickOne = arr => arr[crypto.randomInt(arr.length)];
function teamName(taken) {
  let n = pickOne(NAME_A) + ' ' + pickOne(NAME_B);
  while (taken.includes(n)) n = pickOne(NAME_A) + ' ' + pickOne(NAME_B);
  return n;
}
// Base 1X2 probabilities per favourite choice; jittered per game so
// auto fixtures do not all price identically.
const FAV_PROBS = {
  even: [0.36, 0.28, 0.36],
  home: [0.46, 0.27, 0.27],
  home_strong: [0.60, 0.23, 0.17],
  away: [0.27, 0.27, 0.46],
  away_strong: [0.17, 0.23, 0.60],
};
function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireSuperAdmin(req, res);
  if (!auth) return;
  await ensureAdminTables();
  const { league, home_team, away_team, starts_at, o1, ox, o2, goals, fav } = await readBody(req);

  let home = String(home_team || '').trim();
  let away = String(away_team || '').trim();
  if (!home) home = teamName([away]);
  if (!away || away === home) away = teamName([home]);
  const leagueName = String(league || '').trim() || 'PrimeStake Featured';

  const start = starts_at ? new Date(starts_at) : new Date(Date.now() + 30 * 60000);
  if (Number.isNaN(start.getTime())) return send(res, 400, { error: 'invalid_start_time' });

  let odds;
  const entered = { o1: Number(o1), ox: Number(ox), o2: Number(o2) };
  const OKEYS = ['o1', 'ox', 'o2'];
  const have = OKEYS.filter(k => entered[k] > 1);
  if (have.length === 3) {
    odds = expandOdds(entered.o1, entered.ox, entered.o2);
  } else if (have.length === 0) {
    const base = FAV_PROBS[fav] || FAV_PROBS.even;
    const jit = base.map(p => Math.max(0.08, p + (Math.random() * 0.06 - 0.03)));
    const sum = jit.reduce((a, b) => a + b, 0);
    const toOdds = p => Math.max(1.02, Math.round((0.94 / (p / sum)) * 100) / 100);
    odds = expandOdds(toOdds(jit[0]), toOdds(jit[1]), toOdds(jit[2]));
  } else {
    // Per-field completion (Prince's ask, 2026-11-03 late): the
    // prices he typed stay exactly as typed; only the blanks are
    // priced around them. Entered prices are de-margined at the
    // house factor (0.94), the probability left over is split
    // between the blank outcomes by the favourite profile, and each
    // blank is priced back at the same factor.
    const base = FAV_PROBS[fav] || FAV_PROBS.even;
    const weight = { o1: base[0], ox: base[1], o2: base[2] };
    let usedFair = 0;
    for (const k of have) usedFair += 0.94 / entered[k];
    const missing = OKEYS.filter(k => !have.includes(k));
    const wSum = missing.reduce((a, k) => a + weight[k], 0) || 1;
    const rest = Math.max(1 - usedFair, 0.02 * missing.length);
    const line = {};
    for (const k of OKEYS) {
      if (have.includes(k)) { line[k] = entered[k]; continue; }
      const p = Math.max(rest * (weight[k] / wSum), 0.005);
      line[k] = Math.min(51, Math.max(1.02, Math.round((0.94 / p) * 100) / 100));
    }
    odds = expandOdds(line.o1, line.ox, line.o2);
  }
  if (!odds.o1) return send(res, 400, { error: 'valid_1x2_odds_required', detail: 'Home, draw and away odds must all be above 1.00.' });

  let cleanGoals = [];
  if (Array.isArray(goals)) {
    for (const g of goals.slice(0, 14)) {
      const minute = Math.round(Number(g && g.minute));
      const side = g && g.side;
      if (minute >= 1 && minute <= 90 && (side === 'home' || side === 'away')) cleanGoals.push({ minute, side });
    }
    cleanGoals.sort((a, b) => a.minute - b.minute);
  }
  if (!cleanGoals.length) {
    // Auto goal schedule from the priced probabilities: the stronger
    // side's expected goals rise, the weaker side's fall.
    const inv = [1 / odds.o1, 1 / odds.ox, 1 / odds.o2];
    const invSum = inv.reduce((a, b) => a + b, 0);
    const lambdaHome = 0.4 + 2.8 * (inv[0] / invSum);
    const lambdaAway = 0.4 + 2.8 * (inv[2] / invSum);
    const hg = Math.min(5, poisson(lambdaHome));
    const ag = Math.min(5, poisson(lambdaAway));
    const minutes = new Set();
    const nextMinute = () => {
      let m = 2 + crypto.randomInt(89);
      while (minutes.has(m)) m = 2 + crypto.randomInt(89);
      minutes.add(m);
      return m;
    };
    for (let i = 0; i < hg; i++) cleanGoals.push({ minute: nextMinute(), side: 'home' });
    for (let i = 0; i < ag; i++) cleanGoals.push({ minute: nextMinute(), side: 'away' });
    cleanGoals.sort((a, b) => a.minute - b.minute);
  }

  const rows = await sql(
    `insert into matches (league, home_team, away_team, starts_at, odds, external_ref, goal_events)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb) returning *`,
    [leagueName.slice(0, 80), home.slice(0, 80), away.slice(0, 80),
     start.toISOString(), JSON.stringify(odds), 'custom:' + crypto.randomUUID(), JSON.stringify(cleanGoals)]
  );
  send(res, 201, { match: rows[0] });
});
