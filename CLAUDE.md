# CLAUDE.md

## Working rules (read first)
- Read `CLAUDE_TASK.md` and `TASK_NOTES.md` first.
- Only read/edit files listed in `TASK_NOTES.md` → “File shortlist (approved scope)”.
- If another file is needed: STOP and ask for approval OR update `TASK_NOTES.md` scope first (with rationale) before proceeding.
- After each milestone, append one new bullet to `TASK_NOTES.md` → “Work log (append-only)” describing what changed and the result.

## Multi-session git discipline (locked by David 2026-07-28)
Multiple agent sessions work this repo concurrently and have wrecked each other by
sharing one checkout (branch switched underneath a live session; foreign staged
changes nearly swept into commits; a 15-commit mega-branch stranding finished work).
These rules are mandatory:

1. **The shared checkout (`D:\Projects for MetaSphere\imagine-this-printed`) stays on
   `main`. NEVER `git checkout`/`git switch` a branch in it.** Any work that needs a
   branch gets its own linked worktree:
   `git worktree add "..\itp-worktrees\<branch>" -b <branch>` — work there, and
   `git worktree remove` it after merge. (Exception in force until the
   `earth/zero-nine/itp-payments-hardening` branch merges: the shared checkout is
   currently sitting on that branch — do not "fix" it back to main mid-flight.)
2. **Commit only files YOU changed.** Run `git status` first; if the index carries
   another session's staged work (staged deletions included), commit with explicit
   paths or unstage the foreign entries — never sweep them into your commit.
3. **Branches are small and short-lived.** Merge within ~a day via the pre-merge
   gate. No mega-branches: slice big efforts into independently mergeable pieces.
   A branch that outlives a day of divergence strands everyone else's work behind it.
4. **A push to `main` IS a production deploy** (Vercel always; the backend API +
   worker via Render today, via the Fly GitHub Actions workflow
   `.github/workflows/fly-deploy.yml` once `FLY_DEPLOY_ENABLED` is on — see
   "Deployment" below). Before pushing, confirm `git branch --show-current` says the branch
   you think you're on — a session that assumes `main` while the checkout sits on a
   feature branch "pushes" nothing and thinks it shipped.

---

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ImagineThisPrinted** is a full-featured custom printing e-commerce platform built with React, TypeScript, and Supabase. The platform includes advanced features like product design tools, 3D model galleries, vendor marketplaces, CRM, admin dashboards, and AI-powered marketing tools.

## Development Commands

### Essential Commands
```bash
# Development server (port 5173)
npm run dev

# Production build
npm run build

# Lint codebase
npm run lint

# Preview production build
npm run preview

# Start production server (static)
npm start
```

### Database Verification
```bash
# Verify Supabase infrastructure
cd scripts && npm run verify
```

## Technology Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: TailwindCSS v3.4 with CSS variables for theming
- **Routing**: React Router DOM v7
- **Authentication**: Supabase Auth (PKCE flow)
- **Database**: Supabase (PostgreSQL)
- **Payments**: Stripe
- **Canvas**: Konva.js for product design editor
- **AI**: OpenAI GPT for marketing content generation
- **Deployment**: Vercel (frontend); backend API + worker on Render, moving to Fly.io (see "Deployment")

## Architecture

### Theme System

The application uses a **centralized theme system** with CSS variables and Tailwind extensions:

- **ThemeProvider** (src/components/ThemeProvider.tsx): Manages light/dark mode with localStorage persistence and system preference detection
- **CSS Variables** (src/index.css): Defines semantic color tokens (bg, card, text, primary, secondary, accent)
- **Tailwind Config** (tailwind.config.js): Extends Tailwind with theme-aware colors, custom fonts (Poppins, Orbitron), and glow effects
- **Theme Toggle** (src/components/ThemeToggle.tsx): UI component for switching themes

All components use semantic tokens that automatically swap based on the theme class (`.theme-neon-dark` or `.theme-neon-light`).

### Authentication Flow (PKCE)

The app uses **PKCE flow exclusively** to eliminate race conditions:

1. **Supabase Client** (src/lib/supabase.ts):
   - Configures PKCE with `flowType: 'pkce'`
   - Uses unified storage key: `sb-${project}-auth-token`
   - Auto-refreshes tokens

2. **Auth Context** (src/context/SupabaseAuthContext.tsx):
   - Manages user state and session
   - Maps Supabase user to app user profile from `user_profiles` table
   - Fetches wallet data from `user_wallets` table
   - Provides auth methods: signIn, signUp, signInWithGoogle, signOut, etc.

