// ---------------------------------------------------------------------------
// "This checkout order is paid" — the single implementation.
//
// Extracted verbatim from routes/stripe.ts's handleCheckoutOrderPayment on
// 2026-08-07 for one reason: it had exactly ONE caller (the Stripe webhook), so
// when the webhook stopped arriving, nothing else on the system knew how to
// mark an order paid. A real $26 order (ITP-MSJK1K3I-8GDG) sat at
// status=pending/payment_status=pending with the money already captured in
// Stripe, because the Dashboard endpoint still pointed at
// /api/webhooks/stripe — a route deleted on 2026-07-27 in f4785ce — and every
// delivery 404'd.
//
// Now there are two callers that share this logic byte for byte:
//   1. POST /api/stripe/webhook           (the happy path)
//   2. reconcileUnrecordedPayments()      (services/order-monitor.ts, hourly —
//                                          the net that catches a dead webhook)
//
// The `req` parameter became `log` because that was the only thing the original
// ever used it for. Everything else — the atomic payment_status claim, the
// order of side effects, every fail-soft catch — is unchanged, deliberately:
// this function runs against live money and the reconciler's whole value
// depends on it behaving identically to the webhook path.
// ---------------------------------------------------------------------------
import type Stripe from 'stripe'
import type { Logger } from 'pino'
import { supabase } from '../lib/supabase.js'
import { sendOrderConfirmationEmail as sendOrderEmail, sendNewOrderTeamEmail } from '../utils/email.js'
import { decrementBlanksForOrder } from './blank-inventory.js'
import { accrueCreatorMarginsForOrder } from './creator-margins.js'
import { sendMerchOrderEvent } from './merch-webhook.js'
import { processOrderCompletion } from './order-reward-service.js'
import { processReferralFirstPurchase } from './referral-service.js'
import { findCouponIdByCode, recordCouponUsage } from '../routes/coupons.js'

/**
 * Where the paid order came from, for logging and for the team alert's subject.
 * 'webhook' is the normal path; 'reconciler' means a webhook was MISSED and the
 * hourly sweep found the payment in Stripe — that distinction is the signal
 * that delivery is broken, so it must survive into the alert.
 */
export type PaidOrderSource = 'webhook' | 'reconciler'

/**
 * Marks a checkout order paid and runs every downstream side effect exactly
 * once. Safe to call repeatedly with the same PaymentIntent: the UPDATE …
 * WHERE payment_status != 'paid' below is the atomic gate, and a caller that
 * loses the race returns before touching anything else.
 *
 * Throws only when the order can't be identified or the claim UPDATE itself
 * errors (the webhook turns that into a 500 so Stripe retries). Every
 * *secondary* effect — email, rewards, inventory, margins, notifications —
 * logs and swallows its own failures, because the payment already succeeded and
 * nothing here is worth telling Stripe the delivery failed over.
 */
