# YEGNA BINGO V51 — Fixes

This build is prepared for **GitHub Pages frontend + Render Node backend + Supabase/PostgreSQL** and Telegram Mini App use.

## Fixed

- Countdown is no longer blocked just because the backend URL is missing; when the backend is configured, the server round is authoritative.
- Expired picking rounds with zero cards are automatically restarted server-side.
- Card picking is server-authoritative when the backend is configured, with a maximum of 2 cards per user and atomic card uniqueness.
- Unpick refunds the stake before game launch.
- Telegram session cookies work for the cross-origin GitHub Pages → Render setup (`SameSite=None; Secure` in production).
- Telegram Super Admin defaults to Telegram ID `801812169` and is also configurable with `SUPER_ADMIN_TELEGRAM_ID`.
- Logo and audio paths are base-path aware for GitHub Pages (`/yegna-bingo/`).
- Netlify runtime files/dependency were removed; the backend now runs with `node server/index.mjs`.
- Render health endpoint is `/health`.
- Telegram bot webhook endpoint is `/telegram/webhook`.
- GitHub Pages workflow builds with `VITE_API_BASE_URL` from a GitHub repository variable.

## Required deployment values

### GitHub repository variable

`VITE_API_BASE_URL` = the Render service API URL ending in `/api`, for example:

`https://YOUR-RENDER-SERVICE.onrender.com/api`

### Render environment variables

- `NODE_ENV=production`
- `DATABASE_URL=<Supabase PostgreSQL connection string>`
- `TELEGRAM_BOT_TOKEN=<BotFather token>`
- `SUPER_ADMIN_TELEGRAM_ID=801812169`
- `ALLOWED_ORIGIN=https://YOUR-USERNAME.github.io`
- `MINI_APP_URL=https://YOUR-USERNAME.github.io/yegna-bingo/`
- `WALLET_BOT_SECRET=<random secret>`
- `TELEGRAM_WEBHOOK_SECRET=<random secret>`

Never put the bot token or database password into GitHub frontend variables.