3. **Auth Callback** (src/pages/AuthCallback.tsx):
   - Handles OAuth redirects with `code` parameter
   - Exchanges code for session via `exchangeCodeForSession()`
   - Verifies localStorage persistence
   - Redirects to intended page

4. **Protected Routes** (src/components/ProtectedRoute.tsx):
   - Wraps pages requiring authentication
   - Redirects to login if not authenticated

### State Management

- **AuthContext**: Global user authentication state
- **CartContext**: Shopping cart state with localStorage persistence
- **KioskAuthContext**: Kiosk-specific authentication for vendor terminals

### Role-Based Access Control

The platform supports 7 user roles:
- **customer**: Default role, can shop and design products
- **founder**: Tracks assigned orders and earnings (35% profit share)
- **vendor**: Submits products, tracks sales, manages storefront
- **admin**: Full system administration
- **manager**: Order and cost management
- **wholesale**: Bulk ordering with tiered pricing
- **kiosk**: Terminal mode for vendor locations

Role-specific navigation and access control is implemented in:
- src/components/Navbar.tsx: Dynamic navigation based on user role
- src/components/ProtectedRoute.tsx: Route-level access control

### Database Schema

Key tables in Supabase:
- `user_profiles`: User account data with role
- `user_wallets`: Points and ITC token balances
- `products`: Product catalog
- `orders`: Order management
- `vendor_products`: Vendor submissions
- `three_d_models`: 3D model gallery
- `custom_job_requests`: Custom order workflow
- `audit_logs`: System activity tracking
- `marketing_campaigns`: AI-generated marketing content

All tables have **Row Level Security (RLS)** policies. User creation triggers auto-create profile and wallet.

### API Integration

The app has a **separate backend service** for server-side operations:

- **Frontend API client** (src/lib/api.ts): Axios-based client
- **API Base URL**: Set via `VITE_API_BASE` environment variable
- **Backend endpoints**: Email, Stripe, OpenAI, Replicate integrations

Proxy in development (vite.config.ts):
```
/api -> http://localhost:4000
```

### Utility Services

Key utility modules:
- **src/utils/email.ts**: Transactional email utility using Resend (Brevo deprecated/removed)
- **src/utils/stripe.ts**: Stripe payment processing
- **src/utils/gpt-assistant.ts**: OpenAI GPT for marketing
- **src/utils/product-recommender.ts**: AI product recommendations
- **src/utils/founder-earnings.ts**: 35% profit share calculation
- **src/utils/vendor-payouts.ts**: Stripe Connect payouts
- **src/utils/kiosk-service.ts**: Kiosk terminal functionality
- **src/utils/messaging.ts**: In-app messaging system
- **src/utils/referral-system.ts**: Referral code tracking

## Environment Variables

Required variables (see docs/ENV_VARIABLES.md for details):

### Frontend (.env.local)
```env
VITE_SUPABASE_URL=https://czzyrmizvjqlifcivrhn.supabase.co
VITE_SUPABASE_ANON_KEY=<your_anon_key>
VITE_STRIPE_PUBLISHABLE_KEY=<your_stripe_key>
VITE_API_BASE=https://api.imaginethisprinted.com
VITE_SITE_URL=https://imaginethisprinted.com
```

### Backend (Render)
```env
SUPABASE_URL=<same_as_frontend>
SUPABASE_ANON_KEY=<same_as_frontend>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
DATABASE_URL=<postgres_connection_string>
RESEND_API_KEY=<resend_api_key>
EMAIL_FROM=Imagine This Printed <wecare@imaginethisprinted.com>
STRIPE_SECRET_KEY=<stripe_secret_key>
OPENAI_API_KEY=<openai_api_key>
```

## Path Aliases

Vite is configured with path aliases (vite.config.ts):
```typescript
'@': './src'
'@lib': './src/lib'
```

Usage:
```typescript
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/SupabaseAuthContext'
```

## Page Structure

The application follows a modular page structure:

### Public Pages
- **Home** (src/pages/Home.tsx): Landing page with hero, featured products
- **ProductCatalog** (src/pages/ProductCatalog.tsx): Category-filtered product listings
- **ProductPage** (src/pages/ProductPage.tsx): Individual product details

### Protected Pages
- **ProductDesigner** (src/pages/ProductDesigner.tsx): Konva-based design tool
- **Cart** (src/pages/Cart.tsx): Shopping cart
- **Checkout** (src/pages/Checkout.tsx): Stripe checkout flow
- **Wallet** (src/pages/Wallet.tsx): Points and ITC wallet

