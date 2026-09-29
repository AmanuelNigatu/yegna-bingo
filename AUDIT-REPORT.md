# YEGNA BINGO V51 — Initial audit and maintenance notes

## Changes made

1. **Telegram bot conversation IDs:** text replies now read and update `bot_conversations` by the Telegram numeric ID, matching the table key and the way `/start` and the callback handlers address conversations. The previous code passed the internal database user ID during text steps, so deposit/withdrawal conversations could appear to disappear.
2. **Telegram bot message formatting:** corrected double-escaped newline sequences so bot prompts and confirmations render on separate lines.
3. **ETB amount validation:** bot-entered amounts and internal wallet-request amounts now accept only ordinary positive decimal notation with up to two decimal places and enforce an upper bound. Admin wallet adjustments also reject excess decimal places and unreasonable amounts.
4. **Card reserve/release retry behavior:** card reservations now return idempotently when the same player already holds that card, and new reservation attempts use distinct ledger references. Refund references are tied to the specific stake transaction, allowing the same card to be released and selected again without colliding with an old ledger entry.
5. **Request parsing and size limits:** malformed/non-object JSON is rejected as `400`; the Node HTTP server limits request bodies to 1 MiB and responds with `413` for oversized bodies.
6. **Credentialed local CORS:** development CORS now reflects a supplied origin instead of sending `Access-Control-Allow-Origin: *` alongside credentials, which browsers reject.
7. **HTTP response hardening:** added `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and production HSTS headers at the Render Node server layer.
8. **Deployment documentation/workflow:** README was rewritten to describe the current GitHub Pages + Render + PostgreSQL architecture, fresh-database initialization, secrets, and staging checks. The Pages workflow now uses `npm ci` and fails clearly if `VITE_API_BASE_URL` is missing. Added `npm run start:local` for loading a local `.env` with supported Node versions.

## Checks performed

- `node --check server/api.mjs` — passed.
- `node --check server/bot.mjs` — passed.
- `node --check server/index.mjs` — passed.
- `node --check scripts/migrate.mjs` — passed.
- `package.json` and `package-lock.json` JSON parse — passed.
- Original ZIP integrity — passed.

## Checks not completed

`npm ci --no-audit --no-fund` timed out in this environment and dependencies were not installed. Therefore the Vite production build, JSX compilation, and automated/browser integration tests could not be run here. This archive must be treated as an **audit candidate for staging tests**, not as a guarantee of zero defects or as already verified for live production.

## Required staging verification

Before production use, install dependencies and run `npm run build`; test Telegram login/session cookies from the deployed Pages origin; test a deposit request through approval; test withdrawal hold and rejection refund; reserve/release/re-reserve the same Bingo card; have two users attempt the same card concurrently; test round recovery after client disconnect; and verify each sub-admin permission boundary against the real database.
