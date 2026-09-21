# YEGNA BINGO V44 — Server-Side Bingo Engine

V44 keeps the V43 UI, wallet, Telegram bot, authentication, and admin features intact while moving official Bingo round state and number calling to PostgreSQL through the Netlify API.

## Server-authoritative state
- `games.called_numbers` stores the official call order.
- `games.current_call` stores the latest number.
- `games.next_call_at` controls the 3-second cadence.
- `games.call_index` prevents ambiguous call sequencing.
- `games.winner_count` records 0, 1, or 2 winners.
- Winner detection is performed from server-registered cards and the same deterministic card generator used by the client.
- A winning call settles the round atomically and credits the configured reward.
- Two winners are allowed only when both cards satisfy a winning pattern on the same newly called number; the reward pool is split equally.
- Duplicate reward insertion is protected by the existing transaction unique key.

## Netlify/serverless behavior
There is no long-running Node timer. Clients poll `/api/games/state` and the server advances the round only when the next call is due. PostgreSQL is the source of truth, so multiple Telegram clients observe the same call sequence.

## Migration
Run `db/migration-v44.sql` after the existing migrations. It is additive and preserves existing data.

## Important deployment note
Netlify Functions remain serverless. The V44 engine is intentionally event-driven rather than a permanent background process. If no client requests the state endpoint, no function remains running; the next state request advances the authoritative round when a call is due.
