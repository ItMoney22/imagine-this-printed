-- Atomic ITC purchase claim.
--
-- Watchtower task 3f579f0b-bda2-4c1b-baf0-4c0f795a92fa.
--
-- handleITCPurchase used to SELECT itc_transactions WHERE reference =
-- payment_intent.id and, finding nothing, credit the wallet and INSERT.
-- Stripe delivers webhooks at least once. Two overlapping deliveries both
-- pass that SELECT and both credit. invoice.paid and payout.failed already
-- avoid this with claimOnce()'s UPDATE ... WHERE guard, but a purchase has
-- no row to flip until the ledger insert — so the insert has to be the claim.
--
-- claim_itc_purchase() does the claim and the credit in one transaction:
--   1. Lock the wallet row (FOR UPDATE) so two different purchases for the
--      same user cannot clobber each other's read-modify-write.
--   2. INSERT the purchase ledger row with the post-credit balance.
--      ON CONFLICT DO NOTHING against the partial unique index below — a
--      redelivery inserts zero rows and returns claimed = false.
--   3. Only the insert that won sets user_wallets.itc_balance.
--
-- The wallet write is an absolute assignment of the post-credit balance, not
-- an increment on top of whatever a trigger did. COMPLETE_DATABASE_SETUP.sql
-- defines update_wallet_balance_itc_trigger AFTER INSERT, which SETs
-- itc_balance = NEW.balance_after. If that trigger is installed it fires
-- during the INSERT, and the UPDATE after it writes the same number again.
-- If the trigger is absent, the UPDATE is the credit. Either way one delivery
-- moves the balance once, and a second delivery moves it zero times.
--
-- A failure (missing wallet, constraint, anything else) raises, which rolls
-- the insert back with the balance change. The webhook returns 500 and
-- Stripe retries. A duplicate does not raise.
--
-- EXECUTE is revoked from anon/authenticated. This function mints ITC; the
-- service role (the webhook) is the only caller.

DO $$
DECLARE
  v_dup int;
BEGIN
  SELECT count(*) INTO v_dup FROM (
    SELECT reference
      FROM public.itc_transactions
     WHERE type = 'purchase'
       AND reference IS NOT NULL
     GROUP BY reference
    HAVING count(*) > 1
  ) d;

  IF v_dup > 0 THEN
    RAISE EXCEPTION
      'itc purchase claim: % payment intent reference(s) already have more than one purchase row — resolve those before adding the unique index',
      v_dup;
  END IF;
END $$;

-- reference is free text on every other transaction type (referral ids,
-- order ids, nulls). Uniqueness is only for purchase rows that carry a
-- payment intent id. NULLs are excluded so unrelated rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS itc_transactions_purchase_reference_uidx
  ON public.itc_transactions (reference)
  WHERE type = 'purchase' AND reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_itc_purchase(
  p_user_id uuid,
  p_reference text,
  p_amount numeric,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  claimed boolean,
  new_balance numeric,
  transaction_id uuid
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_new numeric;
  v_tx_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'claim_itc_purchase: user_id is required';
  END IF;
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'claim_itc_purchase: reference is required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'claim_itc_purchase: amount must be positive (got %)', p_amount;
  END IF;

  SELECT w.itc_balance
    INTO v_balance
    FROM public.user_wallets w
   WHERE w.user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_itc_purchase: wallet not found for %', p_user_id;
  END IF;

  v_new := v_balance + p_amount;

  INSERT INTO public.itc_transactions (
    user_id, type, amount, balance_after, reference, metadata
  )
  VALUES (
    p_user_id,
    'purchase',
    p_amount,
    v_new,
    p_reference,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('claim_state', 'credited')
  )
  ON CONFLICT (reference) WHERE type = 'purchase' AND reference IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_tx_id;

  IF v_tx_id IS NULL THEN
    claimed := false;
    new_balance := NULL;
    transaction_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.user_wallets
     SET itc_balance = v_new,
         updated_at = now()
   WHERE user_id = p_user_id;

  claimed := true;
  new_balance := v_new;
  transaction_id := v_tx_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.claim_itc_purchase(uuid, text, numeric, jsonb) IS
  'Atomically claim a Stripe payment intent and credit ITC once. Returns claimed=false when the purchase reference already exists. Raises (rolling the insert back) when the wallet is missing.';

REVOKE ALL ON FUNCTION public.claim_itc_purchase(uuid, text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_itc_purchase(uuid, text, numeric, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_itc_purchase(uuid, text, numeric, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
