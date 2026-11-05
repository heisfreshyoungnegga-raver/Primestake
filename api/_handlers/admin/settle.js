const { sql, readBody, send, guard, requireAdmin, isCustomMatch, customMatchState, settleMatchAt } = require('../../_lib');

// Settle a finished match: score every pending selection on it, then
// settle any bet whose selections are now all decided. A fully-won bet
// credits its potential payout through the ledger. The scoring itself
// lives in _lib.settleMatchAt, shared with the automatic sweep.
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
  const r = await settleMatchAt(match_id, home, away);
  send(res, 200, { ok: true, selections_scored: r.selections_scored, bets_won: r.bets_won, bets_lost: r.bets_lost });
});
