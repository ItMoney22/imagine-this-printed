const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    const body = JSON.stringify(req.body);
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;
      
      case 'payment_intent.payment_failed':
        await handlePaymentFailure(event.data.object);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

async function handlePaymentSuccess(paymentIntent) {
  try {
    const { metadata } = paymentIntent;
    const items = JSON.parse(metadata.items || '[]');
    const shipping = JSON.parse(metadata.shipping || '{}');

    const orderData = {
      order_number: `ORD-${Date.now()}`,
      payment_intent_id: paymentIntent.id,
      user_id: metadata.userId || null,
      customer_email: metadata.customerEmail || null,
      subtotal: paymentIntent.amount / 100, // Convert cents to dollars
      total: paymentIntent.amount / 100,
      currency: paymentIntent.currency.toUpperCase(),
      status: 'confirmed',
      payment_status: 'paid',
      payment_method: 'stripe',
      shipping_address: shipping,
      source: 'web'
    };

    const order = await prisma.order.create({
      data: {
        orderNumber: orderData.order_number,
        paymentIntentId: orderData.payment_intent_id,
        userId: orderData.user_id,
        customerEmail: orderData.customer_email,
        subtotal: orderData.subtotal,
        total: orderData.total,
        currency: orderData.currency,
        status: orderData.status,
        paymentStatus: orderData.payment_status,
        paymentMethod: orderData.payment_method,
        shippingAddress: orderData.shipping_address,
        source: orderData.source
      }
    });

    if (metadata.userId && metadata.itcAmount) {
      const itcAmount = parseFloat(metadata.itcAmount);
      const usdAmount = paymentIntent.amount / 100; // Convert cents to dollars
      
      // Get current wallet balance
      const walletData = await prisma.userWallet.findUnique({
        where: { userId: metadata.userId },
        select: { itcBalance: true }
      });
      
      const currentBalance = Number(walletData?.itcBalance || 0);
      const newBalance = currentBalance + itcAmount;
      
      // Update wallet balance
      await prisma.userWallet.upsert({
        where: { userId: metadata.userId },
        update: { itcBalance: newBalance },
        create: {
          userId: metadata.userId,
          itcBalance: newBalance,
          pointsBalance: 0
        }
      });

      // Record transaction
      await prisma.itcTransaction.create({
        data: {
          userId: metadata.userId,
          type: 'purchase',
          amount: itcAmount,
          balanceAfter: newBalance,
          usdValue: usdAmount,
          reason: 'ITC token purchase',
          paymentIntentId: paymentIntent.id
        }
      });
    }

    console.log(`Payment succeeded: ${paymentIntent.id}`);
  } catch (error) {
    console.error('Payment success handling error:', error);
  }
}

async function handlePaymentFailure(paymentIntent) {
  try {
    console.log(`Payment failed: ${paymentIntent.id}`, paymentIntent.last_payment_error);
  } catch (error) {
    console.error('Payment failure handling error:', error);
  }
}