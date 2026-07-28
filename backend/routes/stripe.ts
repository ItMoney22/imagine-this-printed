import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import { requireAuth, requireRole, optionalAuth } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'
import {
  ITC_PACKAGES,
  findPackageByUSD,
  isValidPackageAmount
} from '../config/itc-pricing.js'
import { processRoyaltyPayment, calculateRoyalty } from '../services/user-royalties.js'
import {
  sendOrderConfirmationEmail as sendOrderEmail,
  sendOrderShippedEmail,
  sendOrderDeliveredEmail
} from '../utils/email.js'
import { decrementBlanksForOrder } from '../services/blank-inventory.js'
import { accrueCreatorMarginsForOrder } from '../services/creator-margins.js'
import { calculateOrderPricing, evaluateCheckoutAmount, type PricingCartItem } from '../services/order-pricing.js'
import { sendMerchOrderEvent } from '../services/merch-webhook.js'
import { processOrderCompletion } from '../services/order-reward-service.js'
import { processReferralFirstPurchase } from '../services/referral-service.js'
import { findCouponIdByCode, recordCouponUsage } from './coupons.js'
import { extractImaginationCartItems, findDpiViolations, DEFAULT_MIN_DPI } from '../services/imagination-dpi-guard.js'
import { imaginationProducts } from '../services/imagination-products.js'
import {
  reverseOrderSideEffects,
  recordRefundOnOrder,
  refundedCentsFromMetadata
} from '../services/order-refunds.js'

const router = Router()

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia'
})

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET

// Rate limiting map (simple in-memory store, use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const userLimit = rateLimitMap.get(userId)

  if (!userLimit || userLimit.resetAt < now) {
    rateLimitMap.set(userId, {
      count: 1,
      resetAt: now + 60000 // 1 minute
    })
    return true
  }

  if (userLimit.count >= 5) {
    return false
  }

  userLimit.count++
  return true
}

// ---------------------------------------------------------------------------
// Checkout order line-item helpers
//
// PRODUCTION SCHEMA (verified live 2026-06-12): order_items columns are
// (id, order_id, product_id uuid, product_name, variant_id, variant_name,
// quantity, unit_price, subtotal, metadata jsonb, created_at).
// The columns this route used to insert (price, total, variations,
// personalization) DO NOT exist in production, so every order_items insert
// failed silently (the error was never checked) and the table held 0 rows —
// orders rendered only through the orders.metadata.items fallback.
//
// product_id is a uuid column: custom client-side cart ids
// ('3d-print-<modelId>', 'imagination-sheet-<id>', 'metal-art-custom-<ts>')
// can never be stored there. One such id used to abort the entire multi-row
// insert (22P02). They are kept in order_items.metadata.client_product_id and
// in the orders.metadata.items snapshot instead, and product_id is nulled.
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Per-unit add-on upsell total (metal-art easel stand, wall mount, etc.).
// Add-ons are priced per unit and were already folded into the charged amount
// client-side — this mirrors that so order_items line totals reconcile and
// fulfillment can see which add-ons to include.
function addonsUnitTotal(item: any): number {
  const addons = item?.selectedAddons
  if (!Array.isArray(addons)) return 0
  return addons.reduce((s: number, a: any) => s + (Number(a?.price) || 0), 0)
}

// Server-side mirror of the Imagination Station's client-side DPI gate
// (Watchtower task b714d855, follow-up to 2ec9eeff). Resolves each distinct
// print type present in the cart to its minDPI via the same DB-backed
// service the /presets route uses (product.minDpi -> rules.minDPI -> 300),
// so a crafted API call or a stale client can't slip a low-DPI design past
// checkout just because it skipped the frontend's hard-block.
async function resolveMinDpiByPrintType(printTypes: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  await Promise.all(printTypes.map(async (printType) => {
    try {
      const product = await imaginationProducts.getProductByType(printType)
      result[printType] = (product?.rules && product.rules.minDPI) || product?.minDpi || DEFAULT_MIN_DPI
    } catch {
      result[printType] = DEFAULT_MIN_DPI
    }
  }))
  return result
}

// Durable cart snapshot stored on orders.metadata.items — what MyOrders and
// the print bridge read for items that have no products row (custom items).
function snapshotCartItems(items: any[] | undefined | null) {
  return (items || []).map((i: any) => ({
    id: i.product?.id ?? null,
    name: i.product?.name ?? null,
    price: i.product?.price ?? 0,
    quantity: i.quantity || 1,
    image: i.product?.images?.[0] ?? null,
    size: i.selectedSize ?? null,
    color: i.selectedColor ?? null,
    // Where on the garment the art prints. Chosen on the product page and
    // carried through the cart — fulfillment needs it or it defaults to front.
    printLocation: i.printLocation ?? null,
    customDesign: i.customDesign ?? null,
    // Selected add-on upsells (metal-art stand/mount/etc.) so MyOrders + the
    // print bridge / fulfillment can see what to include.
    addons: Array.isArray(i.selectedAddons) && i.selectedAddons.length ? i.selectedAddons : null
  }))
}

// Re-sync order_items rows to the current cart (replace, not append — drafts
// are updated on every cart/total change). Failures are logged but do not
// fail checkout: orders.metadata.items still carries the snapshot.
async function replaceOrderItems(orderId: string, items: any[] | undefined | null, req: Request) {
  if (!items || items.length === 0) return
  const rows = items.map((item: any) => {
    const rawId = item.product?.id != null ? String(item.product.id) : null
    const qty = item.quantity || 1
    const addonUnit = addonsUnitTotal(item)
    const hasAddons = Array.isArray(item.selectedAddons) && item.selectedAddons.length > 0
    return {
      order_id: orderId,
      product_id: rawId && UUID_RE.test(rawId) ? rawId : null,
      product_name: item.product?.name || 'Unknown Product',
      quantity: qty,
      unit_price: item.product?.price || 0,
      // Line subtotal includes per-unit add-ons so it reconciles with the
      // amount charged (which already folds add-ons in).
      subtotal: ((item.product?.price || 0) + addonUnit) * qty,
      metadata: {
        client_product_id: rawId,
        image_url: item.product?.images?.[0] ?? null,
        size: item.selectedSize ?? null,
        color: item.selectedColor ?? null,
        print_location: item.printLocation ?? null,
        custom_design: item.customDesign ?? null,
        // Add-on upsells for fulfillment (+ per-unit add-on total).
        addons: hasAddons ? item.selectedAddons : null,
        addons_total: hasAddons ? addonUnit : 0
      }
    }
  })
  const { error: delError } = await supabase.from('order_items').delete().eq('order_id', orderId)
  if (delError) {
    req.log?.error({ err: delError, orderId }, 'Failed to clear order_items before re-sync')
  }
  const { error } = await supabase.from('order_items').insert(rows)
  if (error) {
    req.log?.error({ err: error, orderId }, 'Failed to insert order_items rows (metadata.items snapshot still present)')
  }
}

