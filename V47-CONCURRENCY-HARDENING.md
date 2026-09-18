# YEGNA BINGO V47 — Production Concurrency & Retry Hardening

V47 is based on V46 and is intentionally additive.

## What changed
- PostgreSQL connection pool is bounded/configurable (`PG_POOL_MAX`, default 5) to reduce connection exhaustion on serverless concurrency.
- Pool idle and connection timeouts are configurable (`PG_IDLE_TIMEOUT_MS`, `PG_CONNECTION_TIMEOUT_MS`).
- Card stake requests are idempotent by `(user, stake, reference_id)`: a client retry after a committed request returns the existing result instead of charging twice.
- Card release/refund requests are idempotent: a retry after a committed refund returns the current wallet result.
- Existing row locks remain authoritative for round/card/wallet concurrency.
- Added indexes for player-card lookup, wallet idempotency lookup and game-call lookup.

## Preserved rules
- 10 ETB server-controlled stake.
- Maximum 2 cards per user.
- One card number can belong to only one player in a round.
- Unpick is allowed only during picking.
- Refund is exactly one 10 ETB stake per released card.
- Existing Bingo UI, wallet, Telegram bot, admin, authentication and reward rules are preserved.

## Database
Run `db/migration-v47.sql` after V46 migration.
