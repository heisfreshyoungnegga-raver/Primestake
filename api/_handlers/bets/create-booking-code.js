const crypto = require('crypto');
const { sql, readBody, send, guard, requireAuth, keyFor, fillOdds, isCustomMatch, customMatchState } = require('../../_lib');

// Player slip codes — any logged-in player may pack their own slip
// into a 5-digit booking code and share it. Same table and same rules
// as the super admin's codes: the code resolves through
// bets/booking-resolve, loads the exact slip, and a use is counted
// only when somebody actually places the bet (bets/place.js), never
// for browsing. Player codes are free, unlimited-use and live for 7
// days. Minting the same slip twice returns the code already minted
// for it instead of a duplicate.
function mintDigits() {
  // 5-digit code, first digit never zero so it types exactly as shown.
  return String(crypto.randomInt(10000, 100000));
}

module.exports = guard(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const auth = requireAuth(req, res);
  if (!auth) return;
  const body = await readBody(req);

  const selections = Array.isArray(body.selections) ? body.selections : [];
  if (!selections.length) return send(res, 400, { error: 'no_selections' });
  if (selections.length > 20) return send(res, 400, { error: 'too_many_selections' });

  // Validate every leg against the live book, exactly like placement.
  const ids = [...new Set(selections.map(s => String(s.match_id || '')))];
  const matchRows = await sql('select id, status, odds, starts_at, external_ref, goal_events, score_home, score_away from matches where id = any($1::uuid[])', [ids]);
  const byId = new Map(matchRows.map(m => [m.id, m]));
  const clean = [];
  const seen = new Set();
  for (const s of selections) {
    const m = byId.get(String(s.match_id || ''));
    if (!m) return send(res, 400, { error: 'match_not_found' });
    if (m.status === 'finished') return send(res, 400, { error: 'match_finished' });
    if (isCustomMatch(m) && customMatchState(m).status === 'finished') return send(res, 400, { error: 'match_finished' });
    if (seen.has(m.id)) return send(res, 400, { error: 'one_selection_per_match' });
    seen.add(m.id);
    const key = keyFor(s.market, s.pick);
    const odd = key ? Number(fillOdds(m.odds)[key]) : NaN;
    if (!key || !(odd > 1)) return send(res, 400, { error: 'market_unavailable' });
    clean.push({ match_id: m.id, market: String(s.market), pick: String(s.pick) });
  }
  // Sort so the same slip always compares equal, whatever order the
  // client sent the legs in.
  clean.sort((a, b) => (a.match_id + '|' + a.market + '|' + a.pick).localeCompare(b.match_id + '|' + b.market + '|' + b.pick));

  // Same slip already coded and still live? Hand back the existing code.
  const dup = await sql(
    `select * from booking_codes where created_by = $1 and status = 'active'
     and (expires_at is null or expires_at > now()) and selections = $2::jsonb
     order by created_at desc limit 1`,
    [auth.uid, JSON.stringify(clean)]
  );
  if (dup.length) return send(res, 200, { booking_code: dup[0], existing: true });

  // Light anti-spam cap on live codes per player.
  const countRows = await sql(
    `select count(*) as n from booking_codes where created_by = $1 and status = 'active'
     and (expires_at is null or expires_at > now())`,
    [auth.uid]
  );
  if (Number(countRows[0].n) >= 20) return send(res, 400, { error: 'too_many_codes' });

  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const label = body.label ? String(body.label).slice(0, 80) : 'Shared slip';

  // Mint with retry — the unique index is the arbiter on collisions.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = mintDigits();
    try {
      const rows = await sql(
        `insert into booking_codes (code, created_by, label, price_ghs, selections, max_uses, expires_at)
         values ($1, $2, $3, null, $4::jsonb, null, $5) returning *`,
        [code, auth.uid, label, JSON.stringify(clean), expiresAt]
      );
      return send(res, 201, { booking_code: rows[0] });
    } catch (e) {
      if (!/unique|duplicate/i.test(String(e.dbMessage || e.message || ''))) throw e;
    }
  }
  return send(res, 500, { error: 'code_mint_failed' });
});