// POST /api/stripe/checkout-payment-intent - Create or update payment intent for product checkout.
//
// optionalAuth (NOT requireAuth) because /cart and /checkout are intentionally
// public for guest checkout. When the caller IS authenticated, we trust
// req.user.sub over the body-supplied userId — that closes the spoofing hole
// (anyone could previously send any userId in the body and have an order
// associated with that wallet). For guests we still accept the body-supplied
// userId (or null) — guest order rows just won't be tied to a user.
router.post('/checkout-payment-intent', optionalAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { amount, currency, items, shipping, couponCode, userId: bodyUserId, shippingCost, itcCreditAmount, itcCreditUSD, existingPaymentIntentId, existingOrderId, shippingType, rush } = req.body
    // Authenticated callers: use the JWT subject. Guests: trust the body
    // (or null) because there's no logged-in user to verify against.
    const userId = req.user?.sub ?? bodyUserId ?? null
    // ITC store-credit and per-user coupon limits are only ever honored for a
    // caller we've actually authenticated via the JWT — never a body-supplied
    // guest id, which anyone could spoof to drain someone else's wallet.
    const trustedUserId = req.user?.sub ?? null

    // Validate currency
    if (currency !== 'usd') {
      return res.status(400).json({ error: 'Only USD currency is supported' })
    }

    // -----------------------------------------------------------------------
    // SECURITY (Watchtower task b714d855): re-check every Imagination Station
    // item's image layers against its print type's minDPI server-side. The
    // client already hard-blocks this in the editor (task 2ec9eeff), but that
    // is a UI-only gate — this is the actual cart-addition/order-creation
    // choke point, so it's where a bypassed or stale client gets caught.
    // Runs before pricing/order writes so a violation aborts cleanly with no
    // partial order.
    // -----------------------------------------------------------------------
    const imaginationCartItems = extractImaginationCartItems(items)
    if (imaginationCartItems.length > 0) {
      const printTypes = Array.from(new Set(imaginationCartItems.map(i => i.printType)))
      const minDpiByPrintType = await resolveMinDpiByPrintType(printTypes)
      const dpiViolations = findDpiViolations(imaginationCartItems, minDpiByPrintType)
      if (dpiViolations.length > 0) {
        req.log?.warn({ violations: dpiViolations }, 'Checkout blocked — Imagination Station design(s) below print-type minDPI')
        return res.status(400).json({
          error: 'Print quality too low',
          message: `${dpiViolations.length} design${dpiViolations.length !== 1 ? 's' : ''} below the minimum DPI required for printing. Shrink, re-upload, or upscale before ordering.`,
          violations: dpiViolations.map(v => ({ item: v.itemIndex, layer: v.layerName, dpi: v.dpi, minDPI: v.minDPI, printType: v.printType }))
        })
      }
    }

    // -----------------------------------------------------------------------
    // SECURITY (Watchtower task 9a8431d9): the client-supplied `amount`,
    // `tax`, `discount`, and `shippingCost` are NEVER trusted. The server
    // independently recomputes the whole order — line prices from the DB,
    // discount from the coupon table, tax from a state rate table, shipping
    // bounds-checked — and THAT number is what gets charged, always. See
    // backend/services/order-pricing.ts for the engine and its documented
    // scope/known gaps.
    // -----------------------------------------------------------------------
    const pricingItems: PricingCartItem[] = (items || []).map((item: any) => ({
      productId: item?.product?.id != null ? String(item.product.id) : null,
      quantity: item?.quantity || 1,
      selectedSize: item?.selectedSize ?? null,
      selectedAddonIds: Array.isArray(item?.selectedAddons) ? item.selectedAddons.map((a: any) => a?.id) : [],
      clientUnitPriceDollars: item?.product?.price != null ? Number(item.product.price) : null
    }))

    let pricing
    try {
      pricing = await calculateOrderPricing({
        items: pricingItems,
        shippingAddress: { state: shipping?.state, postalCode: shipping?.zipCode, country: shipping?.country },
        shipping: {
          type: shippingType,
          clientAmountCents: Math.round((Number(shippingCost) || 0) * 100),
          rush: !!rush
        },
        couponCode: couponCode || null,
        userId: trustedUserId,
        itcCreditRequested: Number(itcCreditAmount) || 0
      })
    } catch (pricingError: any) {
      req.log?.error({ err: pricingError }, 'Error computing server-side order pricing')
      return res.status(500).json({ error: 'Failed to price order', message: pricingError.message })
    }

    if (pricing.errors.length > 0) {
      req.log?.warn({ errors: pricing.errors }, 'Checkout pricing could not be verified')
      return res.status(400).json({ error: 'Invalid order — pricing could not be verified', details: pricing.errors })
    }

    const serverAmountCents = pricing.totalCents

    // Stripe's own floor, checked against the AUTHORITATIVE server total.
    if (serverAmountCents < 50) {
      return res.status(400).json({ error: 'Invalid amount - minimum is $0.50' })
    }

    // Anti-tampering gate: reject when the client's number and the server's
    // number disagree by more than a cent of rounding slack. The response
    // carries the real numbers back so an honest client (whose only "offense"
    // is a stale local estimate — see src/pages/Checkout.tsx) can resync and
    // retry instead of getting stuck.
    const pricingResponse = {
      subtotal: pricing.productSubtotalCents / 100,
      discount: pricing.discountCents / 100,
      shipping: pricing.shippingCents / 100,
      tax: pricing.taxCents / 100,
      taxRate: pricing.taxRate,
      total: serverAmountCents / 100
    }
    const amountCheck = evaluateCheckoutAmount(Number(amount), serverAmountCents)
    if (!amountCheck.ok) {
      req.log?.warn({ clientAmount: amount, serverAmount: serverAmountCents }, 'Checkout amount mismatch — rejecting (possible tampering or stale client estimate)')
      return res.status(400).json({ error: amountCheck.error, pricing: pricingResponse })
    }

    // From here on, every dollar figure comes from `pricing` — never `amount`,
    // `tax`, `discount`, or `shippingCost` off the request body.
    const subtotal = pricingResponse.subtotal
    const serverDiscountAmount = pricingResponse.discount
    const serverShippingAmount = pricingResponse.shipping
    const serverTaxAmount = pricingResponse.tax

    // If we have an existing payment intent and order, update them instead of creating new
    if (existingPaymentIntentId && existingOrderId) {
      try {
        // Update the existing payment intent amount — server-calculated, never the client's.
        const updatedPaymentIntent = await stripe.paymentIntents.update(existingPaymentIntentId, {
          amount: serverAmountCents,
          metadata: {
            couponCode: couponCode || '',
            discount: serverDiscountAmount.toString(),
            shippingCost: serverShippingAmount.toString()
          }
        })

        // Merge metadata so the items snapshot tracks the CURRENT cart (the
        // draft may have been created before an item — e.g. a 3D print — was
        // added) without clobbering unrelated keys (print status, etc.).
        const { data: existingOrder } = await supabase
          .from('orders')
          .select('metadata, user_id')
          .eq('id', existingOrderId)
          .single()
        const mergedMetadata = {
          ...(existingOrder?.metadata && typeof existingOrder.metadata === 'object' ? existingOrder.metadata : {}),
          items: snapshotCartItems(items),
          itc_credit_amount: itcCreditAmount || 0,
          itc_credit_usd: itcCreditUSD || 0
        }

        // Update the existing order
        await supabase
          .from('orders')
          .update({
            subtotal: subtotal,
            tax_amount: serverTaxAmount,
            shipping_amount: serverShippingAmount,
            discount_amount: serverDiscountAmount,
            total: serverAmountCents / 100,
            discount_codes: couponCode ? [couponCode] : [],
            shipping_address: {
              firstName: shipping?.firstName,
              lastName: shipping?.lastName,
              address: shipping?.address,
              city: shipping?.city,
              state: shipping?.state,
              zipCode: shipping?.zipCode,
              country: shipping?.country || 'US',
              email: shipping?.email
            },
            customer_email: shipping?.email || null,
            customer_name: `${shipping?.firstName || ''} ${shipping?.lastName || ''}`.trim() || null,
            metadata: mergedMetadata,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingOrderId)

        // Claim ownership of guest drafts: if the caller is authenticated and
        // the draft has no user yet (created while logged out / with an
        // expired session), attach it so /api/orders/my can find it. Never
        // reassign an order that already belongs to a user.
        if (req.user?.sub && existingOrder && !existingOrder.user_id) {
          await supabase
            .from('orders')
            .update({ user_id: req.user.sub })
            .eq('id', existingOrderId)
            .is('user_id', null)
        }

        // Re-sync line items to the current cart
        await replaceOrderItems(existingOrderId, items, req)

        req.log?.info({
          paymentIntentId: existingPaymentIntentId,
          orderId: existingOrderId,
          amount: serverAmountCents / 100,
          shippingCost: serverShippingAmount,
          discount: serverDiscountAmount
        }, 'Updated existing payment intent and order')

        return res.json({
          clientSecret: updatedPaymentIntent.client_secret,
          paymentIntentId: updatedPaymentIntent.id,
          orderId: existingOrderId,
          updated: true,
          pricing: pricingResponse
        })
      } catch (updateError: any) {
        // If update fails (e.g., payment intent already confirmed), create new
        req.log?.warn({ err: updateError, existingPaymentIntentId }, 'Failed to update existing payment intent, creating new one')
      }
    }

    // Generate order number
    const orderNumber = `ITP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`

    // Create order in database
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: userId || null,
        customer_email: shipping?.email || null,
        customer_name: `${shipping?.firstName || ''} ${shipping?.lastName || ''}`.trim() || null,
        subtotal: subtotal,
        tax_amount: serverTaxAmount,
        shipping_amount: serverShippingAmount,
        discount_amount: serverDiscountAmount,
        total: serverAmountCents / 100,
        currency: 'USD',
        status: 'pending',
        payment_status: 'pending',
        fulfillment_status: 'unfulfilled',
        payment_method: 'stripe',
        shipping_address: {
          firstName: shipping?.firstName,
          lastName: shipping?.lastName,
          address: shipping?.address,
          city: shipping?.city,
          state: shipping?.state,
          zipCode: shipping?.zipCode,
          country: shipping?.country || 'US',
          email: shipping?.email
        },
        discount_codes: couponCode ? [couponCode] : [],
        source: 'web',
        metadata: {
          items: snapshotCartItems(items),
          itc_credit_amount: itcCreditAmount || 0,
          itc_credit_usd: itcCreditUSD || 0
        }
      })
      .select()
      .single()

    if (orderError) {
      req.log?.error({ err: orderError }, 'Error creating order in database')
      return res.status(500).json({ error: 'Failed to create order', message: orderError.message })
    }

    // Create order items (schema-safe; errors logged inside, never silent)
    await replaceOrderItems(order.id, items, req)

    // Build description from items
    const itemDescriptions = items?.map((item: any) =>
      `${item.quantity}x ${item.product?.name || 'Product'}`
    ).join(', ') || 'Order'

    // Create payment intent — server-calculated amount, never the client's.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: serverAmountCents,
      currency,
      description: `Order ${orderNumber}: ${itemDescriptions}`,
      metadata: {
        orderId: order.id,
        orderNumber: orderNumber,
        userId: userId || '',
        items: JSON.stringify(items?.map((i: any) => ({
          id: i.product?.id,
          name: i.product?.name,
          qty: i.quantity
        })) || []),
        couponCode: couponCode || '',
        discount: serverDiscountAmount.toString(),
        shippingCost: serverShippingAmount.toString(),
        shippingCity: shipping?.city || '',
        shippingState: shipping?.state || '',
        shippingCountry: shipping?.country || 'US',
        itcCreditAmount: itcCreditAmount?.toString() || '0',
        itcCreditUSD: itcCreditUSD?.toString() || '0'
      },
      // Note: We don't set receipt_email - we send our own branded Mr. Imagine emails via Resend
      automatic_payment_methods: {
        enabled: true
      }
    })

    // Update order with payment intent ID
    await supabase
      .from('orders')
      .update({ payment_intent_id: paymentIntent.id })
      .eq('id', order.id)

    req.log?.info({
      paymentIntentId: paymentIntent.id,
      orderId: order.id,
      orderNumber: orderNumber,
      amount: serverAmountCents / 100,
      shippingCost: serverShippingAmount,
      discount: serverDiscountAmount,
      itemCount: items?.length || 0
    }, 'Checkout payment intent and order created')

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      orderId: order.id,
      orderNumber: orderNumber,
      pricing: pricingResponse
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error creating checkout payment intent')
    return res.status(500).json({
      error: 'Failed to create payment intent',
      message: error.message
    })
  }
})

