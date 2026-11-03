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
  return { id: u.id, phone: u.phone, email: u.email || null, display_name: u.display_name, role: u.role, status: u.status, balance_ghs: Number(u.balance_ghs) };
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
function fmtLine(x) { return (x > 0 ? '+' : '') + Number(x).toFixed(1); }
function keyFor(market, pick) {
  if (MARKETS[market]) return MARKETS[market][pick] || null;
  const ou = /^Over\/Under (\d+\.\d)$/.exec(market);
  if (ou) {
    const suffix = ou[1].replace('.', '');
    if (pick === 'Over ' + ou[1]) return 'over' + suffix;
    if (pick === 'Under ' + ou[1]) return 'under' + suffix;
  }
  // Handicap markets carry the home team's spread line in the name
  // ('Handicap +0.5'); picks are 'Home +0.5' / 'Away -0.5'.
  const hc = /^Handicap ([+-]?\d+\.\d)$/.exec(market);
  if (hc) {
    const line = parseFloat(hc[1]);
    if (pick === 'Home ' + fmtLine(line)) return 'sph';
    if (pick === 'Away ' + fmtLine(-line)) return 'spa';
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
  const hc = /^Handicap ([+-]?\d+\.\d)$/.exec(market);
  if (hc) {
    const line = parseFloat(hc[1]);
    // The home pick applies the line to the home score; the away
    // pick carries the mirrored line. A level adjusted score (only
    // possible on whole lines) loses — ESPN soccer spreads are
    // half-goal lines, so this does not arise in practice.
    return pick.indexOf('Home ') === 0 ? (home + line) > away : (away - line) > home;
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

// ---- Admin platform: invites, commissions, settings, custom matches --
// Lazy self-migration (same pattern as the payment tables): invite
// attribution columns on users, one-time admin invite tokens, the
// commission ledger, goal schedules on matches, and the operator
// settings the super-admin dashboard controls.
let adminTablesReady = null;
function ensureAdminTables() {
  if (!adminTablesReady) {
    adminTablesReady = (async () => {
      await sql(`alter table users add column if not exists invite_code text`);
      await sql(`create unique index if not exists users_invite_code_idx on users (invite_code) where invite_code is not null`);
      await sql(`alter table users add column if not exists invited_by uuid references users (id)`);
      // Widen the status check so invited admins can sit in 'pending'
      // until the super admin verifies them.
      await sql(`do $$ declare c text; begin
        select conname into c from pg_constraint
        where conrelid = 'users'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%';
        if c is not null then execute 'alter table users drop constraint ' || quote_ident(c); end if;
        alter table users add constraint users_status_check check (status in ('active', 'blocked', 'pending'));
      end $$`);
      await sql(`create table if not exists invites (
        id uuid primary key default gen_random_uuid(),
        token text not null unique,
        kind text not null default 'admin',
        created_by uuid references users (id),
        expires_at timestamptz not null,
        used_by uuid references users (id),
        used_at timestamptz,
        created_at timestamptz not null default now()
      )`);
      await sql(`create table if not exists commissions (
        id uuid primary key default gen_random_uuid(),
        earner_id uuid not null references users (id),
        source_user_id uuid not null references users (id),
        source_txn_id uuid references wallet_transactions (id),
        basis_ghs numeric(12, 2) not null,
        pct numeric(6, 2) not null,
        amount_ghs numeric(12, 2) not null,
        paid_at timestamptz,
        created_at timestamptz not null default now()
      )`);
      await sql(`create unique index if not exists commissions_source_idx on commissions (source_txn_id) where source_txn_id is not null`);
      await sql(`alter table matches add column if not exists goal_events jsonb not null default '[]'::jsonb`);
      await sql(`insert into operator_settings (key, value) values
        ('gateway_enabled', '1'), ('payouts_frozen', '0'),
        ('admin_commission_pct', '0'), ('user_cashback_pct', '0')
        on conflict (key) do nothing`);
    })().catch(e => { adminTablesReady = null; throw e; });
  }
  return adminTablesReady;
}

async function getSettings(keys) {
  const rows = await sql('select key, value from operator_settings where key = any($1::text[])', [keys]);
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
}

// Rewards that hang off a completed deposit, run once per deposit txn:
//  - user cashback: user_cashback_pct of the deposit, credited straight
//    back to the depositor's balance as an adjustment ledger row.
//  - referral commission: admin_commission_pct of the deposit, recorded
//    in the commission ledger for whoever invited the depositor — any
//    account can refer, players included — to be paid out later from
//    the super-admin dashboard.
// Idempotent per source txn, so a retried call can never double-pay.
async function applyDepositRewards(userId, txnId, amountGhs) {
  const amount = Number(amountGhs);
  if (!(amount > 0)) return;
  const s = await getSettings(['admin_commission_pct', 'user_cashback_pct']);
  const cashPct = Number(s.user_cashback_pct || 0);
  const commPct = Number(s.admin_commission_pct || 0);
  if (cashPct > 0) {
    const cash = Math.round(amount * cashPct) / 100;
    if (cash > 0) {
      const dupe = await sql('select id from wallet_transactions where external_ref = $1', ['cashback:' + txnId]);
      if (!dupe.length) {
        await sql(
          `with ins as (
             insert into wallet_transactions (user_id, kind, method, amount_ghs, status, external_ref, note)
             values ($1, 'adjustment', 'Deposit cashback', $2, 'completed', $3, $4) returning id
           )
           update users set balance_ghs = balance_ghs + $2 where id = $1`,
          [userId, cash, 'cashback:' + txnId, cashPct + '% cashback on deposit']
        );
      }
    }
  }
  if (commPct > 0) {
    const inv = await sql(
      `select i.id from users u join users i on i.id = u.invited_by
       where u.id = $1 and i.status = 'active' and i.role in ('admin', 'super_admin')`,
      [userId]
    );
    if (inv.length) {
      const earn = Math.round(amount * commPct) / 100;
      if (earn > 0) {
        await sql(
          `insert into commissions (earner_id, source_user_id, source_txn_id, basis_ghs, pct, amount_ghs)
           values ($1, $2, $3, $4, $5, $6) on conflict (source_txn_id) where source_txn_id is not null do nothing`,
          [inv[0].id, userId, txnId, amount, commPct, earn]
        );
      }
    }
  }
}

// A super-admin "featured" match carries a goal schedule. Its displayed
// state is derived from the clock: before kickoff it is upcoming; from
// kickoff the minute counts up and each scheduled goal lands at its
// minute; at 95 minutes it is finished with the full scheduled score.
function isCustomMatch(m) {
  return m && typeof m.external_ref === 'string' && m.external_ref.startsWith('custom:');
}
function customMatchState(m, now = new Date()) {
  const goals = Array.isArray(m.goal_events) ? m.goal_events : [];
  const finH = goals.filter(g => g.side === 'home').length;
  const finA = goals.filter(g => g.side === 'away').length;
  if (m.status === 'finished') return { status: 'finished', minute: null, score_home: m.score_home, score_away: m.score_away, final_home: m.score_home, final_away: m.score_away };
  const elapsed = Math.floor((now - new Date(m.starts_at)) / 60000);
  if (elapsed < 0) return { status: 'upcoming', minute: null, score_home: 0, score_away: 0, final_home: finH, final_away: finA };
  if (elapsed >= 95) return { status: 'finished', minute: null, score_home: finH, score_away: finA, final_home: finH, final_away: finA };
  const shown = goals.filter(g => Number(g.minute) <= elapsed);
  return {
    status: 'live', minute: Math.min(elapsed, 90),
    score_home: shown.filter(g => g.side === 'home').length,
    score_away: shown.filter(g => g.side === 'away').length,
    final_home: finH, final_away: finA
  };
}

// Build a full odds book from a 1X2 line for a custom match: Double
// Chance from the 1X2 prices (same maths as the ESPN sync), the
// Over/Under ladder and BTTS from a Poisson goal model whose total is
// split between the teams by their implied win strengths.
function poissonCdf(k, mu) {
  let term = Math.exp(-mu), sum = term;
  for (let i = 1; i <= k; i++) { term *= mu / i; sum += term; }
  return sum;
}
function expandOdds(o1, ox, o2) {
  const odds = {};
  if (!(o1 > 1 && ox > 1 && o2 > 1)) return odds;
  odds.o1 = o1; odds.ox = ox; odds.o2 = o2;
  odds.dc1x = Math.round((o1 * ox) / (o1 + ox) * 100) / 100;
  odds.dc12 = Math.round((o1 * o2) / (o1 + o2) * 100) / 100;
  odds.dcx2 = Math.round((ox * o2) / (ox + o2) * 100) / 100;
  const raw = [1 / o1, 1 / ox, 1 / o2];
  const margin = raw[0] + raw[1] + raw[2];
  const pH = raw[0] / margin, pA = raw[2] / margin;
  const mu = 2.7;
  const muH = mu * (pH / (pH + pA || 1)) || mu / 2;
  const muA = Math.max(mu - muH, 0.15);
  const pHomeScores = 1 - Math.exp(-muH), pAwayScores = 1 - Math.exp(-muA);
  const fair = (p) => (p > 0.02 && p < 0.98) ? Math.round((1 / p) / (margin > 1 ? 1.05 : 1) * 100) / 100 : null;
  [0.5, 1.5, 2.5, 3.5, 4.5].forEach(line => {
    const suffix = String(line).replace('.', '');
    const pOver = 1 - poissonCdf(Math.floor(line), mu);
    const o = fair(pOver), u = fair(1 - pOver);
    if (o && o > 1.01) odds['over' + suffix] = o;
    if (u && u > 1.01) odds['under' + suffix] = u;
  });
  const gg = fair(pHomeScores * pAwayScores);
  const ng = fair(1 - pHomeScores * pAwayScores);
  if (gg && gg > 1.01) odds.gg = gg;
  if (ng && ng > 1.01) odds.ng = ng;
  Object.keys(odds).forEach(k => { if (!(odds[k] > 1)) delete odds[k]; });
  return odds;
}

// Complete a partial odds book from its 1X2 line: any key the book
// lacks (totals lines ESPN did not publish, BTTS it never carries)
// is priced by expandOdds; keys already present are never touched.
// Deterministic — the match list, the details page and bet
// placement all see the same completed book.
function fillOdds(odds) {
  if (!odds || !(odds.o1 > 1 && odds.ox > 1 && odds.o2 > 1)) return odds || {};
  return { ...expandOdds(odds.o1, odds.ox, odds.o2), ...odds };
}

function inviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'PS';
  const buf = require('crypto').randomBytes(8);
  for (let i = 0; i < 8; i++) code += chars[buf[i] % chars.length];
  return code;
}

// Every account — player, admin or super admin — owns one permanent
// referral code. Mint it lazily on first use and return it.
async function ensureInviteCode(userId) {
  const rows = await sql('select invite_code from users where id = $1', [userId]);
  if (!rows.length) return null;
  if (rows[0].invite_code) return rows[0].invite_code;
  for (let i = 0; i < 5; i++) {
    const upd = await sql('update users set invite_code = $2 where id = $1 and invite_code is null returning invite_code', [userId, inviteCode()]);
    if (upd.length) return upd[0].invite_code;
    const again = await sql('select invite_code from users where id = $1', [userId]);
    if (again.length && again[0].invite_code) return again[0].invite_code;
  }
  return null;
}

module.exports = { sql, hashPassword, verifyPassword, issueToken, readBody, send, requireAuth, requireAdmin, requireSuperAdmin, guard, publicUser, betCode, MARKETS, keyFor, pickWon, shinobiConfig, shinobiFetch, mapIntentStatus, detectNetwork, ensurePaymentTables, ensureAdminTables, getSettings, applyDepositRewards, isCustomMatch, customMatchState, expandOdds, fillOdds, inviteCode, ensureInviteCode };
