-- YEGNA BINGO V48 — one global active round + legacy round consolidation
-- The production database may already contain multiple V44-V47 rounds because
-- earlier builds partitioned games by game_type. Keep the newest active round,
-- refund cards from older active rounds, then enforce exactly one active round.

DO $$
DECLARE
  keep_id TEXT;
  old_game RECORD;
  card RECORD;
  refund_amount NUMERIC(14,2);
  next_balance NUMERIC(14,2);
BEGIN
  SELECT id INTO keep_id
  FROM games
  WHERE status IN ('picking','running')
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF keep_id IS NOT NULL THEN
    FOR old_game IN
      SELECT id
      FROM games
      WHERE status IN ('picking','running') AND id <> keep_id
      ORDER BY created_at, id
    LOOP
      FOR card IN
        SELECT gc.id, gc.user_id, gc.card_number, COALESCE(g.stake, 10)::numeric(14,2) AS stake
        FROM game_cards gc
        JOIN games g ON g.id = gc.game_id
        WHERE gc.game_id = old_game.id
      LOOP
        refund_amount := card.stake;
        IF NOT EXISTS (
          SELECT 1 FROM wallet_transactions
          WHERE user_id = card.user_id
            AND type = 'stake_refund'
            AND reference_id = 'global-consolidation-refund-' || old_game.id || '-' || card.card_number
        ) THEN
          SELECT balance INTO next_balance
          FROM wallets
          WHERE user_id = card.user_id
          FOR UPDATE;

          IF next_balance IS NOT NULL THEN
            next_balance := next_balance + refund_amount;
            INSERT INTO wallet_transactions(user_id,type,amount,balance_after,reference_id,detail)
            VALUES(
              card.user_id,
              'stake_refund',
              refund_amount,
              next_balance,
              'global-consolidation-refund-' || old_game.id || '-' || card.card_number,
              'Automatic refund: obsolete per-game round consolidated into global round'
            );
            UPDATE wallets SET balance = next_balance, updated_at = NOW()
            WHERE user_id = card.user_id;
          END IF;
        END IF;
      END LOOP;

      DELETE FROM game_cards WHERE game_id = old_game.id;
      UPDATE games
      SET status='settled', settled_at=COALESCE(settled_at,NOW()), next_call_at=NULL,
          ended_reason='global_round_consolidation'
      WHERE id = old_game.id;
    END LOOP;
  END IF;
END $$;

-- Exactly one picking/running round may exist, regardless of game_type.
CREATE UNIQUE INDEX IF NOT EXISTS games_one_global_active_idx
  ON games ((1))
  WHERE status IN ('picking','running');

CREATE INDEX IF NOT EXISTS games_global_created_idx
  ON games(created_at DESC);
