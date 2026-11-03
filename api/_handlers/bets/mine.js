const { sql, send, guard, requireAuth, cashoutQuote } = require('../../_lib');

module.exports = guard(async (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const rows = await sql(
    `select b.id, b.code, b.stake_ghs, b.total_odds, b.potential_ghs, b.status, b.placed_at, b.cashout_ghs,
            coalesce(json_agg(json_build_object(
              'match_id', s.match_id, 'market', s.market, 'pick', s.pick,
              'odds', s.odds, 'result', s.result,
              'home_team', m.home_team, 'away_team', m.away_team, 'league', m.league
            ) order by s.id) filter (where s.id is not null), '[]') as selections
     from bets b
     left join bet_selections s on s.bet_id = b.id
     left join matches m on m.id = s.match_id
     where b.user_id = $1
     group by b.id
     order by b.placed_at desc
     limit 100`,
    [auth.uid]
  );
  // Attach a live cashout offer to every open bet that has one, so
  // My Bets can show the Cashout button with its amount.
  const open = rows.filter(b => b.status === 'open');
  if (open.length) {
    const ids = [...new Set(open.flatMap(b => (b.selections || []).map(s => s.match_id)))];
    if (ids.length) {
      const mrows = await sql(
        'select id, status, score_home, score_away, odds, external_ref, goal_events, starts_at from matches where id = any($1::uuid[])',
        [ids]
      );
      const byId = {};
      mrows.forEach(m => { byId[m.id] = m; });
      for (const b of open) b.cashout_offer = cashoutQuote(b, b.selections || [], byId);
    }
  }
  send(res, 200, { bets: rows });
});
