# Imagine This Printed - RUNBOOK

## Stabilize → Decide: Critical Setup & Go/No-Go Tests

This runbook documents the essential setup steps and tests required to verify the auth system works end-to-end.

---

## Prerequisites

- Node.js >= 18.17
- npm or yarn
- Supabase project created
- Database migrations run

---

## Environment Setup

### Frontend Environment Variables

File: `.env`

Required variables (all must start with `VITE_` prefix):

```bash
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="eyJ..."  # From Supabase dashboard
VITE_API_BASE="http://localhost:4000"  # Backend URL
VITE_SITE_URL="http://localhost:5173"
VITE_STRIPE_PUBLISHABLE_KEY="pk_test_..."
VITE_ITC_WALLET_ADDRESS="your-wallet-address"
VITE_ITC_USD_RATE="0.10"
```

### Backend Environment Variables

File: `backend/.env`

Required variables:

```bash
# Supabase
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJ..."  # Service role key (secret!)
SUPABASE_ANON_KEY="eyJ..."  # Anon key (public)
DATABASE_URL="postgresql://postgres:password@db.your-project.supabase.co:5432/postgres"

# Application
APP_ORIGIN="http://localhost:5173"
API_ORIGIN="http://localhost:4000"
FRONTEND_URL="http://localhost:5173"  # Required for OAuth callbacks
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:4000"
NODE_ENV="development"
PORT="4000"

# Authentication
JWT_SECRET="your-jwt-secret-minimum-32-characters-long"

# Stripe (optional)
STRIPE_PUBLISHABLE_KEY="pk_test_..."
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# Email (optional)
BREVO_API_KEY="your-brevo-api-key"
BREVO_SENDER_EMAIL="noreply@yourdomain.com"
BREVO_SENDER_NAME="Imagine This Printed"

# AWS S3 (optional)
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
AWS_REGION="us-east-1"
AWS_BUCKET_NAME="your-bucket"
S3_BUCKET_NAME="your-bucket"
CLOUDFRONT_URL="https://your-distribution.cloudfront.net"
```

---

## CORS Configuration

The backend reads `ALLOWED_ORIGINS` from environment variables. Ensure:

- **Local dev**: Include `http://localhost:5173` and `http://localhost:4000`
- **Production**: Include your production frontend URL (e.g., `https://imaginethisprinted.com`)

Example:
```bash
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:4000,https://imaginethisprinted.com"
```

---

## Health Check Endpoints

The backend provides health check endpoints to verify system status:

### 1. General Health

```bash
GET /api/health
```

Response:
```json
{"ok": true}
```

### 2. Auth Configuration Health

```bash
GET /api/health/auth
```

Response:
```json
{
  "ok": true,
  "supabaseUrl": "https://czzyrmizvjqlifcivrhn.supabase.co",
  "frontendUrl": "http://localhost:5173",
  "anonKeyTail": "...xyz",
  "callbackUrl": "http://localhost:5173/auth/callback"
}
```

### 3. Database Health

```bash
GET /api/health/database
```

Response:
```json
{
  "status": "connected",
  "message": "Database connected successfully (12 users)"
}
```

---

## Logging

The backend uses **pino** for structured logging.

### Development

Logs are pretty-printed with colors:

```
15:24:32 INFO: 🚀 Server running on port 4000
15:24:35 INFO: GET /api/health 200
```

### Production

Logs are JSON formatted for log aggregation:

```json
{"level":30,"time":1699000000,"msg":"Server running on port 4000"}
```

### Environment Variable

Control log level:
```bash
LOG_LEVEL="debug"  # Options: trace, debug, info, warn, error, fatal
```

---

## Running the Application

### Backend

```bash
# Navigate to backend directory
cd backend

# Install dependencies (if not done)
npm install

# Generate Prisma client
npx prisma generate

# Build TypeScript
npm run build

# Start server
npm start
```

Expected output:
```
[prestart] ✅ jose OK: 6.1.0
🚀 Server running on port 4000
📡 API available at http://localhost:4000
🏥 Health check: http://localhost:4000/api/health
```

### Frontend

```bash
# From root directory
npm install

# Start dev server
npm run dev
```

Expected output:
```
VITE v7.x.x ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

---

## Go / No-Go Tests

Run these 5 tests in order to verify the system is working:

### 1. ✅ Environment Variables Presence

**Test**: Backend logs show all environment variables on boot

**How to verify**:
```bash
cd backend
npm start
```

**Expected**: Console shows structured env log with boolean presence indicators:
```
{
  env: {
    SUPABASE_URL: 'https://...',
    SUPABASE_SERVICE_ROLE_KEY: true,
    SUPABASE_ANON_KEY: true,
    FRONTEND_URL: 'http://localhost:5173',
    DATABASE_URL: true,
    ALLOWED_ORIGINS: 'http://localhost:5173,...',
    JWT_SECRET: true
  }
}
```

**Fail criteria**: Any required var shows `false` or `undefined`

---

### 2. ✅ Health Endpoints Return 200 OK

**Test**: `/health` and `/health/auth` return successful responses

**How to verify**:
```bash
# Terminal 1: Backend running (npm start)

