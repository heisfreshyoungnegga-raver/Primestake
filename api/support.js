const { sql, readBody, send, guard, requireAuth } = require('./_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (req.method === 'POST') {
    const { subject, body } = await readBody(req);
    if (!subject || !body) return send(res, 400, { error: 'subject_and_message_required' });
    const rows = await sql(
      'insert into support_messages (user_id, subject, body) values ($1, $2, $3) returning id, status, created_at',
      [auth.uid, String(subject).slice(0, 120), String(body).slice(0, 2000)]
    );
    return send(res, 201, { message: rows[0] });
  }
  const rows = await sql('select id, subject, body, status, created_at from support_messages where user_id = $1 order by created_at desc limit 30', [auth.uid]);
  send(res, 200, { messages: rows });
});
