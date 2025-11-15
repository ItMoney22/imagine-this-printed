# ImagineThisPrinted Wallet System - Complete Documentation

**Last Updated:** 2025-11-10
**Audit Date:** 2025-11-10
**Status:** ⚠️ PARTIALLY IMPLEMENTED - Missing transaction logging and admin management features

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Database Schema](#database-schema)
4. [Frontend Components](#frontend-components)
5. [Backend API Endpoints](#backend-api-endpoints)
6. [User Workflows](#user-workflows)
7. [Admin Workflows](#admin-workflows)
8. [Integration Points](#integration-points)
9. [RLS Policies](#rls-policies)
10. [Missing Features](#missing-features)
11. [Troubleshooting](#troubleshooting)

---

## Executive Summary

### What Works ✅
- User wallet creation (auto-created on signup via trigger)
- Balance display in frontend
- ITC balance fetching via API
- Points redemption to ITC conversion
- ITC deduction for mockup generation (designer feature)
- Wallet balance checks before spending
- Basic wallet UI with multiple tabs

### What's Missing ❌
- **Transaction history recording** - No insert into itc_transactions or points_transactions tables
- **Admin wallet management** - No admin endpoints to credit/debit user wallets
- **Transaction audit trail** - Transactions not being logged despite table existing
- **Earning mechanisms** - No automated ITC rewards for referrals, purchases, etc.
- **Purchase completion** - Stripe ITC purchase flow incomplete
- **Audit logs** - No logging of wallet modifications
- **Admin UI** - No interface for admins to manage user wallets

### Critical Issues 🚨
1. **ITC deductions are happening WITHOUT transaction records** - Line 196-202 in backend/routes/designer.ts updates wallet but doesn't create transaction
2. **Points redemption doesn't log transactions** - Line 73-82 in backend/routes/wallet.ts updates wallet but doesn't insert into transactions table
3. **No admin wallet controls** - Admins cannot manually credit/debit users
4. **Transaction history is empty** - Frontend displays empty arrays because no transactions are being recorded

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      WALLET SYSTEM ARCHITECTURE                  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Frontend   │◄───────►│   Backend    │◄───────►│   Supabase   │
│   (React)    │  HTTP   │   (Express)  │  RLS    │  (Postgres)  │
└──────────────┘         └──────────────┘         └──────────────┘
       │                        │                         │
       │                        │                         │
   ┌───▼────┐              ┌───▼────┐              ┌────▼─────┐
   │ Wallet │              │ Wallet │              │  user_   │
   │  Page  │              │ Routes │              │ wallets  │
   └────────┘              └────────┘              └──────────┘
       │                        │                         │
   ┌───▼────────┐          ┌───▼────────┐          ┌────▼─────────┐
   │ Auth       │          │ Designer   │          │ points_      │
   │ Context    │          │ Routes     │          │ transactions │
   │ (Balance)  │          │ (Spend)    │          │ (EMPTY!)     │
   └────────────┘          └────────────┘          └──────────────┘
                                │                         │
                           ┌────▼─────────┐         ┌────▼─────────┐
                           │ Stripe-ITC   │         │ itc_         │
                           │ Bridge       │         │ transactions │
                           │ (Purchase)   │         │ (EMPTY!)     │
                           └──────────────┘         └──────────────┘

Key Data Flow:
1. User signs up → Trigger creates wallet with 0 balance
2. User views balance → Frontend fetches from user_wallets via API
3. User spends ITC → Backend deducts balance (NO TRANSACTION LOGGED!)
4. User redeems points → Backend converts (NO TRANSACTION LOGGED!)
5. User views history → Frontend shows empty (NO TRANSACTIONS TO SHOW!)
```

---

## Database Schema

### Table: `user_wallets`

**File:** `supabase/migrations/001_initial_schema.sql` (lines 39-50)

```sql
CREATE TABLE user_wallets (
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE PRIMARY KEY,
  points_balance INTEGER DEFAULT 0,           -- Loyalty points
  itc_balance DECIMAL DEFAULT 0.00,           -- ITC token balance
  lifetime_points_earned INTEGER DEFAULT 0,    -- Total points ever earned
  lifetime_itc_earned DECIMAL DEFAULT 0.00,    -- Total ITC ever earned
  last_points_activity TIMESTAMPTZ,            -- Last points transaction
  last_itc_activity TIMESTAMPTZ,               -- Last ITC transaction
  wallet_status TEXT DEFAULT 'active',         -- active/suspended/locked
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Columns:**
- `user_id` - Primary key, references user_profiles
- `points_balance` - Current points balance (integer)
- `itc_balance` - Current ITC token balance (decimal)
- `lifetime_points_earned` - Cumulative points earned (not updated currently)
- `lifetime_itc_earned` - Cumulative ITC earned (not updated currently)
- `last_points_activity` - Timestamp of last points transaction (not updated)
- `last_itc_activity` - Timestamp of last ITC transaction (not updated)
- `wallet_status` - Status flag (always 'active' currently)
- `created_at`, `updated_at` - Standard timestamps

**Trigger:** Auto-created on user signup via `handle_new_user()` trigger (lines 50-71 in supabase/migrations/003_user_triggers.sql)

### Table: `points_transactions`

**File:** `supabase/migrations/001_initial_schema.sql` (lines 53-66)

```sql
CREATE TABLE points_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,                    -- 'earned' | 'redeemed'
  amount INTEGER NOT NULL,               -- Points amount (+ for earn, - for spend)
  balance_after INTEGER NOT NULL,        -- Balance after this transaction
  reason TEXT NOT NULL,                  -- Description of transaction
  source TEXT,                           -- Source system (e.g., 'order', 'referral')
  reference_id TEXT,                     -- Related entity ID (order_id, etc.)
  metadata JSONB DEFAULT '{}',           -- Additional data
  expires_at TIMESTAMPTZ,                -- Expiration for earned points
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Status:** ⚠️ Table exists but NO DATA is being inserted

### Table: `itc_transactions`

**File:** `supabase/migrations/001_initial_schema.sql` (lines 69-85)

```sql
CREATE TABLE itc_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,                    -- 'purchase' | 'reward' | 'redemption' | 'ai_generation'
  amount DECIMAL NOT NULL,               -- ITC amount (+ for credit, - for debit)
  balance_after DECIMAL NOT NULL,        -- Balance after this transaction
  usd_value DECIMAL,                     -- USD equivalent value
  exchange_rate DECIMAL DEFAULT 0.10,    -- ITC to USD rate
  reason TEXT NOT NULL,                  -- Description of transaction
  payment_intent_id TEXT,                -- Stripe payment ID (for purchases)
  transaction_hash TEXT,                 -- Blockchain tx hash (future)
  reference_id TEXT,                     -- Related entity ID
  metadata JSONB DEFAULT '{}',           -- Additional data
  status TEXT DEFAULT 'completed',       -- 'completed' | 'pending' | 'failed'
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Status:** ⚠️ Table exists but NO DATA is being inserted

---

## Frontend Components

### Component: `Wallet.tsx`

**File:** `src/pages/Wallet.tsx`

**Features:**
- Tab navigation (overview, points, itc, redeem, purchase)
- Balance display cards (points, ITC, total USD value)
- Points redemption form
- ITC purchase form (via Stripe)
- Transaction history display (currently empty)

**Key Functions:**

#### `loadWalletData()` - Lines 39-72
```typescript
// Fetches wallet data from backend API
// GET /api/wallet/get
// Updates state: pointsBalance, itcBalance
// Does NOT fetch transaction history (sets empty arrays)
```

#### `handleRedeem()` - Lines 98-126
```typescript
// Redeems points for ITC tokens
// POST /api/wallet/redeem
// Conversion: 1 point = $0.01 = 0.0025 ITC
// Does NOT log transaction to database
```

#### `handlePurchaseITC()` - Lines 74-96
```typescript
// Purchase ITC tokens with Stripe
// Calls stripeITCBridge.purchaseITC()
// ⚠️ NOT FULLY IMPLEMENTED - Stripe flow incomplete
```

**Exchange Rates (Lines 24-26):**
```typescript
const pointsToUSD = 0.01  // 1 point = $0.01 USD
const usdToITC = 0.25     // $1.00 = 0.25 ITC tokens
```

### Context: `SupabaseAuthContext.tsx`

**File:** `src/context/SupabaseAuthContext.tsx`

**Wallet Integration (Lines 16-19, 102-105):**
```typescript
interface User {
  // ... other fields
  wallet?: {
    pointsBalance: number
    itcBalance: number
  }
}

// Fetched from user_wallets table (lines 56-60)
const walletResult = await supabase
  .from('user_wallets')
  .select('points, itc_balance')
  .eq('user_id', supabaseUser.id)
  .single()
```

**Usage:** Provides wallet balance to all components via `useAuth()` hook

---

## Backend API Endpoints

### Endpoint: `GET /api/wallet/get`

**File:** `backend/routes/wallet.ts` (lines 8-37)

**Auth:** Required (requireAuth middleware)

**Response:**
```json
{
  "ok": true,
  "wallet": {
    "user_id": "uuid",
    "points_balance": 100,
    "itc_balance": 25.50,
    "lifetime_points_earned": 100,
    "lifetime_itc_earned": 25.50,
    "wallet_status": "active",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

**Implementation:**
```typescript
// Fetches wallet from user_wallets table
const { data: wallet, error } = await supabase
  .from('user_wallets')
  .select('*')
  .eq('user_id', userId)
  .single()
```

### Endpoint: `POST /api/wallet/redeem`

**File:** `backend/routes/wallet.ts` (lines 40-101)

**Auth:** Required

**Request Body:**
```json
{
  "points": 100,
  "redeemType": "itc"  // Currently only 'itc' is implemented
}
```

**Response:**
```json
{
  "ok": true,
  "wallet": { /* updated wallet */ },
  "redeemed": {
    "points": 100,
    "itc": 1.0
  }
}
```

**Implementation:**
```typescript
// 1. Check balance
if (wallet.points < points) {
  return res.status(400).json({ error: 'Insufficient points' })
}

// 2. Calculate ITC (1 point = 0.01 ITC)
const itcAmount = points * 0.01

// 3. Update wallet (lines 73-82)
const { data: updated, error: updateError } = await supabase
  .from('user_wallets')
  .update({
    points: wallet.points - points,
    itc_balance: wallet.itc_balance + itcAmount,
    updated_at: new Date().toISOString(),
  })
  .eq('user_id', userId)

// ❌ CRITICAL: No transaction record created!
```

**Missing:** Transaction logging to `points_transactions` and `itc_transactions`

### Endpoint: `POST /api/designer/generate-mockup`

**File:** `backend/routes/designer.ts` (lines 32-228)

**Auth:** Required

**Request Body:**
```json
{
  "designImageUrl": "https://...",
  "productTemplate": "shirts",
  "mockupType": "flat"
}
```

**Response:**
```json
{
  "ok": true,
  "mockupUrl": "https://storage.googleapis.com/...",
  "cost": 25,
  "newBalance": 75.00
}
```

**ITC Cost:** 25 ITC tokens per mockup (line 15)

**Implementation:**
```typescript
// 1. Check balance (lines 76-92)
const { data: wallet } = await supabase
  .from('user_wallets')
  .select('itc_balance')
  .eq('user_id', userId)
  .single()

if (wallet.itc_balance < 25) {
  return res.status(400).json({ error: 'Insufficient ITC balance' })
}

// 2. Generate mockup with Replicate AI (lines 128-176)

// 3. Upload to Google Cloud Storage (lines 178-194)

// 4. Deduct ITC (lines 197-202)
const { error: updateError } = await supabase
  .from('user_wallets')
  .update({
    itc_balance: wallet.itc_balance - 25
  })
  .eq('user_id', userId)

// ❌ CRITICAL: No transaction record created!
```

**Missing:** Transaction logging to `itc_transactions` table with type='ai_generation'

---

## User Workflows

### Workflow 1: View Wallet Balance

```
┌─────────────┐
│ User logs in│
└──────┬──────┘
       │
       ▼
┌────────────────────────┐
│ AuthContext fetches    │
│ wallet from Supabase   │
│ (user_wallets table)   │
└──────┬─────────────────┘
       │
       ▼
┌────────────────────────┐
│ Balance stored in      │
│ user.wallet object     │
│ {pointsBalance: 0,     │
│  itcBalance: 0.00}     │
└──────┬─────────────────┘
       │
       ▼
┌────────────────────────┐
│ User navigates to      │
│ /wallet page           │
└──────┬─────────────────┘
       │
       ▼
┌────────────────────────┐
│ Wallet.tsx calls       │
│ loadWalletData() API   │
│ GET /api/wallet/get    │
└──────┬─────────────────┘
       │
       ▼
┌────────────────────────┐
│ Displays balance cards │
│ - Points: 0            │
│ - ITC: 0.00            │
│ - Total Value: $0.00   │
└────────────────────────┘
```

**Result:** ✅ Works correctly

### Workflow 2: Redeem Points for ITC

```
┌─────────────────────┐
│ User enters amount  │
│ Input: 100 points   │
└──────┬──────────────┘
       │
       ▼
┌──────────────────────────┐
│ handleRedeem() called    │
│ POST /api/wallet/redeem  │
│ {points: 100}            │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ Backend checks balance   │
│ wallet.points >= 100?    │
└──────┬───────────────────┘
       │
       ▼ YES
┌──────────────────────────┐
│ Calculate ITC amount     │
│ 100 * 0.01 = 1.0 ITC     │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ Update user_wallets:     │
│ points: 100 → 0          │
│ itc_balance: 0 → 1.0     │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ ❌ NO TRANSACTION LOG!   │
│ (Should insert to        │
│  points_transactions &   │
│  itc_transactions)       │
└──────┬───────────────────┘
       │
       ▼
┌──────────────────────────┐
│ Frontend refreshes       │
│ Shows updated balances   │
└──────────────────────────┘
```

**Result:** ⚠️ Partially works - Balance updates but no transaction history

### Workflow 3: Generate Mockup (Spend ITC)

```
┌─────────────────────────┐
│ User in Product         │
│ Designer, clicks        │
│ "Generate Mockup"       │
└──────┬──────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ POST /api/designer/          │
│      generate-mockup         │
│ {designImageUrl,             │
│  productTemplate: "shirts"}  │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Backend checks ITC balance   │
│ wallet.itc_balance >= 25?    │
└──────┬───────────────────────┘
       │
       ▼ YES
┌──────────────────────────────┐
│ Call Replicate API           │
│ Generate mockup image        │
│ (AI image generation)        │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Upload result to             │
│ Google Cloud Storage         │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Deduct 25 ITC from wallet    │
│ UPDATE user_wallets          │
│ itc_balance = balance - 25   │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ ❌ NO TRANSACTION LOG!       │
│ (Should insert to            │
│  itc_transactions with       │
│  type='ai_generation')       │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Return mockup URL to         │
│ frontend with new balance    │
└──────────────────────────────┘
```

**Result:** ⚠️ Partially works - Mockup generated and ITC deducted but no audit trail

### Workflow 4: Purchase ITC with Stripe

```
┌─────────────────────────┐
│ User enters USD amount  │
│ Input: $10.00           │
└──────┬──────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ handlePurchaseITC() called   │
│ stripeITCBridge.purchaseITC()│
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Calculate ITC amount         │
│ $10.00 / $0.10 = 100 ITC     │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ ❌ INCOMPLETE FLOW           │
│ Creates payment intent but   │
│ Stripe Elements not properly │
│ integrated for card input    │
└──────────────────────────────┘
```

**Result:** ❌ Not working - Stripe integration incomplete

### Workflow 5: View Transaction History

```
┌─────────────────────────┐
│ User clicks "Points" or │
│ "ITC" tab in Wallet     │
└──────┬──────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Wallet.tsx displays          │
│ pointsHistory array          │
│ OR itcHistory array          │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ ❌ ALWAYS EMPTY!             │
│ Arrays initialized as []     │
│ in loadWalletData() line 63  │
│ No API call to fetch         │
│ transaction history          │
└──────────────────────────────┘
```

**Result:** ❌ Not working - No transaction history available

---

## Admin Workflows

### Admin Workflow 1: View User Wallet (Current)

```
┌─────────────────────────┐
│ Admin logs into         │
│ AdminDashboard          │
└──────┬──────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Can view user_wallets via    │
│ direct Supabase queries      │
│ (lines 100-104 in            │
│  AdminDashboard.tsx)         │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ Displays total points        │
│ distributed across all users │
│ (system metric)              │
└──────────────────────────────┘
```

**Result:** ⚠️ Read-only, no management capabilities

### Admin Workflow 2: Credit User Wallet (Missing)

```
┌─────────────────────────┐
│ Admin wants to credit   │
│ user with ITC tokens    │
└──────┬──────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ ❌ NO ENDPOINT EXISTS        │
│ Should: POST /api/admin/     │
│         wallet/credit        │
│ {userId, amount, reason}     │
└──────────────────────────────┘
```

**Result:** ❌ Not implemented

### Admin Workflow 3: Debit User Wallet (Missing)

```
┌─────────────────────────┐
│ Admin wants to deduct   │
│ ITC from user (refund,  │
│ correction, etc.)       │
└──────┬──────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ ❌ NO ENDPOINT EXISTS        │
│ Should: POST /api/admin/     │
│         wallet/debit         │
│ {userId, amount, reason}     │
└──────────────────────────────┘
```

**Result:** ❌ Not implemented

### Admin Workflow 4: View Transaction History (Missing)

```
┌─────────────────────────┐
│ Admin wants to audit    │
│ user transaction history│
└──────┬──────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ ❌ NO UI EXISTS              │
│ Should: Display list of      │
│ itc_transactions for user    │
│ with filters, search         │
└──────────────────────────────┘
```

**Result:** ❌ Not implemented

### Admin Workflow 5: Suspend Wallet (Missing)

```
┌─────────────────────────┐
│ Admin wants to suspend  │
│ user wallet (fraud,     │
│ investigation, etc.)    │
└──────┬──────────────────┘
       │
       ▼
┌──────────────────────────────┐
│ ❌ NO ENDPOINT EXISTS        │
│ Should: POST /api/admin/     │
│         wallet/suspend       │
│ {userId, reason}             │
│ Sets wallet_status='suspended'│
└──────────────────────────────┘
```

**Result:** ❌ Not implemented

---

## Integration Points

### Integration 1: Product Designer → Wallet

**Location:** `backend/routes/designer.ts`

**Function:** `POST /api/designer/generate-mockup`

**ITC Cost:** 25 tokens per mockup generation

**Flow:**
1. User creates design in ProductDesigner.tsx
2. Clicks "Generate Mockup" button
3. Backend checks ITC balance (line 76-92)
4. Calls Replicate AI API for image generation (line 134-146)
5. Uploads result to Google Cloud Storage (line 185)
6. Deducts 25 ITC from wallet (line 197-202)
7. Returns mockup URL and new balance

**Issues:**
- ❌ No transaction logging
- ❌ No update to `last_itc_activity` timestamp
- ❌ No update to `lifetime_itc_earned` (should track spending too)

### Integration 2: Referral System → Wallet (Missing)

**Location:** `src/utils/referral-system.ts`

**Expected Flow:**
1. User signs up with referral code
2. Referral system validates code
3. Credits both referrer and referee with ITC rewards
4. Logs transactions to `itc_transactions` and `referral_transactions`

**Current Status:** ❌ Referral rewards not integrated with wallet

**Files to Check:**
- `supabase/migrations/001_initial_schema.sql` - referral_codes table (lines 88-103)
- `supabase/migrations/001_initial_schema.sql` - referral_transactions table (lines 106-121)

### Integration 3: Order Completion → Wallet (Missing)

**Expected Flow:**
1. User completes order
2. Earns points based on order total (e.g., 1 point per $1 spent)
3. Updates `user_wallets.points_balance`
4. Inserts record into `points_transactions`

**Current Status:** ❌ Not implemented

### Integration 4: Founder Earnings → Wallet (Missing)

**Location:** `src/utils/founder-earnings.ts`

**Expected Flow:**
1. Order is fulfilled
2. Calculate 35% profit share for founder
3. Credit founder's wallet with ITC or points
4. Log transaction

**Current Status:** ❌ Not integrated with wallet system

### Integration 5: Vendor Payouts → Wallet (Missing)

**Location:** `src/utils/vendor-payouts.ts`

**Expected Flow:**
1. Vendor product sells
2. Calculate commission
3. Credit vendor wallet or trigger Stripe payout
4. Log transaction

**Current Status:** ❌ Not integrated with wallet system

---

## RLS Policies

**File:** `supabase/migrations/002_rls_policies.sql`

### Policy 1: Users Access Own Wallet (Lines 46-47)

```sql
CREATE POLICY "Users can access their own wallet" ON user_wallets
    FOR ALL USING (auth.uid() = user_id);
```

**Effect:** Users can SELECT, UPDATE their own wallet
**Status:** ✅ Working correctly

### Policy 2: Users View Own Points Transactions (Lines 50-51)

```sql
CREATE POLICY "Users can view their own points transactions" ON points_transactions
    FOR SELECT USING (auth.uid() = user_id);
```

**Effect:** Users can only see their own points transactions
**Status:** ✅ Policy correct, but no data exists

### Policy 3: System Inserts Points Transactions (Lines 53-54)

```sql
CREATE POLICY "System can insert points transactions" ON points_transactions
    FOR INSERT WITH CHECK (true);
```

**Effect:** Backend can insert transactions without restrictions
**Status:** ✅ Policy allows inserts, but backend doesn't use it

### Policy 4: Users View Own ITC Transactions (Lines 57-58)

```sql
CREATE POLICY "Users can view their own ITC transactions" ON itc_transactions
    FOR SELECT USING (auth.uid() = user_id);
```

**Effect:** Users can only see their own ITC transactions
**Status:** ✅ Policy correct, but no data exists

### Policy 5: System Inserts ITC Transactions (Lines 60-61)

```sql
CREATE POLICY "System can insert ITC transactions" ON itc_transactions
    FOR INSERT WITH CHECK (true);
```

**Effect:** Backend can insert transactions without restrictions
**Status:** ✅ Policy allows inserts, but backend doesn't use it

### Admin Access to Wallets (Missing)

**Expected Policy:**
```sql
CREATE POLICY "Admins can manage all wallets" ON user_wallets
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE id = auth.uid() AND role IN ('admin', 'founder')
        )
    );
```

**Status:** ❌ Not implemented - Admins cannot manage wallets via UI

---

## Missing Features

### 1. Transaction Logging System

**Priority:** 🔴 CRITICAL

**Problem:** All wallet modifications happen without audit trail

**Required Implementation:**

#### Backend Function: `logITCTransaction()`
```typescript
// Create: backend/utils/wallet-logger.ts

export async function logITCTransaction(
  userId: string,
  type: 'purchase' | 'reward' | 'redemption' | 'ai_generation' | 'admin_credit' | 'admin_debit',
  amount: number,
  reason: string,
  metadata?: Record<string, any>
) {
  // 1. Get current balance
  const { data: wallet } = await supabase
    .from('user_wallets')
    .select('itc_balance')
    .eq('user_id', userId)
    .single()

  // 2. Insert transaction record
  const { error } = await supabase
    .from('itc_transactions')
    .insert({
      user_id: userId,
      type,
      amount,
      balance_after: wallet.itc_balance,
      reason,
      metadata,
      status: 'completed',
      processed_at: new Date().toISOString()
    })

  if (error) {
    console.error('[wallet-logger] Failed to log ITC transaction:', error)
    // Don't throw - transaction already completed
  }
}
```

#### Backend Function: `logPointsTransaction()`
```typescript
export async function logPointsTransaction(
  userId: string,
  type: 'earned' | 'redeemed',
  amount: number,
  reason: string,
  source?: string,
  referenceId?: string
) {
  // Similar to logITCTransaction but for points
}
```

**Files to Modify:**
- `backend/routes/wallet.ts` - Add logging to redeem endpoint (after line 82)
- `backend/routes/designer.ts` - Add logging to generate-mockup (after line 202)

### 2. Admin Wallet Management Endpoints

**Priority:** 🔴 CRITICAL

**Required Endpoints:**

#### `POST /api/admin/wallet/credit`
```typescript
// Credit user wallet with ITC tokens
// Request: { userId, amount, reason }
// Response: { ok: true, wallet, transaction }
```

#### `POST /api/admin/wallet/debit`
```typescript
// Debit user wallet (refunds, corrections)
// Request: { userId, amount, reason }
// Response: { ok: true, wallet, transaction }
```

#### `GET /api/admin/wallet/transactions/:userId`
```typescript
// Get transaction history for user
// Response: { ok: true, transactions: [] }
```

#### `POST /api/admin/wallet/suspend`
```typescript
// Suspend user wallet
// Request: { userId, reason }
// Response: { ok: true, wallet }
```

#### `POST /api/admin/wallet/activate`
```typescript
// Re-activate suspended wallet
// Request: { userId }
// Response: { ok: true, wallet }
```

**Implementation File:** Create `backend/routes/admin/wallet.ts`

### 3. Transaction History API

**Priority:** 🟡 HIGH

**Required Endpoints:**

#### `GET /api/wallet/transactions/points`
```typescript
// Get points transaction history for current user
// Query params: ?limit=50&offset=0
// Response: { ok: true, transactions: [], total: 100 }
```

#### `GET /api/wallet/transactions/itc`
```typescript
// Get ITC transaction history for current user
// Query params: ?limit=50&offset=0&type=ai_generation
// Response: { ok: true, transactions: [], total: 100 }
```

**Files to Modify:**
- `backend/routes/wallet.ts` - Add new endpoints
- `src/pages/Wallet.tsx` - Fetch and display history (lines 63-64)

### 4. Automated Earning Mechanisms

**Priority:** 🟡 HIGH

**Missing Integrations:**

#### Order Completion → Points
```typescript
// File: backend/routes/orders.ts
// After order status = 'completed'
// Award points: 1 point per $1 spent
await creditPoints(userId, orderTotal, 'Order #' + orderId)
```

#### Referral Rewards → ITC
```typescript
// File: backend/routes/referrals.ts
// After successful referral signup
await creditITC(referrerId, 10, 'Referral reward')
await creditITC(refereeId, 5, 'Welcome bonus')
```

#### Product Upload → Points
```typescript
// File: backend/routes/products.ts
// After product approved
await creditPoints(vendorId, 50, 'Product approved')
```

### 5. Stripe ITC Purchase Flow

**Priority:** 🟡 HIGH

**Files to Complete:**
- `src/utils/stripe-itc.ts` - Implement Stripe Elements integration
- `backend/routes/webhooks.ts` - Handle payment_intent.succeeded webhook
- `backend/routes/wallet.ts` - Add POST /api/wallet/purchase endpoint

**Flow:**
1. Frontend: User enters amount, loads Stripe Elements
2. Frontend: Collects card info via Stripe Elements
3. Frontend: Confirms payment with Stripe
4. Backend: Webhook receives payment_intent.succeeded
5. Backend: Credits user wallet with ITC
6. Backend: Logs transaction to itc_transactions
7. Frontend: Displays success message and updated balance

### 6. Admin Wallet Management UI

**Priority:** 🟢 MEDIUM

**Required Components:**

#### Component: `AdminWalletManager.tsx`
```typescript
// Features:
// - Search users by email/username
// - Display current wallet balance
// - Credit/debit form with reason
// - Transaction history table
// - Suspend/activate wallet button
```

**Integration:** Add to AdminDashboard.tsx as new tab

---

## Troubleshooting

### Issue 1: Transaction History Shows Empty

**Symptoms:**
- User navigates to Wallet page → "Points" or "ITC" tab
- No transactions displayed
- Arrays are empty

**Root Cause:**
Transaction records are never inserted into database

**Diagnosis:**
```sql
-- Check if transactions table has data
SELECT COUNT(*) FROM itc_transactions;
-- Result: 0

SELECT COUNT(*) FROM points_transactions;
-- Result: 0
```

**Solution:**
1. Implement transaction logging (see [Missing Features](#missing-features))
2. Modify backend endpoints to insert records
3. Test with mockup generation or points redemption
4. Verify records appear in database

### Issue 2: Balance Updates But No Audit Trail

**Symptoms:**
- User generates mockup → ITC deducted
- User redeems points → ITC increased
- But no record of transactions

**Root Cause:**
Backend updates `user_wallets` directly without creating transaction records

**Diagnosis:**
```sql
-- Check wallet balance
SELECT itc_balance FROM user_wallets WHERE user_id = 'xxx';
-- Result: 75.00 (deducted 25 for mockup)

-- Check if transaction logged
SELECT * FROM itc_transactions WHERE user_id = 'xxx';
-- Result: (empty)
```

**Solution:**
Wrap all wallet modifications with transaction logging:
```typescript
// Before
await supabase
  .from('user_wallets')
  .update({ itc_balance: newBalance })
  .eq('user_id', userId)

// After
await supabase
  .from('user_wallets')
  .update({ itc_balance: newBalance })
  .eq('user_id', userId)

await logITCTransaction(userId, 'ai_generation', -25, 'Mockup generation')
```

### Issue 3: Admin Cannot Manage Wallets

**Symptoms:**
- Admin logs in
- Can view user balances in metrics
- Cannot credit/debit individual users
- No wallet management interface

**Root Cause:**
Admin wallet management endpoints and UI not implemented

**Diagnosis:**
```bash
# Try to call admin wallet endpoint
curl -X POST https://api.imaginethisprinted.com/api/admin/wallet/credit \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"userId":"xxx","amount":100,"reason":"Test"}'

# Result: 404 Not Found (endpoint doesn't exist)
```

**Solution:**
1. Create `backend/routes/admin/wallet.ts` with CRUD endpoints
2. Add admin check middleware
3. Create `src/components/AdminWalletManager.tsx` UI
4. Add to AdminDashboard as new tab

### Issue 4: Stripe Purchase Fails

**Symptoms:**
- User clicks "Purchase ITC Tokens"
- Enters amount
- Payment fails or hangs

**Root Cause:**
Stripe Elements not properly integrated in frontend

**Diagnosis:**
Check `src/utils/stripe-itc.ts` lines 72-80:
```typescript
// Card details collection is incomplete
payment_method: {
  card: {
    // ❌ No actual card element bound here
  }
}
```

**Solution:**
1. Implement Stripe Elements in Wallet.tsx
2. Mount card element in purchase form
3. Use `stripe.confirmCardPayment()` with element
4. Handle webhook on backend to credit wallet

### Issue 5: Insufficient Balance Error Despite Having Funds

**Symptoms:**
- User has ITC balance
- Tries to generate mockup
- Gets "Insufficient balance" error

**Root Cause:**
- Type mismatch (string vs number)
- Race condition (balance not yet updated)
- Decimal precision issue

**Diagnosis:**
```sql
SELECT itc_balance, pg_typeof(itc_balance)
FROM user_wallets
WHERE user_id = 'xxx';
```

**Solution:**
Ensure proper type casting:
```typescript
const balance = Number(wallet.itc_balance)
if (balance >= MOCKUP_COST_ITC) {
  // proceed
}
```

### Issue 6: Wallet Balance Not Updating After Transaction

**Symptoms:**
- User performs action (redeem, purchase)
- Success message shown
- Balance doesn't update in UI

**Root Cause:**
Frontend not refreshing after transaction

**Diagnosis:**
Check `src/pages/Wallet.tsx` handleRedeem function (line 118):
```typescript
await loadWalletData()  // Should refresh balance
```

**Solution:**
Ensure loadWalletData() is called after every transaction

### Issue 7: RLS Policy Blocking Wallet Access

**Symptoms:**
- User cannot view own wallet
- API returns empty or 401 error

**Root Cause:**
RLS policy not matching user's auth.uid()

**Diagnosis:**
```sql
-- Check if user profile exists
SELECT id, email FROM user_profiles WHERE id = auth.uid();

-- Check wallet exists
SELECT * FROM user_wallets WHERE user_id = auth.uid();

-- Test RLS policy
SET ROLE authenticated;
SET request.jwt.claims.sub = 'user-uuid-here';
SELECT * FROM user_wallets WHERE user_id = auth.uid();
```

**Solution:**
Verify user is authenticated and profile/wallet exist

---

## Appendix A: Code References

### Frontend Files
- `src/pages/Wallet.tsx` - Main wallet UI (391 lines)
- `src/context/SupabaseAuthContext.tsx` - User + wallet state (lines 16-19, 56-60, 102-105)
- `src/utils/stripe-itc.ts` - Stripe ITC bridge (135 lines)
- `src/types/index.ts` - Type definitions (lines 95-113, 254-264)

### Backend Files
- `backend/routes/wallet.ts` - Wallet API endpoints (104 lines)
- `backend/routes/designer.ts` - Mockup generation with ITC deduction (244 lines)
- `backend/index.ts` - Main Express app (registers wallet routes line 15)
- `backend/middleware/supabaseAuth.ts` - Auth middleware

### Database Files
- `supabase/migrations/001_initial_schema.sql` - Table schemas (lines 39-85)
- `supabase/migrations/002_rls_policies.sql` - Security policies (lines 46-61)
- `supabase/migrations/003_user_triggers.sql` - Auto-create wallet trigger (lines 50-71)

---

## Appendix B: Recommended Action Plan

### Phase 1: Critical Fixes (Week 1)

**Priority:** Must have for production

1. **Implement Transaction Logging** (2 days)
   - Create `backend/utils/wallet-logger.ts`
   - Add logging to wallet.ts redeem endpoint
   - Add logging to designer.ts generate-mockup endpoint
   - Test with real transactions

2. **Fix Transaction History Display** (1 day)
   - Create GET /api/wallet/transactions/itc endpoint
   - Create GET /api/wallet/transactions/points endpoint
   - Update Wallet.tsx to fetch history
   - Display in Points/ITC tabs

3. **Add Lifetime Stats Updates** (1 day)
   - Update lifetime_itc_earned on credits
   - Update lifetime_points_earned on awards
   - Update last_itc_activity timestamp
   - Update last_points_activity timestamp

### Phase 2: Admin Features (Week 2)

**Priority:** Important for operations

1. **Admin Wallet Endpoints** (2 days)
   - Create backend/routes/admin/wallet.ts
   - Implement credit, debit, suspend, activate
   - Add admin-only middleware
   - Write API tests

2. **Admin Wallet UI** (2 days)
   - Create AdminWalletManager.tsx component
   - Add user search
   - Add credit/debit forms
   - Add transaction history view
   - Integrate with AdminDashboard

### Phase 3: Earning Mechanisms (Week 3)

**Priority:** Nice to have for growth

1. **Order Completion Rewards** (1 day)
   - Award points on order completion
   - Log transactions
   - Send notification

2. **Referral Rewards** (2 days)
   - Integrate with referral system
   - Credit referrer and referee
   - Log transactions
   - Send confirmation emails

3. **Vendor/Founder Rewards** (1 day)
   - Credit on product approval
   - Credit on sales
   - Log transactions

### Phase 4: Purchase Flow (Week 4)

**Priority:** Important for monetization

1. **Stripe Integration** (3 days)
   - Implement Stripe Elements in Wallet
   - Create payment intent endpoint
   - Handle webhook for completion
   - Credit wallet on success
   - Send confirmation email
   - Test with test cards

### Phase 5: Polish & Testing (Week 5)

**Priority:** Quality assurance

1. **Automated Tests** (2 days)
   - Unit tests for wallet functions
   - Integration tests for API endpoints
   - E2E tests for user flows

2. **Documentation** (1 day)
   - API documentation
   - Admin guide
   - User guide

3. **Performance Optimization** (1 day)
   - Index transaction tables
   - Cache balance lookups
   - Optimize queries

---

## Appendix C: Database Indexes

**Recommended Indexes for Performance:**

```sql
-- Speed up transaction history queries
CREATE INDEX idx_itc_transactions_user_created
ON itc_transactions(user_id, created_at DESC);

CREATE INDEX idx_points_transactions_user_created
ON points_transactions(user_id, created_at DESC);

-- Speed up admin queries
CREATE INDEX idx_itc_transactions_type
ON itc_transactions(type);

CREATE INDEX idx_itc_transactions_status
ON itc_transactions(status);

-- Speed up wallet lookups (already has PK on user_id)
-- No additional index needed

-- Speed up referral queries
CREATE INDEX idx_referral_transactions_referrer
ON referral_transactions(referrer_id);

CREATE INDEX idx_referral_transactions_referee
ON referral_transactions(referee_id);
```

---

## Appendix D: Monitoring Queries

**SQL Queries for System Health:**

```sql
-- Total ITC in circulation
SELECT SUM(itc_balance) as total_itc FROM user_wallets;

-- Total points in circulation
SELECT SUM(points_balance) as total_points FROM user_wallets;

-- Users with highest ITC balance
SELECT
  u.username,
  u.email,
  w.itc_balance
FROM user_wallets w
JOIN user_profiles u ON u.id = w.user_id
ORDER BY w.itc_balance DESC
LIMIT 10;

-- Transaction volume by type (last 30 days)
SELECT
  type,
  COUNT(*) as count,
  SUM(ABS(amount)) as total_amount
FROM itc_transactions
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY type
ORDER BY total_amount DESC;

-- Users with negative balances (should be none!)
SELECT
  u.username,
  w.itc_balance,
  w.points_balance
FROM user_wallets w
JOIN user_profiles u ON u.id = w.user_id
WHERE w.itc_balance < 0 OR w.points_balance < 0;

-- Wallets with suspicious activity
SELECT
  w.user_id,
  u.username,
  w.itc_balance,
  w.wallet_status,
  COUNT(t.id) as transaction_count,
  MAX(t.created_at) as last_transaction
FROM user_wallets w
JOIN user_profiles u ON u.id = w.user_id
LEFT JOIN itc_transactions t ON t.user_id = w.user_id
WHERE t.created_at >= NOW() - INTERVAL '24 hours'
GROUP BY w.user_id, u.username, w.itc_balance, w.wallet_status
HAVING COUNT(t.id) > 50  -- More than 50 transactions in 24h
ORDER BY transaction_count DESC;
```

---

## Document History

- **2025-11-10:** Initial audit and documentation
- **Status:** Complete audit, recommendations provided
- **Next Review:** After Phase 1 implementation

---

**End of Document**
