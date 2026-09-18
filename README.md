# YEGNA BINGO — No Netlify

The previous Netlify-specific deployment layer has been removed.

## Architecture

- GitHub + GitHub Pages: frontend/source/deployment
- Node.js backend host: API + Telegram webhook
- PostgreSQL/Supabase: users, wallets, cards and game state
- Telegram Bot: Mini App launcher + wallet bot

**Important:** GitHub/GitHub Pages alone cannot run the Node API, PostgreSQL, or a persistent Telegram webhook. The real multiplayer game therefore still needs a backend host. Netlify is no longer required.

## GitHub Pages

Create Actions Variables:

- `VITE_API_BASE_URL` = `https://YOUR-BACKEND-HOST/api`
- `VITE_BASE_PATH` = `/YOUR-REPO` for `https://USER.github.io/YOUR-REPO/`, or `/` for a custom/user Pages domain.

Enable **Settings → Pages → Source: GitHub Actions**.

## Backend

Run:

```bash
npm ci
npm start
```

Required backend environment variables:

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `SUPER_ADMIN_TELEGRAM_ID`
- `ALLOWED_ORIGIN` = exact GitHub Pages origin
- `MINI_APP_URL` = exact GitHub Pages URL
- `NODE_ENV=production`

Production cross-origin sessions use `SameSite=None; Secure` cookies and explicit CORS origin matching.

## Database

```bash
npm run db:migrate
```

## Telegram webhook

Repository Secrets:

- `BACKEND_URL`
- `MINI_APP_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`

Then run **Actions → Configure Telegram webhook → Run workflow**.

Webhook: `BACKEND_URL/api/bot`

Mini App button: `MINI_APP_URL`

Never put `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, or `TELEGRAM_WEBHOOK_SECRET` into frontend variables.
