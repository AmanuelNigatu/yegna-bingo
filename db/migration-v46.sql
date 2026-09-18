-- YEGNA BINGO V46 — Production game lifecycle & recovery hardening
-- Additive migration only. Existing rounds and wallet data are preserved.
ALTER TABLE games ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE games ADD COLUMN IF NOT EXISTS ended_reason TEXT;

UPDATE games
SET last_activity_at = COALESCE(last_activity_at, started_at, pick_started_at, created_at)
WHERE last_activity_at IS NULL;

CREATE INDEX IF NOT EXISTS games_recovery_idx
  ON games(status, next_call_at)
  WHERE status IN ('picking','running');
