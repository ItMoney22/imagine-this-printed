-- ============================================================================
-- Referral reward, option C: worth sharing, still paid only on a real order
-- ============================================================================
-- Watchtower task 4cebbf83 (dr-dill, 2026-10-07, Nine's gate). Builds on
-- 20261007210000_referral_attribution.sql (task bdfa6939), which shipped the
-- safe option A: sign-up pays nothing, referrer gets 50 ITC ($0.50) on the
-- friend's first paid order, friend gets nothing. $0.50 moves nobody to share.
--
-- Option C, as decided:
--   * REFERRER: 500 ITC ($5 store credit) when the friend's first order with
--     at least $15 of products (after discounts) is paid. Lifetime-once per
--     friend (idx_referral_transactions_one_purchase_per_referee). The $15
--     floor exists because live catalog items start at $3.07: without it a
--     throwaway account could buy a $3 item and mint $5 of credit.
--   * FRIEND: a personal 10%-off code for their first order, minted when the
--     link is recorded at their first sign-in, valid 30 days, one use. It is
--     bound to the friend's account (metadata.owner_user_id) and to a first
--     order (metadata.first_order_only); the API enforces both at checkout
--     (backend/shared/coupon-owner.ts). discount_codes has RLS on and no
--     policies, so the public key cannot list codes.
--   * SIGN-UP STILL PAYS NOTHING. The four v_* sign-up amounts stay 0: bot
--     sign-ups (152 marked on 10/7) could farm anything paid on sign-up.
--   * One coupon per order: checkout takes a single code, so the welcome code
--     never stacks with another code (ETSYBAG, THANKS10-..., a future
--     seasonal code). Automatic price rules (bundles, youth sizes) still apply.
--
-- The amounts live HERE. src/lib/referral-program.ts mirrors them for display
-- and backend/utils/reward-calculator.ts REFERRAL_CONFIG mirrors the referrer
-- amount. Change these, change those.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.process_referral_reward(
  p_referral_code character varying,
  p_referee_id uuid,
  p_referee_email character varying,
  p_reward_type character varying
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Sign-up pays nothing (tasks bdfa6939 + 4cebbf83): bots could farm it.
  v_referrer_points INTEGER := 0;
  v_referrer_itc NUMERIC := 0;
  v_referee_points INTEGER := 0;
  v_referee_itc NUMERIC := 0;
  -- The friend's welcome code (task 4cebbf83). Mirrored in
  -- src/lib/referral-program.ts REFERRAL_REWARDS.friend.
  v_welcome_percent INTEGER := 10;
  v_welcome_days INTEGER := 30;
  -- No I/O/0/1: these get read off a phone and typed by hand.
  c_alphabet CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_welcome_code TEXT;
  v_welcome_expires TIMESTAMP;
  v_suffix TEXT;
  v_bytes BYTEA;
  v_code_record RECORD;
  v_existing RECORD;
  v_transaction_id UUID;
BEGIN
  IF p_reward_type IS DISTINCT FROM 'signup' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unsupported referral reward type', 'reason', 'bad_type');
  END IF;

  -- Lock the code row so total_uses / max_uses cannot be raced past.
  SELECT * INTO v_code_record
  FROM referral_codes
  WHERE code = UPPER(p_referral_code)
    AND is_active = true
    AND (max_uses IS NULL OR total_uses < max_uses)
    AND (expires_at IS NULL OR expires_at > NOW())
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired referral code', 'reason', 'invalid_code');
  END IF;

  IF v_code_record.user_id = p_referee_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cannot use your own referral code', 'reason', 'own_code');
  END IF;

  -- Already referred? The same link again is a no-op; a different one is refused.
  SELECT * INTO v_existing
  FROM referral_transactions
  WHERE referee_id = p_referee_id AND type = 'signup'
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.referral_code_id = v_code_record.id THEN
      RETURN jsonb_build_object('success', true, 'already', true, 'transaction_id', v_existing.id,
                                'referrer_id', v_existing.referrer_id,
                                'welcome_code', v_existing.metadata->>'welcome_code');
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'This account already joined through another referral link',
                              'reason', 'already_referred');
  END IF;

  INSERT INTO referral_transactions (
    referral_code_id, referrer_id, referee_id, referee_email, type,
    referrer_reward_points, referrer_reward_itc, referee_reward_points,
    referee_reward_itc, status, completed_at
  ) VALUES (
    v_code_record.id, v_code_record.user_id, p_referee_id, COALESCE(p_referee_email, ''), 'signup',
    v_referrer_points, v_referrer_itc, v_referee_points, v_referee_itc, 'completed', NOW()
  )
  ON CONFLICT (referee_id) WHERE ((type)::text = 'signup'::text) DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NULL THEN
    -- A concurrent call recorded it first.
    RETURN jsonb_build_object('success', true, 'already', true, 'referrer_id', v_code_record.user_id);
  END IF;

  UPDATE user_profiles
  SET referred_by = v_code_record.user_id
  WHERE id = p_referee_id AND referred_by IS NULL;

  -- discount_codes.expires_at is timestamp WITHOUT time zone holding UTC wall
  -- time (the API writes ISO strings into it, see delivery-coupon.ts).
  v_welcome_expires := (NOW() AT TIME ZONE 'utc') + make_interval(days => v_welcome_days);
  FOR attempt IN 1..5 LOOP
    v_bytes := extensions.gen_random_bytes(6);
    v_suffix := '';
    FOR k IN 0..5 LOOP
      v_suffix := v_suffix || substr(c_alphabet, (get_byte(v_bytes, k) % 32) + 1, 1);
    END LOOP;
    v_welcome_code := 'WELCOME' || v_welcome_percent || '-' || v_suffix;
    BEGIN
      INSERT INTO discount_codes (
        code, type, value, description, max_uses, current_uses, per_user_limit,
        min_order_amount, applies_to, is_active, expires_at, metadata
      ) VALUES (
        v_welcome_code, 'percentage', v_welcome_percent,
        'Welcome ' || v_welcome_percent || '% off a first order (joined through a friend''s link)',
        1, 0, 1, 0, 'usd', true, v_welcome_expires,
        jsonb_build_object('source', 'referral_welcome',
                           'owner_user_id', p_referee_id,
                           'first_order_only', true,
                           'referral_transaction_id', v_transaction_id,
                           'referrer_id', v_code_record.user_id)
      );
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_welcome_code := NULL;
    END;
  END LOOP;

  IF v_welcome_code IS NOT NULL THEN
    UPDATE referral_transactions
    SET metadata = COALESCE(metadata, '{}'::jsonb)
                   || jsonb_build_object('welcome_code', v_welcome_code, 'welcome_percent', v_welcome_percent)
    WHERE id = v_transaction_id;
  END IF;

  UPDATE referral_codes
  SET total_uses = COALESCE(total_uses, 0) + 1, updated_at = NOW()
  WHERE id = v_code_record.id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'referrer_id', v_code_record.user_id,
    'referrer_rewards', jsonb_build_object('points', v_referrer_points, 'itc', v_referrer_itc),
    'referee_rewards', jsonb_build_object('points', v_referee_points, 'itc', v_referee_itc),
    'welcome_code', v_welcome_code,
    'welcome_percent', v_welcome_percent,
    'welcome_expires_at', v_welcome_expires
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$function$;

-- The referrer's bonus when a referred friend's first qualifying order is paid.
-- Lifetime-once per referee (idx_referral_transactions_one_purchase_per_referee).
-- Pays only on a recorded 'signup' referral, never on a bare referred_by: the
-- referee can edit their own profile row, the signup row they cannot write.
-- The order must be the referee's own, paid, and carry at least
-- v_min_products_usd of products after discounts; a smaller order pays
-- nothing and leaves the bonus for a later order that qualifies.
-- related_order_id records which order earned it, so a refund of THAT order
-- reverses it (backend/services/order-refunds.ts reverseReferralBonus).
CREATE OR REPLACE FUNCTION public.award_referral_first_order(
  p_referee_id uuid,
  p_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- The one place the referrer's bonus lives (task 4cebbf83, option C).
  -- Mirrored for display in src/lib/referral-program.ts
  -- (REFERRAL_REWARDS.firstOrder.referrerItc / minProductsUsd).
  v_bonus_itc NUMERIC := 500;
  v_min_products_usd NUMERIC := 15;
  v_signup RECORD;
  v_order RECORD;
  v_products_paid NUMERIC;
  v_transaction_id UUID;
  v_itc_after NUMERIC;
BEGIN
  SELECT * INTO v_signup
  FROM referral_transactions
  WHERE referee_id = p_referee_id AND type = 'signup' AND status = 'completed'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'User was not referred', 'reason', 'not_referred');
  END IF;

  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'No order given', 'reason', 'no_order');
  END IF;

  SELECT id, user_id, payment_status, subtotal, discount_amount INTO v_order
  FROM orders WHERE id = p_order_id;

  IF NOT FOUND OR v_order.user_id IS DISTINCT FROM p_referee_id THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order does not belong to this account', 'reason', 'not_their_order');
  END IF;

  IF v_order.payment_status IS DISTINCT FROM 'paid' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order is not paid', 'reason', 'not_paid');
  END IF;

  v_products_paid := COALESCE(v_order.subtotal, 0) - COALESCE(v_order.discount_amount, 0);
  IF v_products_paid < v_min_products_usd THEN
    RETURN jsonb_build_object('success', false, 'message', 'Order is below the referral minimum',
                              'reason', 'below_minimum', 'products_paid', v_products_paid,
                              'minimum', v_min_products_usd);
  END IF;

  INSERT INTO referral_transactions (
    referral_code_id, referrer_id, referee_id, referee_email, type,
    referrer_reward_points, referrer_reward_itc, referee_reward_points,
    referee_reward_itc, status, related_order_id, completed_at
  ) VALUES (
    v_signup.referral_code_id, v_signup.referrer_id, p_referee_id, COALESCE(v_signup.referee_email, ''), 'purchase',
    0, v_bonus_itc, 0, 0, 'completed', p_order_id, NOW()
  )
  ON CONFLICT (referee_id) WHERE ((type)::text = 'purchase'::text) DO NOTHING
  RETURNING id INTO v_transaction_id;

  IF v_transaction_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'First purchase bonus already awarded', 'reason', 'already_awarded');
  END IF;

  SELECT COALESCE(itc_balance, 0) INTO v_itc_after
  FROM user_wallets WHERE user_id = v_signup.referrer_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO user_wallets (user_id, points, itc_balance)
    VALUES (v_signup.referrer_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;
    v_itc_after := 0;
  END IF;
  v_itc_after := COALESCE(v_itc_after, 0) + v_bonus_itc;

  -- Same ledger shape the JS path wrote, so reverseReferralBonus() and the
  -- wallet history read it unchanged.
  INSERT INTO itc_transactions (user_id, type, amount, balance_after, reference, metadata)
  VALUES (v_signup.referrer_id, 'earned', v_bonus_itc, v_itc_after,
          'referral:' || v_transaction_id::text,
          jsonb_build_object('source', 'referral', 'reason', 'Referral first purchase bonus',
                             'related_entity_type', 'referral',
                             'related_entity_id', v_transaction_id,
                             'order_id', p_order_id));

  UPDATE user_wallets
  SET itc_balance = v_itc_after, updated_at = NOW()
  WHERE user_id = v_signup.referrer_id;

  UPDATE referral_codes
  SET total_earnings = COALESCE(total_earnings, 0) + v_bonus_itc, updated_at = NOW()
  WHERE id = v_signup.referral_code_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'referrer_id', v_signup.referrer_id,
    'bonus_itc', v_bonus_itc
  );
END;
$function$;

-- Service role only (CREATE OR REPLACE keeps the grants; restated so this file
-- is safe on its own). PUBLIC is revoked explicitly because Postgres grants
-- EXECUTE to PUBLIC by default on every new function.
REVOKE ALL ON FUNCTION public.process_referral_reward(character varying, uuid, character varying, character varying) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_reward(character varying, uuid, character varying, character varying) TO service_role;

REVOKE ALL ON FUNCTION public.award_referral_first_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_first_order(uuid, uuid) TO service_role;

COMMIT;
