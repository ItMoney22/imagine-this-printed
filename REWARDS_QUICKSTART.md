# Rewards System - Quick Start Guide

## 🚀 Deployment Steps

### 1. Deploy Database Migration

**Option A: Supabase Dashboard**
```bash
# Copy the contents of migrations/006_reward_system.sql
# Paste into Supabase SQL Editor
# Click "Run"
```

**Option B: Command Line**
```bash
psql -U postgres -h your-project.supabase.co -d postgres -f migrations/006_reward_system.sql
```

### 2. Verify Migration

```sql
-- Check tables exist
SELECT COUNT(*) FROM points_transactions;
SELECT COUNT(*) FROM itc_transactions;
SELECT COUNT(*) FROM referral_codes;
SELECT COUNT(*) FROM referral_transactions;
SELECT COUNT(*) FROM order_rewards;

-- Test the award function
SELECT award_order_rewards(
  gen_random_uuid(), -- test order ID
  'your-user-uuid'::uuid,
  100.00,
  1.0
);
```

### 3. Deploy Backend

```bash
cd backend

# Install dependencies (if needed)
npm install

# Build TypeScript
npm run build

# Deploy to Railway/VPS
git add .
git commit -m "feat: add order rewards and referral system"
git push origin main
```

### 4. Test API Endpoints

```bash
# Health check
curl https://api.imaginethisprinted.com/api/health

# Get wallet (requires auth token)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.imaginethisprinted.com/api/wallet/get

# Get points transactions
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.imaginethisprinted.com/api/wallet/transactions/points

# Get order rewards
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.imaginethisprinted.com/api/wallet/rewards/orders
```

## 📊 How It Works

### Automatic Order Rewards

When an order is marked as "completed":

```typescript
// In your admin panel or order management system
const response = await fetch('/api/orders/{orderId}/complete', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  }
})

// Automatically:
// 1. Updates order status to "completed"
// 2. Calculates rewards based on user tier
// 3. Awards points and ITC to user wallet
// 4. Creates transaction records
// 5. Logs activity in audit trail
```

### User Tier Progression

| Tier | Spend Required | Points Rate | ITC Bonus |
|------|---------------|-------------|-----------|
| 🥉 Bronze | $0 | 100 points/$1 | 0% |
| 🥈 Silver | $500 | 125 points/$1 | 0.5% |
| 🥇 Gold | $2,000 | 150 points/$1 | 1% |
| 💎 Platinum | $10,000 | 200 points/$1 | 2% |

Tiers are automatically calculated based on **lifetime spend** across all completed orders.

### Referral Program

**Generate Code**:
```javascript
// User creates referral code (one per user)
POST /api/wallet/referral/create
// Returns: { code: "JOHN2K8A" }
```

**Share Code**:
```javascript
// New user applies code during signup
POST /api/wallet/referral/apply
Body: { code: "JOHN2K8A" }

// Instant rewards:
// - Referrer: +500 points, +5 ITC
// - New user: +250 points, +2.5 ITC (welcome bonus)
```

**First Purchase Bonus**:
```javascript
// When referred user makes first purchase
// Referrer automatically gets 5% of order value as bonus points
// Example: $100 order = +500 bonus points to referrer
```

## 🎯 Integration Points

### 1. Order Completion Flow

Update your order management system:

```typescript
// backend/routes/admin/orders.ts (or wherever you handle orders)
import { processOrderCompletion } from '../services/order-reward-service.js'

router.patch('/:orderId/complete', requireAuth, async (req, res) => {
  // ... update order status ...

  // Award rewards
  await processOrderCompletion({
    orderId: order.id,
    userId: order.user_id,
    orderTotal: order.total
  })

  res.json({ success: true })
})
```

### 2. Signup Flow

Add referral code field to signup form:

```typescript
// src/components/AuthModal.tsx
<input
  type="text"
  placeholder="Referral code (optional)"
  onChange={(e) => setReferralCode(e.target.value)}
/>

// After successful signup
if (referralCode) {
  await apiFetch('/api/wallet/referral/apply', {
    method: 'POST',
    body: JSON.stringify({ code: referralCode })
  })
}
```

### 3. Wallet Page

Update the wallet component to show new tabs:

```typescript
// src/pages/Wallet.tsx

// Add these tabs to navigation
const tabs = ['overview', 'points', 'itc', 'orders', 'referrals', 'redeem', 'purchase']

// Load data
useEffect(() => {
  const loadData = async () => {
    const [points, itc, orders, referrals] = await Promise.all([
      apiFetch('/api/wallet/transactions/points'),
      apiFetch('/api/wallet/transactions/itc'),
      apiFetch('/api/wallet/rewards/orders'),
      apiFetch('/api/wallet/referral/stats')
    ])

    setPointsHistory(points.transactions)
    setItcHistory(itc.transactions)
    setOrderRewards(orders.rewards)
    setReferralStats(referrals.stats)
  }

  loadData()
}, [])
```