### Role-Specific Dashboards
- **FoundersDashboard**: Order tracking, invoice generation, earnings
- **VendorDashboard**: Product submissions, sales analytics, payouts
- **AdminDashboard**: System overview, user management, approvals
- **ManagerDashboard**: Cost management, order oversight
- **CRM**: Customer contact management, custom job requests
- **MarketingTools**: AI content generation, campaign management

### Account Pages
- **UserProfile**: Public/private user profiles
- **ProfileEdit**: Edit user profile
- **CustomerMessages/VendorMessages**: In-app messaging

## Component Architecture

### Layout Components
- **Header** (src/components/Header.tsx): Glass effect header with theme-aware logo
- **Navbar** (src/components/Navbar.tsx): Role-based navigation
- **Footer** (src/components/Footer.tsx): Footer with links and social icons

### Utility Components
- **AuthModal** (src/components/AuthModal.tsx): Sign in/sign up modal
- **ThemeToggle** (src/components/ThemeToggle.tsx): Theme switcher
- **FloatingCart** (src/components/FloatingCart.tsx): Cart button with count
- **ChatBotWidget** (src/components/ChatBotWidget.tsx): AI chatbot interface
- **ErrorBoundary** (src/components/ErrorBoundary.tsx): Error handling

### Product Components
- **ProductCard** (src/components/ProductCard.tsx): Product listing card
- **ProductRecommendations** (src/components/ProductRecommendations.tsx): AI recommendations

## Supabase Configuration

### Important Dashboard Settings

1. **Authentication URL Configuration**:
   - Site URL: `https://imaginethisprinted.com`
   - Redirect URLs (must include ALL domains):
     ```
     https://imaginethisprinted.com/auth/callback
     https://imaginethisprinted.com/auth/reset-password
     http://localhost:5173/auth/callback
     http://localhost:5173/auth/reset-password
     ```

2. **Auth Flow Type**: MUST be PKCE (not implicit)

3. **Google OAuth**: Redirect URI in Google Cloud Console:
   ```
   https://czzyrmizvjqlifcivrhn.supabase.co/auth/v1/callback
   ```

### Database Triggers

User creation automatically triggers:
- Profile creation in `user_profiles`
- Wallet creation in `user_wallets`

See docs/TASK-5-TRIGGERS-SETUP.md for details.

## Common Workflows

### Adding a New Page

1. Create page component in `src/pages/YourPage.tsx`
2. Add route in `src/App.tsx`:
   ```tsx
   <Route path="/your-page" element={<YourPage />} />
   ```
3. Add navigation link in `src/components/Navbar.tsx` (if role-specific)
4. If protected, wrap in `<ProtectedRoute>`:
   ```tsx
   <Route path="/your-page" element={<ProtectedRoute><YourPage /></ProtectedRoute>} />
   ```

### Using Theme Colors

Always use semantic tokens instead of hardcoded colors:
```tsx
// Good
<div className="bg-bg text-text border-primary">

// Bad
<div className="bg-gray-900 text-white border-purple-500">
```

Available tokens: bg, card, text, muted, primary, secondary, accent

### Database Queries

Use the Supabase client from `@/lib/supabase`:
```typescript
import { supabase } from '@/lib/supabase'

// Query with RLS
const { data, error } = await supabase
  .from('products')
  .select('*')
  .eq('category', 'shirts')
```

### Authentication

Use the AuthContext:
```typescript
import { useAuth } from '@/context/SupabaseAuthContext'

function MyComponent() {
  const { user, signIn, signOut } = useAuth()

  if (!user) return <div>Not logged in</div>

  return <div>Welcome {user.username}</div>
}
```

## Deployment

### Production Deployment

The project is deployed on the following platforms:
- **Frontend**: Vite SPA built and served via **Vercel** (automatic deployments triggered by pushes to `main` branch).
- **Backend (API)**: Express.js server. Production today: **Render** web service `srv-d7jpgut7vvec739bsid0`. Target: Fly app `imagine-this-printed-api` (`backend/fly.api.toml`, bluegreen, health-gated on `/api/health`).
- **Worker**: Background processor. Production today: **Render** background worker `srv-d7jppnn7f7vs73bb4p80`. Target: Fly app `imagine-this-printed-worker` (`backend/fly.worker.toml`, rolling, no services, exactly one machine).

Both Fly apps build the same image from `backend/Dockerfile` (build context `backend/`).

### Backend CI/CD (Render -> Fly migration)

Render redeploys itself from `main` while it is production. Fly has no Git
integration, so `.github/workflows/fly-deploy.yml` replaces that trigger:

