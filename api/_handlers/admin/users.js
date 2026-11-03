const { sql, send, guard, requireAdmin, ensureAdminTables } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  await ensureAdminTables();
  const rows = await sql(
    `select u.id, u.phone, u.display_name, u.role, u.status, u.balance_ghs, u.created_at,
            u.invited_by, i.phone as inviter_phone,
            completed_deposit_count(u.id) as deposits_completed,
            (select count(*) from bets b where b.user_id = u.id) as bets_count
     from users u
     left join users i on i.id = u.invited_by
     order by u.created_at desc
     limit 200`
  );
  send(res, 200, { users: rows.map(u => ({ ...u, balance_ghs: Number(u.balance_ghs) })) });
});