// POST /api/stripe/create-payment-intent - Create payment intent for ITC token purchase
router.post('/create-payment-intent', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { amount, currency, description, metadata } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Rate limit check
    if (!checkRateLimit(userId)) {
      return res.status(429).json({ error: 'Too many payment attempts. Please try again later.' })
    }

    // Validate amount
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    // Convert cents to dollars for package validation
    const amountInDollars = amount / 100

    // Validate against predefined packages
    if (!isValidPackageAmount(amountInDollars)) {
      return res.status(400).json({
        error: 'Invalid package amount',
        validAmounts: ITC_PACKAGES.map(pkg => pkg.priceUSD)
      })
    }

    // Get package details
    const packageDetails = findPackageByUSD(amountInDollars)
    if (!packageDetails) {
      return res.status(400).json({ error: 'Package not found' })
    }

    // Validate currency
    if (currency !== 'usd') {
      return res.status(400).json({ error: 'Only USD currency is supported' })
    }

    // Get user email from user_profiles
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('user_id', userId)
      .single()

    if (profileError || !profile) {
      req.log?.error({ err: profileError }, 'Failed to fetch user profile')
      return res.status(500).json({ error: 'Failed to fetch user profile' })
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount, // Amount in cents
      currency,
      description: description || `Purchase ${packageDetails.itcAmount} ITC`,
      metadata: {
        userId,
        itcAmount: packageDetails.itcAmount.toString(),
        packagePriceUSD: amountInDollars.toString(),
        bonusPercent: (packageDetails.bonusPercent || 0).toString(),
        ...metadata
      },
      // Note: We don't set receipt_email - we send our own branded Mr. Imagine emails via Resend
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      }
    })

    req.log?.info({
      paymentIntentId: paymentIntent.id,
      userId,
      amount: amountInDollars,
      itcAmount: packageDetails.itcAmount
    }, 'Payment intent created')

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      itcAmount: packageDetails.itcAmount,
      bonusPercent: packageDetails.bonusPercent || 0
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error creating payment intent')
    return res.status(500).json({
      error: 'Failed to create payment intent',
      message: error.message
    })
  }
})

// POST /api/stripe/webhook - Stripe webhook handler
router.post('/webhook', async (req: Request, res: Response): Promise<any> => {
  const sig = req.headers['stripe-signature']

  if (!sig) {
    return res.status(400).json({ error: 'No signature provided' })
  }

  if (!STRIPE_WEBHOOK_SECRET) {
    req.log?.error('STRIPE_WEBHOOK_SECRET not configured')
    return res.status(500).json({ error: 'Webhook secret not configured' })
  }

  let event: Stripe.Event

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      STRIPE_WEBHOOK_SECRET
    )
  } catch (error: any) {
    req.log?.error({ err: error }, 'Webhook signature verification failed')
    return res.status(400).json({ error: `Webhook Error: ${error.message}` })
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        await handlePaymentSuccess(paymentIntent, req)
        break
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        await handlePaymentFailure(paymentIntent, req)
        break
      }

      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        req.log?.info({
          paymentIntentId: paymentIntent.id,
          userId: paymentIntent.metadata.userId
        }, 'Payment canceled')
        break
      }

      // Refund gap (Watchtower task c83da451): ITP had NO refund handling at
      // all before this — ported nothing, this is new. Resolves the charge
      // back to an ITP order via orders.payment_intent_id (written in
      // handleCheckoutOrderPayment once a payment succeeds), so it only
      // covers orders that have already gone through that paid path.
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        await handleChargeRefunded(charge, req)
        break
      }

      // Chargebacks (Watchtower task c1b0182f). Every charge.dispute.* event
      // carries a Stripe.Dispute; a single handler branches on the event type
      // so no dispute lifecycle stage silently lands in the default
      // log-and-ignore branch the way all of them used to.
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.funds_withdrawn':
      case 'charge.dispute.funds_reinstated':
      case 'charge.dispute.closed': {
        const dispute = event.data.object as Stripe.Dispute
        await handleChargeDispute(dispute, event.type, req)
        break
      }

      // ===============================
      // STRIPE CONNECT EVENTS (ported from the now-removed routes/webhooks.ts
      // POST /stripe — that route could never verify its signature, since
      // index.ts only gives raw body to /api/stripe/webhook, so these events
      // never reliably processed there)
      // ===============================
      case 'account.updated': {
        const account = event.data.object as Stripe.Account
        // Pure state-sync (mirrors Stripe's current account fields) — safe to
        // re-apply on a redelivery with no guard, so none is added here.
        req.log?.info({ accountId: account.id }, '[Stripe Connect Webhook] Account updated')
        const { handleConnectAccountUpdate } = await import('../services/stripe-connect.js')
        await handleConnectAccountUpdate(account)
        break
      }

      case 'payout.paid': {
        const payout = event.data.object as Stripe.Payout
        if (event.account) {
          const cashoutRequestId = payout.metadata?.cashout_request_id
          if (cashoutRequestId) {
            const { data: existing } = await supabase
              .from('itc_cashout_requests')
              .select('status')
              .eq('id', cashoutRequestId)
              .maybeSingle()
            if (existing?.status === 'paid') {
              req.log?.info({ payoutId: payout.id, cashoutRequestId }, 'Cashout already marked paid — duplicate webhook delivery, skipping')
              break
            }
          }
          req.log?.info({ payoutId: payout.id, account: event.account }, '[Stripe Connect Webhook] Payout paid')
          const { handlePayoutPaid } = await import('../services/stripe-connect.js')
          await handlePayoutPaid(payout, event.account)
        }
        break
      }

      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout
        if (event.account) {
          const cashoutRequestId = payout.metadata?.cashout_request_id
          // Idempotency claim — same atomic pattern as the checkout-order guard
          // above: flip status to 'failed' only if it isn't already, so a
          // redelivered payout.failed can't refund ITC to the wallet twice.
          if (cashoutRequestId) {
            const { claimOnce } = await import('../lib/webhook-helpers.js')
            const claim = await claimOnce(
              supabase
                .from('itc_cashout_requests')
                .update({ status: 'failed' })
                .eq('id', cashoutRequestId)
                .neq('status', 'failed')
                .select('id')
            )
            if (claim.error) {
              req.log?.error({ err: claim.error, cashoutRequestId }, 'Failed to claim cashout request for payout.failed')
            }
            if (!claim.claimed) {
              req.log?.info({ payoutId: payout.id, cashoutRequestId }, 'Cashout already failed — duplicate webhook delivery, skipping ITC refund')
              break
            }
          }
          req.log?.info({ payoutId: payout.id, account: event.account }, '[Stripe Connect Webhook] Payout failed')
          const { handlePayoutFailed } = await import('../services/stripe-connect.js')
          await handlePayoutFailed(payout, event.account)
        }
        break
      }

      // ===============================
      // FOUNDER INVOICE EVENTS (ported from routes/webhooks.ts — same reason
      // as the Connect events above)
      // ===============================
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoicePaid(invoice, req)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await handleInvoicePaymentFailed(invoice, req)
        break
      }

      default:
        req.log?.info({ eventType: event.type }, 'Unhandled event type')
    }

    return res.json({ received: true })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error processing webhook')
    return res.status(500).json({ error: 'Webhook processing failed' })
  }
})

