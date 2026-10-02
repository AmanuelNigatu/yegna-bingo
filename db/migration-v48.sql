-- YEGNA BINGO V48 — Global game lookup hardening
-- Additive only. Existing users, wallets, games and transactions are preserved.
-- This migration only adds indexes used by the server-authoritative global
-- round endpoints. It does not alter or delete existing game rows.
CREATE INDEX IF NOT EXISTS games_active_global_lookup_idx
  ON games(status, created_at DESC)
  WHERE status IN ('picking','running');

CREATE INDEX IF NOT EXISTS game_cards_game_card_lookup_idx
  ON game_cards(game_id, card_number, user_id);
