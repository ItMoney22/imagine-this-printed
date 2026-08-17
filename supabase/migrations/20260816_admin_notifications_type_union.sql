-- ---------------------------------------------------------------------------
-- Reconcile admin_notifications_type_check to the UNION of every notification
-- type the codebase actually emits — and stop the next branch from clobbering it.
--
-- Watchtower task ae9c62ac-1ec5-40fb-9fb1-de63a979ab3a (Dr. Dill, 2026-08-16).
-- Discovered during the refund/dispute go-live (task ede1687a).
--
-- THE BUG CLASS
-- A CHECK constraint cannot be extended in place, so every migration that has
-- ever needed a new notification type did DROP + ADD with the FULL list rewritten
-- from whatever the author happened to see at the time. Four parallel branches
-- have now done that:
--
--   20260706000000_blank_inventory.sql        -> +low_stock/order_stalled/health_alert
--   20260727_refunds_and_disputes.sql         -> +payment_dispute   (no wholesale_application)
--   20260728_wholesale_applications.sql       -> +wholesale_application (no payment_dispute)
--   20260807_admin_notifications_new_order.sql-> +new_order            (no payment_dispute)
--
-- Whichever one runs LAST silently deletes the types the others added. That is
-- not a merge conflict — every file applies cleanly — so nothing catches it.
--
-- WHAT WAS ACTUALLY LIVE (measured 2026-08-16, before this migration):
--   new_ticket, ticket_reply, ticket_escalation, agent_needed,
--   low_stock, order_stalled, health_alert, payment_dispute
-- i.e. 20260727 (refunds/disputes) was the last writer. So TWO code paths were
-- inserting types the database rejected with 23514:
--   * backend/services/order-payment.ts:341   type:'new_order'          (every paid order)
--   * backend/routes/wholesale.ts:83          type:'wholesale_application'
-- Both are wrapped in try/catch, so the email still went out and the request
-- still succeeded — the admin bell row was the only casualty. Silent.
--
-- WHY THIS FILE IS A DO BLOCK INSTEAD OF ANOTHER HARDCODED LIST
-- Restating a literal list is exactly what caused the bug. This computes the
-- final list as the union of three sources, so it can only ever ADD:
--   1. REQUIRED  — every type grepped out of the code that inserts here
--   2. whatever the LIVE constraint currently allows (so a value added by a
--      branch this file has never heard of survives)
--   3. every DISTINCT type already present in the table (so the new constraint
--      is guaranteed to validate and can never fail on real data)
-- Idempotent: re-running it is a no-op. Additive: nothing is ever removed.
--
-- DO NOT apply 20260728_wholesale_applications.sql or
-- 20260807_admin_notifications_new_order.sql to production. Their constraint
-- blocks have been rewritten to this same union so a cold re-run is no longer
-- destructive, but neither file is needed for the type list any more — this one
-- supersedes both. (20260728 does still carry the wholesale_applications TABLE,
-- which is separately missing from prod; that is tracked as its own task.)
--
-- No BEGIN/COMMIT here on purpose: scripts/apply-pending-migrations.mjs wraps
-- each migration in its own transaction and verifies inside it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  -- Source of truth: every literal passed as `type` to an admin_notifications
  -- insert anywhere in the repo, as of 2026-08-16.
  --   new_ticket / ticket_reply / ticket_escalation / agent_needed
  --                                    backend/routes/support.ts,
  --                                    backend/routes/admin/support.ts,
  --                                    backend/routes/ai/chat.ts
  --   low_stock                        backend/services/blank-inventory.ts
  --   order_stalled                    backend/services/order-monitor.ts, backend/routes/stripe.ts
  --   health_alert                     backend/services/order-monitor.ts
  --   payment_dispute                  backend/routes/stripe.ts
  --   wholesale_application            backend/routes/wholesale.ts
  --   new_order                        backend/services/order-payment.ts
  required  text[] := ARRAY[
    'new_ticket', 'ticket_reply', 'ticket_escalation', 'agent_needed',
    'low_stock', 'order_stalled', 'health_alert',
    'payment_dispute', 'wholesale_application', 'new_order'
  ];
  allowed_now text[];
  in_use      text[];
  final_list  text[];
  missing     text[];
BEGIN
  -- (2) values the live constraint allows right now, pulled out of its own
  -- definition text. Postgres normalises `type IN (...)` to
  -- `(type)::text = ANY ((ARRAY['x'::character varying, ...])::text[])`,
  -- so the quoted literals are exactly the allowed set.
  SELECT COALESCE(array_agg(DISTINCT m[1]), ARRAY[]::text[])
    INTO allowed_now
    FROM pg_constraint c
    CROSS JOIN LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-zA-Z0-9_]+)''::', 'g') AS m
   WHERE c.conrelid = 'public.admin_notifications'::regclass
     AND c.conname  = 'admin_notifications_type_check';

  -- (3) values that exist in the data, so ADD CONSTRAINT can never fail.
  SELECT COALESCE(array_agg(DISTINCT type::text), ARRAY[]::text[])
    INTO in_use
    FROM public.admin_notifications;

  final_list := ARRAY(
    SELECT DISTINCT v FROM unnest(required || allowed_now || in_use) AS v ORDER BY v
  );

  EXECUTE 'ALTER TABLE public.admin_notifications DROP CONSTRAINT IF EXISTS admin_notifications_type_check';
  EXECUTE format(
    'ALTER TABLE public.admin_notifications ADD CONSTRAINT admin_notifications_type_check CHECK (type IN (%s))',
    (SELECT string_agg(quote_literal(v), ', ' ORDER BY v) FROM unnest(final_list) AS v)
  );

  -- Belt and suspenders: refuse to commit a constraint that lost a required type.
  SELECT COALESCE(array_agg(r), ARRAY[]::text[]) INTO missing
    FROM unnest(required) AS r WHERE r <> ALL (final_list);
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'admin_notifications_type_check is missing required type(s): %',
      array_to_string(missing, ', ');
  END IF;

  RAISE NOTICE 'admin_notifications_type_check now allows: %', array_to_string(final_list, ', ');
END $$;

COMMENT ON CONSTRAINT admin_notifications_type_check ON public.admin_notifications IS
  'Union of every notification type the app inserts. Reconciled 2026-08-16 (Watchtower ae9c62ac) after four branches each rewrote the full list and clobbered each other. To add a type: copy the DO block in 20260816_admin_notifications_type_union.sql and add yours to `required` — never hand-write a fresh literal list.';
