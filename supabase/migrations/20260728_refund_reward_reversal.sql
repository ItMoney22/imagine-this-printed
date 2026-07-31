-- Refunds: let a refund reverse coupon usage (Watchtower task 01d0d679).
--
-- backend/services/order-refunds.ts reverseOrderRewards() and
-- reverseReferralBonus() need no schema change: order_rewards.status and
-- referral_transactions.status both already allow 'reversed' in their live
-- CHECK constraints (migrations/006_reward_system.sql:219 and :160).
--
-- coupon_usage has no status column at all (supabase/migrations/
-- 20251219_coupons_giftcards_support.sql:28-35 — just id, discount_code_id,
-- user_id, order_id, discount_amount, used_at), so reverseCouponUsage() needs
-- somewhere to record "this usage was undone" without deleting the row (the
-- audit trail of "a coupon WAS used on this order" should survive a refund).
-- reversed_at doubles as that marker and as the step's idempotency guard.

ALTER TABLE coupon_usage
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

-- reverseCouponUsage() looks this table up by order_id on every refund.
CREATE INDEX IF NOT EXISTS idx_coupon_usage_order_id ON coupon_usage(order_id);
