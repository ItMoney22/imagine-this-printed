-- Restore the order-reward + referral RPCs against the REAL live schema.
--
-- Watchtower task e9034a97-90f2-4759-98f1-b4d235448743 (follow-up to 85de5f13,
-- the itc_transactions/user_wallets drift fix).
--
-- ============================================================================
-- WHAT THE LIVE DATABASE ACTUALLY LOOKS LIKE (queried directly, 2026-07-27,
-- project czzyrmizvjqlifcivrhn, via DATABASE_URL / the session pooler)
-- ============================================================================
-- The premise of the task was that award_order_rewards() exists in production
-- with a drifted body. It does not. The real finding is worse and simpler:
--
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('award_order_rewards','process_referral_reward');   -->  0 rows
--
-- migrations/006_reward_system.sql was NEVER APPLIED to production. Nothing it
-- declares exists live except the two tables that predate it (points_transactions
-- and itc_transactions, both from 001_initial_schema.sql):
--
--   order_rewards           MISSING     referral_codes          MISSING
--   referral_transactions   MISSING     user_total_spend (view) MISSING
--   award_order_rewards()   MISSING     process_referral_reward() MISSING
--   user_profiles.referred_by           MISSING
--
-- Consequence: backend/services/order-reward-service.ts calls
-- supabase.rpc('award_order_rewards', ...), PostgREST answers PGRST202
-- ("function not found in schema cache"), the service throws, and its catch
-- block tries to record the failure by INSERTing into order_rewards -- a table
-- that also does not exist, so the failure record silently fails too. Every
-- order reward has been a total no-op leaving zero trace anywhere but the
-- backend log. Same story for process_referral_reward() via
-- backend/services/referral-service.ts.
--
-- ============================================================================
-- TWO CLAIMS IN THE TASK BRIEF THAT THE LIVE DATABASE CONTRADICTS
-- ============================================================================
-- 1. "user_wallets.points is really points_balance live."  FALSE. Live
--    user_wallets is (id, user_id, points, itc_balance, created_at, updated_at,
--    usd_balance, total_earned, total_spent). `points` is correct as declared;
--    there is no points_balance column and no drift to fix there.
--
-- 2. Only itc_transactions was thought to be drifted. In fact
--    points_transactions is drifted TOO, and worse -- a third drift nobody had
--    catalogued. Live shape:
--        points_transactions(id, user_id, points_change NOT NULL, reason,
--                            reference, balance_after, metadata jsonb, created_at)
--    006 inserts (type, amount, reason, related_entity_type, related_entity_id).
--    Four of those five columns do not exist live, and live's mandatory
--    points_change is absent from the declaration entirely. So even if 006 had
--    been applied, the points half of the award would have failed as well.
--
-- Verified live column lists this file is written against:
--   itc_transactions   (id, user_id, type, amount, reference, balance_after,
--                       metadata jsonb, created_at)   -- no CHECK on `type`
--   points_transactions(id, user_id, points_change, reason, reference,
--                       balance_after, metadata jsonb, created_at)
--   user_wallets       (id, user_id, points, itc_balance, created_at,
--                       updated_at, usd_balance, total_earned, total_spent)
--   orders             (..., user_id -> user_profiles(id), total, status, ...)
--   user_profiles.id = auth.users.id (verified: 5/5 rows join)
--
-- ============================================================================
-- BLAST RADIUS OF THE OUTAGE (measured, not estimated)
-- ============================================================================
--   orders total .......................... 3   (all status='processing',
--                                                payment_status='paid',
--                                                $9.41 gross, Dec 2025)
--   orders in a reward-eligible status .... 0   ('delivered'/'completed'/'shipped')
--   distinct users owed a reward .......... 0
--   ITC never paid out .................... 0.00
-- No back-fill is required. The bug is real and total, but it has not cost a
-- single customer a single token yet, because no order has ever reached a
-- completing status and the paid-webhook call site
-- (backend/routes/stripe.ts:893) was only wired up on 2026-07-27, after those
-- three orders. This migration closes the hole before the first real payout.
--
-- ============================================================================
-- WHY A NEW FILE
-- ============================================================================
-- Same convention as supabase/migrations/20260727_fix_itc_wallet_schema_drift.sql
-- and 004_schema_fixes.sql / 005_rls_fixes.sql: layer forward, never rewrite an
-- applied migration. migrations/006_reward_system.sql is left on disk as the
-- historical record of intent and is marked SUPERSEDED -- DO NOT APPLY in its
-- header, because applying it now would CREATE OR REPLACE these functions back
-- into their broken form. supabase/reward-function-drift.test.ts enforces both
-- halves of that.
--
-- Every statement below is IF NOT EXISTS / OR REPLACE guarded and additive.

