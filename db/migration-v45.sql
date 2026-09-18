-- YEGNA BINGO V45 — Multiplayer synchronization & recovery
-- Safe additive migration. Existing users, wallets, games and transactions are preserved.
-- Every authoritative Bingo call gets an immutable, idempotent audit row.
CREATE TABLE IF NOT EXISTS game_calls (
  id BIGSERIAL PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  call_index INTEGER NOT NULL CHECK (call_index >= 0 AND call_index < 75),
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 75),
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(game_id, call_index),
  UNIQUE(game_id, number)
);
CREATE INDEX IF NOT EXISTS game_calls_game_idx ON game_calls(game_id, call_index);
