const { sql, send, guard, isCustomMatch, customMatchState, fillOdds } = require('./_lib');
const { maybeRefreshLive } = require('./_espn');

// Public match list: live matches first, then upcoming by start time.
// Super-admin "featured" matches (external_ref custom:...) carry a goal
// schedule instead of a feed: their clock, score and status are derived
// from kickoff time on every read, so they play like real matches with
// no one touching them. A featured match that has run its 95 minutes
// stays visible as a result for 3 hours, then drops off.
module.exports = guard(async (req, res) => {
  // Live matches keep themselves current: the first list request after
  // a quiet couple of minutes refreshes statuses, scores and minutes
  // from ESPN before answering (see maybeRefreshLive). A feed failure
  // must never break the list, so errors are swallowed.
  await maybeRefreshLive().catch(() => {});
  const rows = await sql(
    `select id, league, home_team, away_team, starts_at, status, minute,
            score_home, score_away, odds, home_logo, away_logo, external_ref, goal_events
     from matches
     where status in ('live', 'upcoming')
     order by (status = 'live') desc, starts_at asc
     limit 300`
  );
  const now = new Date();
  const out = [];
  for (const m of rows) {
    if (isCustomMatch(m)) {
      const st = customMatchState(m, now);
      if (st.status === 'finished' && now - new Date(m.starts_at) > (95 + 180) * 60000) continue;
      out.push({ ...m, odds: fillOdds(m.odds), status: st.status, minute: st.minute, score_home: st.score_home, score_away: st.score_away, goal_events: undefined });
    } else {
      out.push({ ...m, odds: fillOdds(m.odds), goal_events: undefined });
    }
  }
  out.sort((a, b) => {
    const rank = (x) => x.status === 'live' ? 0 : x.status === 'upcoming' ? 1 : 2;
    return rank(a) - rank(b) || new Date(a.starts_at) - new Date(b.starts_at);
  });
  send(res, 200, { matches: out });
});
