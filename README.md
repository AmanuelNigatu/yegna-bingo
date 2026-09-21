# YEGNA BINGO Mini App

React + Vite Telegram Mini App starter with a premium YEGNA BINGO design.

## Included in this version
- First page with YEGNA BINGO branding.
- Both stake buttons are Bingo (10 No.1 and 10 No.2).
- Each game has 600 generated Bingo cards (cards #001–#600).
- Card picker UI styled from the supplied reference screenshot.
- One user/session can join only one Bingo game.
- A user can reserve up to 2 cards in that game.
- Tapping an available card reserves it; tapping your own card releases it so another available card can be chosen.
- Taken cards show a lock and cannot be selected.
- Search card numbers and paginate through all 600 cards.
- LocalStorage keeps the demo user's selections between refreshes.

## Important production note
This ZIP contains the frontend/demo reservation logic. Real multi-user Telegram play requires a shared backend/database and server-side atomic card locking. The UI is ready for that integration; the sample locked cards are only demo data so the lock state is visible during preview.

## Run
```bash
npm install
npm run dev
```


## Card locking
All 600 cards start available in the preview; no cards are hard-coded as locked. A card becomes locked for other users only when connected to the future shared server/database. A user can hold up to 2 cards in one Bingo game and can release their own card by tapping it again.


## v8 updates
- Live Bingo number board now follows standard B-I-N-G-O columns: B 1-15, I 16-30, N 31-45, G 46-60, O 61-75.
- Called numbers are highlighted and the current call gets a gold outline.
- Card Pick page now has the same YEGNA gold frame treatment and the shared bottom navigation bar.
- Added a floating Back to Top button for the 600-card scroll page.
- Card Pick still shows all 600 cards on one scrollable page and allows up to 2 cards.

## Backend setup (V32)

This project now includes a production-oriented Netlify Function + PostgreSQL wallet backend.

### Environment variables
- `DATABASE_URL` — PostgreSQL connection string (Supabase/Postgres works).
- `TELEGRAM_BOT_TOKEN` — the token for the YEGNA BINGO Telegram bot.
- `ADMIN_TELEGRAM_IDS` — comma-separated Telegram numeric IDs allowed to use admin endpoints.
- `ALLOWED_ORIGIN` — your deployed Mini App origin.

### Database
Run `db/schema.sql` once against your PostgreSQL database.

### API authentication
The Mini App must send the raw Telegram `initData` string in the `X-Telegram-Init-Data` header. The backend validates Telegram's signature before creating/updating the user and wallet.

### Important
The backend is included and ready to connect, but it is not live until the environment variables and PostgreSQL database are configured. Do not put `TELEGRAM_BOT_TOKEN` in frontend code.

### Backend API endpoints
- `GET /api/health`
- `GET /api/wallet`
- `GET /api/admin/stats`
- `GET /api/admin/users?q=username`
- `GET /api/admin/settings`
- `PUT /api/admin/reward-rate`
- `POST /api/admin/users/adjust`
- `POST /api/games/stake`
- `POST /api/games/settle`

The included `src/api.js` is the frontend API client. The existing demo/localStorage wallet UI is intentionally left unchanged in this backend-foundation version so the current visual/game behavior is preserved while the real database layer is prepared.


## Super Admin / Sub Admins (V33)
- `SUPER_ADMIN_TELEGRAM_IDS` identifies the top-level Super Admin account(s). `ADMIN_TELEGRAM_IDS` remains supported as a legacy alias and is treated as super-admin IDs.
- Only a `super_admin` can add, remove, or edit sub-admin permissions.
- Sub-admin permissions are stored server-side in `sub_admin_permissions` and can include dashboard, users, wallet, reward, and game management.
- A user must have opened the Mini App at least once so the account exists before it can be promoted by username or Telegram ID.
- Removing a sub-admin returns the account to the normal `user` role and deletes its delegated permissions.
- Frontend Super Admin controls are shown only after the authenticated backend reports `role=super_admin`; backend authorization remains authoritative.


## V34 change
- Admin page now visibly includes the Super Admin / Sub Admin Management section and the admin wallet page is vertically scrollable so the section is not clipped below the viewport. Existing game, wallet, reward, and backend behavior is preserved.


## Super Admin bootstrap
The production backend uses exactly one `SUPER_ADMIN_TELEGRAM_ID`. Keep this value server-side as an environment variable; never put it in React/frontend code. When the Mini App is connected to Telegram, set it to the Super Admin's numeric Telegram user ID. Telegram usernames are for display/search only.

Do not set a sample/default admin ID in production. If `SUPER_ADMIN_TELEGRAM_ID` is empty, no Telegram account is promoted to Super Admin by configuration.

## V37 — Deposit / Withdraw Approval
- Added server-side `wallet_requests` workflow for Telegram Bot-submitted deposit and withdrawal requests.
- Added Super Admin/Sub Admin Wallet-permission protected request list with Pending / Approved / Rejected filters.
- Approve is atomic and idempotent: it creates the wallet ledger transaction and updates the balance only once.
- Reject records the reviewer and rejection reason without changing the wallet balance.
- Requests are linked to the user's permanent Telegram numeric ID through the `users` table; username is display/search data only.
- Bot request intake uses the server-only `WALLET_BOT_SECRET` environment variable. Never expose this secret in frontend code.
- Deposit requests affect the wallet only after approval. Withdrawal requests are checked against the current wallet balance at approval time.


## V39
Secure Telegram identity persistence, server-side wallet ledger/request handling, idempotent bot wallet requests, withdrawal hold/refund workflow, and server-enforced 10 ETB card stake/release rules. See `V39-IMPLEMENTATION.md`.


## V46
Production game lifecycle and recovery hardening. See `V46-PRODUCTION-LIFECYCLE.md` and `db/migration-v46.sql`.


## V47
Production concurrency and retry hardening. See `V47-CONCURRENCY-HARDENING.md` and `db/migration-v47.sql`.


## V48
Production observability and health monitoring were added on top of V47. See `V48-OBSERVABILITY-HEALTH.md`.