export async function applyPaidCheckoutOrder(
  paymentIntent: Stripe.PaymentIntent,
  log?: Logger,
  source: PaidOrderSource = 'webhook'
): Promise<{ claimed: boolean }> {
  const { orderId, orderNumber, userId, itcCreditAmount, itcCreditUSD } = paymentIntent.metadata

  if (!orderId) {
    log?.error({ metadata: paymentIntent.metadata }, 'Missing orderId in checkout order metadata')
    throw new Error('Missing orderId in metadata')
  }

  log?.info({
    orderId,
    orderNumber,
    amount: paymentIntent.amount,
    itcCreditAmount,
    itcCreditUSD,
    source
  }, 'Processing checkout order payment')

  // Idempotency claim — Stripe retries webhook deliveries, and the reconciler
  // may race a late one. Flipping payment_status is the atomic gate (single
  // UPDATE … WHERE != 'paid'): if another delivery already claimed this order,
  // skip ALL side effects. Without this, the ITC deduction below double-charged
  // wallets on retries.
  //
  // charge_id is captured here too (2026-08-07). It used to stay NULL forever,
  // which left findOrderForCharge()'s charge_id fallback permanently dead and
  // made refund/dispute events depend entirely on payment_intent_id matching.
  const latestCharge = typeof paymentIntent.latest_charge === 'string'
    ? paymentIntent.latest_charge
    : paymentIntent.latest_charge?.id ?? null

  const { data: claimedRows, error: orderUpdateError } = await supabase
    .from('orders')
    .update({
      status: 'processing',
      payment_status: 'paid',
      payment_intent_id: paymentIntent.id,
      ...(latestCharge ? { charge_id: latestCharge } : {}),
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId)
    .neq('payment_status', 'paid')
    .select('id')

  if (orderUpdateError) {
    log?.error({ err: orderUpdateError, orderId }, 'Failed to update order status')
    throw new Error('Failed to update order status')
  }
  if (!claimedRows || claimedRows.length === 0) {
    log?.info(
      { orderId, paymentIntentId: paymentIntent.id, source },
      'Order already marked paid — duplicate delivery, skipping side effects'
    )
    return { claimed: false }
  }

  // Defensive: if the order row lost its user linkage (created while the
  // session was missing/expired) but the payment intent knows the user,
  // backfill it so the order shows up in /api/orders/my. Only fills NULL —
  // never reassigns.
  if (userId) {
    await supabase
      .from('orders')
      .update({ user_id: userId })
      .eq('id', orderId)
      .is('user_id', null)
  }

  // Process ITC credit deduction if applicable
  const itcAmount = parseFloat(itcCreditAmount || '0')
  if (itcAmount > 0 && userId) {
    try {
      // Get current wallet balance
      const { data: wallet, error: walletError } = await supabase
        .from('user_wallets')
        .select('itc_balance')
        .eq('user_id', userId)
        .single()

      if (walletError || !wallet) {
        log?.error({ err: walletError, userId }, 'Failed to fetch wallet for ITC deduction')
      } else {
        const currentBalance = parseFloat(wallet.itc_balance || '0')
        const newBalance = Math.max(0, currentBalance - itcAmount)

        // Deduct ITC from wallet
        const { error: updateError } = await supabase
          .from('user_wallets')
          .update({
            itc_balance: newBalance,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId)

        if (updateError) {
          log?.error({ err: updateError, userId }, 'Failed to deduct ITC from wallet')
        } else {
          // Record the transaction (itc_transactions live schema:
          // type/amount/balance_after/reference/metadata — the old reason/usd_value
          // columns don't exist, so this ledger insert silently failed)
          const { error: creditLedgerError } = await supabase
            .from('itc_transactions')
            .insert({
              user_id: userId,
              type: 'purchase_payment',
              amount: -itcAmount, // Negative for deduction
              balance_after: newBalance,
              reference: orderId,
              metadata: {
                description: `Store credit applied to order ${orderNumber}`,
                usd_value: parseFloat(itcCreditUSD || '0')
              },
              created_at: new Date().toISOString()
            })
          if (creditLedgerError) log?.error({ err: creditLedgerError, userId }, 'Failed to log ITC store-credit ledger')

          log?.info({
            userId,
            itcDeducted: itcAmount,
            newBalance,
            orderId
          }, 'ITC store credit deducted successfully')
        }
      }
    } catch (itcError: any) {
      log?.error({ err: itcError, userId, itcAmount }, 'Error processing ITC credit deduction')
      // Don't throw - order payment succeeded, ITC issue is secondary
    }
  }

  // Get order details for notification/email
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', orderId)
    .single()

  if (orderError) {
    log?.error({ err: orderError, orderId }, 'Failed to fetch order details')
    // Don't throw - order was updated successfully
  }

  // Award order rewards + first-purchase referral bonus, and record coupon
  // redemption. This runs only once we've won the idempotency claim above, and
  // processOrderCompletion / processReferralFirstPurchase each have their own
  // internal dedup guard as a second layer. None of this should ever fail the
  // caller — the payment already succeeded — so every failure here is logged
  // and swallowed.
  if (order) {
    try {
      const rewardsUserId = order.user_id || userId
      const orderTotalUsd = Number(order.total) || 0

      const rewardResult = await processOrderCompletion({
        orderId,
        userId: rewardsUserId,
        orderTotal: orderTotalUsd,
        orderNumber
      })
      if (!rewardResult.success && rewardResult.error !== 'Duplicate reward attempt') {
        log?.error({ orderId, err: rewardResult.error }, '[rewards] Failed to award order rewards')
      }

      // Safe to call unconditionally — processReferralFirstPurchase only
      // actually awards ITC the first time (checks for an existing
      // 'purchase'-type referral_transactions row for this user first).
      if (rewardsUserId) {
        const referralResult = await processReferralFirstPurchase(rewardsUserId, orderTotalUsd)
        if (referralResult.success) {
          log?.info({ orderId, referrerId: referralResult.referrerId, bonus: referralResult.bonusITC }, '[rewards] Referral first-purchase bonus awarded')
        }
      }

      const couponCode = Array.isArray(order.discount_codes) ? order.discount_codes[0] : null
      if (couponCode && Number(order.discount_amount) > 0) {
        const couponId = await findCouponIdByCode(couponCode)
        if (couponId) {
          await recordCouponUsage({
            couponId,
            userId: rewardsUserId,
            orderId,
            discountApplied: Number(order.discount_amount) || 0
          })
        } else {
          log?.warn({ orderId, couponCode }, '[coupons] Could not resolve coupon id for redemption recording')
        }
      }
    } catch (rewardsError: any) {
      log?.error({ err: rewardsError, orderId }, '[rewards] Reward/referral/coupon post-processing error')
    }
  }

  // Send order confirmation email
  if (order?.customer_email) {
    try {
      await sendOrderConfirmation(order)
    } catch (emailError) {
      log?.error({ err: emailError, orderId }, 'Failed to send order confirmation email')
      // Don't throw - this is non-critical
    }
  }

  // Tell the TEAM a real order just landed (2026-08-07). Before this, the paid
  // path emailed only the customer: the sole team-facing order signals were the
  // stalled-order alert (3 DAYS late) and the 8am daily digest, so ITP's first
  // real order came in and nobody on staff was told. Fail-soft in both halves —
  // an alerting problem must never corrupt a paid order.
  if (order) {
    await notifyTeamOfPaidOrder(order, source, log)
  }

  // Decrement blank-shirt inventory for shirt line items (idempotent — the
  // DB unique index dedupes).
  await decrementBlanksForOrder(orderId)

  // Pay the creators: for each user-generated product on the order, accrue
  // margin (D1: retail − cost_price − fee share; legacy designs: 15% royalty)
  // to the creator's ITC wallet. Idempotent per (order, product).
  await accrueCreatorMarginsForOrder(orderId, log)

  // Notify Darrell V2's merch sales ledger. Emitted AFTER margins accrue so
  // creatorMarginCents can be read back rather than recomputed. Fail-soft:
  // sendMerchOrderEvent never throws, and this catch is a second
  // belt-and-suspenders guard — a delivery failure must never break checkout.
  await sendMerchOrderEvent({ orderId, type: 'order.paid', log }).catch((err) => {
    log?.error({ err, orderId }, '[merch-webhook] emission threw unexpectedly')
  })

  log?.info({
    orderId,
    orderNumber,
    paymentIntentId: paymentIntent.id,
    customerEmail: order?.customer_email,
    source
  }, '✅ Checkout order payment processed successfully')

  return { claimed: true }
}

/**
 * Customer-facing confirmation. Identifies the order by its friendly
 * order_number (never the uuid) and addresses the buyer by name; order.id
 * rides along in the options so the email can mint a tokenized, no-login
 * order-status link.
 */
async function sendOrderConfirmation(order: any) {
  if (!order.customer_email) {
    console.log('[Email] No customer email, skipping order confirmation')
    return
  }

  // `unit_price` is the real column on order_items (see replaceOrderItems in
  // routes/stripe.ts, which writes unit_price/subtotal). The original read
  // `item.price`, which does not exist, so every confirmation email itemised
  // the order at $0.00 while showing the correct grand total. `price` is kept
  // as a fallback in case an older row shape turns up.
  const items = order.order_items?.map((item: any) => ({
    name: item.product_name || 'Product',
    quantity: item.quantity || 1,
    price: Number(item.unit_price ?? item.price ?? 0) || 0
  })) || []

  const customerName =
    order.customer_name ||
    [order.shipping_address?.firstName, order.shipping_address?.lastName].filter(Boolean).join(' ') ||
    undefined

  await sendOrderEmail(
    order.customer_email,
    order.order_number || order.id,
    items,
    order.total || 0,
    customerName,
    { orderId: order.id }
  )
  console.log(`[Email] Order confirmation sent to ${order.customer_email}: Order #${order.order_number}`)
}

/**
 * Admin bell row + immediate email to the fulfilment crew. Two independent
 * try/catch blocks on purpose: a failed insert must not cost us the email, and
 * a failed email must not cost us the bell.
 */
async function notifyTeamOfPaidOrder(order: any, source: PaidOrderSource, log?: Logger): Promise<void> {
  const label = order.order_number || String(order.id).slice(0, 8)
  const total = Number(order.total) || 0
  const itemCount = Array.isArray(order.order_items)
    ? order.order_items.reduce((n: number, i: any) => n + (Number(i.quantity) || 0), 0)
    : 0
  // A reconciler-sourced order means the webhook did NOT arrive. Say so in the
  // alert — otherwise a broken delivery pipeline looks like a normal sale.
  const viaReconciler = source === 'reconciler'

  try {
    const { error } = await supabase.from('admin_notifications').insert({
      type: 'new_order',
      title: `💰 New order ${label} — $${total.toFixed(2)}`,
      message:
        `${itemCount || 'Some'} item(s) from ${order.customer_name || order.customer_email || 'a customer'}. ` +
        `Ready to fulfil.` +
        (viaReconciler ? ' ⚠️ Recovered by the payment reconciler — the Stripe webhook did NOT deliver.' : '')
    })
    if (error) log?.error({ err: error, orderId: order.id }, '[new-order-alert] admin_notifications insert failed')
  } catch (err: any) {
    log?.error({ err, orderId: order.id }, '[new-order-alert] admin_notifications insert threw')
  }

  try {
    const items = (order.order_items || []).map((i: any) => ({
      name: i.product_name || 'Product',
      quantity: Number(i.quantity) || 1,
      size: i.metadata?.size ?? null,
      color: i.metadata?.color ?? null
    }))
    await sendNewOrderTeamEmail({
      orderId: order.id,
      orderNumber: label,
      total,
      customerName: order.customer_name,
      customerEmail: order.customer_email,
      shippingAddress: order.shipping_address,
      // What the customer actually chose — pickup vs delivery vs carrier, rush,
      // and the pickup appointment. Written by snapshotShippingChoice() at
      // checkout; absent on orders created before 2026-08-07.
      shippingChoice: order.metadata?.shipping ?? null,
      items,
      recoveredByReconciler: viaReconciler
    })
  } catch (err: any) {
    log?.error({ err, orderId: order.id }, '[new-order-alert] team email failed')
  }
}
