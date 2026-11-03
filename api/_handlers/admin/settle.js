const { sql, readBody, send, guard, requireAdmin, pickWon, isCustomMatch, customMatchState } = require('../../_lib');

// Settle a finished match: score every pending selection on it, then
// settle any bet whose selections are now all decided. A fully-won bet
// credits its potential payout through the ledger.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const { match_id, score_home, score_away } = await readBody(req);
  let home = Number(score_home), away = Number(score_away);
  if (!match_id) return send(res, 400, { error: 'match_required' });
  if (Number.isNaN(home) || Number.isNaN(away)) {
    const stored = await sql('select score_home, score_away, external_ref, goal_events, starts_at, status from matches where id = $1', [match_id]);
    if (!stored.length) return send(res, 404, { error: 'match_not_found' });
    if (isCustomMatch(stored[0])) {
      // Featured matches settle on their scheduled final score.
      const st = customMatchState(stored[0]);
      home = st.final_home; away = st.final_away;
    } else {
      home = Number(stored[0].score_home); away = Number(stored[0].score_away);
    }
  }

  await sql("update matches set status = 'finished', score_home = $2, score_away = $3 where id = $1", [match_id, home, away]);

  const sels = await sql(
    "select id, bet_id, market, pick from bet_selections where match_id = $1 and result = 'pending'",
    [match_id]
  );
  for (const s of sels) {
    await sql('update bet_selections set result = $2 where id = $1', [s.id, pickWon(s.market, s.pick, home, away) ? 'won' : 'lost']);
  }

  const affected = [...new Set(sels.map(s => s.bet_id))];
  let settledWon = 0, settledLost = 0;
  for (const betId of affected) {
    const rows = await sql(
      `select b.id, b.user_id, b.potential_ghs, b.status,
              count(*) filter (where s.result = 'pending') as pending,
              count(*) filter (where s.result = 'lost') as lost
       from bets b join bet_selections s on s.bet_id = b.id
       where b.id = $1 group by b.id`,
      [betId]
    );
    if (!rows.length) continue;
    const b = rows[0];
    if (b.status !== 'open' || Number(b.pending) > 0) continue;
    if (Number(b.lost) > 0) {
      await sql("update bets set status = 'lost', settled_at = now() where id = $1", [betId]);
      settledLost++;
    } else {
      await sql(
        `with upd as (update bets set status = 'won', settled_at = now() where id = $1 returning user_id, potential_ghs),
              led as (insert into wallet_transactions (user_id, kind, method, amount_ghs, status)
                      select user_id, 'bet_win', 'Balance', potential_ghs, 'completed' from upd returning id)
         update users set balance_ghs = balance_ghs + (select potential_ghs from upd)
         where id = (select user_id from upd)`,
        [betId]
      );
      settledWon++;
    }
  }
  send(res, 200, { ok: true, selections_scored: sels.length, bets_won: settledWon, bets_lost: settledLost });
});
