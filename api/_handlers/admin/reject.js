const { sql, readBody, send, guard, requireAdmin } = require('../../_lib');

// Reject a pending deposit or withdrawal. Rejecting a withdrawal refunds
// the hold back to the player's balance in the same statement.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const { id } = await readBody(req);
  const rows = await sql(
    `with t as (
       update wallet_transactions
       set status = 'rejected', confirmed_by = $2, confirmed_at = now()
       where id = $1 and status = 'pending'
       returning user_id, kind, amount_ghs
     ),
     refund as (
       update users set balance_ghs = balance_ghs - (select amount_ghs from t)
       where id = (select user_id from t) and (select kind from t) = 'withdrawal'
       returning id
     )
     select (select count(*) from t) as updated`,
    [id, auth.uid]
  );
  if (!rows.length || Number(rows[0].updated) === 0) return send(res, 404, { error: 'pending_transaction_not_found' });
  send(res, 200, { ok: true });
});
