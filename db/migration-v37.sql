-- V37: Deposit / Withdraw approval workflow
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
