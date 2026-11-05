const { sql, send, guard, requireAdmin, ensureAdminTables, ensureInviteCode } = require('../../_lib');

// Every admin's own dashboard: their user invite link, the users they
// brought in, and their commission money — earned so far, already paid
// out, and still pending payout. The super admin additionally gets the
// same summary for every admin, which drives the payout buttons.
module.exports = guard(async (req, res) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  await ensureAdminTables();

  // Lazily mint the caller's invite code on first view.
  const myCode = await ensureInviteCode(auth.uid);
  if (!myCode) return send(res, 404, { error: 'account_not_found' });
  const me = [{ invite_code: myCode }];

  const [invited, totals, recent] = await Promise.all([
    sql(`select u.id, u.phone, u.display_name, u.created_at,
                coalesce((select sum(t.amount_ghs) from wallet_transactions t
                          where t.user_id = u.id and t.kind = 'deposit' and t.status = 'completed'), 0) as deposits_ghs
         from users u where u.invited_by = $1 order by u.created_at desc limit 100`, [auth.uid]),
    sql(`select coalesce(sum(amount_ghs), 0) as earned,
                coalesce(sum(amount_ghs) filter (where paid_at is not null), 0) as paid,
                coalesce(sum(amount_ghs) filter (where paid_at is null), 0) as pending
         from commissions where earner_id = $1`, [auth.uid]),
    sql(`select c.amount_ghs, c.pct, c.basis_ghs, c.paid_at, c.created_at, u.phone as from_phone
         from commissions c join users u on u.id = c.source_user_id
         where c.earner_id = $1 order by c.created_at desc limit 20`, [auth.uid])
  ]);
  const myReqRows = await sql(
    `select id, amount_ghs, created_at from commission_payout_requests
     where earner_id = $1 and status = 'pending'`, [auth.uid]);
  const t = totals[0] || {};
  const out = {
    invite_code: me[0].invite_code,
    invite_path: '/?ref=' + me[0].invite_code,
    invited_users: invited.map(u => ({ ...u, deposits_ghs: Number(u.deposits_ghs) })),
    commissions: {
      earned_ghs: Number(t.earned || 0),
      paid_ghs: Number(t.paid || 0),
      pending_ghs: Number(t.pending || 0)
    },
    recent: recent.map(r => ({ ...r, amount_ghs: Number(r.amount_ghs), basis_ghs: Number(r.basis_ghs), pct: Number(r.pct) })),
    payout_request: myReqRows.length ? { ...myReqRows[0], amount_ghs: Number(myReqRows[0].amount_ghs) } : null
  };

  if (auth.role === 'super_admin') {
    const admins = await sql(
      `select u.id, u.phone, u.display_name, u.role,
              coalesce(sum(c.amount_ghs), 0) as earned,
              coalesce(sum(c.amount_ghs) filter (where c.paid_at is not null), 0) as paid,
              coalesce(sum(c.amount_ghs) filter (where c.paid_at is null), 0) as pending,
              (select r.amount_ghs from commission_payout_requests r where r.earner_id = u.id and r.status = 'pending') as payout_requested_ghs,
              (select count(*) from users x where x.invited_by = u.id) as invited_count
       from users u left join commissions c on c.earner_id = u.id
       where u.role in ('admin', 'super_admin')
          or exists (select 1 from commissions cx where cx.earner_id = u.id)
       group by u.id order by pending desc`
    );
    out.admins = admins.map(a => ({ ...a, earned: Number(a.earned), paid: Number(a.paid), pending: Number(a.pending), payout_requested_ghs: a.payout_requested_ghs == null ? null : Number(a.payout_requested_ghs), invited_count: Number(a.invited_count) }));
  }
  send(res, 200, out);
});
