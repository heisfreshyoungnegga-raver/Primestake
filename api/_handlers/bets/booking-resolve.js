const { sql, readBody, send, guard, requireAuth, keyFor, fillOdds, isCustomMatch, customMatchState } = require('../../_lib');

// Resolve a 5-digit booking code into a loadable slip. Any logged-in
// player may resolve a code; the use is only counted when the slip
// is actually bet (bets/place.js), so checking a code is free.
// Odds are re-read from the matches NOW — a leg whose match finished
// or whose market vanished comes back available:false and the client
// simply does not add it to the slip.
module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  const { code } = await readBody(req);
  const clean = String(code || '').replace(/\D/g, '').slice(0, 5);
  if (clean.length !== 5) return send(res, 400, { error: 'code_must_be_5_digits' });

  const rows = await sql('select * from booking_codes where code = $1', [clean]);
  if (!rows.length) return send(res, 404, { error: 'code_not_found' });
  const bc = rows[0];
  if (bc.status !== 'active') return send(res, 400, { error: 'code_revoked' });
  if (bc.expires_at && new Date(bc.expires_at).getTime() <= Date.now()) return send(res, 400, { error: 'code_expired' });
  if (bc.max_uses && Number(bc.uses) >= Number(bc.max_uses)) return send(res, 400, { error: 'code_exhausted' });

  const sels = Array.isArray(bc.selections) ? bc.selections : [];
  const ids = [...new Set(sels.map(s => String(s.match_id)))];
  const matchRows = ids.length
    ? await sql('select id, home_team, away_team, league, starts_at, status, odds, external_ref, goal_events, score_home, score_away from matches where id = any($1::uuid[])', [ids])
    : [];
  const byId = new Map(matchRows.map(m => [m.id, m]));

  const selections = sels.map(s => {
    const m = byId.get(String(s.match_id));
    if (!m) return { match_id: String(s.match_id), market: s.market, pick: s.pick, available: false, reason: 'match_not_found' };
    const key = keyFor(s.market, s.pick);
    const odd = key ? Number(fillOdds(m.odds)[key]) : NaN;
    let available = m.status !== 'finished' && odd > 1;
    let reason = null;
    if (m.status === 'finished') { available = false; reason = 'match_finished'; }
    else if (isCustomMatch(m) && customMatchState(m).status === 'finished') { available = false; reason = 'match_finished'; }
    else if (!(odd > 1)) { available = false; reason = 'market_unavailable'; }
    return {
      match_id: m.id, home_team: m.home_team, away_team: m.away_team, league: m.league,
      starts_at: m.starts_at, status: m.status, market: s.market, pick: s.pick,
      odd: odd > 1 ? odd : null, available, reason,
    };
  });

  return send(res, 200, {
    code: bc.code, label: bc.label, price_ghs: bc.price_ghs != null ? Number(bc.price_ghs) : null,
    uses: Number(bc.uses), max_uses: bc.max_uses, expires_at: bc.expires_at, selections,
  });
});
