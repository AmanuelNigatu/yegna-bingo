# YEGNA BINGO V45 — Production Multiplayer Synchronization & Recovery

V45 is based on V44 and preserves the existing UI, wallet, Telegram bot, authentication/session, admin, and Bingo presentation.

## Server-authoritative recovery
- `GET /api/games/state` locks the active game row before advancing it.
- The engine uses the persisted `next_call_at` deadline and the 3-second schedule.
- If clients disconnect temporarily, the next state request catches up all elapsed call deadlines in order instead of permanently pausing the game.
- Each call is recorded in `game_calls` with unique `(game_id, call_index)` and `(game_id, number)` constraints.
- The call sequence remains deterministic from the game ID, call index, and creation timestamp.
- A winning call settles immediately; only cards completing on that exact call can share the reward.
- Once settled, `next_call_at` is cleared and no more calls can be generated.

## Reconnect behavior
A client may reload or reconnect and request the current state. The response is authoritative for:
- round status
- called numbers
- current call
- call index
- next call deadline
- picked-card count
- winners

## Manual settlement hardening
The admin settlement endpoint remains available for authorized game management, but V45 requires:
- the game is running
- the submitted cards belong to the game
- every submitted card satisfies a real winning pattern using the server's called-number set
- only 1 or 2 unique winner cards are accepted

## Database migration
Run `db/migration-v45.sql` after the V44 migration. It is additive and does not delete existing application data.
