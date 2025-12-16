import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'
import {
  ITC_PACKAGES,
  findPackageByUSD,
  isValidPackageAmount
} from '../config/itc-pricing.js'
import { processRoyaltyPayment, calculateRoyalty } from '../services/user-royalties.js'

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

// POST /api/stripe/create-payment-intent
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
  const { userId, itcAmount, packagePriceUSD, orderId, productId } = paymentIntent.metadata

  // Determine payment type: ITC purchase or product order
  const isITCPurchase = itcAmount && packagePriceUSD
  const isProductOrder = orderId && productId

  if (!userId) {
    req.log?.error({ metadata: paymentIntent.metadata }, 'Missing userId in metadata')
    throw new Error('Missing userId in metadata')
  }

  // Handle ITC token purchase
  if (isITCPurchase) {
    await handleITCPurchase(paymentIntent, req)
  }

  // Handle product order payment
  if (isProductOrder) {
    await handleProductOrderPayment(paymentIntent, req)
  }

  if (!isITCPurchase && !isProductOrder) {
    req.log?.warn({ metadata: paymentIntent.metadata }, 'Payment type could not be determined')
  }
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

export default router
