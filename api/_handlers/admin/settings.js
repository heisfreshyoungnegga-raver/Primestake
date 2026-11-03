const { sql, readBody, send, guard, requireAdmin, requireSuperAdmin, ensureAdminTables, getSettings } = require('../../_lib');

const KEYS = ['gateway_enabled', 'payouts_frozen', 'admin_commission_pct', 'user_cashback_pct'];

// Platform control settings. Any admin can read them (dashboards show
// the state); only the super admin can change them: the ShinobiPay
// gateway on/off, the payout freeze, and the two commission rates.
module.exports = guard(async (req, res) => {
  await ensureAdminTables();
  if (req.method === 'GET') {
    const auth = requireAdmin(req, res);
    if (!auth) return;
    return send(res, 200, { settings: await getSettings(KEYS) });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireSuperAdmin(req, res);
  if (!auth) return;
  const body = await readBody(req);
  const updates = {};
  if (body.gateway_enabled !== undefined) updates.gateway_enabled = body.gateway_enabled ? '1' : '0';
  if (body.payouts_frozen !== undefined) updates.payouts_frozen = body.payouts_frozen ? '1' : '0';
  for (const k of ['admin_commission_pct', 'user_cashback_pct']) {
    if (body[k] !== undefined) {
      const v = Number(body[k]);
      if (!(v >= 0 && v <= 50)) return send(res, 400, { error: 'invalid_percent', detail: k + ' must be between 0 and 50.' });
      updates[k] = String(v);
    }
  }
  for (const [k, v] of Object.entries(updates)) {
    await sql('insert into operator_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [k, v]);
  }
  send(res, 200, { ok: true, settings: await getSettings(KEYS) });
});
