const { sql, readBody, send, guard, requireAdmin, ensureAdminTables, getSettings, applyDepositRewards } = require('../../_lib');

// Confirm a pending deposit or withdrawal. A confirmed deposit credits
// the balance in the same statement and then pays the deposit rewards
// (user cashback + inviter commission). A confirmed withdrawal was
// already debited when the player requested it, so only the status
// changes — and withdrawals cannot be confirmed while payouts are
// frozen by the super admin.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const { id } = await readBody(req);
  await ensureAdminTables();
  const pending = await sql('select user_id, kind, amount_ghs from wallet_transactions where id = $1 and status = $2', [id, 'pending']);
  if (!pending.length) return send(res, 404, { error: 'pending_transaction_not_found' });
  const txn = pending[0];
  // Withdrawal approvals are super-admin only (Prince's rule,
  // 2026-11-04): a regular admin can confirm deposits, but only the
  // super admin can approve money leaving the platform.
  if (txn.kind === 'withdrawal' && auth.role !== 'super_admin') {
    return send(res, 403, { error: 'super_admin_only', detail: 'Only the super admin can approve withdrawals.' });
  }
  if (txn.kind === 'withdrawal') {
    const settings = await getSettings(['payouts_frozen']);
    if (settings.payouts_frozen === '1') {
      return send(res, 403, { error: 'payouts_frozen', detail: 'Payouts are frozen by the super admin. Unfreeze them in Platform Control before confirming withdrawals.' });
    }
  }
  const rows = await sql(
    `with t as (
       update wallet_transactions
       set status = 'completed', confirmed_by = $2, confirmed_at = now()
       where id = $1 and status = 'pending'
       returning user_id, kind, amount_ghs
     ),
     credit as (
       update users set balance_ghs = balance_ghs + (select amount_ghs from t)
       where id = (select user_id from t) and (select kind from t) = 'deposit'
       returning id
     )
     select (select count(*) from t) as updated`,
    [id, auth.uid]
  );
  if (!rows.length || Number(rows[0].updated) === 0) return send(res, 404, { error: 'pending_transaction_not_found' });
  if (txn.kind === 'deposit') {
    await applyDepositRewards(txn.user_id, id, Number(txn.amount_ghs));
  }
  send(res, 200, { ok: true });
});
