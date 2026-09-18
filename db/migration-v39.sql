-- V39: secure Telegram identity + atomic wallet ledger/request workflow
-- Safe to run after V37/V38. Existing data is preserved.
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('deposit','withdrawal','withdrawal_hold','withdrawal_refund','stake','stake_refund','win_reward','admin_credit','admin_debit'));

CREATE UNIQUE INDEX IF NOT EXISTS wallet_requests_reference_id_uidx
  ON wallet_requests(reference_id);

CREATE INDEX IF NOT EXISTS users_telegram_id_idx ON users(telegram_id);
CREATE INDEX IF NOT EXISTS wallet_transactions_reference_idx ON wallet_transactions(reference_id);

-- V39 withdrawal policy: withdrawal requests reserve available wallet balance
-- immediately using a withdrawal_hold ledger entry. Approval finalizes the
-- request without a second deduction; rejection creates withdrawal_refund.

ALTER TABLE games ADD COLUMN IF NOT EXISTS game_type INTEGER NOT NULL DEFAULT 1;
ALTER TABLE games ADD COLUMN IF NOT EXISTS pick_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS games_type_status_idx ON games(game_type,status,created_at DESC);
