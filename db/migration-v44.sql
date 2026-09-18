-- YEGNA BINGO V44 — Server-side game engine
-- Safe additive migration. Existing game/wallet data is preserved.
ALTER TABLE games ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE games ADD COLUMN IF NOT EXISTS next_call_at TIMESTAMPTZ;
ALTER TABLE games ADD COLUMN IF NOT EXISTS called_numbers JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE games ADD COLUMN IF NOT EXISTS current_call INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS call_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN IF NOT EXISTS winner_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS games_running_next_call_idx ON games(status,next_call_at) WHERE status='running';
