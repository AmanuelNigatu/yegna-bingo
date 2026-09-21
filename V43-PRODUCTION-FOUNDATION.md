# YEGNA BINGO V43 — Production Foundation

V43 is a minimal hardening step on top of V42. It does not redesign the Mini App or change wallet/game rules.

## Changes

1. **Netlify Bot routing fixed**
   - `/api/bot/*` and `/api/bot` are now listed before the general `/api/*` rewrite.
   - Netlify evaluates redirect rules from top to bottom and uses the first match.

2. **Canonical database schema**
   - `bot_conversations` is now included in `db/schema.sql` as well as `db/migration-v43.sql`.
   - A fresh database can create the Telegram Bot conversation state without depending on a later migration.

3. **Existing V42 security remains**
   - Telegram Mini App `initData` verification.
   - One-time initData replay protection.
   - Server-side HttpOnly session.
   - Telegram Bot webhook secret.
   - PostgreSQL-backed wallet/request state.
   - Server-controlled stake and wallet transactions.

## Production architecture

Telegram Mini App / Bot
→ Netlify Functions
→ PostgreSQL

Netlify is the application/API layer. PostgreSQL is the persistent data layer.

## Deployment order

1. Deploy the V43 site to Netlify.
2. Configure server-only environment variables from `.env.example`.
3. Apply the database schema/migrations.
4. Set the Telegram Bot webhook to `/api/bot` with the matching `TELEGRAM_WEBHOOK_SECRET`.
5. Open the Mini App from Telegram and verify session creation.
6. Test deposit and withdrawal request flows.
7. Test card stake/unpick and admin approval/rejection.
8. Only after those checks, enable production game operation.

## Important

V43 is intentionally not the final multi-player game engine. The next production game-engine step should make number calls, game state, winner detection, and settlement authoritative on the server while preserving the existing UI.
