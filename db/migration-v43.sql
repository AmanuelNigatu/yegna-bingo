-- YEGNA BINGO V43 — Production routing + database foundation
-- Safe to run after V42. Existing data is preserved.
--
-- 1) The bot conversation table is now also part of the canonical schema.
-- 2) The Netlify route order is corrected in netlify.toml so /api/bot/*
--    reaches the bot function instead of the general API function.
-- 3) No game, wallet, UI, or reward behavior is changed by this migration.

CREATE TABLE IF NOT EXISTS bot_conversations (
  telegram_id BIGINT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('deposit','withdrawal')),
  step TEXT NOT NULL CHECK (step IN ('amount','detail','confirm')),
  amount NUMERIC(14,2),
  detail TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_conversations_updated_idx
  ON bot_conversations(updated_at);
