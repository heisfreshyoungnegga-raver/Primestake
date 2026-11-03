const { sql, readBody, send, guard, requireAuth, cashoutQuote } = require('../../_lib');

// Cash out an open bet early (Stakeza-style, Prince's ask
// 2026-11-03). The offer is recomputed server-side at the moment of
// the request — never trusted from the client — then the credit,
// the bet status and the ledger entry land in ONE statement, so
// money can never half-move. Settlement skips non-open bets, so a
// cashed-out ticket can never also pay out at full time.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { bet_id } = await readBody(req);
  if (!bet_id) return send(res, 400, { error: 'bet_required' });
  const bets = await sql(
    'select id, stake_ghs, potential_ghs, status from bets where id = $1 and user_id = $2',
    [bet_id, auth.uid]
  );
  if (!bets.length) return send(res, 404, { error: 'ticket_not_found' });
  const bet = bets[0];
  if (bet.status !== 'open') return send(res, 400, { error: 'bet_not_open' });
  const sels = await sql(
    'select match_id, market, pick, odds from bet_selections where bet_id = $1',
    [bet.id]
  );
  const ids = [...new Set(sels.map(s => s.match_id))];
  const mrows = ids.length
    ? await sql('select id, status, score_home, score_away, odds, external_ref, goal_events, starts_at from matches where id = any($1::uuid[])', [ids])
    : [];
  const byId = {};
  mrows.forEach(m => { byId[m.id] = m; });
  const amount = cashoutQuote(bet, sels, byId);
  if (amount == null) return send(res, 400, { error: 'cashout_unavailable' });
  const rows = await sql(
    `with upd as (update bets set status = 'cashed_out', cashout_ghs = $2, settled_at = now()
                  where id = $1 and status = 'open' returning user_id),
          led as (insert into wallet_transactions (user_id, kind, method, amount_ghs, status)
                  select user_id, 'cashout', 'Balance', $2, 'completed' from upd returning id)
     update users set balance_ghs = balance_ghs + $2 where id = (select user_id from upd)
     returning balance_ghs`,
    [bet.id, amount]
  );
  if (!rows.length) return send(res, 409, { error: 'bet_not_open' });
  send(res, 200, { ok: true, cashout_ghs: amount, balance_ghs: rows[0].balance_ghs });
});