BEGIN;

-- ===================================================
-- 1. user_profiles.referred_by
-- ===================================================
-- referral_code already exists live; referred_by does not, and
-- backend/services/referral-service.ts:221 selects it.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_referred_by ON user_profiles(referred_by);

-- ===================================================
-- 2. referral_codes / referral_transactions
-- ===================================================
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  total_uses INTEGER DEFAULT 0,
  total_earnings NUMERIC(10, 2) DEFAULT 0,
  max_uses INTEGER,
  expires_at TIMESTAMPTZ,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_user_id ON referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);

CREATE TABLE IF NOT EXISTS referral_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id UUID NOT NULL REFERENCES referral_codes(id) ON DELETE CASCADE,
  referrer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_email VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('signup', 'purchase', 'milestone')),
  referrer_reward_points INTEGER DEFAULT 0,
  referrer_reward_itc NUMERIC(10, 2) DEFAULT 0,
  referee_reward_points INTEGER DEFAULT 0,
  referee_reward_itc NUMERIC(10, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  related_order_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  failed_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_referral_transactions_referrer ON referral_transactions(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_transactions_referee ON referral_transactions(referee_id);
-- One first-purchase bonus per referee, enforced by the database rather than by
-- referral-service.ts's read-then-write check (which two concurrent paid
-- webhooks can both pass).
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_transactions_one_purchase_per_referee
  ON referral_transactions(referee_id) WHERE type = 'purchase';

-- ===================================================
-- 3. order_rewards
-- ===================================================
CREATE TABLE IF NOT EXISTS order_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_total NUMERIC(10, 2) NOT NULL,
  user_tier VARCHAR(20) DEFAULT 'bronze',
  base_points INTEGER NOT NULL DEFAULT 0,
  tier_bonus_points INTEGER DEFAULT 0,
  promo_bonus_points INTEGER DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  itc_bonus NUMERIC(10, 2) DEFAULT 0,
  promo_multiplier NUMERIC(4, 2) DEFAULT 1.0,
  is_first_purchase BOOLEAN DEFAULT false,
  points_transaction_id UUID REFERENCES points_transactions(id),
  itc_transaction_id UUID REFERENCES itc_transactions(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'awarded', 'failed', 'reversed')),
  awarded_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- base_points/total_points get DEFAULT 0 (006 declared them bare NOT NULL):
-- order-reward-service.ts's catch block inserts a status='failed' row supplying
-- neither column, so without a default the failure record itself would fail --
-- exactly the "swallowed insert" pattern this whole line of work exists to kill.
CREATE INDEX IF NOT EXISTS idx_order_rewards_user_id ON order_rewards(user_id);
CREATE INDEX IF NOT EXISTS idx_order_rewards_status ON order_rewards(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_rewards_unique_order ON order_rewards(order_id);

-- ===================================================
-- 4. RLS
-- ===================================================
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_rewards ENABLE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='order_rewards' AND policyname='Users can view their own order rewards') THEN
    CREATE POLICY "Users can view their own order rewards" ON order_rewards FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referral_codes' AND policyname='Users can view their own referral codes') THEN
    CREATE POLICY "Users can view their own referral codes" ON referral_codes FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referral_transactions' AND policyname='Users can view their referral transactions') THEN
    CREATE POLICY "Users can view their referral transactions" ON referral_transactions FOR SELECT
      USING (auth.uid() = referrer_id OR auth.uid() = referee_id);
  END IF;
END
$policies$;

-- ===================================================
-- 5. user_total_spend view (tier input)
-- ===================================================
CREATE OR REPLACE VIEW user_total_spend AS
SELECT
  user_id,
  COUNT(*) AS total_orders,
  SUM(total) AS total_spent,
  MAX(created_at) AS last_order_date,
  MIN(created_at) AS first_order_date
FROM orders
WHERE status IN ('delivered', 'completed', 'shipped')
GROUP BY user_id;

