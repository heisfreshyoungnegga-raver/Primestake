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
  if (rows[0].status === 'pending') return send(res, 403, { error: 'account_pending', detail: 'Your admin account is waiting for verification by the super admin.' });
  // Count the sign-in. Prince's rule (2026-11-03): from a SUPER
  // ADMIN's 3rd sign-in onward, the portals must push a
  // change-password prompt (skippable per sign-in) until the
  // password has been changed once — pwd_prompt_done then stops it.
  const bumped = await sql('update users set login_count = login_count + 1 where id = $1 returning login_count', [rows[0].id]);
  const loginCount = bumped.length ? bumped[0].login_count : 0;
  const pwdPrompt = rows[0].role === 'super_admin' && loginCount >= 3 && !rows[0].pwd_prompt_done;
  const user = publicUser(rows[0]);
  send(res, 200, { user, token: issueToken(rows[0]), pwdPrompt });
});
