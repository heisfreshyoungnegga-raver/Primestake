const { sql, hashPassword, issueToken, readBody, send, guard, publicUser } = require('../../_lib');

module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const { phone, password, display_name } = await readBody(req);
  const cleanPhone = String(phone || '').replace(/\s+/g, '');
  if (!/^\+?\d{9,15}$/.test(cleanPhone)) return send(res, 400, { error: 'invalid_phone' });
  if (!password || String(password).length < 6) return send(res, 400, { error: 'password_too_short' });
  const existing = await sql('select id from users where phone = $1', [cleanPhone]);
  if (existing.length) return send(res, 409, { error: 'phone_already_registered' });
  const rows = await sql(
    'insert into users (phone, password_hash, display_name) values ($1, $2, $3) returning *',
    [cleanPhone, hashPassword(String(password)), display_name ? String(display_name).slice(0, 60) : null]
  );
  const user = publicUser(rows[0]);
  send(res, 201, { user, token: issueToken(rows[0]) });
});
