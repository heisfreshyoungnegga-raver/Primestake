const crypto = require('crypto');
const { sql, readBody, send, guard, requireSuperAdmin, ensureAdminTables, expandOdds } = require('../../_lib');

// Super admin only: create a "featured" match that plays like a real
// one. The super admin sets the league, teams, kickoff time, the 1X2
// prices and the goal schedule (which minute each goal lands). The
// public feed derives the live clock and score from that schedule, and
// settlement uses the scheduled final score. The full odds book
// (Double Chance, Over/Under ladder, BTTS) is priced from the 1X2 line.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireSuperAdmin(req, res);
  if (!auth) return;
  await ensureAdminTables();
  const { league, home_team, away_team, starts_at, o1, ox, o2, goals } = await readBody(req);
  if (!league || !home_team || !away_team || !starts_at) return send(res, 400, { error: 'league_home_away_time_required' });
  const start = new Date(starts_at);
  if (Number.isNaN(start.getTime())) return send(res, 400, { error: 'invalid_start_time' });
  const odds = expandOdds(Number(o1), Number(ox), Number(o2));
  if (!odds.o1) return send(res, 400, { error: 'valid_1x2_odds_required', detail: 'Home, draw and away odds must all be above 1.00.' });
  const cleanGoals = [];
  if (Array.isArray(goals)) {
    for (const g of goals.slice(0, 14)) {
      const minute = Math.round(Number(g && g.minute));
      const side = g && g.side;
      if (minute >= 1 && minute <= 90 && (side === 'home' || side === 'away')) cleanGoals.push({ minute, side });
    }
    cleanGoals.sort((a, b) => a.minute - b.minute);
  }
  const rows = await sql(
    `insert into matches (league, home_team, away_team, starts_at, odds, external_ref, goal_events)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb) returning *`,
    [String(league).slice(0, 80), String(home_team).slice(0, 80), String(away_team).slice(0, 80),
     start.toISOString(), JSON.stringify(odds), 'custom:' + crypto.randomUUID(), JSON.stringify(cleanGoals)]
  );
  send(res, 201, { match: rows[0] });
});
