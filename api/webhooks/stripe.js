const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: 'paid',
      items: items,
      shipping_address: shipping,
      created_at: new Date().toISOString(),
      user_id: metadata.userId || null
    };

    const { error } = await supabase
      .from('orders')
      .insert([orderData]);

    if (error) {
      console.error('Order creation failed:', error);
      return;
    }

    if (metadata.userId && metadata.itcAmount) {
      const itcAmount = parseInt(metadata.itcAmount);
      
      const { error: walletError } = await supabase
        .from('user_wallets')
        .upsert({
          user_id: metadata.userId,
          itc_balance: supabase.raw('COALESCE(itc_balance, 0) + ?', [itcAmount]),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (walletError) {
        console.error('Wallet update failed:', walletError);
      }

      const { error: transactionError } = await supabase
        .from('itc_transactions')
        .insert([{
          user_id: metadata.userId,
          amount: itcAmount,
          type: 'purchase',
          payment_intent_id: paymentIntent.id,
          created_at: new Date().toISOString()
        }]);

      if (transactionError) {
        console.error('Transaction recording failed:', transactionError);
      }
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