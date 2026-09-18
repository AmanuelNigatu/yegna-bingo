-- V41 secure server sessions + one-time Telegram initData replay protection
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS telegram_auth_replays (
  payload_hash TEXT PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS telegram_auth_replays_created_idx ON telegram_auth_replays(created_at);

-- Optional housekeeping can safely remove old replay records after the maximum
-- Telegram initData age, e.g. DELETE FROM telegram_auth_replays WHERE created_at < NOW() - INTERVAL '2 hours';
