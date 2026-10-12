-- =============================================================================
-- ITC refund guard — close the self-mint hole in POST /api/wallet/refund-itc
-- =============================================================================
-- Watchtower task b66fb61f-d82e-4c37-af95-f5457920d640.
--
-- PROBLEM. /api/wallet/refund-itc ran on the service-role client (RLS bypassed,
-- so the 2026-08-16 wallet lockdown in 20260810_lock_wallet_balance.sql did not
-- reach it) and credited whatever `amount` the request body carried:
--
--   newBalance = wallet.itc_balance + req.body.amount   -- no prior debit checked
--
-- Any authenticated user could mint unlimited ITC and then cash it out through
-- Stripe Connect or spend it on merch.
--
-- FIX. A refund must now name the itc_transactions debit row it is compensating,
-- and that pairing is enforced in the database, not only in the route:
--
--   1. refund_itc_for_debit() does the whole thing in ONE statement-atomic
--      function: lock the debit, verify ownership + shape, verify it has not
--      already been refunded, cap the credit at the debit amount, move the
--      balance, and write the refund ledger row carrying
--      metadata.refunded_transaction_id = <debit id>.
--   2. A partial UNIQUE INDEX on that metadata key makes a second refund row for
--      the same debit impossible even if two requests race past the read check
--      or a future call site forgets to look.
--
-- SCHEMA NOTE (the task's open question). Live itc_transactions is
-- (id, user_id, type, amount, balance_after, reference, metadata jsonb,
-- created_at) — see 20260727_fix_itc_wallet_schema_drift.sql. There is no
-- refunded_at / refund_ref_id column and no appetite to add one to a money table
-- that three unmerged branches already touch, so the refund link lives in the
-- existing `metadata` jsonb under the key `refunded_transaction_id`. The unique
-- index below gives that convention the same teeth a real column would have,
-- with no table rewrite.
--
-- Only debits written by POST /api/wallet/deduct-itc (type='usage',
-- reference='feature_usage') are refundable through this path. That restriction
-- is deliberate: order payments, ITC->credit conversions, payout holds and
-- Stripe Connect cashouts all write debit rows too, and refunding one of those
-- would hand the user their ITC back while they keep the goods.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. One refund row per debit, enforced by the database.
-- -----------------------------------------------------------------------------
-- Partial so it only constrains rows that opt into the convention: the
-- Imagination Station refund path (imagination-pricing.ts, type='credit') and
-- every pre-existing refund row carry no `refunded_transaction_id` and are
-- untouched.
DO $$
DECLARE
  v_dupes int;
BEGIN
  SELECT COUNT(*) INTO v_dupes
    FROM (
      SELECT metadata->>'refunded_transaction_id' AS debit_id
        FROM public.itc_transactions
       WHERE type = 'refund'
         AND metadata->>'refunded_transaction_id' IS NOT NULL
       GROUP BY 1
      HAVING COUNT(*) > 1
    ) d;

  IF v_dupes > 0 THEN
    RAISE WARNING 'Skipping itc_transactions_one_refund_per_debit: % debit(s) already carry more than one refund row — reconcile then create the index manually.', v_dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS itc_transactions_one_refund_per_debit
      ON public.itc_transactions ((metadata->>'refunded_transaction_id'))
      WHERE type = 'refund'
        AND metadata->>'refunded_transaction_id' IS NOT NULL;
  END IF;
END;
$$;

-- Supports the "most recent unrefunded feature debit" lookup the route falls
-- back to while an older frontend bundle is still live (Vercel and Render
-- deploy independently, so the API gets the new contract before every browser
-- does).
CREATE INDEX IF NOT EXISTS idx_itc_transactions_user_type_created
  ON public.itc_transactions (user_id, type, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. The atomic refund.
-- -----------------------------------------------------------------------------
-- Returns a jsonb verdict rather than raising, so the route can map each
-- failure onto its own HTTP status without parsing error strings:
--   {"ok": false, "code": "invalid_amount"        }  -> 400
--   {"ok": false, "code": "debit_not_found"       }  -> 422
--   {"ok": false, "code": "not_refundable"        }  -> 422
--   {"ok": false, "code": "amount_exceeds_debit"  }  -> 422
--   {"ok": false, "code": "already_refunded"      }  -> 409
--   {"ok": false, "code": "wallet_not_found"      }  -> 404
--   {"ok": true,  "new_balance": n, "refund_id": uuid, "debit_amount": n}
CREATE OR REPLACE FUNCTION public.refund_itc_for_debit(
  p_user_id      uuid,
  p_debit_id     uuid,
  p_amount       numeric,
  p_reference    text DEFAULT 'feature_refund',
  p_description  text DEFAULT NULL,
  p_reference_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_debit        public.itc_transactions%ROWTYPE;
  v_debit_amount numeric;
  v_already      int;
  v_new_balance  numeric;
  v_refund_id    uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_amount');
  END IF;

  -- FOR UPDATE serialises two concurrent refunds of the same debit: the second
  -- waits here, then sees the refund row the first one wrote.
  SELECT * INTO v_debit
    FROM public.itc_transactions
   WHERE id      = p_debit_id
     AND user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'debit_not_found');
  END IF;

  -- Refundable == a feature-usage debit written by /api/wallet/deduct-itc.
  -- Anything else (order payment, cashout, conversion, admin adjustment,
  -- community boost) is not compensable through this endpoint.
  IF v_debit.amount >= 0
     OR v_debit.type <> 'usage'
     OR COALESCE(v_debit.reference, '') <> 'feature_usage' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_refundable');
  END IF;

  v_debit_amount := -v_debit.amount;

  SELECT COUNT(*) INTO v_already
    FROM public.itc_transactions
   WHERE type = 'refund'
     AND metadata->>'refunded_transaction_id' = p_debit_id::text;

  IF v_already > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_refunded',
                              'debit_amount', v_debit_amount);
  END IF;

  IF p_amount > v_debit_amount THEN
    RETURN jsonb_build_object('ok', false, 'code', 'amount_exceeds_debit',
                              'debit_amount', v_debit_amount);
  END IF;

  UPDATE public.user_wallets
     SET itc_balance = itc_balance + p_amount
   WHERE user_id = p_user_id
  RETURNING itc_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'wallet_not_found');
  END IF;

  -- If this insert trips itc_transactions_one_refund_per_debit the exception
  -- aborts the whole function, taking the balance update above with it. The
  -- credit and its ledger row are all-or-nothing.
  INSERT INTO public.itc_transactions
    (user_id, type, amount, balance_after, reference, metadata)
  VALUES
    (p_user_id, 'refund', p_amount, v_new_balance,
     COALESCE(NULLIF(p_reference, ''), 'feature_refund'),
     jsonb_build_object(
       'refunded_transaction_id', p_debit_id::text,
       'reference_id', p_reference_id,
       'description', p_description
     ))
  RETURNING id INTO v_refund_id;

  RETURN jsonb_build_object('ok', true,
                            'new_balance', v_new_balance,
                            'refund_id', v_refund_id,
                            'debit_amount', v_debit_amount);
END;
$$;

COMMENT ON FUNCTION public.refund_itc_for_debit(uuid, uuid, numeric, text, text, text) IS
  'Atomic ITC refund bound to a prior /api/wallet/deduct-itc debit row. Verifies ownership, '
  'refundability and non-duplication, caps the credit at the original debit, then moves the '
  'balance and writes the linked refund ledger row in one transaction. Returns a jsonb verdict.';

-- Service role only. The wallet routes call this with the service-role client;
-- nothing should be able to reach it from a browser session through PostgREST.
REVOKE ALL ON FUNCTION public.refund_itc_for_debit(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_itc_for_debit(uuid, uuid, numeric, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.refund_itc_for_debit(uuid, uuid, numeric, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_itc_for_debit(uuid, uuid, numeric, text, text, text) TO service_role;
