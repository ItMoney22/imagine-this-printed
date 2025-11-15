# Railway Environment Variables Checklist

## Production Deployment - Complete Environment Setup

**Last Updated:** 2025-11-08
**Status:** Production Ready

---

## Required Environment Variables

### Backend Service (Railway)

#### Core Settings
```bash
NODE_ENV=production
PORT=4000
LOG_LEVEL=info
```

#### Supabase Configuration
```bash
SUPABASE_URL=https://czzyrmizvjqlifcivrhn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
SUPABASE_ANON_KEY=<your_anon_key>
JWT_SECRET=<supabase_jwt_secret>  # From Supabase dashboard > Settings > API > JWT Secret
DATABASE_URL=<postgres_connection_string>  # Optional, only if using Prisma directly
```

#### CORS & Frontend
```bash
FRONTEND_URL=https://imaginethisprinted.com
ALLOWED_ORIGINS=https://imaginethisprinted.com,https://api.imaginethisprinted.com
```

#### Email Service (Brevo)
```bash
BREVO_API_KEY=<your_brevo_api_key>
BREVO_SENDER_EMAIL=wecare@imaginethisprinted.com
BREVO_SENDER_NAME=Imagine This Printed
```

#### Payment Processing (Stripe)
```bash
STRIPE_SECRET_KEY=<your_stripe_secret_key>
STRIPE_WEBHOOK_SECRET=<your_webhook_signing_secret>
STRIPE_PUBLISHABLE_KEY=<your_stripe_publishable_key>
```

#### AI Services (Replicate)
```bash
REPLICATE_API_TOKEN=<your_replicate_api_token>
REPLICATE_PRODUCT_MODEL_ID=recraft-ai/recraft-v3
REPLICATE_TRYON_MODEL_ID=google/nano-banana
REPLICATE_REMBG_MODEL_ID=cjwbw/rembg
```

#### Background Removal (Remove.bg)
```bash
REMOVEBG_API_KEY=<your_removebg_api_key>
```

#### OpenAI (for marketing tools)
```bash
OPENAI_API_KEY=<your_openai_api_key>
```

#### Google Cloud Storage
```bash
GOOGLE_CLOUD_PROJECT_ID=imagine-this-printed-main
GOOGLE_CLOUD_STORAGE_BUCKET=imagine-this-printed-products
# Service account JSON - paste entire JSON as single line
GOOGLE_APPLICATION_CREDENTIALS_JSON=<service_account_json>
```

---

### Frontend Service (Railway)

```bash
VITE_SUPABASE_URL=https://czzyrmizvjqlifcivrhn.supabase.co
VITE_SUPABASE_ANON_KEY=<your_anon_key>
VITE_STRIPE_PUBLISHABLE_KEY=<your_stripe_publishable_key>
VITE_API_BASE=https://api.imaginethisprinted.com
VITE_SITE_URL=https://imaginethisprinted.com
```

---

## Variables to REMOVE (Not Used)

These variables should NOT be in your Railway configuration:

```bash
# ❌ Remove these - not used in codebase
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
AWS_S3_BUCKET

# ❌ Remove if you're not using Prisma directly
PRISMA_CLI_QUERY_ENGINE_TYPE
PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK

# ❌ Remove duplicate/legacy auth variables
NEXT_PUBLIC_SUPABASE_URL  # We use VITE_, not NEXT_PUBLIC_
NEXT_PUBLIC_SUPABASE_ANON_KEY
REACT_APP_*  # We use VITE_ prefix

# ❌ Remove if not using legacy image services
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

---

## Environment Variable Verification

### Backend Health Check
```bash
curl https://api.imaginethisprinted.com/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-11-08T...",
  "services": {
    "supabase": "connected",
    "replicate": "configured",
    "brevo": "configured",
    "stripe": "configured"
  }
}
```

### Frontend Build Check
```bash
# During Railway build, verify VITE_ vars are present
echo "VITE_SUPABASE_URL: $VITE_SUPABASE_URL"
```

---

## Critical Notes

### 1. **Google Cloud Storage Authentication**

The service account JSON must be provided as a **single-line string** in Railway:

```bash
# Correct format (single line):
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"...","private_key":"..."}

