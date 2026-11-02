const { sql, send, guard } = require('./_lib');

// Public match list: live matches first, then upcoming by start time.
module.exports = guard(async (req, res) => {
  const rows = await sql(
    `select id, league, home_team, away_team, starts_at, status, minute,
            score_home, score_away, odds, home_logo, away_logo, external_ref
     from matches
     where status in ('live', 'upcoming')
     order by (status = 'live') desc, starts_at asc
     limit 300`
  );
  send(res, 200, { matches: rows });
});
