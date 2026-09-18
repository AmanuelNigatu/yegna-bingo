# V48 — Production Observability & Health

Based on V47. This release adds lightweight production observability without changing Bingo, wallet, Telegram, admin, or authentication rules.

## Added
- `X-Request-Id` on API JSON responses for log correlation.
- Structured JSON request-start/request-end/error logs.
- Public `GET /api/health` connectivity check.
- Health check reports PostgreSQL and Telegram configuration status without user data.
- Health latency is returned in milliseconds.

## Deployment
Use `/api/health` as the external health probe after `DATABASE_URL` and `TELEGRAM_BOT_TOKEN` are configured. A healthy response requires both PostgreSQL connectivity and Telegram configuration.

## Scope protection
No game rules, wallet calculations, reward rules, Telegram Bot flows, UI, or admin permissions were intentionally changed.
