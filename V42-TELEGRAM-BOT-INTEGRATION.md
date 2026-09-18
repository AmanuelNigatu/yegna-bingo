# YEGNA BINGO V42 — Telegram Bot Integration

V42 adds the real Telegram Bot webhook flow while preserving the existing Mini App game and wallet UI.

## Server environment
- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN` (server only)
- `TELEGRAM_WEBHOOK_SECRET` (server only; must match Telegram webhook secret)
- `MINI_APP_URL` (the deployed Mini App URL)
- Existing V40/V41 variables remain required.

## Database
Run `db/migration-v42.sql` after the previous migrations. It creates persistent bot conversation state so serverless function instances do not depend on in-memory state.

## Webhook
After deploying, set the Telegram webhook to:
`https://YOUR-DOMAIN/api/bot`
using Telegram Bot API `setWebhook` with:
- `url`
- `secret_token` = the same value as `TELEGRAM_WEBHOOK_SECRET`

Do not put the bot token, webhook secret, or database URL in frontend code.

## Bot flow
- `/start` registers/updates the Telegram numeric user identity and shows the menu.
- `🎮 Open YEGNA BINGO` opens the Mini App.
- `💰 Deposit` → amount → payment/reference detail → confirmation → Pending request.
- `💸 Withdraw` → amount → destination/method detail → confirmation → balance hold → Pending request.
- `📋 My Wallet` shows the current wallet balance.
- `❓ Help` explains the flow.
- Request references are unique and the database transaction makes withdrawal hold + request creation atomic.

Admin approval/rejection remains in the Mini App. Deposit approval credits the wallet; withdrawal approval finalizes the held amount; withdrawal rejection releases the hold.

## V41 compatibility fix
The Mini App session bootstrap now sends `X-Telegram-Init-Data` to `/api/auth/session`, which is required for the V41 server-side verification path.
