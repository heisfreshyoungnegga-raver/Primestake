const { sql, verifyPassword, issueToken, readBody, send, guard, publicUser } = require('../../_lib');

module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const { phone, password } = await readBody(req);
  const cleanPhone = String(phone || '').replace(/\s+/g, '');
  const rows = await sql('select * from users where phone = $1', [cleanPhone]);
  if (!rows.length || !verifyPassword(String(password || ''), rows[0].password_hash)) {
    return send(res, 401, { error: 'wrong_phone_or_password' });
  }
  if (rows[0].status === 'blocked') return send(res, 403, { error: 'account_blocked' });
  const user = publicUser(rows[0]);
  send(res, 200, { user, token: issueToken(rows[0]) });
});
