const crypto = require('crypto');
const { sql, readBody, send, guard, requireSuperAdmin, keyFor, fillOdds, isCustomMatch, customMatchState } = require('../../_lib');

// Booking codes — super admin only (Prince's rule, 2026-11-04).
// A booking code is a sellable, server-side slip: the super admin
// builds a set of selections (typically on a match he just created),
// the system mints a 5-digit code, and any player who buys/receives
// the code can load the exact slip and bet it. Codes carry an
// optional price note, an optional use limit and an optional expiry;
// uses are counted at bet placement (see bets/place.js), never at
// load time, so a buyer browsing the slip does not burn a use.
//
// GET  -> list every code with creator + usage.
// POST -> { selections, label?, price_ghs?, max_uses?, expires_hours? }
//         creates a code; { revoke_id } instead revokes one.
function mintDigits() {
  // 5-digit code, first digit never zero so it types exactly as shown.
  return String(crypto.randomInt(10000, 100000));
}

module.exports = guard(async (req, res) => {
  const auth = requireSuperAdmin(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const rows = await sql(
      `select bc.*, u.phone as creator_phone, u.email as creator_email,
              (select count(*) from bets b where b.booking_code_id = bc.id) as bets_placed
       from booking_codes bc join users u on u.id = bc.created_by
       order by bc.created_at desc limit 100`
    );
    return send(res, 200, { codes: rows });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = await readBody(req);

  if (body.revoke_id) {
    const rows = await sql(
      "update booking_codes set status = 'revoked' where id = $1::uuid and status = 'active' returning id, code",
      [String(body.revoke_id)]
    );
    if (!rows.length) return send(res, 404, { error: 'code_not_found_or_already_revoked' });
    return send(res, 200, { revoked: rows[0] });
  }

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

  const label = body.label ? String(body.label).slice(0, 80) : null;
  const price = Number(body.price_ghs) > 0 ? Math.round(Number(body.price_ghs) * 100) / 100 : null;
  const maxUses = Number(body.max_uses) > 0 ? Math.floor(Number(body.max_uses)) : null;
  const expiresAt = Number(body.expires_hours) > 0
    ? new Date(Date.now() + Number(body.expires_hours) * 3600 * 1000).toISOString()
    : null;

  // Mint with retry — the unique index is the arbiter on collisions.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = mintDigits();
    try {
      const rows = await sql(
        `insert into booking_codes (code, created_by, label, price_ghs, selections, max_uses, expires_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7) returning *`,
        [code, auth.uid, label, price, JSON.stringify(clean), maxUses, expiresAt]
      );
      return send(res, 201, { booking_code: rows[0] });
    } catch (e) {
      if (!/unique|duplicate/i.test(String(e.dbMessage || e.message || ''))) throw e;
    }
  }
  return send(res, 500, { error: 'code_mint_failed' });
});
