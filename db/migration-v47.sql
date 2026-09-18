-- YEGNA BINGO V47 — Production concurrency & retry hardening
-- Additive only. No existing users, wallets, games or transaction rows are removed.

-- Faster lookup for a player's cards inside a busy round.
CREATE INDEX IF NOT EXISTS game_cards_game_user_idx
  ON game_cards(game_id, user_id);

-- Faster lookup for idempotent wallet operations by authenticated user.
CREATE INDEX IF NOT EXISTS wallet_transactions_user_type_reference_idx
  ON wallet_transactions(user_id, type, reference_id);

-- Keep game-call reads efficient while many clients reconnect simultaneously.
CREATE INDEX IF NOT EXISTS game_calls_game_number_idx
  ON game_calls(game_id, number);