# ❌ Wrong - multiline will break
GOOGLE_APPLICATION_CREDENTIALS_JSON={
  "type": "service_account",
  ...
}
```

To convert multiline JSON to single line:
```bash
cat service-account.json | jq -c
```

### 2. **Supabase JWT Secret**

Get the JWT secret from Supabase Dashboard:
1. Go to Settings > API
2. Find "JWT Secret" under "JWT Settings"
3. Copy the value to `JWT_SECRET` environment variable

### 3. **Stripe Webhook Secret**

After deploying to Railway:
1. Create webhook in Stripe Dashboard
2. Point it to: `https://api.imaginethisprinted.com/api/webhooks/stripe`
3. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`

### 4. **CORS Configuration**

Ensure `ALLOWED_ORIGINS` includes all domains that will access your API:
```bash
ALLOWED_ORIGINS=https://imaginethisprinted.com,https://api.imaginethisprinted.com
```

---

## Deployment Steps

### 1. Backend Deployment

1. **Set Environment Variables** in Railway dashboard
2. **Verify Build**:
   ```bash
   npm run build  # Should complete without errors
   ```
3. **Start Server**:
   ```bash
   npm start  # Runs: tsx --env-file=.env index.ts
   ```
4. **Test Health Endpoint**:
   ```bash
   curl https://api.imaginethisprinted.com/api/health
   ```

### 2. Worker Deployment (Same Service)

Worker runs alongside backend in same container:
```bash
npm run worker  # Runs: tsx --env-file=.env worker/index.ts
```

Alternatively, use `concurrently` to run both:
```json
{
  "scripts": {
    "start": "concurrently \"npm run dev\" \"npm run worker\""
  }
}
```

### 3. Frontend Deployment

1. **Set VITE_* Environment Variables**
2. **Build**:
   ```bash
   npm run build  # Outputs to dist/
   ```
3. **Serve**:
   ```bash
   npm start  # Runs: node server.js (Express static server)
   ```

---

## Environment Variable Security

### ✅ DO:
- Use Railway's secret management
- Rotate API keys quarterly
- Use different keys for dev/staging/production
- Audit who has access to Railway project

### ❌ DON'T:
- Commit `.env` files to git (use `.env.example` instead)
- Share production keys in Slack/Discord
- Use the same Stripe/Replicate keys across environments
- Expose `SUPABASE_SERVICE_ROLE_KEY` to frontend

---

## Testing Environment Setup

### Local Development
```bash
# Create .env.local for frontend
cp .env.local.example .env.local

# Create .env for backend
cp backend/.env.example backend/.env

# Start services
npm run dev  # Frontend on :5173
cd backend && npm run dev  # Backend on :4000
cd backend && npm run worker  # Worker process
```

### Verify Local Setup
1. Frontend: http://localhost:5173
2. Backend: http://localhost:4000/api/health
3. Worker: Check console for "Worker started"

---

## Monitoring & Logs

### Railway Logs
```bash
# View backend logs
railway logs --service backend

# View frontend logs
railway logs --service frontend
```

### Health Checks
```bash
# General health
curl https://api.imaginethisprinted.com/api/health

# Email service
curl https://api.imaginethisprinted.com/api/health/email

# Database
curl https://api.imaginethisprinted.com/api/health/database

# Auth config
curl https://api.imaginethisprinted.com/api/health/auth
```

---

## Troubleshooting

### Issue: "Failed to load wallet"
**Cause:** `JWT_SECRET` not set or incorrect
**Fix:** Copy JWT Secret from Supabase Dashboard > Settings > API

### Issue: "CORS error"
**Cause:** Frontend domain not in `ALLOWED_ORIGINS`
**Fix:** Add domain to comma-separated list

### Issue: "Images not uploading"
**Cause:** Google Cloud credentials invalid
**Fix:** Ensure `GOOGLE_APPLICATION_CREDENTIALS_JSON` is single-line JSON

### Issue: "Worker not processing jobs"
**Cause:** Worker not running or env vars missing
**Fix:** Check `REPLICATE_API_TOKEN` is set, restart worker

---

## Final Checklist Before Production

- [ ] All required environment variables set in Railway
- [ ] Unused variables removed
- [ ] Health checks passing
- [ ] Stripe webhooks configured
- [ ] CORS working from production domain
- [ ] Google Cloud Storage uploads working
- [ ] Email sending via Brevo working
- [ ] AI product generation working (Replicate + Remove.bg)
- [ ] Worker processing jobs
- [ ] Database migrations applied
- [ ] SSL certificates active
- [ ] Domain DNS configured
- [ ] Monitoring/error tracking enabled (Sentry recommended)

---

## Support & Documentation

- **Railway Docs:** https://docs.railway.app
- **Supabase Docs:** https://supabase.com/docs
- **Stripe Webhooks:** https://stripe.com/docs/webhooks
- **Replicate API:** https://replicate.com/docs
- **Remove.bg API:** https://www.remove.bg/api

---

**Last Review:** 2025-11-08
**Next Review:** Before major deployment or when adding new services
