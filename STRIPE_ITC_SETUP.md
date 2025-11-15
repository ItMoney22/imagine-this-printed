# Stripe ITC Purchase Integration - Setup Guide

This guide covers the complete setup for the Stripe ITC token purchase system.

## Overview

The system allows users to purchase ITC tokens using Stripe payment processing. It includes:
- Multiple package options with volume discounts
- Secure Stripe Elements payment form
- Webhook handling for automatic wallet crediting
- Transaction history tracking
- Email confirmations (optional)

## Architecture

### Frontend
- **Wallet.tsx**: Main wallet interface with package selection
- **PaymentForm.tsx**: Stripe Elements payment form component
- **stripe-itc.ts**: Stripe service for payment processing

### Backend
- **routes/stripe.ts**: Payment intent creation and webhook handling
- **routes/wallet.ts**: Wallet operations and transaction history
- **config/itc-pricing.ts**: Package definitions and pricing logic

## Environment Variables

### Frontend (.env.local)
```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### Backend (Railway/Production)
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Getting Stripe Credentials

### 1. Stripe Publishable Key
1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Navigate to **Developers** > **API keys**
3. Copy the **Publishable key** (starts with `pk_test_` for test mode)
4. Add to frontend `.env.local`:
   ```
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
   ```

### 2. Stripe Secret Key
1. In Stripe Dashboard > **Developers** > **API keys**
2. Copy the **Secret key** (starts with `sk_test_` for test mode)
3. Add to backend environment (Railway):
   ```
   STRIPE_SECRET_KEY=sk_test_your_key_here
   ```

### 3. Stripe Webhook Secret
1. Go to **Developers** > **Webhooks**
2. Click **Add endpoint**
3. Enter your endpoint URL:
   ```
   https://your-api-domain.com/api/stripe/webhook
   ```
4. Select events to listen to:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)
7. Add to backend environment:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
   ```

## ITC Packages

The system includes 5 predefined packages with volume discounts:

| ITC Amount | Price (USD) | Discount | Popular |
|------------|-------------|----------|---------|
| 50         | $5.00       | 0%       | No      |
| 100        | $10.00      | 0%       | No      |
| 250        | $22.50      | 10%      | Yes     |
| 500        | $40.00      | 20%      | No      |
| 1000       | $70.00      | 30%      | No      |

Packages are defined in `backend/config/itc-pricing.ts`.

## Payment Flow

### 1. User Selects Package
- User navigates to Wallet > Purchase tab
- Clicks on a package card
- Frontend calls `/api/stripe/create-payment-intent`

### 2. Payment Intent Created
- Backend validates package amount
- Creates Stripe PaymentIntent with metadata
- Returns `clientSecret` to frontend

### 3. User Enters Payment Details
- Stripe Elements form loads
- User enters card details
- Stripe handles 3D Secure if required

### 4. Payment Confirmation
- Frontend calls `stripe.confirmPayment()`
- Stripe processes payment
- Returns success or error

### 5. Webhook Processing
- Stripe sends `payment_intent.succeeded` event to webhook
- Backend verifies webhook signature
- Credits ITC to user wallet
- Records transaction in `itc_transactions` table
- Sends confirmation email (optional)

## API Endpoints

### POST /api/stripe/create-payment-intent
Create a payment intent for ITC purchase.

**Request:**
```json
{
  "amount": 500,
  "currency": "usd",
  "description": "Purchase 50 ITC tokens"
}
```

**Response:**
```json
{
  "clientSecret": "pi_xxx_secret_xxx",
  "paymentIntentId": "pi_xxx",
  "itcAmount": 50,
  "bonusPercent": 0
}
```

### POST /api/stripe/webhook
Stripe webhook endpoint for payment events.

**Headers:**
- `stripe-signature`: Webhook signature for verification

**Events Handled:**
- `payment_intent.succeeded`: Credit wallet
- `payment_intent.payment_failed`: Log failure
- `payment_intent.canceled`: Log cancellation

### GET /api/wallet/transactions/itc
Get ITC transaction history for authenticated user.

**Response:**
```json
{
  "ok": true,
  "transactions": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "amount": 50,
      "description": "Purchased 50 ITC tokens for $5.00",
      "usd_value": 5.00,
      "stripe_payment_intent_id": "pi_xxx",
      "created_at": "2025-01-10T12:00:00Z"
    }
  ]
}
```

## Database Schema

