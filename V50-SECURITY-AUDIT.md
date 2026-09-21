# YEGNA BINGO V50 — Production Security Audit & Secrets Hardening

V50 is based on V49 and is intentionally limited to production security hardening. Existing Bingo UI, wallet rules, Telegram bot flow, admin permissions, authentication/session design, and game lifecycle are preserved.

## Changes

- Added explicit production CORS origin enforcement. Credentialed API responses no longer fall back to `*` in production.
- Added `Vary: Origin` for CORS correctness.
- Rejects browser requests whose `Origin` does not match `ALLOWED_ORIGIN` when configured; production requires an explicit allowed origin.
- Added Netlify security headers: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS, and a CSP compatible with the existing Telegram WebApp SDK and Google Fonts.
- Kept all secrets server-side. `.env.example` contains placeholders only.
- No secrets, tokens, balances, or personal wallet data were added to client assets.

## Production environment requirements

Set these as Netlify environment variables, not in source control:

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `SUPER_ADMIN_TELEGRAM_ID`
- `ALLOWED_ORIGIN`
- `WALLET_BOT_SECRET`
- `TELEGRAM_WEBHOOK_SECRET`
- `MINI_APP_URL`

Use long random values for the two webhook/internal secrets. Rotate them if they are ever exposed.

## Important deployment note

HSTS should only be used on a site that is served exclusively over HTTPS. Netlify production deployments normally use HTTPS; do not copy this header into a local HTTP server.

## Verification

- `api.mjs` syntax check: pass
- `bot.mjs` syntax check: pass
- `scripts/migrate.mjs` syntax check: pass
- `netlify.toml` structural review: pass
- ZIP integrity: pass

A real Netlify deployment and live Telegram/PostgreSQL security test still require the production environment and its actual secrets; this archive does not claim that those live tests were performed.