-- ===================================================
-- 6. award_order_rewards() -- live-shape rewrite
-- ===================================================
CREATE OR REPLACE FUNCTION award_order_rewards(
  p_order_id UUID,
  p_user_id UUID,
  p_order_total NUMERIC,
  p_promo_multiplier NUMERIC DEFAULT 1.0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_tier VARCHAR(20);
  v_total_spent NUMERIC;
  v_is_first_purchase BOOLEAN;
  v_base_points INTEGER;
  v_tier_multiplier NUMERIC;
  v_tier_bonus INTEGER;
  v_promo_bonus INTEGER;
  v_total_points INTEGER;
  v_itc_bonus NUMERIC;
  v_points_tx_id UUID;
  v_itc_tx_id UUID;
  v_current_points INTEGER;
  v_current_itc NUMERIC;
  v_reward_id UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_user_id is required');
  END IF;

  -- Idempotency. Returned as a structured result rather than RAISEd: the old
  -- version raised, which the catch-all handler at the bottom turned into an
  -- indistinguishable generic failure.
  IF EXISTS (SELECT 1 FROM order_rewards WHERE order_id = p_order_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rewards already awarded for this order');
  END IF;

  -- Tier input. A user's FIRST order is not in user_total_spend at all, so the
  -- SELECT finds no row and both variables stay NULL -- in the old body that
  -- silently cost every genuine first-time buyer their 50% first-purchase
  -- bonus, because `IF NULL THEN` takes the ELSE branch. COALESCE fixes it.
  SELECT COALESCE(total_spent, 0), COALESCE(total_orders, 0) = 0
    INTO v_total_spent, v_is_first_purchase
  FROM user_total_spend WHERE user_id = p_user_id;

  v_total_spent := COALESCE(v_total_spent, 0);
  v_is_first_purchase := COALESCE(v_is_first_purchase, true);
  p_order_total := COALESCE(p_order_total, 0);
  p_promo_multiplier := COALESCE(p_promo_multiplier, 1.0);

  IF v_total_spent >= 10000 THEN
    v_user_tier := 'platinum'; v_tier_multiplier := 2.0;  v_itc_bonus := p_order_total * 0.02;
  ELSIF v_total_spent >= 2000 THEN
    v_user_tier := 'gold';     v_tier_multiplier := 1.5;  v_itc_bonus := p_order_total * 0.01;
  ELSIF v_total_spent >= 500 THEN
    v_user_tier := 'silver';   v_tier_multiplier := 1.25; v_itc_bonus := p_order_total * 0.005;
  ELSE
    v_user_tier := 'bronze';   v_tier_multiplier := 1.0;  v_itc_bonus := 0;
  END IF;

  v_base_points  := FLOOR(p_order_total * 100);
  v_tier_bonus   := FLOOR(v_base_points * (v_tier_multiplier - 1));
  v_promo_bonus  := FLOOR(v_base_points * (p_promo_multiplier - 1));
  IF v_is_first_purchase THEN
    v_promo_bonus := v_promo_bonus + FLOOR(v_base_points * 0.5);
  END IF;
  v_total_points := v_base_points + v_tier_bonus + v_promo_bonus;
  v_itc_bonus    := ROUND(v_itc_bonus, 2);

  -- Lock the wallet row for the read-modify-write below. Without this, two
  -- concurrent awards both read the same starting balance and write ledger
  -- rows whose balance_after disagrees with the wallet -- the precise
  -- divergence the June ITC incident produced.
  SELECT points, itc_balance INTO v_current_points, v_current_itc
  FROM user_wallets WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO user_wallets (user_id, points, itc_balance)
    VALUES (p_user_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT points, itc_balance INTO v_current_points, v_current_itc
    FROM user_wallets WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  v_current_points := COALESCE(v_current_points, 0);
  v_current_itc    := COALESCE(v_current_itc, 0);

  -- Points ledger. LIVE columns only: points_change (NOT NULL), reason,
  -- reference, balance_after, metadata. The old body wrote type/amount/
  -- related_entity_type/related_entity_id -- none of which exist.
  INSERT INTO points_transactions (
    user_id, points_change, reason, reference, balance_after, metadata
  ) VALUES (
    p_user_id,
    v_total_points,
    'Order completion reward',
    'order:' || p_order_id::text,
    v_current_points + v_total_points,
    jsonb_build_object(
      'type', 'earned',
      'related_entity_type', 'order',
      'related_entity_id', p_order_id,
      'tier', v_user_tier,
      'base_points', v_base_points,
      'tier_bonus', v_tier_bonus,
      'promo_bonus', v_promo_bonus,
      'is_first_purchase', v_is_first_purchase
    )
  ) RETURNING id INTO v_points_tx_id;

  -- ITC ledger. LIVE columns only: type, amount, balance_after, reference,
  -- metadata. The old body wrote usd_value/reason/related_entity_type/
  -- related_entity_id -- none of which exist. Everything that used to live in
  -- those columns is preserved inside metadata, matching the convention commit
  -- 6299315 established across all 13 application-side call sites.
  IF v_itc_bonus > 0 THEN
    INSERT INTO itc_transactions (
      user_id, type, amount, balance_after, reference, metadata
    ) VALUES (
      p_user_id,
      'reward',
      v_itc_bonus,
      v_current_itc + v_itc_bonus,
      'order:' || p_order_id::text,
      jsonb_build_object(
        'source', 'order_reward',
        'reason', 'Order completion ITC bonus',
        'related_entity_type', 'order',
        'related_entity_id', p_order_id,
        'usd_value', p_order_total,
        'tier', v_user_tier
      )
    ) RETURNING id INTO v_itc_tx_id;
  END IF;

  UPDATE user_wallets
  SET points = COALESCE(points, 0) + v_total_points,
      itc_balance = COALESCE(itc_balance, 0) + v_itc_bonus,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO order_rewards (
    order_id, user_id, order_total, user_tier, base_points, tier_bonus_points,
    promo_bonus_points, total_points, itc_bonus, promo_multiplier,
    is_first_purchase, points_transaction_id, itc_transaction_id, status, awarded_at
  ) VALUES (
    p_order_id, p_user_id, p_order_total, v_user_tier, v_base_points, v_tier_bonus,
    v_promo_bonus, v_total_points, v_itc_bonus, p_promo_multiplier,
    v_is_first_purchase, v_points_tx_id, v_itc_tx_id, 'awarded', NOW()
  ) RETURNING id INTO v_reward_id;

  RETURN jsonb_build_object(
    'success', true,
    'reward_id', v_reward_id,
    'points_awarded', v_total_points,
    'itc_awarded', v_itc_bonus,
    'tier', v_user_tier,
    'is_first_purchase', v_is_first_purchase
  );

EXCEPTION WHEN OTHERS THEN
  -- Kept deliberately: the only caller of consequence is the Stripe paid
  -- webhook, which must never fail a settled payment over a reward problem.
  -- SQLSTATE is now included so a future failure is diagnosable from the
  -- returned payload instead of only from the backend log.
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$$;

-- ===================================================
-- 7. process_referral_reward() -- live-shape rewrite
-- ===================================================
CREATE OR REPLACE FUNCTION process_referral_reward(
  p_referral_code VARCHAR,
  p_referee_id UUID,
  p_referee_email VARCHAR,
  p_reward_type VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_record RECORD;
  v_referrer_points INTEGER := 500;
  v_referrer_itc NUMERIC := 5;
  v_referee_points INTEGER := 250;
  v_referee_itc NUMERIC := 2.5;
  v_transaction_id UUID;
  v_referrer_points_after INTEGER;
  v_referrer_itc_after NUMERIC;
  v_referee_points_after INTEGER;
  v_referee_itc_after NUMERIC;
BEGIN
  SELECT * INTO v_code_record
  FROM referral_codes
  WHERE code = p_referral_code
    AND is_active = true
    AND (max_uses IS NULL OR total_uses < max_uses)
    AND (expires_at IS NULL OR expires_at > NOW());

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired referral code');
  END IF;

  IF v_code_record.user_id = p_referee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot use your own referral code');
  END IF;

  INSERT INTO referral_transactions (
    referral_code_id, referrer_id, referee_id, referee_email, type,
    referrer_reward_points, referrer_reward_itc, referee_reward_points,
    referee_reward_itc, status, completed_at
  ) VALUES (
    v_code_record.id, v_code_record.user_id, p_referee_id, p_referee_email, p_reward_type,
    v_referrer_points, v_referrer_itc, v_referee_points, v_referee_itc, 'completed', NOW()
  ) RETURNING id INTO v_transaction_id;

  -- Referrer. Wallets are locked and read BEFORE any ledger row is written, so
  -- balance_after can never be computed from a stale read (the old body
  -- recomputed it inline inside each INSERT ... SELECT with no lock at all).
  SELECT COALESCE(points, 0), COALESCE(itc_balance, 0)
    INTO v_referrer_points_after, v_referrer_itc_after
  FROM user_wallets WHERE user_id = v_code_record.user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO user_wallets (user_id, points, itc_balance)
    VALUES (v_code_record.user_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;
    v_referrer_points_after := 0; v_referrer_itc_after := 0;
  END IF;
  v_referrer_points_after := COALESCE(v_referrer_points_after, 0) + v_referrer_points;
  v_referrer_itc_after    := COALESCE(v_referrer_itc_after, 0) + v_referrer_itc;

  INSERT INTO points_transactions (user_id, points_change, reason, reference, balance_after, metadata)
  VALUES (v_code_record.user_id, v_referrer_points, 'Referral reward',
          'referral:' || v_transaction_id::text, v_referrer_points_after,
          jsonb_build_object('type', 'earned', 'related_entity_type', 'referral',
                             'related_entity_id', v_transaction_id));

  INSERT INTO itc_transactions (user_id, type, amount, balance_after, reference, metadata)
  VALUES (v_code_record.user_id, 'referral', v_referrer_itc, v_referrer_itc_after,
          'referral:' || v_transaction_id::text,
          jsonb_build_object('source', 'referral', 'reason', 'Referral reward',
                             'related_entity_type', 'referral',
                             'related_entity_id', v_transaction_id));

  UPDATE user_wallets
  SET points = v_referrer_points_after, itc_balance = v_referrer_itc_after, updated_at = NOW()
  WHERE user_id = v_code_record.user_id;

  -- Referee welcome bonus.
  SELECT COALESCE(points, 0), COALESCE(itc_balance, 0)
    INTO v_referee_points_after, v_referee_itc_after
  FROM user_wallets WHERE user_id = p_referee_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO user_wallets (user_id, points, itc_balance)
    VALUES (p_referee_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;
    v_referee_points_after := 0; v_referee_itc_after := 0;
  END IF;
  v_referee_points_after := COALESCE(v_referee_points_after, 0) + v_referee_points;
  v_referee_itc_after    := COALESCE(v_referee_itc_after, 0) + v_referee_itc;

  INSERT INTO points_transactions (user_id, points_change, reason, reference, balance_after, metadata)
  VALUES (p_referee_id, v_referee_points, 'Welcome bonus',
          'referral:' || v_transaction_id::text, v_referee_points_after,
          jsonb_build_object('type', 'earned', 'related_entity_type', 'referral',
                             'related_entity_id', v_transaction_id));

  INSERT INTO itc_transactions (user_id, type, amount, balance_after, reference, metadata)
  VALUES (p_referee_id, 'referral', v_referee_itc, v_referee_itc_after,
          'referral:' || v_transaction_id::text,
          jsonb_build_object('source', 'referral', 'reason', 'Welcome bonus',
                             'related_entity_type', 'referral',
                             'related_entity_id', v_transaction_id));

  UPDATE user_wallets
  SET points = v_referee_points_after, itc_balance = v_referee_itc_after, updated_at = NOW()
  WHERE user_id = p_referee_id;

  UPDATE referral_codes
  SET total_uses = COALESCE(total_uses, 0) + 1, updated_at = NOW()
  WHERE id = v_code_record.id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'referrer_rewards', jsonb_build_object('points', v_referrer_points, 'itc', v_referrer_itc),
    'referee_rewards', jsonb_build_object('points', v_referee_points, 'itc', v_referee_itc)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$$;

-- ===================================================
-- 8. Grants
-- ===================================================
GRANT SELECT ON user_total_spend TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION award_order_rewards(UUID, UUID, NUMERIC, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION process_referral_reward(VARCHAR, UUID, VARCHAR, VARCHAR) TO service_role;

COMMENT ON FUNCTION award_order_rewards(UUID, UUID, NUMERIC, NUMERIC) IS
  'Awards points/ITC for a completed order. Writes points_transactions and itc_transactions using the VERIFIED LIVE column shapes only - see supabase/reward-function-drift.test.ts before editing.';
COMMENT ON FUNCTION process_referral_reward(VARCHAR, UUID, VARCHAR, VARCHAR) IS
  'Awards referral rewards to referrer and referee. Writes points_transactions and itc_transactions using the VERIFIED LIVE column shapes only - see supabase/reward-function-drift.test.ts before editing.';

COMMIT;
