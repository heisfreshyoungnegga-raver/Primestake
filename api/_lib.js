// PrimeStake API shared library. Zero dependencies: Node built-ins plus
// Neon's HTTP SQL endpoint, so Vercel runs these functions as-is.
const crypto = require('crypto');

function config() {
  return {
    databaseUrl: process.env.DATABASE_URL || '',
    sessionSecret: process.env.SESSION_SECRET || ''
  };
}
function missingConfig() {
  const c = config();
  const missing = [];
  if (!c.databaseUrl) missing.push('DATABASE_URL');
  if (!c.sessionSecret) missing.push('SESSION_SECRET');
  return missing;
}

// Run one SQL statement against Neon over HTTPS. The connection string
// (which carries the DB password) is sent as a header to the database
// host only, and never logged.
async function sql(query, params = []) {
  const { databaseUrl } = config();
  const host = new URL(databaseUrl.replace(/^postgres(ql)?:\/\//, 'https://')).host;
  const res = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'Neon-Connection-String': databaseUrl,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, params })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `database error (${res.status})`);
    err.dbMessage = data.message || '';
    throw err;
  }
  return data.rows || [];
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

function signToken(payload) {
  const { sessionSecret } = config();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  const { sessionSecret } = config();
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}
function issueToken(user) {
  return signToken({ uid: user.id, role: user.role, exp: Date.now() + 7 * 24 * 3600 * 1000 });
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// Returns the session payload or sends 401 and returns null.
function requireAuth(req, res) {
  const header = req.headers.authorization || '';
  const payload = verifyToken(header.replace(/^Bearer\s+/i, ''));
  if (!payload) { send(res, 401, { error: 'not_logged_in' }); return null; }
  return payload;
}
function requireAdmin(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return null;
  if (payload.role !== 'admin' && payload.role !== 'super_admin') { send(res, 403, { error: 'admin_only' }); return null; }
  return payload;
}
function requireSuperAdmin(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return null;
  if (payload.role !== 'super_admin') { send(res, 403, { error: 'super_admin_only' }); return null; }
  return payload;
}

// Wrap a handler with the config check and a uniform error shape.
function guard(handler) {
  return async (req, res) => {
    const missing = missingConfig();
    if (missing.length) return send(res, 503, { error: 'backend_not_configured', missing });
    try {
      await handler(req, res);
    } catch (e) {
      if (!res.writableEnded) send(res, 500, { error: 'server_error', detail: String(e.dbMessage || e.message || e).slice(0, 300) });
    }
  };
}

function publicUser(u) {
  return { id: u.id, phone: u.phone, display_name: u.display_name, role: u.role, status: u.status, balance_ghs: Number(u.balance_ghs) };
}
function betCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];
  return 'PB-' + code;
}

// Market catalogue shared by bet placement and settlement. Keys match
// the odds jsonb stored on each match row.
const MARKETS = {
  '1X2': { '1': 'o1', 'X': 'ox', '2': 'o2' },
  'Double Chance': { '12': 'dc12', '1X': 'dc1x', 'X2': 'dcx2' },
  // Over/Under markets are handled dynamically by line (see keyFor/pickWon).
  'Both Teams To Score': { 'Yes': 'gg', 'No': 'ng' }
};
// Map a (market, pick) pair to its key inside the match odds jsonb.
// Over/Under works for any half-goal line: 'Over/Under 1.5' + 'Over 1.5'
// resolves to 'over15'.
function keyFor(market, pick) {
  if (MARKETS[market]) return MARKETS[market][pick] || null;
  const ou = /^Over\/Under (\d+\.\d)$/.exec(market);
  if (ou) {
    const suffix = ou[1].replace('.', '');
    if (pick === 'Over ' + ou[1]) return 'over' + suffix;
    if (pick === 'Under ' + ou[1]) return 'under' + suffix;
  }
  return null;
}
function pickWon(market, pick, home, away) {
  const total = home + away;
  const ou = /^Over\/Under (\d+\.\d)$/.exec(market);
  if (ou) {
    const line = parseFloat(ou[1]);
    return pick === 'Over ' + ou[1] ? total > line : total < line;
  }
  switch (market) {
    case '1X2': return pick === '1' ? home > away : pick === 'X' ? home === away : away > home;
    case 'Double Chance': return pick === '12' ? home !== away : pick === '1X' ? home >= away : away >= home;
    case 'Both Teams To Score': return pick === 'Yes' ? (home > 0 && away > 0) : (home === 0 || away === 0);
    default: return false;
  }
}

