# YEGNA BINGO V46 — Production Game Lifecycle & Automatic Recovery

V46 is based on V45 and preserves the existing UI, Wallet, Telegram Bot, authentication/session, Admin permissions, and Bingo presentation.

## Lifecycle hardening
- Picking remains open for 35 seconds and starts only when at least one card exists.
- Running rounds use the persisted `next_call_at` deadline and a 3-second call interval.
- Calls are authoritative in PostgreSQL and audited by `game_calls`.
- A reconnect/state request can catch up missed deadlines, capped at 20 calls per request so one serverless invocation cannot spend unbounded time catching up. A subsequent request continues recovery if more calls remain due.
- A winning call ends the round immediately; only cards that win on that exact call share the reward.
- If all 75 numbers are exhausted without a winner, the round settles with `ended_reason=all_numbers_called`.
- Winner settlement records `ended_reason=winner`.
- `last_activity_at` records the latest server-side lifecycle activity for monitoring/recovery.

## Recovery model
Netlify remains serverless: the browser polls the authoritative state while active, and reconnects automatically recover missed deadlines from PostgreSQL. No permanent Node `setInterval` process is required.

## Database
Run `db/migration-v46.sql` after the V45 migration. It is additive and preserves existing application data.