// Handle successful payment
async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent, req: Request) {
  const { userId, itcAmount, packagePriceUSD, orderId, orderNumber, productId } = paymentIntent.metadata

  // Determine payment type: ITC purchase, checkout order, or legacy product order
  const isITCPurchase = itcAmount && packagePriceUSD
  const isCheckoutOrder = orderId && orderNumber && !productId
  const isLegacyProductOrder = orderId && productId

  // Handle ITC token purchase
  if (isITCPurchase) {
    if (!userId) {
      req.log?.error({ metadata: paymentIntent.metadata }, 'Missing userId in ITC purchase metadata')
      throw new Error('Missing userId in metadata')
    }
    await handleITCPurchase(paymentIntent, req)
    return
  }

  // Handle checkout order (product order from checkout page)
  if (isCheckoutOrder) {
    await handleCheckoutOrderPayment(paymentIntent, req)
    return
  }

  // Handle legacy product order payment
  if (isLegacyProductOrder) {
    if (!userId) {
      req.log?.error({ metadata: paymentIntent.metadata }, 'Missing userId in product order metadata')
      throw new Error('Missing userId in metadata')
    }
    await handleProductOrderPayment(paymentIntent, req)
    return
  }

  req.log?.warn({ metadata: paymentIntent.metadata }, 'Payment type could not be determined')
}

// Handle checkout order payment (from checkout page)
async function handleCheckoutOrderPayment(paymentIntent: Stripe.PaymentIntent, req: Request) {
  const { orderId, orderNumber, userId, itcCreditAmount, itcCreditUSD } = paymentIntent.metadata

  if (!orderId) {
    req.log?.error({ metadata: paymentIntent.metadata }, 'Missing orderId in checkout order metadata')
    throw new Error('Missing orderId in metadata')
  }

  req.log?.info({
    orderId,
    orderNumber,
    amount: paymentIntent.amount,
    itcCreditAmount,
    itcCreditUSD
  }, 'Processing checkout order payment')

  // Idempotency claim — Stripe retries webhook deliveries. Flipping
  // payment_status is the atomic gate (single UPDATE … WHERE != 'paid'): if
  // another delivery already claimed this order, skip ALL side effects.
  // Without this, the ITC deduction below double-charged wallets on retries.
  const { data: claimedRows, error: orderUpdateError } = await supabase
    .from('orders')
    .update({
      status: 'processing',
      payment_status: 'paid',
      payment_intent_id: paymentIntent.id,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId)
    .neq('payment_status', 'paid')
    .select('id')

  if (orderUpdateError) {
    req.log?.error({ err: orderUpdateError, orderId }, 'Failed to update order status')
    throw new Error('Failed to update order status')
  }
  if (!claimedRows || claimedRows.length === 0) {
    req.log?.info(
      { orderId, paymentIntentId: paymentIntent.id },
      'Order already marked paid — duplicate webhook delivery, skipping side effects'
    )
    return
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
        req.log?.error({ err: walletError, userId }, 'Failed to fetch wallet for ITC deduction')
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
          req.log?.error({ err: updateError, userId }, 'Failed to deduct ITC from wallet')
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
          if (creditLedgerError) req.log?.error({ err: creditLedgerError, userId }, 'Failed to log ITC store-credit ledger')

          req.log?.info({
            userId,
            itcDeducted: itcAmount,
            newBalance,
            orderId
          }, 'ITC store credit deducted successfully')
        }
      }
    } catch (itcError: any) {
      req.log?.error({ err: itcError, userId, itcAmount }, 'Error processing ITC credit deduction')
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
    req.log?.error({ err: orderError, orderId }, 'Failed to fetch order details')
    // Don't throw - order was updated successfully
  }

  // Award order rewards + first-purchase referral bonus, and record coupon
  // redemption. Previously NONE of this fired from the paid webhook:
  // processOrderCompletion/processReferralFirstPurchase were only reachable
  // from the admin-only POST /api/orders/:orderId/complete (no frontend
  // caller), and POST /api/coupons/apply had no callers anywhere — so a real
  // customer checkout never earned points, never triggered a referral bonus,
  // and never actually enforced a coupon's max_uses/per-user limit. This runs
  // only once we've won the idempotency claim above (a webhook redelivery
  // returns before reaching this point), and processOrderCompletion /
  // processReferralFirstPurchase each have their own internal dedup guard as
  // a second layer. None of this should ever fail the webhook response — the
  // payment already succeeded — so every failure here is logged and swallowed.
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
        req.log?.error({ orderId, err: rewardResult.error }, '[rewards] Failed to award order rewards')
      }

      // Safe to call unconditionally — processReferralFirstPurchase only
      // actually awards ITC the first time (checks for an existing
      // 'purchase'-type referral_transactions row for this user first).
      if (rewardsUserId) {
        const referralResult = await processReferralFirstPurchase(rewardsUserId, orderTotalUsd)
        if (referralResult.success) {
          req.log?.info({ orderId, referrerId: referralResult.referrerId, bonus: referralResult.bonusITC }, '[rewards] Referral first-purchase bonus awarded')
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
          req.log?.warn({ orderId, couponCode }, '[coupons] Could not resolve coupon id for redemption recording')
        }
      }
    } catch (rewardsError: any) {
      req.log?.error({ err: rewardsError, orderId }, '[rewards] Reward/referral/coupon post-processing error')
    }
  }

  // Send order confirmation email
  if (order?.customer_email) {
    try {
      await sendOrderConfirmationEmail(order)
    } catch (emailError) {
      req.log?.error({ err: emailError, orderId }, 'Failed to send order confirmation email')
      // Don't throw - this is non-critical
    }
  }

  // Decrement blank-shirt inventory for shirt line items (idempotent — the
  // webhooks.ts fallback path calls this too; the DB unique index dedupes).
  await decrementBlanksForOrder(orderId)

  // Pay the creators: for each user-generated product on the order, accrue
  // margin (D1: retail − cost_price − fee share; legacy designs: 15% royalty)
  // to the creator's ITC wallet. Idempotent per (order, product) — safe on
  // webhook retries and across both paid paths. This used to be a dead branch
  // for storefront checkouts (no productId in payment metadata), so external
  // storefront sales never paid creators.
  await accrueCreatorMarginsForOrder(orderId, req.log)

  // Notify Darrell V2's merch sales ledger (docs/merch-orders-webhook.md
  // there). Emitted AFTER margins accrue so creatorMarginCents can be read
  // back rather than recomputed. Fail-soft: sendMerchOrderEvent never throws,
  // and this catch is a second belt-and-suspenders guard — a delivery
  // failure must never break checkout.
  await sendMerchOrderEvent({ orderId, type: 'order.paid', log: req.log }).catch((err) => {
    req.log?.error({ err, orderId }, '[merch-webhook] emission threw unexpectedly')
  })

  req.log?.info({
    orderId,
    orderNumber,
    paymentIntentId: paymentIntent.id,
    customerEmail: order?.customer_email
  }, '✅ Checkout order payment processed successfully')
}

// Resolve a Stripe charge/dispute back to an ITP order. Primary key is
// orders.payment_intent_id (written by handleCheckoutOrderPayment once a
// payment succeeds), with charge_id as a fallback for orders created by other
// paths. Returns null when nothing matches — a Stripe account can carry charges
// that were never ITP orders.
async function findOrderForCharge(
  paymentIntentId: string | null | undefined,
  chargeId: string | null | undefined,
  req: Request
): Promise<{ id: string; status: string | null; payment_status: string | null; total: number | null; metadata: any } | null> {
  const select = 'id, status, payment_status, total, metadata'

  if (paymentIntentId) {
    const { data, error } = await supabase
      .from('orders')
      .select(select)
      .eq('payment_intent_id', paymentIntentId)
      .maybeSingle()
    if (error) {
      req.log?.error({ err: error, paymentIntentId }, '[stripe-webhook] Order lookup by payment_intent_id failed')
    } else if (data) {
      return data as any
    }
  }

  if (chargeId) {
    const { data, error } = await supabase
      .from('orders')
      .select(select)
      .eq('charge_id', chargeId)
      .maybeSingle()
    if (error) {
      req.log?.error({ err: error, chargeId }, '[stripe-webhook] Order lookup by charge_id failed')
    } else if (data) {
      return data as any
    }
  }

  return null
}

