const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, currency = 'usd', items, shipping, description, metadata } = req.body;

    if (!amount || amount < 50) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency,
      description: description || 'Imagine This Printed Purchase',
      metadata: {
        ...(metadata || {}),
        items: JSON.stringify(items),
        shipping: JSON.stringify(shipping)
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ 
      error: 'Payment intent creation failed',
      details: error.message 
    });
  }
}