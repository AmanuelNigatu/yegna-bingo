-- V48: one authoritative global Bingo round.
-- Close legacy duplicate active rounds, then prevent a second active round at DB level.
UPDATE games
SET status = 'settled',
    settled_at = COALESCE(settled_at, NOW()),
    next_call_at = NULL,
    ended_reason = COALESCE(ended_reason, 'superseded_by_global_round')
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS rn
    FROM games
    WHERE status IN ('picking','running')
  ) x WHERE x.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS games_single_global_active_idx
  ON games ((1))
  WHERE status IN ('picking','running');
