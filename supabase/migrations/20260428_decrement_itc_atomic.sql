-- =============================================================================
-- Atomic ITC decrement RPC
-- =============================================================================
-- Closes the TOCTOU race in /api/wallet/deduct-itc and friends. The previous
-- application code did:
--
--   SELECT itc_balance FROM user_wallets WHERE user_id = $1
--   -- (gap: another request can read the same balance here)
--   UPDATE user_wallets SET itc_balance = $2 WHERE user_id = $1
--
-- Two concurrent calls could both pass the >= check and both succeed,
-- silently producing a double-spend. This RPC moves the check + write into a
-- single atomic UPDATE statement that uses the row's CURRENT balance via the
-- WHERE clause, so the second request gets 0 affected rows and a NULL return.
--
-- Usage from server:
--   const { data, error } = await supabase.rpc('decrement_itc', {
--     p_user_id: userId,
--     p_amount:  amount,
--   })
--   if (error || data === null) -> insufficient balance OR no wallet
--   else -> data is the NEW balance (already debited atomically)
--
-- The companion non-negative CHECK constraint is added at the bottom so that
-- any path bypassing this RPC still cannot push a wallet below zero.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.decrement_itc(
  p_user_id uuid,
  p_amount  numeric
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'decrement_itc: amount must be positive (got %)', p_amount;
  END IF;

  -- Atomic decrement. The WHERE clause re-reads the current balance under the
  -- row lock taken by UPDATE, so a concurrent decrement that already pushed
  -- the balance below p_amount will see 0 affected rows here.
  UPDATE public.user_wallets
     SET itc_balance = itc_balance - p_amount
   WHERE user_id     = p_user_id
     AND itc_balance >= p_amount
  RETURNING itc_balance INTO v_new_balance;

  -- v_new_balance is NULL when:
  --   * wallet row doesn't exist, OR
  --   * balance was insufficient (the >= check failed).
  -- Caller is expected to translate NULL into a 400/402 response.
  RETURN v_new_balance;
END;
$$;

COMMENT ON FUNCTION public.decrement_itc(uuid, numeric) IS
  'Atomic ITC debit. Returns NEW balance on success, NULL on insufficient funds or missing wallet. '
  'Closes the TOCTOU race on the application-side read-then-write pattern.';

-- Belt-and-suspenders: a CHECK constraint so any code path that bypasses
-- decrement_itc (legacy helper functions, manual UPDATEs, mistakes) still
-- cannot drive a wallet negative. We DO NOT add this if any existing row is
-- already < 0; in that case the migration warns and skips the constraint
-- so the deploy can proceed and an admin can reconcile first.
DO $$
DECLARE
  v_negative_count int;
BEGIN
  SELECT COUNT(*) INTO v_negative_count
    FROM public.user_wallets
   WHERE itc_balance < 0;

  IF v_negative_count > 0 THEN
    RAISE WARNING 'Skipping itc_balance >= 0 CHECK: % wallet(s) already have negative balance — please reconcile then add the constraint manually.', v_negative_count;
  ELSE
    -- Only add the constraint if it doesn't already exist.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname  = 'user_wallets_itc_balance_nonneg'
         AND conrelid = 'public.user_wallets'::regclass
    ) THEN
      ALTER TABLE public.user_wallets
        ADD CONSTRAINT user_wallets_itc_balance_nonneg
        CHECK (itc_balance >= 0);
    END IF;
  END IF;
END;
$$;
