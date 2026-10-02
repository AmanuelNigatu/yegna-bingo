CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','sub_admin','super_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);



CREATE TABLE IF NOT EXISTS sub_admin_permissions (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);

CREATE TABLE IF NOT EXISTS wallets (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','withdrawal_hold','withdrawal_refund','stake','stake_refund','win_reward','admin_credit','admin_debit')),
  amount NUMERIC(14,2) NOT NULL,
  balance_after NUMERIC(14,2) NOT NULL,
  reference_id TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(type, reference_id, user_id)
);

CREATE INDEX IF NOT EXISTS wallet_transactions_user_created_idx
  ON wallet_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  game_type INTEGER NOT NULL DEFAULT 1 CHECK (game_type IN (1,2)),
  stake NUMERIC(14,2) NOT NULL DEFAULT 10,
  reward_rate NUMERIC(5,2) NOT NULL DEFAULT 85,
  status TEXT NOT NULL DEFAULT 'picking' CHECK (status IN ('picking','running','settled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pick_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  next_call_at TIMESTAMPTZ,
  called_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_call INTEGER,
  call_index INTEGER NOT NULL DEFAULT 0,
  winner_count INTEGER NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ,
  ended_reason TEXT,
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS games_type_status_idx ON games(game_type,status,created_at DESC);

CREATE TABLE IF NOT EXISTS game_cards (
  id BIGSERIAL PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_number INTEGER NOT NULL CHECK (card_number BETWEEN 1 AND 600),
  stake_transaction_id BIGINT REFERENCES wallet_transactions(id),
  UNIQUE(game_id, card_number),
  UNIQUE(game_id, user_id, card_number)
);

CREATE TABLE IF NOT EXISTS game_winners (
  id BIGSERIAL PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_number INTEGER NOT NULL,
  reward_amount NUMERIC(14,2) NOT NULL,
  split_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(game_id, card_number)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings(key, value) VALUES ('reward_rate', '85')
ON CONFLICT (key) DO NOTHING;


CREATE TABLE IF NOT EXISTS wallet_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit','withdrawal')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reference_id TEXT NOT NULL UNIQUE,
  method TEXT,
  detail TEXT,
  rejection_reason TEXT,
  reviewed_by BIGINT REFERENCES users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS wallet_requests_status_type_idx ON wallet_requests(status, type, requested_at DESC);
CREATE INDEX IF NOT EXISTS wallet_requests_user_idx ON wallet_requests(user_id, requested_at DESC);


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
