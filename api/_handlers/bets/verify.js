const { sql, send, guard } = require('../../_lib');

// Public ticket check: status and selections only, no account data.
module.exports = guard(async (req, res) => {
  const code = String((req.query && req.query.code) || '').trim().toUpperCase();
  if (!code) return send(res, 400, { error: 'code_required' });
  const rows = await sql(
    `select b.code, b.stake_ghs, b.total_odds, b.potential_ghs, b.status, b.placed_at,
            m.home_team, m.away_team, m.league, s.market, s.pick, s.odds, s.result
     from bets b
     left join bet_selections s on s.bet_id = b.id
     left join matches m on m.id = s.match_id
     where b.code = $1
     order by s.id`,
    [code]
  );
  if (!rows.length) return send(res, 404, { error: 'ticket_not_found' });
  const head = rows[0];
  send(res, 200, {
    ticket: {
      code: head.code, stake_ghs: Number(head.stake_ghs), total_odds: Number(head.total_odds),
      potential_ghs: Number(head.potential_ghs), status: head.status, placed_at: head.placed_at,
      selections: rows.filter(r => r.market).map(r => ({
        home_team: r.home_team, away_team: r.away_team, league: r.league,
        market: r.market, pick: r.pick, odds: Number(r.odds), result: r.result
      }))
    }
  });
});
