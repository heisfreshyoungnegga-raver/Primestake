const { readBody, send, guard, requireAdmin } = require('../../_lib');
const { LEAGUES, syncLeagues } = require('../../_espn');

// Manual ESPN sync from the admin portal: a full sweep of the chosen
// leagues over the coming days. Live scores between manual syncs are
// kept fresh automatically by the public match list (see api/matches.js
// and maybeRefreshLive in api/_espn.js).
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const body = await readBody(req);
  const leagues = Array.isArray(body.leagues) && body.leagues.length
    ? body.leagues.filter(l => LEAGUES[l])
    : Object.keys(LEAGUES);
  const daysAhead = Math.min(Math.max(Number(body.days) || 7, 1), 14);
  const offsets = [];
  for (let o = -1; o <= daysAhead; o++) offsets.push(o);
  const { report, imported, withOdds } = await syncLeagues(leagues, offsets);
  send(res, 200, { ok: true, imported, with_odds: withOdds, leagues: report });
});
