const { sql, readBody, send, guard, requireAuth, betCode, keyFor, isCustomMatch, customMatchState, fillOdds } = require('../../_lib');

// Place a bet. Odds are read back from the database (never trusted from
// the client), and the debit + bet + selections + ledger entry happen in
// ONE statement, so money can never half-move.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { selections, stake_ghs } = await readBody(req);
  const stake = Number(stake_ghs);
  if (!Array.isArray(selections) || !selections.length) return send(res, 400, { error: 'no_selections' });
  if (selections.length > 20) return send(res, 400, { error: 'too_many_selections' });
  if (!(stake > 0)) return send(res, 400, { error: 'invalid_stake' });

  const ids = [...new Set(selections.map(s => String(s.match_id)))];
  const matchRows = await sql('select id, status, odds, starts_at, external_ref, goal_events, score_home, score_away from matches where id = any($1::uuid[])', [ids]);
  const byId = new Map(matchRows.map(m => [m.id, m]));

  let totalOdds = 1;
  const clean = [];
  const seenMatches = new Set();
  for (const s of selections) {
    const m = byId.get(String(s.match_id));
    if (!m) return send(res, 400, { error: 'match_not_found' });
    if (m.status === 'finished') return send(res, 400, { error: 'match_finished' });
    // Featured matches finish by the clock even while their stored
    // status still says upcoming — never sell a bet on a finished one.
    if (isCustomMatch(m) && customMatchState(m).status === 'finished') return send(res, 400, { error: 'match_finished' });
    if (seenMatches.has(m.id)) return send(res, 400, { error: 'one_selection_per_match' });
    seenMatches.add(m.id);
    const key = keyFor(s.market, s.pick);
    const odds = key ? Number(fillOdds(m.odds)[key]) : NaN;
    if (!key || !(odds > 1)) return send(res, 400, { error: 'market_unavailable' });
    totalOdds *= odds;
    clean.push({ match_id: m.id, market: s.market, pick: s.pick, odds });
  }
  totalOdds = Math.round(totalOdds * 1000) / 1000;
  const potential = Math.round(stake * totalOdds * 100) / 100;

  // $1 user, $2 stake, $3 potential, $4 total odds; selections follow at $5+.
  const params = [auth.uid, stake, potential, totalOdds];
  const selParams = [];
  clean.forEach(s => selParams.push(s.match_id, s.market, s.pick, s.odds));
  const code = betCode();
  const rows = await sql(
    `with bal as (
       update users set balance_ghs = balance_ghs - $2
       where id = $1 and balance_ghs >= $2
       returning id
     ),
     bet as (
       insert into bets (code, user_id, stake_ghs, total_odds, potential_ghs)
       select '${code}', $1, $2, $4, $3 from bal
       returning id, code
     ),
     sel as (
       insert into bet_selections (bet_id, match_id, market, pick, odds)
       select bet.id, v.match_id, v.market, v.pick, v.odds
       from bet, (values ${clean.map((_, i) => `($${5 + i * 4}::uuid, $${6 + i * 4}, $${7 + i * 4}, $${8 + i * 4}::numeric)`).join(', ')}) as v(match_id, market, pick, odds)
       returning id
     ),
     led as (
       insert into wallet_transactions (user_id, kind, method, amount_ghs, status)
       select $1, 'bet_stake', 'Balance', -$2, 'completed' from bet
       returning id
     )
     select (select count(*) from bal) as debited, (select code from bet) as code`,
    [...params, ...selParams]
  );
  if (!rows.length || Number(rows[0].debited) === 0) return send(res, 400, { error: 'insufficient_balance' });
  send(res, 201, { code: rows[0].code, total_odds: totalOdds, potential_ghs: potential });
});
