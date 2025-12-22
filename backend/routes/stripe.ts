import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'
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

// POST /api/stripe/checkout-payment-intent - Create or update payment intent for product checkout
router.post('/checkout-payment-intent', async (req: Request, res: Response): Promise<any> => {
  try {
    const { amount, currency, items, shipping, couponCode, discount, userId, shippingCost, tax, existingPaymentIntentId, existingOrderId } = req.body

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
            updated_at: new Date().toISOString()
          })
          .eq('id', existingOrderId)

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
          items: items?.map((i: any) => ({
            id: i.product?.id,
            name: i.product?.name,
            price: i.product?.price,
            quantity: i.quantity,
            image: i.product?.images?.[0]
          }))
        }
      })
      .select()
      .single()

    if (orderError) {
      req.log?.error({ err: orderError }, 'Error creating order in database')
      return res.status(500).json({ error: 'Failed to create order', message: orderError.message })
    }

    // Create order items
    if (items && items.length > 0) {
      const orderItems = items.map((item: any) => ({
        order_id: order.id,
        product_id: item.product?.id || null,
        product_name: item.product?.name || 'Unknown Product',
        quantity: item.quantity || 1,
        price: item.product?.price || 0,
        total: (item.product?.price || 0) * (item.quantity || 1),
        variations: item.selectedSize || item.selectedColor ? {
          size: item.selectedSize,
          color: item.selectedColor
        } : {},
        personalization: item.customDesign ? {
          designUrl: item.customDesign
        } : {}
      }))

      await supabase.from('order_items').insert(orderItems)
    }

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
        shippingCountry: shipping?.country || 'US'
      },
      receipt_email: shipping?.email || undefined,
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
      receipt_email: profile.email,
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
  const { orderId, orderNumber } = paymentIntent.metadata

  if (!orderId) {
    req.log?.error({ metadata: paymentIntent.metadata }, 'Missing orderId in checkout order metadata')
    throw new Error('Missing orderId in metadata')
  }

  req.log?.info({
    orderId,
    orderNumber,
    amount: paymentIntent.amount
  }, 'Processing checkout order payment')

  // Update order status to paid/processing
  const { error: orderUpdateError } = await supabase
    .from('orders')
    .update({
      status: 'processing',
      payment_status: 'paid',
      payment_intent_id: paymentIntent.id,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId)

  if (orderUpdateError) {
    req.log?.error({ err: orderUpdateError, orderId }, 'Failed to update order status')
    throw new Error('Failed to update order status')
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

  // Check for duplicate transaction
  const { data: existingTransaction } = await supabase
    .from('itc_transactions')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .single()

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

  // Record transaction
  const { error: transactionError } = await supabase
    .from('itc_transactions')
    .insert({
      user_id: userId,
      amount: itcAmountNum,
      reason: `Purchased ${itcAmountNum} ITC for $${usdAmount.toFixed(2)}`,
      stripe_payment_intent_id: paymentIntent.id,
      usd_value: usdAmount,
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

  // Optionally record failed payment attempt
  if (userId) {
    await supabase
      .from('itc_transactions')
      .insert({
        user_id: userId,
        amount: 0,
        reason: `Failed payment attempt - ${paymentIntent.last_payment_error?.message || 'Unknown error'}`,
        stripe_payment_intent_id: paymentIntent.id,
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
    .eq('user_id', userId)
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
      updateData.shipping_carrier = carrier
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
