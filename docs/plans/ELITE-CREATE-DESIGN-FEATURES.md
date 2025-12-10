# Elite /create-design Features Implementation Plan

**Created:** 2025-12-10
**Status:** Planning Phase
**Target:** Make /create-design the best product creator experience

## Overview

Transform the /create-design flow into an elite experience with Mr. Imagine. All features enhance the conversational design flow while keeping Mr. Imagine as the real mascot (not AI).

---

## Feature Priority & Assignment

### 🔴 HIGH PRIORITY - Claude (Complex/Backend-Heavy)

#### 1. Design Variations
**Description:** After first design generates, offer variations with prompt tweaks
**Complexity:** Medium
**ITC Cost:** 25 ITC per variation (discounted from 50)

**Implementation:**
- Add "Make Variations" button after image selection
- Backend: New endpoint `/api/user-products/:id/variations`
- Generate 3 variations with modified prompts:
  - Variation A: Bolder colors
  - Variation B: Different composition
  - Variation C: More stylized
- Use same base prompt with style modifiers
- Mr. Imagine: "Love it but want options? Let me cook up a few more!"

**Files to modify:**
- `src/pages/UserProductCreator.tsx` - Add variations step/UI
- `backend/routes/user-products.ts` - Add variations endpoint
- `backend/services/designAssistant.ts` - Add variation prompt logic

---

#### 2. Voice Input for Prompts
**Description:** Speak your design idea instead of typing
**Complexity:** Medium (infrastructure exists)

**Implementation:**
- Reuse existing Minimax voice transcription
- Add microphone button next to text input
- Real-time transcription display
- Mr. Imagine responds to voice naturally
- Mobile-first experience

**Files to modify:**
- `src/pages/UserProductCreator.tsx` - Add voice recording UI
- Reuse `backend/routes/ai/voice-chat.ts` transcription logic

---

#### 3. ITC Cashout System
**Description:** Let creators redeem ITC for value
**Complexity:** Medium

**Implementation - Hybrid Approach:**
```
ITC Redemption Options:
├── Store Credit (instant)
│   └── Convert ITC to store credit 1:1
│   └── Use credit at checkout
│
├── Product Discount (instant)
│   └── Apply ITC as discount on any purchase
│   └── Max 50% of order total
│
└── Cash Payout (manual, $50 minimum)
    └── Request payout in Wallet page
    └── Admin reviews and processes via PayPal/Venmo
    └── 5% processing fee
```

**Database Changes:**
```sql
-- Payout requests table
CREATE TABLE payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id),
  amount_itc INTEGER NOT NULL,
  amount_usd NUMERIC(10,2) NOT NULL,
  payout_method TEXT NOT NULL, -- 'paypal', 'venmo', 'bank'
  payout_details JSONB, -- email, account info
  status TEXT DEFAULT 'pending', -- pending, approved, paid, rejected
  processed_at TIMESTAMPTZ,
  processed_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Files to modify:**
- `src/pages/Wallet.tsx` - Add cashout UI
- `backend/routes/wallet.ts` - Add cashout endpoints
- `src/pages/AdminDashboard.tsx` - Add payout approval tab

---

#### 4. Design History & Drafts
**Description:** Save progress, view past generations
**Complexity:** Medium

**Implementation:**
```sql
-- User design sessions table
CREATE TABLE user_design_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id),
  status TEXT DEFAULT 'draft', -- draft, generating, completed, submitted
  prompt TEXT,
  style TEXT,
  color TEXT,
  product_type TEXT,
  conversation_history JSONB,
  generated_images JSONB,
  selected_image_id TEXT,
  product_id UUID REFERENCES products(id), -- if completed
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Features:**
- Auto-save drafts every 30 seconds
- "Continue where you left off" on page load
- View all past generations in sidebar
- "Remix" button to start new design from old prompt

**Files to modify:**
- `src/pages/UserProductCreator.tsx` - Add draft management
- `backend/routes/user-products.ts` - Add draft endpoints

---

### 🟡 MEDIUM PRIORITY - Gemini Can Help

#### 5. Preview on Multiple Products (GEMINI TASK)
**Description:** Show design mockups on different product types
**Complexity:** Low-Medium (mostly frontend)

**Task for Gemini:**
```
Create a "Preview on Other Products" component for UserProductCreator.

Requirements:
1. After design is generated, show a grid of product thumbnails
2. Products to show: T-shirt, Hoodie, Mug, Phone Case, Tote Bag
3. Use placeholder mockup templates (we have /mockups/ folder)
4. When user clicks a product, show larger preview
5. "Add to my designs" button to save for later
6. Style: Match existing card/button styles in the codebase

Files to reference:
- src/pages/UserProductCreator.tsx (current flow)
- src/components/*.tsx (for styling patterns)
- src/types/index.ts (for type definitions)

Note everything you change so Claude can review and integrate.
```

---

#### 6. Social Share Integration (GEMINI TASK)
**Description:** One-click share to social media
**Complexity:** Low