# Terminal 2: Run health checks
curl http://localhost:4000/api/health
curl http://localhost:4000/api/health/auth
```

**Expected**:
```json
{"ok":true}

{
  "ok":true,
  "supabaseUrl":"https://czzyrmizvjqlifcivrhn.supabase.co",
  "frontendUrl":"http://localhost:5173",
  "callbackUrl":"http://localhost:5173/auth/callback"
}
```

**Fail criteria**: Any endpoint returns error or non-200 status

---

### 3. ✅ No CORS Errors in Browser

**Test**: Frontend can make requests to backend without CORS errors

**How to verify**:
1. Start backend: `cd backend && npm start`
2. Start frontend: `npm run dev`
3. Open browser: `http://localhost:5173`
4. Open DevTools → Network tab
5. Navigate through the app
6. Check for CORS errors in console

**Expected**: No CORS-related errors in console

**Fail criteria**: See errors like:
```
Access to fetch at 'http://localhost:4000/api/...' from origin
'http://localhost:5173' has been blocked by CORS policy
```

---

### 4. ✅ Sign-In Completes → [AUTH] Shows SIGNED_IN

**Test**: User can sign in and auth state change is logged

**How to verify**:
1. Backend and frontend running
2. Open `http://localhost:5173`
3. Open DevTools → Console
4. Click "Sign In" / "Login"
5. Enter valid credentials OR click "Sign in with Google"
6. Watch console for `[AUTH]` logs

**Expected console output**:
```
[authDebug] 🔧 Attaching auth state change listener...
[AUTH] { event: 'SIGNED_IN', user: 'uuid-here', email: 'user@example.com', hasSession: true }
```

**Fail criteria**:
- No `[AUTH]` log appears
- Event shows `SIGNED_OUT` instead of `SIGNED_IN`
- Errors in console during sign-in

---

### 5. ✅ /me Endpoint Returns Current User Profile

**Test**: Protected `/me` endpoint returns user data with valid token

**How to verify**:
1. Sign in successfully (test #4)
2. Open DevTools → Application → Local Storage
3. Find Supabase session key (e.g., `sb-xxx-auth-token`)
4. Copy the `access_token` value
5. Make authenticated request:

```bash
curl -H "Authorization: Bearer <access_token>" http://localhost:4000/api/auth/me
```

**Expected**:
```json
{
  "ok": true,
  "user": {
    "sub": "uuid-here",
    "email": "user@example.com",
    "role": "authenticated"
  }
}
```

**Fail criteria**:
- Returns 401 Unauthorized
- Returns error: "Invalid token"
- No user data in response

---

## Troubleshooting

### Backend Won't Start

**Error**: `ERR_MODULE_NOT_FOUND`

**Solution**: Ensure all imports have `.js` extensions. Run:
```bash
npm run build
npm start
```

---

### Prisma Error

**Error**: `@prisma/client did not initialize yet`

**Solution**:
```bash
cd backend
npx prisma generate
npm start
```

---

### Missing Environment Variables

**Error**: Console shows `undefined` or `false` for required vars

**Solution**:
1. Check `backend/.env` exists
2. Compare with `backend/.env.example`
3. Add missing variables
4. Restart backend

---

### CORS Errors

**Error**: Browser shows CORS policy blocked request

**Solution**:
1. Check `ALLOWED_ORIGINS` in `backend/.env`
2. Ensure it includes frontend URL: `http://localhost:5173`
3. Restart backend

---

### Login Doesn't Work

**Checklist**:
1. ✅ Backend health checks pass
2. ✅ Supabase redirect URLs configured (see `diagnostics/supabase-checklist.md`)
3. ✅ Browser console shows `[AUTH]` logs
4. ✅ No errors in console
5. ✅ Supabase anon key is correct in frontend `.env`

---

## Production Deployment

### Environment Variables

Ensure these are set in your hosting platform (Railway, Vercel, etc.):

**Backend**:
- All variables from `backend/.env.example`
- `FRONTEND_URL` = your production frontend URL
- `ALLOWED_ORIGINS` = your production frontend URL
- `NODE_ENV` = `production`

**Frontend**:
- All `VITE_*` variables
- `VITE_API_BASE` = your production backend URL
- `VITE_SITE_URL` = your production frontend URL

### Supabase Redirect URLs

Add production URLs to Supabase console:
- `https://yourdomain.com/auth/callback`
- `https://yourdomain.com/auth/reset-password`

---

## Support

For issues, check:
1. `diagnostics/ROOT_CAUSE_REPORT.md` - Known issues and fixes
2. `diagnostics/supabase-checklist.md` - Supabase setup guide
3. `diagnostics/env-setup-notes.md` - Environment variable guide

---

**Last Updated**: 2025-10-20
