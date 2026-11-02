# PrimeStake — sportsbook

PrimeStake is a Ghana sportsbook: black header, gold accent, hero,
filters, match list with live odds, games lobby, betslip, booking
codes, and a mobile money wallet.

## Architecture

- Front end: static `index.html` + `js/app.js`, deployed on Vercel.
  All live data comes from the API — there is no sample data in the UI.
- API: zero-dependency Vercel functions under `api/` talking to Neon
  Postgres over its HTTPS SQL endpoint.
- Database: Neon project `primestake` (schema in `backend/schema.sql`),
  with the 6-deposit withdrawal rule enforced by a database trigger.
- Admin: a separate back office at `admin.html` (not linked from the
  public site) for the payout queue, match management and settlement,
  users and support. Admin accounts are normal user accounts promoted
  with `update users set role = 'admin' where phone = '<phone>';` in
  the Neon SQL editor.

## Environment (set in the Vercel project, never in code or chat)

- `DATABASE_URL` — the Neon connection string (contains the DB
  password). Easiest: Vercel project → Storage → connect the Neon
  database and Vercel fills this in.
- `SESSION_SECRET` — any long random string used to sign login tokens.

Until both are set, the API answers 503 `backend_not_configured` and
the site shows a "being set up" state instead of data.