// ---- ShinobiPay (direct MoMo push deposits) --------------------------
// The secret key lives ONLY in server env (SHINOBIPAY_SECRET_KEY); it is
// never sent to the browser and never logged. The webhook signing secret
// is SHINOBIPAY_WEBHOOK_SECRET. Without the key, deposit endpoints answer
// 503 provider_not_configured and the wallet falls back to manual transfer.
function shinobiConfig() {
  return {
    apiBase: (process.env.SHINOBIPAY_API_BASE || 'https://akwapayapi.onrender.com/v1').replace(/\/$/, ''),
    secretKey: process.env.SHINOBIPAY_SECRET_KEY || '',
    webhookSecret: process.env.SHINOBIPAY_WEBHOOK_SECRET || ''
  };
}

// One JSON call to the ShinobiPay API. Returns { status, data } and never
// throws on an HTTP error status (callers branch on it); it throws only
// when the network itself failed, which callers must treat as "unknown".
async function shinobiFetch(path, { method = 'GET', body, idempotencyKey } = {}) {
  const { apiBase, secretKey } = shinobiConfig();
  const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(apiBase + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ShinobiPay intent status -> our attempt status vocabulary.
function mapIntentStatus(s) {
  switch (s) {
    case 'succeeded': return 'succeeded';
    case 'failed': return 'failed';
    case 'processing': return 'processing';
    case 'requires_action': return 'awaiting';
    case 'unknown': return 'unknown';
    default: return 'processing';
  }
}

// Guess the MoMo network from a local Ghana number's prefix. Portability
// means this is only a default: the customer confirms the network in the
// UI, and ShinobiPay warns on a mismatch rather than rerouting.
function detectNetwork(localPhone) {
  const p = String(localPhone || '').slice(0, 3);
  if (['024', '025', '053', '054', '055', '059'].includes(p)) return 'MTN';
  if (['020', '050'].includes(p)) return 'TELECEL';
  if (['026', '027', '056', '057'].includes(p)) return 'AIRTELTIGO';
  return null;
}

// Tables for payment attempts + webhook idempotency. Created lazily so
// the integration self-installs on first use (no console access needed);
// backend/schema.sql carries the same definitions for the record.
let tablesReady = null;
function ensurePaymentTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      await sql(`create table if not exists payment_attempts (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users (id),
        provider text not null default 'shinobipay',
        reference text not null unique,
        intent_id text,
        client_secret text,
        amount_ghs numeric(12, 2) not null,
        amount_minor integer not null,
        phone text,
        network text,
        status text not null default 'created',
        fail_reason text,
        last_sequence integer not null default 0,
        created_at timestamptz not null default now(),
        settled_at timestamptz
      )`);
      await sql(`create table if not exists webhook_events (
        event_id text primary key,
        received_at timestamptz not null default now()
      )`);
    })().catch(e => { tablesReady = null; throw e; });
  }
  return tablesReady;
}

module.exports = { sql, hashPassword, verifyPassword, issueToken, readBody, send, requireAuth, requireAdmin, requireSuperAdmin, guard, publicUser, betCode, MARKETS, keyFor, pickWon, shinobiConfig, shinobiFetch, mapIntentStatus, detectNetwork, ensurePaymentTables };
