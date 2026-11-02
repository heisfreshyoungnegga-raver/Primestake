const { sql, readBody, send, guard, requireAdmin } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  if (req.method === 'POST') {
    const { id, status } = await readBody(req);
    if (!['open', 'answered', 'closed'].includes(status)) return send(res, 400, { error: 'invalid_status' });
    const rows = await sql('update support_messages set status = $1 where id = $2 returning id', [status, id]);
    if (!rows.length) return send(res, 404, { error: 'message_not_found' });
    return send(res, 200, { ok: true });
  }
  const rows = await sql(
    `select sm.id, sm.subject, sm.body, sm.status, sm.created_at, u.phone
     from support_messages sm left join users u on u.id = sm.user_id
     order by (sm.status = 'open') desc, sm.created_at desc limit 100`
  );
  send(res, 200, { messages: rows });
});
