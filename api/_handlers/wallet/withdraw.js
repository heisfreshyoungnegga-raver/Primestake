const { sql, readBody, send, guard, requireAuth, ensureAdminTables, getSettings } = require('../../_lib');

// Withdrawal request: the balance is held immediately, and the database
// trigger refuses the insert until the user reaches the required number
// of completed deposits. Admin rejection refunds the hold automatically.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  await ensureAdminTables();
  const settings = await getSettings(['payouts_frozen']);
  if (settings.payouts_frozen === '1') {
    return send(res, 403, { error: 'payouts_frozen', detail: 'Withdrawals are temporarily paused by the operator. Please check back shortly.' });
  }
  const { amount_ghs, method } = await readBody(req);
  const amount = Number(amount_ghs);
  if (!(amount > 0)) return send(res, 400, { error: 'invalid_amount' });
  let rows;
  try {
    rows = await sql(
      `with bal as (
         update users set balance_ghs = balance_ghs - $2
         where id = $1 and balance_ghs >= $2
         returning id
       )
       insert into wallet_transactions (user_id, kind, method, amount_ghs, status)
       select $1, 'withdrawal', $3, -$2, 'pending' from bal
       returning id, status, created_at`,
      [auth.uid, amount, method ? String(method).slice(0, 40) : 'MTN MoMo']
    );
  } catch (e) {
    if (String(e.dbMessage || '').includes('withdrawal locked')) {
      // The trigger reports "withdrawal locked: X of Y required
      // deposits completed" — pass the counts to the client so the
      // verification prompt can show exactly what is left to do
      // (Prince's Stakeza-style prompt, 2026-11-03).
      const cm = /(\d+) of (\d+)/.exec(e.dbMessage || '');
      const done = cm ? Number(cm[1]) : 0;
      const required = cm ? Number(cm[2]) : 6;
      return send(res, 403, {
        error: 'withdrawal_locked', detail: e.dbMessage,
        deposits_done: done, deposits_required: required,
        remaining: Math.max(required - done, 0),
      });
    }
    throw e;
  }
  if (!rows.length) return send(res, 400, { error: 'insufficient_balance' });
  send(res, 201, { transaction: rows[0] });
});
