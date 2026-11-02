const { sql, send, guard, requireAdmin } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const rows = await sql(
    `select
       (select count(*) from users) as users,
       (select count(*) from users where status = 'blocked') as blocked_users,
       (select count(*) from bets where placed_at::date = current_date) as bets_today,
       (select count(*) from bets where status = 'open') as open_bets,
       (select coalesce(sum(stake_ghs), 0) from bets where placed_at::date = current_date) as stakes_today,
       (select count(*) from wallet_transactions where status = 'pending' and kind = 'deposit') as pending_deposits,
       (select count(*) from wallet_transactions where status = 'pending' and kind = 'withdrawal') as pending_withdrawals,
       (select count(*) from support_messages where status = 'open') as open_support`
  );
  const r = rows[0];
  send(res, 200, {
    stats: {
      users: Number(r.users), blocked_users: Number(r.blocked_users),
      bets_today: Number(r.bets_today), open_bets: Number(r.open_bets),
      stakes_today_ghs: Number(r.stakes_today),
      pending_deposits: Number(r.pending_deposits), pending_withdrawals: Number(r.pending_withdrawals),
      open_support: Number(r.open_support)
    }
  });
});
