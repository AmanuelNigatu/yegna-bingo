-- YEGNA BINGO V42 — Telegram Bot persistent conversation state
CREATE TABLE IF NOT EXISTS bot_conversations (
  telegram_id BIGINT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('deposit','withdrawal')),
  step TEXT NOT NULL CHECK (step IN ('amount','detail','confirm')),
  amount NUMERIC(14,2),
  detail TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bot_conversations_updated_idx ON bot_conversations(updated_at);
