-- ============================================================================
-- Referral attribution: record the link at sign-in, pay only the first order
-- ============================================================================
-- Watchtower task bdfa6939 (dr-dill, 2026-10-07). Read live first:
-- referral_codes 0 rows, referral_transactions 0 rows, user_profiles.referred_by
-- set on 0 accounts.
--
-- 1. process_referral_reward() was SECURITY DEFINER and EXECUTE-able by PUBLIC,
--    anon and authenticated. Anyone holding the public anon key could call it
--    over PostgREST with any referee id, as often as they liked, and mint
--    500 points + 5 ITC to the code owner each time. Only the zero rows in
--    referral_codes kept that shut. Revoked here; service_role only (the API
--    calls it with the service key).
--
-- 2. Reward model (decision recorded in the bdfa6939 handoff + APPROVE card):
--    SIGN-UP PAYS NOTHING. Bot sign-ups could farm sign-up rewards, so a
--    referral now only RECORDS the link at sign-up (referral_transactions
--    'signup' row at 0, user_profiles.referred_by, referral_codes.total_uses)
--    and the referrer is paid 50 ITC when the referred friend's first order is
--    paid (award_referral_first_order below). To restore sign-up rewards, set
--    the four v_* amounts in process_referral_reward back to the old schedule
--    (500 / 5 / 250 / 2.5) and update src/lib/referral-program.ts to match.
--
-- 3. referred_by is now written INSIDE the function (same transaction as the
--    'signup' row), keyed on user_profiles.id. The old service wrote it
--    afterwards with .eq('user_id', ...), and user_id is NULL on 4 of the 5
--    live profiles (handle_new_user never sets it), so it silently wrote
--    nothing.
--
-- 4. Exactly-once is enforced by the database, not by a check-then-insert:
--    one 'signup' row per referee (new partial unique index, joining the
--    existing one-'purchase'-per-referee index) and one ACTIVE code per user.
--
-- 5. award_referral_first_order() replaces the JS read-modify-write in
--    referral-service.ts: the 'purchase' row, the wallet credit and the
--    itc_transactions ledger row now commit together, or none of them do.
--    Before, a failed wallet write left a 'completed' bonus row that the
--    idempotency guard then treated as paid forever.
-- ============================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_transactions_one_signup_per_referee
  ON public.referral_transactions (referee_id)
  WHERE ((type)::text = 'signup'::text);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_codes_one_active_per_user
  ON public.referral_codes (user_id)
  WHERE is_active;

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
  -- Sign-up pays nothing (task bdfa6939, 2026-10-07): bots could farm it.
  -- Old schedule, if David restores it: 500 / 5 / 250 / 2.5.
  v_referrer_points INTEGER := 0;
  v_referrer_itc NUMERIC := 0;
  v_referee_points INTEGER := 0;
  v_referee_itc NUMERIC := 0;
  v_code_record RECORD;
  v_existing RECORD;
  v_transaction_id UUID;
  v_referrer_points_after INTEGER;
  v_referrer_itc_after NUMERIC;
  v_referee_points_after INTEGER;
  v_referee_itc_after NUMERIC;
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
                                'referrer_id', v_existing.referrer_id);
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

  -- Wallet credits only when the schedule above pays something.
  IF v_referrer_points > 0 OR v_referrer_itc > 0 THEN
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
  END IF;

  IF v_referee_points > 0 OR v_referee_itc > 0 THEN
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
  END IF;

  UPDATE referral_codes
  SET total_uses = COALESCE(total_uses, 0) + 1, updated_at = NOW()
  WHERE id = v_code_record.id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'referrer_id', v_code_record.user_id,
    'referrer_rewards', jsonb_build_object('points', v_referrer_points, 'itc', v_referrer_itc),
    'referee_rewards', jsonb_build_object('points', v_referee_points, 'itc', v_referee_itc)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$function$;

-- The referrer's bonus when a referred friend's first order is paid.
-- Lifetime-once per referee (idx_referral_transactions_one_purchase_per_referee).
-- Pays only on a recorded 'signup' referral, never on a bare referred_by: the
-- referee can edit their own profile row, the signup row they cannot write.
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
  -- The one place the first-order bonus amount lives. Mirrored for display in
  -- src/lib/referral-program.ts (REFERRAL_REWARDS.firstOrder.referrerItc).
  v_bonus_itc NUMERIC := 50;
  v_signup RECORD;
  v_transaction_id UUID;
  v_itc_after NUMERIC;
BEGIN
  SELECT * INTO v_signup
  FROM referral_transactions
  WHERE referee_id = p_referee_id AND type = 'signup' AND status = 'completed'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'User was not referred');
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
    RETURN jsonb_build_object('success', false, 'message', 'First purchase bonus already awarded');
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

-- Service role only. PUBLIC is revoked explicitly because Postgres grants
-- EXECUTE to PUBLIC by default on every new function.
REVOKE ALL ON FUNCTION public.process_referral_reward(character varying, uuid, character varying, character varying) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_reward(character varying, uuid, character varying, character varying) TO service_role;

REVOKE ALL ON FUNCTION public.award_referral_first_order(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_referral_first_order(uuid, uuid) TO service_role;

COMMIT;
