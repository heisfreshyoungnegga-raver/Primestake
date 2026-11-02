const { sql, send, guard, requireAdmin } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const rows = await sql('select * from admin_pending_queue');
  send(res, 200, { queue: rows.map(r => ({ ...r, amount_ghs: Number(r.amount_ghs) })) });
});
