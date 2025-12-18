# Coupon Codes & Gift Cards Implementation Plan

## Overview
Implement two admin-managed features:
1. **Coupon Codes** - Discount codes for customers (percentage off, fixed amount, or free shipping)
2. **Gift Cards** - Redeemable codes that add ITC to user wallets

## Database Schema

### 1. Coupons Table
```sql
CREATE TABLE coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  discount_type VARCHAR(20) NOT NULL, -- 'percentage', 'fixed_amount', 'free_shipping'
  discount_value DECIMAL(10,2) NOT NULL, -- percentage (0-100) or fixed amount in cents
  min_order_amount DECIMAL(10,2) DEFAULT 0, -- minimum order to apply
  max_discount_amount DECIMAL(10,2), -- cap for percentage discounts
  usage_limit INTEGER, -- null = unlimited
  used_count INTEGER DEFAULT 0,
  per_user_limit INTEGER DEFAULT 1, -- how many times each user can use
  valid_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  valid_until TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  applies_to VARCHAR(20) DEFAULT 'usd', -- 'usd', 'itc', 'both'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES user_profiles(id)
);

CREATE TABLE coupon_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID REFERENCES coupons(id),
  user_id UUID REFERENCES user_profiles(id),
  order_id UUID REFERENCES orders(id),
  discount_applied DECIMAL(10,2),
  used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 2. Gift Cards Table
```sql
CREATE TABLE gift_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  itc_amount INTEGER NOT NULL, -- ITC to credit (1 ITC = $0.10)
  is_redeemed BOOLEAN DEFAULT false,
  redeemed_by UUID REFERENCES user_profiles(id),
  redeemed_at TIMESTAMP WITH TIME ZONE,
  valid_until TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES user_profiles(id),
  notes TEXT -- admin notes
);
```

## Backend API Routes

### Coupon Routes (`backend/routes/admin/coupons.ts`)
- `GET /api/admin/coupons` - List all coupons
- `POST /api/admin/coupons` - Create new coupon
- `PUT /api/admin/coupons/:id` - Update coupon
- `DELETE /api/admin/coupons/:id` - Delete/deactivate coupon
- `GET /api/coupons/validate` - Validate coupon code (public)
- `POST /api/coupons/apply` - Apply coupon to order

### Gift Card Routes (`backend/routes/admin/gift-cards.ts`)
- `GET /api/admin/gift-cards` - List all gift cards
- `POST /api/admin/gift-cards` - Create new gift card(s)
- `POST /api/admin/gift-cards/bulk` - Bulk generate gift cards
- `DELETE /api/admin/gift-cards/:id` - Delete unredeemed gift card
- `POST /api/gift-cards/redeem` - Redeem gift card (adds ITC to wallet)

## Frontend Components

### 1. Admin Components
- `src/components/AdminCouponManagement.tsx` - Coupon CRUD interface
- `src/components/AdminGiftCardManagement.tsx` - Gift card management interface

### 2. Customer-Facing Components
- Update `src/pages/Checkout.tsx` - Add coupon code input field
- Update `src/context/CartContext.tsx` - Add discount state
- `src/components/GiftCardRedeem.tsx` - Gift card redemption UI (in Wallet page)

## Implementation Tasks

### Phase 1: Database & Backend (Coupons)
1. Create migration for `coupons` and `coupon_usage` tables
2. Create `backend/routes/admin/coupons.ts` with CRUD endpoints
3. Add coupon validation logic
4. Add RLS policies for tables

### Phase 2: Database & Backend (Gift Cards)
1. Create migration for `gift_cards` table
2. Create `backend/routes/admin/gift-cards.ts` with CRUD endpoints
3. Add redemption logic that credits ITC to wallet
4. Add RLS policies

### Phase 3: Admin UI
1. Create `AdminCouponManagement.tsx` component
2. Create `AdminGiftCardManagement.tsx` component
3. Add new tabs to AdminDashboard

### Phase 4: Checkout Integration
1. Add coupon input field to Checkout page
2. Update CartContext to handle discounts
3. Update order creation to record discount info

### Phase 5: Gift Card Redemption
1. Add gift card redemption section to Wallet page
2. Create redemption flow with ITC credit

## File Changes Required

### New Files
- `backend/routes/admin/coupons.ts`
- `backend/routes/admin/gift-cards.ts`
- `src/components/AdminCouponManagement.tsx`
- `src/components/AdminGiftCardManagement.tsx`

### Modified Files
- `backend/index.ts` - Register new routes
- `src/pages/AdminDashboard.tsx` - Add coupon/gift card tabs
- `src/pages/Checkout.tsx` - Add coupon input
- `src/context/CartContext.tsx` - Add discount state
- `src/pages/Wallet.tsx` - Add gift card redemption
- `src/types/index.ts` - Add Coupon and GiftCard types

## Estimated Complexity
- Database migrations: Low
- Backend routes: Medium
- Admin UI: Medium
- Checkout integration: Medium
- Gift card redemption: Low

Total: ~4-6 hours of implementation work