// Mark an order fully refunded and reverse its paid-order side effects.
//
// The UPDATE is the single idempotency gate for the whole refund pipeline: the
// admin endpoint and the charge.refunded webhook both funnel through here, and
// whichever arrives first wins the claim and runs the reversals exactly once.
// A loser (redelivered webhook, or the webhook racing the admin call that
// triggered it) returns claimed:false and does nothing.
async function claimAndReverseRefundedOrder(
  orderId: string,
  req: Request,
  opts: { actorUserId?: string | null; refund?: Record<string, any>; action?: string } = {}
): Promise<{ claimed: boolean; report?: Awaited<ReturnType<typeof reverseOrderSideEffects>> }> {
  const { claimOnce } = await import('../lib/webhook-helpers.js')
  const claim = await claimOnce(
    supabase
      .from('orders')
      // fulfillment_status is deliberately left alone: an order can be
      // refunded after it shipped, and overwriting 'fulfilled' would erase
      // real fulfillment history. Nothing needs it changed —
      // services/order-monitor.ts gates its stalled-order sweep on
      // payment_status = 'paid', which this update already clears.
      .update({
        status: 'refunded',
        payment_status: 'refunded',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .neq('status', 'refunded')
      .select('id')
  )
  if (claim.error) {
    req.log?.error({ err: claim.error, orderId }, '[refund] Failed to claim order for refund')
    return { claimed: false }
  }
  if (!claim.claimed) {
    req.log?.info({ orderId }, '[refund] Order already refunded — skipping side-effect reversal')
    // Still record the refund line itself: a partial refund followed by the
    // one that tips it to full must not lose its money trail.
    if (opts.refund) {
      await recordRefundOnOrder({
        orderId,
        refund: opts.refund,
        actorUserId: opts.actorUserId ?? null,
        action: opts.action ?? 'order_refunded',
        log: req.log
      })
    }
    return { claimed: false }
  }

  const report = await reverseOrderSideEffects(orderId, req.log)

  await recordRefundOnOrder({
    orderId,
    refund: opts.refund,
    report,
    actorUserId: opts.actorUserId ?? null,
    action: opts.action ?? 'order_refunded',
    log: req.log
  })

  // A failed reversal is an operational problem, not a payment problem — the
  // money already moved. Raise it where an admin will see it.
  if (!report.ok) {
    const { error: notifErr } = await supabase.from('admin_notifications').insert({
      // 'order_stalled' rather than a new type: it already passes the live
      // admin_notifications type CHECK, so this alert reaches the bell even on
      // a database that hasn't applied 20260727_refunds_and_disputes.sql.
      type: 'order_stalled',
      title: `Refund reversal needs manual fix — order ${orderId}`,
      message:
        `A refund settled but one or more side effects failed to reverse. ` +
        `store credit: ${report.itcStoreCredit.ok ? 'ok' : report.itcStoreCredit.reason}; ` +
        `inventory: ${report.inventory.ok ? 'ok' : report.inventory.reason}; ` +
        `creator margins: ${report.creatorMargins.ok ? 'ok' : report.creatorMargins.reason}; ` +
        `loyalty ITC: ${report.loyaltyItc.ok ? 'ok' : report.loyaltyItc.reason}; ` +
        `referral bonus: ${report.referralBonus.ok ? 'ok' : report.referralBonus.reason}; ` +
        `coupon usage: ${report.couponUsage.ok ? 'ok' : report.couponUsage.reason}`
    })
    if (notifErr) {
      req.log?.error({ err: notifErr, orderId }, '[refund] Failed to raise reversal-failure notification')
    }
  }

  await sendMerchOrderEvent({ orderId, type: 'order.refunded', log: req.log }).catch((err) => {
    req.log?.error({ err, orderId }, '[merch-webhook] emission threw unexpectedly')
  })

  return { claimed: true, report }
}

// Handle charge.refunded — resolve the Stripe charge back to an ITP order and,
// for a FULL refund, mark it refunded and reverse the paid-order side effects
// (ITC store credit, blank inventory, creator margins).
//
// A PARTIAL refund (charge.refunded === false) moves money but leaves the order
// intact: ITP has no line-level refund model, so proportionally unwinding
// inventory or a creator's margin would be a guess. The partial amount is
// recorded on orders.metadata.refunds and payment_status becomes
// 'partially_refunded' so it is visible and reconcilable — see the admin
// endpoint below, which enforces the same rule.
async function handleChargeRefunded(charge: Stripe.Charge, req: Request) {
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id

  const order = await findOrderForCharge(paymentIntentId, charge.id, req)
  if (!order) {
    req.log?.info({ paymentIntentId, chargeId: charge.id }, '[stripe-webhook] No ITP order matches this charge — skipping')
    return
  }

  // What Stripe reports as refunded, minus what we have already recorded, is
  // this delivery's new money. Stripe is the source of truth for the running
  // total, so a webhook that arrives after the admin endpoint already recorded
  // its own refund adds nothing.
  const alreadyRecordedCents = refundedCentsFromMetadata(order.metadata)
  const newlyRefundedCents = Math.max(0, (charge.amount_refunded || 0) - alreadyRecordedCents)

  // The refund id is what de-dupes this webhook's record against the one the
  // admin endpoint wrote for the same refund. charge.refunds is NOT expanded by
  // default on API version 2025-02-24.acacia, so relying on it alone would
  // yield a null id — and a null id can't match, which would double-count the
  // refund on orders.metadata.refunds and block later partials. Fetch it.
  let stripeRefundId: string | null = charge.refunds?.data?.[0]?.id ?? null
  if (!stripeRefundId && newlyRefundedCents > 0) {
    try {
      const list = await stripe.refunds.list({ charge: charge.id, limit: 1 })
      stripeRefundId = list.data[0]?.id ?? null
    } catch (listErr: any) {
      req.log?.warn({ err: listErr, chargeId: charge.id }, '[stripe-webhook] Could not resolve refund id for charge — recording without it')
    }
  }

  const refundRecord = newlyRefundedCents > 0
    ? {
        stripe_refund_id: stripeRefundId,
        stripe_charge_id: charge.id,
        amount_cents: newlyRefundedCents,
        currency: charge.currency,
        full: !!charge.refunded,
        source: 'stripe_webhook',
        created_at: new Date().toISOString()
      }
    : undefined

  if (!charge.refunded) {
    // Partial: money only, no reversal.
    const { error } = await supabase
      .from('orders')
      .update({ payment_status: 'partially_refunded', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .neq('payment_status', 'refunded')
    if (error) {
      req.log?.error({ err: error, orderId: order.id }, '[stripe-webhook] Failed to mark order partially refunded')
    }
    await recordRefundOnOrder({
      orderId: order.id,
      refund: refundRecord,
      action: 'order_partially_refunded',
      log: req.log
    })
    req.log?.info({
      orderId: order.id,
      chargeId: charge.id,
      amountRefunded: charge.amount_refunded,
      amount: charge.amount
    }, '[stripe-webhook] Partial refund recorded — side effects intentionally NOT reversed (no line-level refund model)')
    return
  }

  const { claimed } = await claimAndReverseRefundedOrder(order.id, req, { refund: refundRecord })
  req.log?.info({ orderId: order.id, chargeId: charge.id, claimed }, '[stripe-webhook] charge.refunded processed')
}

// Handle charge.dispute.* — chargebacks.
//
// Lifecycle mapping (Watchtower task c1b0182f):
//   created / funds_withdrawn  → freeze the order (status 'on_hold',
//                                payment_status 'disputed') so fulfillment
//                                stops while the dispute is open, and alert
//                                admins. The order's pre-dispute status is
//                                stashed so a win can restore it.
//   updated                    → refresh the stored dispute snapshot only.
//   closed(lost) / funds_withdrawn-after-loss
//                              → the money is gone for good, so this is
//                                treated exactly like a full refund: the order
//                                is claimed and every side effect reversed.
//   closed(won) / funds_reinstated
//                              → restore payment_status 'paid' and the stashed
//                                status; nothing to reverse.
//
// These events are state syncs and safe to re-apply, so no claim is needed
// except on the 'lost' path, which routes through the same
// claimAndReverseRefundedOrder() gate every other refund uses.
async function handleChargeDispute(dispute: Stripe.Dispute, eventType: string, req: Request) {
  const paymentIntentId = typeof dispute.payment_intent === 'string'
    ? dispute.payment_intent
    : dispute.payment_intent?.id
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id

  const order = await findOrderForCharge(paymentIntentId, chargeId, req)
  if (!order) {
    req.log?.warn({
      disputeId: dispute.id,
      eventType,
      paymentIntentId,
      chargeId
    }, '[stripe-webhook] Dispute received for a charge with no matching ITP order — logged only')
    return
  }

  const existingMeta = order.metadata && typeof order.metadata === 'object' ? order.metadata : {}
  const priorDispute = existingMeta.dispute && typeof existingMeta.dispute === 'object' ? existingMeta.dispute : {}

  const snapshot = {
    id: dispute.id,
    charge_id: chargeId ?? null,
    status: dispute.status,
    reason: dispute.reason,
    amount_cents: dispute.amount,
    currency: dispute.currency,
    is_charge_refundable: dispute.is_charge_refundable,
    evidence_due_by: dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : null,
    // Keep the first status the order carried before the dispute so a win can
    // put it back where it was.
    previous_order_status: priorDispute.previous_order_status ?? order.status ?? null,
    previous_payment_status: priorDispute.previous_payment_status ?? order.payment_status ?? null,
    last_event: eventType,
    updated_at: new Date().toISOString(),
    created_at: priorDispute.created_at ?? new Date().toISOString()
  }

  const lost = dispute.status === 'lost'
  const won = dispute.status === 'won' || dispute.status === 'warning_closed'

  // Persist the snapshot first so it survives whatever branch runs next.
  const { error: metaErr } = await supabase
    .from('orders')
    .update({ metadata: { ...existingMeta, dispute: snapshot }, updated_at: new Date().toISOString() })
    .eq('id', order.id)
  if (metaErr) {
    req.log?.error({ err: metaErr, orderId: order.id, disputeId: dispute.id }, '[stripe-webhook] Failed to persist dispute snapshot')
  }

  await supabase.from('audit_logs').insert({
    user_id: null,
    action: `stripe_${eventType.replace(/\./g, '_')}`,
    entity: 'order',
    entity_id: order.id,
    changes: { dispute_status: dispute.status, reason: dispute.reason, amount_cents: dispute.amount },
    metadata: snapshot,
    created_at: new Date().toISOString()
  })

  if (lost) {
    // Funds are gone — same treatment as a full refund.
    const { claimed } = await claimAndReverseRefundedOrder(order.id, req, {
      action: 'order_dispute_lost',
      refund: {
        stripe_dispute_id: dispute.id,
        stripe_charge_id: chargeId ?? null,
        amount_cents: dispute.amount,
        currency: dispute.currency,
        full: true,
        source: 'stripe_dispute_lost',
        created_at: new Date().toISOString()
      }
    })
    req.log?.warn({ orderId: order.id, disputeId: dispute.id, claimed }, '[stripe-webhook] ⚠️ Dispute LOST — order refunded and side effects reversed')
    return
  }

  if (won) {
    const restoreStatus = snapshot.previous_order_status || 'processing'
    const restorePaymentStatus = snapshot.previous_payment_status || 'paid'
    // Never resurrect an order that has since been genuinely refunded.
    const { error } = await supabase
      .from('orders')
      .update({ status: restoreStatus, payment_status: restorePaymentStatus, updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .neq('status', 'refunded')
    if (error) {
      req.log?.error({ err: error, orderId: order.id }, '[stripe-webhook] Failed to restore order after dispute win')
    }
    req.log?.info({ orderId: order.id, disputeId: dispute.id, restoreStatus }, '[stripe-webhook] Dispute won — order restored')
    return
  }

  // Still open (created / updated / funds_withdrawn while under review):
  // freeze fulfillment. Guarded so a dispute can't drag a refunded order back.
  const { error: freezeErr } = await supabase
    .from('orders')
    .update({ status: 'on_hold', payment_status: 'disputed', updated_at: new Date().toISOString() })
    .eq('id', order.id)
    .neq('status', 'refunded')
  if (freezeErr) {
    req.log?.error({ err: freezeErr, orderId: order.id }, '[stripe-webhook] Failed to put disputed order on hold')
  }

  // Alert admins once, when the dispute first opens — evidence deadlines are
  // short and a silent chargeback is a lost one. 'payment_dispute' is added to
  // the admin_notifications type CHECK by
  // supabase/migrations/20260727_refunds_and_disputes.sql; against a database
  // that hasn't applied it the insert fails 23514 and is logged, never thrown.
  if (eventType === 'charge.dispute.created') {
    const { error: notifErr } = await supabase.from('admin_notifications').insert({
      type: 'payment_dispute',
      title: `Chargeback opened — order ${order.id}`,
      message:
        `$${(dispute.amount / 100).toFixed(2)} disputed (${dispute.reason}). ` +
        (snapshot.evidence_due_by ? `Evidence due ${snapshot.evidence_due_by}. ` : '') +
        `Order is on hold.`
    })
    if (notifErr) {
      req.log?.error({ err: notifErr, orderId: order.id }, '[stripe-webhook] Failed to raise dispute notification')
    }
  }

  req.log?.warn({
    orderId: order.id,
    disputeId: dispute.id,
    eventType,
    disputeStatus: dispute.status,
    reason: dispute.reason,
    amountCents: dispute.amount
  }, '[stripe-webhook] Dispute open — order frozen')
}

// Send order confirmation email using Resend
async function sendOrderConfirmationEmail(order: any) {
  if (!order.customer_email) {
    console.log('[Email] No customer email, skipping order confirmation')
    return
  }

  // Format items for email
  const items = order.order_items?.map((item: any) => ({
    name: item.product_name || 'Product',
    quantity: item.quantity || 1,
    price: item.price || 0
  })) || []

  await sendOrderEmail(
    order.customer_email,
    order.id,
    items,
    order.total || 0
  )
  console.log(`[Email] Order confirmation sent to ${order.customer_email}: Order #${order.order_number}`)
}

// Handle ITC token purchase
async function handleITCPurchase(paymentIntent: Stripe.PaymentIntent, req: Request) {
  const { userId, itcAmount, packagePriceUSD } = paymentIntent.metadata

  if (!userId || !itcAmount) {
    req.log?.error({ metadata: paymentIntent.metadata }, 'Missing required metadata for ITC purchase')
    throw new Error('Missing required metadata')
  }

  const itcAmountNum = parseFloat(itcAmount)
  const usdAmount = parseFloat(packagePriceUSD)

  // Check for duplicate transaction. The payment intent id lives in the
  // `reference` column (live schema has no stripe_payment_intent_id column —
  // the old filter errored, so dedupe NEVER worked and webhook retries could
  // double-credit ITC).
  const { data: existingTransaction, error: dedupeError } = await supabase
    .from('itc_transactions')
    .select('id')
    .eq('type', 'purchase')
    .eq('reference', paymentIntent.id)
    .maybeSingle()

  if (dedupeError) {
    req.log?.error({ err: dedupeError }, 'Dedupe check failed — continuing cautiously')
  }
  if (existingTransaction) {
    req.log?.warn({ paymentIntentId: paymentIntent.id }, 'Duplicate transaction detected')
    return
  }

  // Update user wallet
  const { data: wallet, error: walletError } = await supabase
    .from('user_wallets')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (walletError || !wallet) {
    req.log?.error({ err: walletError, userId }, 'Failed to fetch wallet')
    throw new Error('Failed to fetch wallet')
  }

  // Credit ITC to wallet
  const newBalance = parseFloat(wallet.itc_balance) + itcAmountNum

  const { error: updateError } = await supabase
    .from('user_wallets')
    .update({
      itc_balance: newBalance,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)

  if (updateError) {
    req.log?.error({ err: updateError, userId }, 'Failed to update wallet')
    throw new Error('Failed to update wallet')
  }

  // Record transaction (live schema: type/amount/reference/balance_after/metadata)
  const { error: transactionError } = await supabase
    .from('itc_transactions')
    .insert({
      user_id: userId,
      type: 'purchase',
      amount: itcAmountNum,
      balance_after: newBalance,
      reference: paymentIntent.id,
      metadata: {
        usd_value: usdAmount,
        reason: `Purchased ${itcAmountNum} ITC for $${usdAmount.toFixed(2)}`
      },
      created_at: new Date().toISOString()
    })

  if (transactionError) {
    req.log?.error({ err: transactionError }, 'Failed to record transaction')
    // Don't throw - wallet was updated successfully
  }

  // Send confirmation email (optional - sendPurchaseConfirmationEmail below is
  // currently a log-only stub; see its body)
  try {
    await sendPurchaseConfirmationEmail(userId, itcAmountNum, usdAmount)
  } catch (emailError) {
    req.log?.error({ err: emailError }, 'Failed to send confirmation email')
    // Don't throw - this is non-critical
  }

  req.log?.info({
    userId,
    itcAmount: itcAmountNum,
    newBalance,
    paymentIntentId: paymentIntent.id
  }, 'ITC purchase processed successfully')
}

// Handle product order payment and royalties
async function handleProductOrderPayment(paymentIntent: Stripe.PaymentIntent, req: Request) {
  const { userId, orderId, productId } = paymentIntent.metadata

  if (!userId || !orderId || !productId) {
    req.log?.error({ metadata: paymentIntent.metadata }, 'Missing required metadata for product order')
    throw new Error('Missing required metadata')
  }

  req.log?.info({
    orderId,
    productId,
    userId,
    amount: paymentIntent.amount
  }, 'Processing product order payment')

  // Check if product is user-generated
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, name, price, is_user_generated, created_by_user_id')
    .eq('id', productId)
    .single()

  if (productError || !product) {
    req.log?.error({ err: productError, productId }, 'Product not found')
    throw new Error('Product not found')
  }

  // Update order status to paid
  const { error: orderUpdateError } = await supabase
    .from('orders')
    .update({
      status: 'paid',
      payment_intent_id: paymentIntent.id,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId)

  if (orderUpdateError) {
    req.log?.error({ err: orderUpdateError, orderId }, 'Failed to update order status')
    // Don't throw - continue with royalty processing
  }

  // Process royalty if product is user-generated
  if (product.is_user_generated && product.created_by_user_id) {
    try {
      const priceCents = paymentIntent.amount // Amount is already in cents
      const { royaltyAmountCents, itcAmount } = calculateRoyalty(priceCents)

      await processRoyaltyPayment({
        userId: product.created_by_user_id,
        productId: product.id,
        orderId,
        salePriceCents: priceCents,
        royaltyAmountCents,
        itcAmount
      })

      req.log?.info({
        creatorId: product.created_by_user_id,
        productId: product.id,
        royaltyAmount: royaltyAmountCents,
        itcAmount
      }, '💰 Royalty processed for user-generated product')
    } catch (royaltyError: any) {
      req.log?.error({
        err: royaltyError,
        productId: product.id,
        creatorId: product.created_by_user_id
      }, '❌ Failed to process royalty payment')
      // Don't throw - order payment succeeded, royalty can be retried
    }
  } else {
    req.log?.info({
      productId: product.id,
      isUserGenerated: product.is_user_generated,
      hasCreator: !!product.created_by_user_id
    }, 'Product order completed (no royalty - not user-generated)')
  }

  req.log?.info({
    orderId,
    productId,
    paymentIntentId: paymentIntent.id
  }, 'Product order payment processed successfully')
}

// Handle failed payment
async function handlePaymentFailure(paymentIntent: Stripe.PaymentIntent, req: Request) {
  const { userId } = paymentIntent.metadata

  req.log?.warn({
    paymentIntentId: paymentIntent.id,
    userId,
    lastPaymentError: paymentIntent.last_payment_error
  }, 'Payment failed')

  // Optionally record failed payment attempt (live schema columns)
  if (userId) {
    await supabase
      .from('itc_transactions')
      .insert({
        user_id: userId,
        type: 'payment_failed',
        amount: 0,
        reference: paymentIntent.id,
        metadata: {
          error: paymentIntent.last_payment_error?.message || 'Unknown error'
        },
        created_at: new Date().toISOString()
      })
  }
}

// ===============================
// FOUNDER INVOICE HANDLERS (ported from routes/webhooks.ts)
// ===============================

// Handle invoice.paid — credit the founder's ITC wallet with their earnings
async function handleInvoicePaid(stripeInvoice: Stripe.Invoice, req: Request) {
  const founderId = stripeInvoice.metadata?.founder_id

  if (!founderId) {
    req.log?.info({ invoiceId: stripeInvoice.id }, '[Invoice Webhook] Not a founder invoice, skipping')
    return
  }

  const { claimOnce } = await import('../lib/webhook-helpers.js')

  // Idempotency claim — same atomic pattern as the checkout-order guard in
  // handleCheckoutOrderPayment above: flip status to 'paid' only if it isn't
  // already, so a redelivered invoice.paid can't credit founder earnings twice.
  const claim = await claimOnce<{ id: string; founder_earnings_cents: number; subtotal_cents: number }>(
    supabase
      .from('founder_invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString()
      })
      .eq('stripe_invoice_id', stripeInvoice.id)
      .neq('status', 'paid')
      .select('id, founder_earnings_cents, subtotal_cents')
  )

  if (claim.error) {
    req.log?.error({ err: claim.error, invoiceId: stripeInvoice.id }, '[Invoice Webhook] Failed to update invoice status')
    throw new Error('Failed to update invoice status')
  }
  if (!claim.claimed || !claim.row) {
    req.log?.info({ invoiceId: stripeInvoice.id }, '[Invoice Webhook] Invoice already paid — duplicate webhook delivery, skipping')
    return
  }
  const invoice = claim.row

  const founderEarningsCents = invoice.founder_earnings_cents
  const founderEarningsUSD = founderEarningsCents / 100

  const { data: wallet, error: walletError } = await supabase
    .from('user_wallets')
    .select('itc_balance')
    .eq('user_id', founderId)
    .single()

  if (walletError || !wallet) {
    req.log?.error({ err: walletError, founderId }, '[Invoice Webhook] Founder wallet not found')
    return
  }

  // Convert USD earnings to ITC (1 ITC = $0.01, so $1 = 100 ITC)
  const itcEarnings = founderEarningsCents
  const { addBalance } = await import('../lib/webhook-helpers.js')
  const newBalance = addBalance(wallet.itc_balance, itcEarnings)

  const { error: walletUpdateError } = await supabase
    .from('user_wallets')
    .update({
      itc_balance: newBalance,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', founderId)

  if (walletUpdateError) {
    req.log?.error({ err: walletUpdateError, founderId }, '[Invoice Webhook] Failed to update wallet')
    return
  }

  // Record the ITC transaction (live schema: type/amount/balance_after/reference/
  // metadata — the old reason/usd_value/reference_id columns don't exist; same
  // fix already applied in handleITCPurchase above and services/stripe-connect.ts).
  const { error: ledgerError } = await supabase
    .from('itc_transactions')
    .insert({
      user_id: founderId,
      type: 'reward',
      amount: itcEarnings,
      balance_after: newBalance,
      reference: invoice.id,
      metadata: {
        description: `Invoice earnings (35% of $${(invoice.subtotal_cents / 100).toFixed(2)})`,
        usd_value: founderEarningsUSD
      },
      created_at: new Date().toISOString()
    })
  if (ledgerError) {
    req.log?.error({ err: ledgerError, founderId }, '[Invoice Webhook] Failed to log ITC transaction')
  }

  req.log?.info({
    invoiceId: invoice.id,
    founderId,
    itcEarnings,
    founderEarningsUSD
  }, '[Invoice Webhook] Invoice paid, founder earnings credited')
}

// Handle invoice.payment_failed — mark the invoice overdue (Stripe will retry)
async function handleInvoicePaymentFailed(stripeInvoice: Stripe.Invoice, req: Request) {
  const founderId = stripeInvoice.metadata?.founder_id

  if (!founderId) {
    req.log?.info({ invoiceId: stripeInvoice.id }, '[Invoice Webhook] Not a founder invoice, skipping')
    return
  }

  // No wallet mutation here, so no strict claim is needed — just guard
  // against downgrading an invoice Stripe has already reported as paid.
  const { error } = await supabase
    .from('founder_invoices')
    .update({ status: 'overdue' })
    .eq('stripe_invoice_id', stripeInvoice.id)
    .neq('status', 'paid')

  if (error) {
    req.log?.error({ err: error, invoiceId: stripeInvoice.id }, '[Invoice Webhook] Failed to update invoice status')
  }

  req.log?.warn({ invoiceId: stripeInvoice.id }, '[Invoice Webhook] Invoice payment failed')
}

// Send purchase confirmation email
async function sendPurchaseConfirmationEmail(userId: string, itcAmount: number, usdAmount: number) {
  // Get user email
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email, username')
    .eq('id', userId) // user_profiles PK is `id` (= auth uid); there is no user_id column
    .single()

  if (!profile || !profile.email) {
    throw new Error('User email not found')
  }

  // TODO: Implement via Resend (backend/utils/email.ts's sendEmailWithTracking)
  // For now, just log
  console.log(`[Email] Would send confirmation to ${profile.email}: ${itcAmount} ITC for $${usdAmount}`)
}

// PATCH /api/stripe/orders/:orderId/status - Update order status and send emails
router.patch('/orders/:orderId/status', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const { status, trackingNumber, carrier } = req.body

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' })
    }

    if (!status) {
      return res.status(400).json({ error: 'Status is required' })
    }

    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` })
    }

    // Get order details first
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    // Prepare update object
    const updateData: any = {
      status,
      updated_at: new Date().toISOString()
    }

    // Add tracking info if provided
    if (trackingNumber) {
      updateData.tracking_number = trackingNumber
    }
    if (carrier) {
      updateData.tracking_company = carrier
    }

    // Update fulfillment status based on order status
    if (status === 'shipped') {
      updateData.fulfillment_status = 'fulfilled'
    } else if (status === 'delivered') {
      updateData.fulfillment_status = 'delivered'
    }

    // Update order status
    const { error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId)

    if (updateError) {
      req.log?.error({ err: updateError, orderId }, 'Failed to update order status')
      return res.status(500).json({ error: 'Failed to update order status' })
    }

    // Notify Darrell V2's merch sales ledger — only on an ACTUAL transition
    // into refunded/cancelled, never on a no-op re-PATCH to the status it
    // already had. Fail-soft: never blocks the admin's status update.
    if (status !== order.status && (status === 'refunded' || status === 'cancelled')) {
      const merchEventType = status === 'refunded' ? 'order.refunded' : 'order.canceled'
      await sendMerchOrderEvent({ orderId, type: merchEventType, log: req.log }).catch((err) => {
        req.log?.error({ err, orderId }, '[merch-webhook] emission threw unexpectedly')
      })
    }

    // Send appropriate email based on status change
    if (order.customer_email) {
      try {
        if (status === 'shipped') {
          await sendOrderShippedEmail(order.customer_email, orderId, trackingNumber, carrier)
          req.log?.info({ orderId, email: order.customer_email }, 'Shipped notification email sent')
        } else if (status === 'delivered') {
          await sendOrderDeliveredEmail(order.customer_email, orderId)
          req.log?.info({ orderId, email: order.customer_email }, 'Delivered notification email sent')
        }
      } catch (emailError) {
        req.log?.error({ err: emailError, orderId }, 'Failed to send status update email')
        // Don't fail the request if email fails
      }
    }

    // Create audit log
    await supabase.from('audit_logs').insert({
      user_id: req.user?.sub,
      action: 'order_status_updated',
      entity: 'order',
      entity_id: orderId,
      changes: {
        previous_status: order.status,
        new_status: status,
        tracking_number: trackingNumber || null,
        carrier: carrier || null
      },
      created_at: new Date().toISOString()
    })

    req.log?.info({
      orderId,
      previousStatus: order.status,
      newStatus: status
    }, 'Order status updated successfully')

    return res.json({
      ok: true,
      message: `Order status updated to ${status}`,
      order: {
        id: orderId,
        status,
        tracking_number: trackingNumber,
        carrier
      }
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'Error updating order status')
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/stripe/orders/:orderId/refund - issue a Stripe refund for an order
// and reverse the paid-order side effects (Watchtower task c1b0182f).
//
// ACCESS: admin ONLY — deliberately stricter than the sibling PATCH
// /orders/:orderId/status above (admin + manager). That route relabels an
// order; this one moves real money out of the business bank account, so it
// sits at the highest role the platform has. Raising a manager to refund
// authority is a product decision, not a default.
//
// PARTIAL REFUNDS: supported for the money, but NOT for side effects. Pass
// `amount` (dollars) to refund less than the remaining balance; the order stays
// live with payment_status 'partially_refunded' and nothing is reversed,
// because ITP has no line-level refund model — proportionally clawing back a
// creator's margin or restocking a fraction of a blank would be a guess. Only a
// refund that brings the total to the full order value reverses side effects.
// Repeated partials that eventually reach the full total DO trigger the
// reversal on the one that tips it over.
router.post('/orders/:orderId/refund', requireAuth, requireRole(['admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const { amount, reason, note } = req.body || {}

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' })
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, order_number, total, currency, status, payment_status, payment_intent_id, charge_id, metadata')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    if (order.status === 'refunded' || order.payment_status === 'refunded') {
      return res.status(409).json({ error: 'Order is already fully refunded' })
    }
    if (order.payment_status !== 'paid' && order.payment_status !== 'partially_refunded') {
      return res.status(409).json({
        error: `Only a paid order can be refunded (payment_status is '${order.payment_status}')`
      })
    }
    if (!order.payment_intent_id && !order.charge_id) {
      return res.status(409).json({
        error: 'Order has no Stripe payment intent or charge — nothing to refund through Stripe'
      })
    }

    const orderTotalCents = Math.round((Number(order.total) || 0) * 100)
    const alreadyRefundedCents = refundedCentsFromMetadata(order.metadata)
    const remainingCents = orderTotalCents - alreadyRefundedCents

    if (remainingCents <= 0) {
      return res.status(409).json({ error: 'Order has no refundable balance remaining' })
    }

    // Omitted amount = refund everything still outstanding.
    let amountCents = remainingCents
    if (amount !== undefined && amount !== null && amount !== '') {
      const parsed = Number(amount)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number of dollars' })
      }
      amountCents = Math.round(parsed * 100)
      if (amountCents > remainingCents) {
        return res.status(400).json({
          error: `amount exceeds the refundable balance ($${(remainingCents / 100).toFixed(2)} remaining)`
        })
      }
    }

    const validReasons = ['duplicate', 'fraudulent', 'requested_by_customer']
    const stripeReason = validReasons.includes(reason) ? reason : undefined

    let refund: Stripe.Refund
    try {
      refund = await stripe.refunds.create(
        {
          ...(order.payment_intent_id
            ? { payment_intent: order.payment_intent_id }
            : { charge: order.charge_id as string }),
          amount: amountCents,
          ...(stripeReason ? { reason: stripeReason as Stripe.RefundCreateParams.Reason } : {}),
          metadata: {
            orderId: order.id,
            orderNumber: order.order_number || '',
            refundedBy: req.user?.sub || '',
            note: typeof note === 'string' ? note.slice(0, 400) : ''
          }
        },
        {
          // Keyed on how much had already been refunded, so a double-clicked
          // button returns the SAME refund instead of issuing a second one,
          // while a deliberate follow-up partial (different prior total) is
          // still allowed through.
          idempotencyKey: `itp-refund:${order.id}:${alreadyRefundedCents}:${amountCents}`
        }
      )
    } catch (stripeError: any) {
      req.log?.error({ err: stripeError, orderId }, '[refund] stripe.refunds.create failed')
      return res.status(502).json({
        error: 'Stripe refund failed',
        message: stripeError?.raw?.message || stripeError?.message || 'Unknown Stripe error'
      })
    }

    const refundRecord = {
      stripe_refund_id: refund.id,
      stripe_charge_id: typeof refund.charge === 'string' ? refund.charge : refund.charge?.id ?? order.charge_id ?? null,
      amount_cents: amountCents,
      currency: refund.currency,
      full: amountCents >= remainingCents,
      reason: stripeReason ?? null,
      note: typeof note === 'string' ? note : null,
      refunded_by: req.user?.sub ?? null,
      source: 'admin_api',
      status: refund.status,
      created_at: new Date().toISOString()
    }

    const isFullRefund = alreadyRefundedCents + amountCents >= orderTotalCents

    if (!isFullRefund) {
      const { error: partialErr } = await supabase
        .from('orders')
        .update({ payment_status: 'partially_refunded', updated_at: new Date().toISOString() })
        .eq('id', order.id)
        .neq('status', 'refunded')
      if (partialErr) {
        req.log?.error({ err: partialErr, orderId }, '[refund] Failed to mark order partially refunded')
      }
      await recordRefundOnOrder({
        orderId: order.id,
        refund: refundRecord,
        actorUserId: req.user?.sub ?? null,
        action: 'order_partially_refunded',
        log: req.log
      })

      req.log?.info({
        orderId,
        refundId: refund.id,
        amountCents,
        remainingCents: remainingCents - amountCents
      }, '[refund] Partial refund issued (side effects intentionally not reversed)')

      return res.json({
        ok: true,
        partial: true,
        refund: { id: refund.id, amount: amountCents / 100, status: refund.status },
        remainingRefundable: (remainingCents - amountCents) / 100,
        message: `Refunded $${(amountCents / 100).toFixed(2)}. Partial refunds do not reverse store credit, inventory, or creator margins.`
      })
    }

    // Full refund: claim the order and reverse every paid-order side effect.
    // Stripe will also deliver charge.refunded for this same refund; whichever
    // reaches claimAndReverseRefundedOrder() first does the work, the other is
    // a no-op — that is what the claim is for.
    const { claimed, report } = await claimAndReverseRefundedOrder(order.id, req, {
      actorUserId: req.user?.sub ?? null,
      refund: refundRecord
    })

    req.log?.info({
      orderId,
      refundId: refund.id,
      amountCents,
      claimed,
      reversalOk: report?.ok ?? null
    }, '[refund] Full refund issued')

    return res.json({
      ok: true,
      partial: false,
      refund: { id: refund.id, amount: amountCents / 100, status: refund.status },
      // claimed:false means the charge.refunded webhook beat us to the
      // reversal — the work is done either way.
      reversal: report ?? { alreadyProcessed: true },
      message: report && !report.ok
        ? 'Refund issued, but one or more side-effect reversals failed — check the admin notifications.'
        : `Refunded $${(amountCents / 100).toFixed(2)} and reversed store credit, inventory, and creator margins.`
    })
  } catch (error: any) {
    req.log?.error({ err: error }, '[refund] Unhandled error issuing refund')
    return res.status(500).json({ error: 'Failed to issue refund', message: error.message })
  }
})

export default router
