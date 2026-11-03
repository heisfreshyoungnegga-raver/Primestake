const { sql, hashPassword, issueToken, readBody, send, guard, publicUser, ensureAdminTables } = require('../../_lib');

// Registration. Two invite paths can ride along:
//  - ref=<invite code>: the new player is attributed to the admin or
//    super admin who shared the link, which is what their commission
//    dashboard counts.
//  - admin_invite=<token>: a one-time super-admin invite. The account
//    is created as an admin in 'pending' status — no session is issued
//    until the super admin verifies it.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const { phone, password, display_name, ref, admin_invite } = await readBody(req);
  const cleanPhone = String(phone || '').replace(/\s+/g, '');
  if (!/^\+?\d{9,15}$/.test(cleanPhone)) return send(res, 400, { error: 'invalid_phone' });
  if (!password || String(password).length < 6) return send(res, 400, { error: 'password_too_short' });
  const existing = await sql('select id from users where phone = $1', [cleanPhone]);
  if (existing.length) return send(res, 409, { error: 'phone_already_registered' });
  await ensureAdminTables();

  let role = 'player', status = 'active', invitedBy = null, inviteRow = null;
  if (admin_invite) {
    const inv = await sql(
      `select id, kind, created_by from invites where token = $1 and kind in ('admin', 'super_admin') and used_by is null and expires_at > now()`,
      [String(admin_invite)]
    );
    if (!inv.length) return send(res, 400, { error: 'invalid_invite', detail: 'That invite link is invalid or has expired. Ask the super admin for a fresh one.' });
    inviteRow = inv[0];
    invitedBy = inv[0].created_by || null;
    if (inv[0].kind === 'super_admin') {
      // A super-admin invite is itself the authorisation: the account
      // is active immediately (there is no higher tier to verify it).
      role = 'super_admin';
      status = 'active';
    } else {
      role = 'admin';
      status = 'pending';
    }
  } else if (ref) {
    const inv = await sql(
      `select id from users where invite_code = $1 and role in ('admin', 'super_admin') and status = 'active'`,
      [String(ref).trim().toUpperCase()]
    );
    if (inv.length) invitedBy = inv[0].id;
  }

  const rows = await sql(
    'insert into users (phone, password_hash, display_name, role, status, invited_by) values ($1, $2, $3, $4, $5, $6) returning *',
    [cleanPhone, hashPassword(String(password)), display_name ? String(display_name).slice(0, 60) : null, role, status, invitedBy]
  );
  const user = rows[0];
  if (inviteRow) {
    await sql('update invites set used_by = $1, used_at = now() where id = $2', [user.id, inviteRow.id]);
    if (status === 'pending') return send(res, 201, { pending: true, user: publicUser(user) });
  }
  send(res, 201, { user: publicUser(user), token: issueToken(user) });
});