## 🔧 Admin Operations

### Process Pending Rewards

For orders that were completed before this system was deployed:

```bash
# Run this ONCE to process historical orders
curl -X POST \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  https://api.imaginethisprinted.com/api/orders/process-pending-rewards

# Response shows how many orders were processed
{
  "ok": true,
  "result": {
    "total": 47,
    "successful": 46,
    "failed": 1
  }
}
```

### Retry Failed Rewards

If a reward fails to process:

```bash
curl -X POST \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  https://api.imaginethisprinted.com/api/orders/{orderId}/retry-rewards
```

### Monitor Rewards

```sql
-- Check recent rewards
SELECT
  o.id,
  o.total,
  r.user_tier,
  r.total_points,
  r.itc_bonus,
  r.awarded_at
FROM order_rewards r
JOIN orders o ON o.id = r.order_id
ORDER BY r.awarded_at DESC
LIMIT 20;

-- Check failed rewards
SELECT * FROM order_rewards WHERE status = 'failed';

-- Referral stats
SELECT
  COUNT(*) as total_referrals,
  SUM(referrer_reward_points) as total_points_awarded,
  SUM(referrer_reward_itc) as total_itc_awarded
FROM referral_transactions
WHERE status = 'completed';
```

## 🎁 Promotional Campaigns

### Activate Double Points Weekend

```typescript
// Manual activation for special events
await processOrderCompletion({
  orderId,
  userId,
  orderTotal,
  promoMultiplier: 2.0 // 2x points!
})
```

### Automatic Time-Based Promotions

Already built-in:
- **Happy Hour** (2-6 PM weekdays): 1.5x points
- **Weekend Bonus** (Sat-Sun): 1.25x points

## 📱 User Experience

### What Users See

**After Order Completion**:
```
🎉 Order Complete!

You earned:
- 9,900 points (Gold tier bonus)
- 0.99 ITC tokens

Your new balance:
- 15,450 points
- 12.5 ITC
```

**Referral Dashboard**:
```
Your Referral Code: JOHN2K8A

Stats:
- 12 total referrals
- 6,500 points earned
- 65 ITC earned

Share your code and earn rewards!
- Friend gets: 250 points + 2.5 ITC
- You get: 500 points + 5 ITC
- Plus 5% bonus on their first purchase
```

## 🚨 Troubleshooting

### Problem: Rewards not showing up

**Check 1**: Order status
```sql
SELECT status FROM orders WHERE id = 'order-id';
-- Must be 'completed' or 'delivered'
```

**Check 2**: Reward record
```sql
SELECT * FROM order_rewards WHERE order_id = 'order-id';
-- Should exist with status = 'awarded'
```

**Check 3**: Retry processing
```bash
curl -X POST /api/orders/{orderId}/retry-rewards
```

### Problem: Referral code doesn't work

**Check code validity**:
```sql
SELECT * FROM referral_codes WHERE code = 'CODE123';
-- Verify is_active = true, not expired, max_uses not reached
```

**Check if already used**:
```sql
SELECT * FROM referral_transactions WHERE referee_id = 'user-id';
-- Users can only use one referral code
```

### Problem: Balance incorrect

**Audit balance**:
```sql
-- Get all transactions
SELECT
  created_at,
  type,
  amount,
  balance_after,
  reason
FROM points_transactions
WHERE user_id = 'user-id'
ORDER BY created_at DESC;

-- Compare to current wallet
SELECT points FROM user_wallets WHERE user_id = 'user-id';
```

## 📈 Performance

- All queries use indexes for fast lookups
- RLS policies enforce security without performance hit
- Transaction inserts are atomic
- Batch processing supports 100+ orders at once

## 🔐 Security

- RLS ensures users only see their own data
- Admin endpoints require admin role
- Duplicate rewards prevented by unique constraints
- Self-referral blocked at database level
- All operations logged in audit trail

## 📝 Next Steps

1. ✅ Deploy database migration
2. ✅ Deploy backend code
3. ⏳ Update Wallet.tsx component
4. ⏳ Add referral code field to signup
5. ⏳ Update order completion flow
6. ⏳ Test with real orders
7. ⏳ Monitor for 24 hours
8. ⏳ Announce to users

---

**Questions?** Check the full documentation in `REWARDS_SYSTEM_IMPLEMENTATION.md`
