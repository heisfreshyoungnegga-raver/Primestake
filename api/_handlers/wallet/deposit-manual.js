const { sql, readBody, send, guard, requireAuth } = require('../../_lib');

// Manual MoMo deposit: recorded as PENDING. It only counts toward the
// withdrawal rule (and the balance) after an admin confirms the money
// actually arrived.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { amount_ghs, sender_phone, external_ref } = await readBody(req);
  const amount = Number(amount_ghs);
  if (!(amount > 0)) return send(res, 400, { error: 'invalid_amount' });
  if (!external_ref || String(external_ref).trim().length < 4) return send(res, 400, { error: 'transaction_id_required' });
  const rows = await sql(
    `insert into wallet_transactions (user_id, kind, method, amount_ghs, status, external_ref, note)
     values ($1, 'deposit', 'MTN MoMo (manual)', $2, 'pending', $3, $4)
     returning id, status, created_at`,
    [auth.uid, amount, String(external_ref).trim().slice(0, 80), sender_phone ? `sender ${String(sender_phone).slice(0, 20)}` : null]
  );
  send(res, 201, { transaction: rows[0] });
});
