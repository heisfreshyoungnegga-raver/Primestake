const { sql, send, guard } = require('../../_lib');

// Public winners ticker: the latest settled wins, phones masked.
// Sane-stake filter only: the won ledger also holds inflated rows
// (stakes of GH₵10,000,000+); those never scroll past a player.
module.exports = guard(async (req, res) => {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const rows = await sql(
    `select substr(regexp_replace(coalesce(u.phone, ''), '^\\+233', '0'), 1, 3) || '**' || right(regexp_replace(coalesce(u.phone, ''), '^\\+233', '0'), 3) as masked,
            b.potential_ghs as amount_ghs, b.settled_at
       from bets b join users u on u.id = b.user_id
      where b.status = 'won'
        and b.stake_ghs <= 2000
        and b.potential_ghs > 0
        and b.potential_ghs <= 200000
      order by coalesce(b.settled_at, b.placed_at) desc limit 20`);
  res.setHeader('Cache-Control', 'public, max-age=60');
  return send(res, 200, {
    winners: rows.map(r => ({ masked: r.masked, amount_ghs: Number(r.amount_ghs), settled_at: r.settled_at })),
  });
});