### itc_transactions Table
```sql
CREATE TABLE itc_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  amount DECIMAL(10, 2) NOT NULL,
  type VARCHAR(10) DEFAULT 'credit',
  balance_before DECIMAL(10, 2),
  balance_after DECIMAL(10, 2),
  description TEXT NOT NULL,
  usd_value DECIMAL(10, 2),
  stripe_payment_intent_id VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_itc_transactions_user_id ON itc_transactions(user_id);
CREATE INDEX idx_itc_transactions_stripe_pi ON itc_transactions(stripe_payment_intent_id);
CREATE INDEX idx_itc_transactions_created_at ON itc_transactions(created_at DESC);
```

## Testing

### Test Mode
Use Stripe test cards for testing:

| Card Number         | Description           |
|--------------------|-----------------------|
| 4242 4242 4242 4242 | Successful payment    |
| 4000 0025 0000 3155 | Requires 3D Secure    |
| 4000 0000 0000 9995 | Declined (insufficient funds) |

**Test Details:**
- Expiry: Any future date (e.g., 12/34)
- CVC: Any 3 digits (e.g., 123)
- ZIP: Any 5 digits (e.g., 12345)

### Testing Webhooks Locally
Use Stripe CLI to forward webhooks to localhost:

```bash
# Install Stripe CLI
# https://stripe.com/docs/stripe-cli

# Login
stripe login

# Forward webhooks
stripe listen --forward-to localhost:4000/api/stripe/webhook

# Copy the webhook secret (whsec_...) and add to .env
STRIPE_WEBHOOK_SECRET=whsec_...

# Trigger test event
stripe trigger payment_intent.succeeded
```

## Security Features

### 1. Rate Limiting
- Maximum 5 payment attempts per minute per user
- Implemented in-memory (use Redis for production)

### 2. Amount Validation
- Only predefined package amounts are accepted
- Server-side validation prevents tampering

### 3. Duplicate Prevention
- Checks for existing `stripe_payment_intent_id` before crediting
- Prevents double-crediting from webhook retries

### 4. Webhook Signature Verification
- All webhooks verify Stripe signature
- Rejects invalid/tampered requests

### 5. User Ownership Validation
- Ensures only the owning user can access wallet
- JWT authentication required for all endpoints

## Error Handling

### Frontend
- Network errors: Retry with exponential backoff
- Payment errors: Display user-friendly messages
- Validation errors: Prevent form submission

### Backend
- Invalid amounts: Return 400 with valid amounts
- Rate limiting: Return 429 with retry-after
- Webhook failures: Log and alert (don't credit wallet)

## Monitoring

### Logs to Watch
- Payment intent creation: `[stripe] Payment intent created`
- Webhook processing: `[webhook] Processing event`
- Wallet crediting: `[wallet] ITC credited`
- Errors: `[error] Payment processing failed`

### Metrics to Track
- Payment success rate
- Average purchase amount
- Failed payment reasons
- Webhook delivery time

## Production Checklist

- [ ] Use production Stripe keys (`pk_live_...` and `sk_live_...`)
- [ ] Configure production webhook endpoint
- [ ] Add webhook secret to production environment
- [ ] Enable Redis for rate limiting (replace in-memory map)
- [ ] Set up email service for confirmations
- [ ] Configure monitoring and alerts
- [ ] Test with small real payments
- [ ] Enable Stripe Radar for fraud prevention
- [ ] Set up payment reconciliation process
- [ ] Configure tax calculation if required

## Troubleshooting

### Payment Intent Creation Fails
- Check STRIPE_SECRET_KEY is set correctly
- Verify amount is a valid package amount
- Check rate limiting (5 requests/minute)

### Webhook Not Receiving Events
- Verify webhook URL is publicly accessible
- Check STRIPE_WEBHOOK_SECRET is correct
- Use `stripe listen` for local testing
- Check webhook event selection in dashboard

### Wallet Not Credited
- Check webhook logs for errors
- Verify `stripe_payment_intent_id` in database
- Check for duplicate transaction prevention
- Verify user_id in payment metadata

### Payment Succeeds but No Confirmation
- Check webhook received `payment_intent.succeeded`
- Verify transaction recorded in `itc_transactions`
- Check wallet balance updated in `user_wallets`
- Review error logs for issues

## Support

For issues or questions:
1. Check Stripe Dashboard > Logs for payment details
2. Review backend logs for webhook processing
3. Check database for transaction records
4. Contact Stripe support for payment issues
5. File issue in repository for integration bugs
