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
    const { amount, currency, items, shipping, couponCode, discount, userId: bodyUserId, shippingCost, tax, itcCreditAmount, itcCreditUSD, existingPaymentIntentId, existingOrderId } = req.body
    // Authenticated callers: use the JWT subject. Guests: trust the body
    // (or null) because there's no logged-in user to verify against.
    const userId = req.user?.sub ?? bodyUserId ?? null

    // Validate amount (in cents)
    if (!amount || typeof amount !== 'number' || amount < 50) { // Stripe minimum is 50 cents
      return res.status(400).json({ error: 'Invalid amount - minimum is $0.50' })
    }

    // Validate currency
    if (currency !== 'usd') {
      return res.status(400).json({ error: 'Only USD currency is supported' })
    }

    // Calculate subtotal from items
    const subtotal = items?.reduce((sum: number, item: any) =>
      sum + (item.product?.price || 0) * (item.quantity || 1), 0) || 0

    // If we have an existing payment intent and order, update them instead of creating new
    if (existingPaymentIntentId && existingOrderId) {
      try {
        // Update the existing payment intent amount
        const updatedPaymentIntent = await stripe.paymentIntents.update(existingPaymentIntentId, {
          amount, // Amount in cents
          metadata: {
            couponCode: couponCode || '',
            discount: discount?.toString() || '0',
            shippingCost: shippingCost?.toString() || '0'
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
            tax_amount: tax || 0,
            shipping_amount: shippingCost || 0,
            discount_amount: discount || 0,
            total: amount / 100,
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
          amount: amount / 100,
          shippingCost: shippingCost,
          discount: discount
        }, 'Updated existing payment intent and order')

        return res.json({
          clientSecret: updatedPaymentIntent.client_secret,
          paymentIntentId: updatedPaymentIntent.id,
          orderId: existingOrderId,
          updated: true
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
        tax_amount: tax || 0,
        shipping_amount: shippingCost || 0,
        discount_amount: discount || 0,
        total: amount / 100,
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

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount, // Amount in cents
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
        discount: discount?.toString() || '0',
        shippingCost: shippingCost?.toString() || '0',
        shippingCity: shipping?.city || '',
        shippingState: shipping?.state || '',
        shippingCountry: shipping?.country || 'US',
        itcCreditAmount: itcCreditAmount?.toString() || '0',
        itcCreditUSD: itcCreditUSD?.toString() || '0'
      },
      // Note: We don't set receipt_email - we send our own branded Mr. Imagine emails via Brevo
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
      amount: amount / 100,
      shippingCost: shippingCost,
      discount: discount,
      itemCount: items?.length || 0
    }, 'Checkout payment intent and order created')

    return res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      orderId: order.id,
      orderNumber: orderNumber
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
      // Note: We don't set receipt_email - we send our own branded Mr. Imagine emails via Brevo
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

  req.log?.info({
    orderId,
    orderNumber,
    paymentIntentId: paymentIntent.id,
    customerEmail: order?.customer_email
  }, '✅ Checkout order payment processed successfully')
}

// Send order confirmation email using Brevo
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

  // Send confirmation email (optional - implement if Brevo is configured)
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

  // TODO: Implement Brevo email sending
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

export default router