- **Trigger**: push to `main` touching `backend/**` or the workflow file, or a manual
  `workflow_dispatch` (Actions -> "Deploy to Fly" -> Run workflow). Storefront-only
  commits never rebuild the backend (same as Render's `backend` root-dir filter).
- **Switch**: repo variable `FLY_DEPLOY_ENABLED`. Anything but `true` -> the run stops at
  `deploy switch` with a notice and the deploy jobs show **skipped**. It stays off while
  Render is production, because a deploy would start a second worker against the live
  DB (the Mrs. Imagine daily scout races). Step 5 of the migration turns it on at
  cutover: `gh variable set FLY_DEPLOY_ENABLED --body true -R ItMoney22/imagine-this-printed`.
- **Tokens**: `FLY_API_TOKEN_API` / `FLY_API_TOKEN_WORKER` (per-app deploy tokens,
  preferred — the repo is public), falling back to a single `FLY_API_TOKEN`. Switch on
  + no token = the run **fails**, never a silent no-op.
- **Order + gates** (each a named check; any failure = red run, nonzero exit):
  1. `backend compiles` — `npm ci && prisma generate && npm run build` on the runner.
  2. `deploy api + worker` — `fly deploy` the API (health-gated bluegreen), then the
     worker, then curl `https://imagine-this-printed-api.fly.dev/api/health` for a 200,
     then assert **exactly one** worker machine is `started` (0 = dead queue, 2+ = racing).
- **Did my push deploy?** `gh run list -w "Deploy to Fly" -L 3` and
  `fly releases -a imagine-this-printed-api`. Once Render is gone, a push that shows no
  Fly run did NOT ship the backend.
- Full write-up: `docs/migration/render-to-fly/STEP-4-CI-DEPLOY.md`.

Health check endpoints:
```bash
# General health
curl https://api.imaginethisprinted.com/api/health

# Email service
curl https://api.imaginethisprinted.com/api/health/email

# Auth config
curl https://api.imaginethisprinted.com/api/health/auth

# Database
curl https://api.imaginethisprinted.com/api/health/database
```

## Debugging

### Auth Debugging

The app has comprehensive logging. Check browser console for:
- `[supabase]`: Supabase client initialization
- `[callback]`: OAuth callback handler
- `[AuthContext]`: Auth context and session management

Successful PKCE login flow:
```
[callback] 2️⃣ Found code in query → exchangeCodeForSession (PKCE flow)
[callback] 3️⃣ PKCE SUCCESS → session: true
[callback] 8️⃣ Navigating to: /
[AuthContext] 🔄 Auth state changed: SIGNED_IN
```

### Common Issues

1. **Session doesn't persist**: Check localStorage for `sb-czzyrmizvjqlifcivrhn.supabase.co-auth-token`
2. **OAuth redirect fails**: Verify redirect URL in Supabase dashboard
3. **User profile not loading**: Check RLS policies and profile creation trigger
4. **Theme not working**: Ensure ThemeProvider wraps app and localStorage has `itp-theme`

## Documentation

Key docs in `docs/` directory:
- **SUPABASE_SETUP_COMPLETE.md**: Database setup verification
- **ENV_VARIABLES.md**: Environment variable reference
- **AUTH_CALLBACK_FIX_GUIDE.md**: PKCE flow implementation details
- **plans/**: Implementation plans for major features

## Git Workflow

Main branch: `main`

Current feature branch: `feature/neon-2-themes`

Recent major features:
- Neon 2.0 theme system with light/dark modes
- PKCE-based authentication flow
- Kiosk mode for vendor terminals
- AI-powered marketing tools
- Wholesale portal with tiered pricing
- Social content management system

## Build Configuration

### Vite Config (vite.config.ts)

- **React plugin**: Fast refresh for development
- **Path aliases**: `@` and `@lib`
- **Dev proxy**: `/api` -> `http://localhost:4000`
- **Build optimization**: Manual chunks for vendor and UI code
- **Chunk size limit**: 1000 KB

### Tailwind Config (tailwind.config.js)

- **Custom colors**: CSS variable-based semantic tokens
- **Custom shadows**: Glow effects (glow, glowSm, glowLg)
- **Custom fonts**: Poppins (display), Orbitron (tech)
- **Custom animations**: glow-pulse

## Type Safety

All types are defined in `src/types/index.ts`:
- User, Product, Order, CartItem
- VendorProduct, ThreeDModel, CustomOrder
- WholesaleProduct, WholesaleOrder, WholesaleAccount
- Kiosk, KioskOrder, KioskSession, KioskAnalytics
- SocialPost, Message, Conversation
- And many more...

Always import types from `@/types`.