**Task for Gemini:**
```
Add social sharing buttons to the success screen in UserProductCreator.

Requirements:
1. Add share buttons for: Instagram, Twitter/X, Facebook, Copy Link
2. Generate a shareable preview URL: /preview/[product-slug]
3. Include Open Graph meta tags for rich previews
4. Mr. Imagine message: "Share your creation with the world!"
5. Track shares in metadata for analytics

Files to modify:
- src/pages/UserProductCreator.tsx (add to success screen)
- Create src/pages/ProductPreview.tsx (public preview page)
- Add route in App.tsx

Note everything you change so Claude can review and integrate.
```

---

#### 7. Trending Prompts / Inspiration Gallery (GEMINI TASK)
**Description:** Show popular design ideas
**Complexity:** Low

**Task for Gemini:**
```
Create an Inspiration Gallery section for the /create-design intro screen.

Requirements:
1. Show 6-8 trending design prompts as clickable cards
2. Each card has: thumbnail image, short prompt, category tag
3. Clicking a card pre-fills the prompt input
4. "Hot This Week" and "Staff Picks" tabs
5. Mr. Imagine intro: "Need inspiration? Check out what's trending!"

For now, hardcode 10-15 example prompts. We'll make this dynamic later.

Example prompts:
- "A fierce lion made of flames, digital art style"
- "Vintage 90s aesthetic sunset with palm trees"
- "Cute kawaii cat astronaut floating in space"
- etc.

Files to modify:
- src/pages/UserProductCreator.tsx (add to intro screen)
- Create new component: src/components/InspirationGallery.tsx

Note everything you change so Claude can review and integrate.
```

---

#### 8. Creator Analytics Dashboard (GEMINI TASK)
**Description:** Track design performance
**Complexity:** Medium

**Task for Gemini:**
```
Create a Creator Analytics page for vendors to track their designs.

Requirements:
1. New page: /creator/analytics
2. Show: Total designs, Total sales, Total ITC earned
3. Design performance table: Name, Views, Sales, Revenue, ITC Earned
4. Simple chart showing earnings over time (use recharts library)
5. "Top Performing Designs" section

For now, mock the data - we'll connect to real data later.

Files to create:
- src/pages/CreatorAnalytics.tsx
- Add route in App.tsx (protected for vendor role)
- Add link in Navbar for vendors

Note everything you change so Claude can review and integrate.
```

---

### 🟢 LOWER PRIORITY - Future Phase

#### 9. Style Transfer / Reference Images
**Description:** Upload reference images for style matching
**Complexity:** High (requires img2img integration)
**Defer:** Phase 2

#### 10. AI Enhancement Tools
**Description:** Upscale, background removal, color adjustment
**Complexity:** Medium
**Defer:** Phase 2 (some already exist in ProductDesigner)

#### 11. Batch Generation
**Description:** Generate multiple designs at once
**Complexity:** Medium
**Defer:** Phase 2

---

## Implementation Order

### Phase 1 - Core Enhancements (Claude)
1. ✅ Vendor gate + ITC credits (DONE)
2. Design History & Drafts (save/resume sessions)
3. ITC Cashout System (store credit + manual payouts)
4. Design Variations

### Phase 2 - UX Enhancements (Parallel with Gemini)
5. Voice Input for Prompts (Claude)
6. Preview on Multiple Products (Gemini)
7. Social Share Integration (Gemini)
8. Trending Prompts Gallery (Gemini)
9. Creator Analytics Dashboard (Gemini)

### Phase 3 - Advanced Features
10. Style Transfer
11. AI Enhancement Tools
12. Batch Generation

---

## Gemini Handoff Template

When assigning tasks to Gemini, use this format:

```
TASK: [Feature Name]
CODEBASE: ImagineThisPrinted - React/TypeScript/Supabase
CONTEXT: This is part of the /create-design page where users create custom products with Mr. Imagine.

REQUIREMENTS:
[Copy from above]

FILES TO REFERENCE:
- src/pages/UserProductCreator.tsx
- src/lib/api.ts (for API calls)
- src/types/index.ts (for types)
- tailwind.config.js (for styling)

IMPORTANT:
1. Document ALL changes you make
2. Follow existing code patterns
3. Use existing UI components where possible
4. Don't modify backend - frontend only for this task
5. Claude will review and integrate your work

OUTPUT:
- List all files created/modified
- Summary of changes
- Any questions or blockers
```

---

## Database Migrations Needed

```sql
-- 1. Payout requests
CREATE TABLE payout_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id),
  amount_itc INTEGER NOT NULL,
  amount_usd NUMERIC(10,2) NOT NULL,
  payout_method TEXT NOT NULL,
  payout_details JSONB,
  status TEXT DEFAULT 'pending',
  processed_at TIMESTAMPTZ,
  processed_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Design sessions (drafts)
CREATE TABLE user_design_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id),
  status TEXT DEFAULT 'draft',
  prompt TEXT,
  style TEXT,
  color TEXT,
  product_type TEXT,
  conversation_history JSONB,
  generated_images JSONB,
  selected_image_id TEXT,
  product_id UUID REFERENCES products(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Design views tracking
ALTER TABLE products ADD COLUMN view_count INTEGER DEFAULT 0;
```

---

## Success Metrics

- **Engagement:** Time spent in /create-design
- **Conversion:** % of sessions that result in submitted designs
- **Retention:** Users returning to create more designs
- **Revenue:** ITC spent on generations, products sold
- **Virality:** Social shares per design

