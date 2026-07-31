-- Fix itc_transactions + user_wallets schema drift: repo -> live (not live -> repo)
--
-- Watchtower task 85de5f13-e439-4e2c-b13c-6fa5a3281642.
--
-- PROBLEM: every checked-in schema source (this migration timeline's own
-- 001_initial_schema.sql, migrations/006_reward_system.sql, COMPLETE_DATABASE_SETUP.sql,
-- prisma/schema.prisma, backend/prisma/schema.prisma) declares:
--   itc_transactions: ... usd_value, exchange_rate, reason, payment_intent_id,
--                      transaction_hash, reference_id, status, processed_at ...
--   user_wallets:     ... last_itc_activity ...
-- None of those columns exist on the live production tables.
--
-- DECISION: amend the declared schema to match live (this file), NOT alter live
-- to match the old declarations. Evidence, three independent sources agreeing
-- column-for-column:
--   1. This Watchtower task's own description states the live shape was verified
--      directly via information_schema: itc_transactions(id, user_id, type, amount,
--      balance_after, reference, metadata jsonb, created_at).
--   2. backend/utils/wallet-logger.ts:71-72 carries an in-code comment: "Live schema
--      (verified 2026-06-12 via information_schema): itc_transactions(id, user_id,
--      type, amount, reference, balance_after, metadata, created_at)." -- identical
--      column list, verified six weeks earlier by a different task.
--   3. Commit 6299315 (2026-06-13, "fix(patrol): ... ITC ledger drift (13 sites)")
--      hand-patched all 13 live INSERT call sites off the phantom columns and onto
--      reference + metadata after those inserts were silently failing in production;
--      every one of those call sites (grep across backend/) writes only user_id,
--      type, amount, balance_after, reference, metadata -- never usd_value, reason,
--      exchange_rate, payment_intent_id, transaction_hash, reference_id, status, or
--      processed_at as top-level columns.
--   4. backend/services/stripe-connect.ts:363-365 and :613-615 each carry a comment
--      documenting a real production incident: "live user_wallets has updated_at,
--      not last_itc_activity -- the stale column made this update fail" (once broke
--      the entire ITC cashout flow, once broke a payout-refund flow).
-- No direct fresh query against live was run for this migration (the sandboxed
-- environment this was authored in blocks outbound Postgres connections); the
-- corroborating evidence above is what the drift verdict rests on. See the
-- accompanying handoff for the exact information_schema queries to run against
-- live to confirm this before applying.
--
-- WHY A NEW FILE INSTEAD OF EDITING 001_initial_schema.sql IN PLACE: that
-- migration has already run against production, and this repo's own precedent
-- (004_schema_fixes.sql, 005_rls_fixes.sql) is to layer corrections on top of 001
-- rather than rewrite an applied migration's checksum. This file follows that
-- same convention.
--
-- APPLIED AGAINST PRODUCTION: a no-op. Every ALTER below is IF EXISTS / IF NOT
-- EXISTS guarded and production is already in the target shape.
-- APPLIED AGAINST A FRESH DATABASE (001 -> ... -> this file): brings a
-- from-scratch install to the same shape as production.

BEGIN;

-- itc_transactions: drop the columns that were never live, add the one that is.
ALTER TABLE itc_transactions
  DROP COLUMN IF EXISTS usd_value,
  DROP COLUMN IF EXISTS exchange_rate,
  DROP COLUMN IF EXISTS reason,
  DROP COLUMN IF EXISTS payment_intent_id,
  DROP COLUMN IF EXISTS transaction_hash,
  DROP COLUMN IF EXISTS reference_id,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS processed_at,
  ADD COLUMN IF NOT EXISTS reference TEXT;

-- user_wallets: updated_at already exists (001_initial_schema.sql creates it and
-- wires the update_user_wallets_updated_at trigger to it); only the phantom
-- column needs to go.
ALTER TABLE user_wallets
  DROP COLUMN IF EXISTS last_itc_activity;

COMMIT;
