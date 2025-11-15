# Railway Environment Variables Checklist for AI Product Builder

## Status: Backend API is DOWN (502 error)
The backend service needs to be redeployed with all required environment variables.

---

## ✅ REQUIRED Environment Variables for Railway Backend

### 1. Core Application
```bash
NODE_ENV=production
PORT=4000
LOG_LEVEL=info
```

### 2. Frontend Configuration
```bash
FRONTEND_URL=https://imaginethisprinted.com
ALLOWED_ORIGINS=https://imaginethisprinted.com,https://www.imaginethisprinted.com
```

### 3. Supabase (Database & Auth)
```bash
SUPABASE_URL=https://czzyrmizvjqlifcivrhn.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6enlybWl6dmpxbGlmY2l2cmhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI0Mjk2MDMsImV4cCI6MjA2ODAwNTYwM30.x81uOOyApsnues3CA7QJeETIypgk0rBvC_bzxlZ_VGs
SUPABASE_SERVICE_ROLE_KEY=[GET FROM SUPABASE DASHBOARD]
DATABASE_URL=[POSTGRES CONNECTION STRING FROM SUPABASE]
JWT_SECRET=[YOUR JWT SECRET]
```

### 4. Email Service (Brevo)
```bash
BREVO_API_KEY=[YOUR BREVO API KEY]
BREVO_SENDER_EMAIL=wecare@imaginethisprinted.com
BREVO_SENDER_NAME=ImagineThisPrinted Support
```

### 5. Payment Processing (Stripe)
```bash
STRIPE_SECRET_KEY=[YOUR STRIPE SECRET KEY - starts with sk_]
STRIPE_WEBHOOK_SECRET=[YOUR STRIPE WEBHOOK SECRET - starts with whsec_]
```

### 6. AI Services - OpenAI (CRITICAL for AI Product Builder)
```bash
OPENAI_API_KEY=[YOUR OPENAI API KEY - starts with sk-]
```

### 7. AI Services - SerpAPI (Web Search for Context)
```bash
SERPAPI_API_KEY=[YOUR SERPAPI KEY]
```
**Note**: Optional but highly recommended. Used to search Google for context about products (e.g., "Arc Raiders game"). Without this, AI products will be less accurate.

### 8. AI Services - Replicate (Image Generation)
```bash
REPLICATE_API_TOKEN=[YOUR REPLICATE TOKEN - starts with r8_]
REPLICATE_API_KEY=[SAME AS REPLICATE_API_TOKEN]
REPLICATE_PRODUCT_MODEL_ID=black-forest-labs/flux-schnell
REPLICATE_TRYON_MODEL_ID=cuuupid/idm-vton
AI_WEBHOOK_SECRET=[GENERATE A RANDOM SECRET FOR WEBHOOKS]
```

### 9. Google Cloud Storage (Image Storage)
```bash
GCS_PROJECT_ID=imagine-this-printed-main
GCS_BUCKET_NAME=imagine-this-printed-media
GCS_CREDENTIALS=[BASE64 ENCODED SERVICE ACCOUNT JSON]
ASSET_BUCKET=products
```

**How to get GCS_CREDENTIALS:**
1. Go to Google Cloud Console
2. Create a service account with Storage Admin role
3. Download the JSON key file
4. Base64 encode it: `cat service-account.json | base64 -w 0`
5. Paste the result as GCS_CREDENTIALS

### 10. Storage Configuration (Alternative: Supabase Storage)
```bash
ASSET_BUCKET=products
```

---

## 📋 Current Issues

### Issue 1: Backend API Returns 502
- **Cause**: Backend service crashed or failed to start
- **Likely Reason**: Missing environment variables (especially OPENAI_API_KEY or SUPABASE_SERVICE_ROLE_KEY)
- **Fix**: Add all required env vars to Railway and redeploy

### Issue 2: "Failed to fetch" in AI Product Builder
- **Cause**: Frontend can't reach backend API
- **Current API URL**: https://api.imaginethisprinted.com
- **Expected Response**: Should return JSON from `/api/health`
- **Actual Response**: 502 Bad Gateway

---

## 🚀 Steps to Fix

### Step 1: Get Missing API Keys

You need to obtain these API keys:

1. **OpenAI API Key** (CRITICAL)
   - Go to: https://platform.openai.com/api-keys
   - Create new secret key
   - Copy the key (starts with `sk-`)

2. **SerpAPI Key** (Recommended)
   - Go to: https://serpapi.com/
   - Sign up for free account (100 searches/month free)
   - Copy API key from dashboard

3. **Replicate API Token** (For AI image generation)
   - Go to: https://replicate.com/account/api-tokens
   - Create new token
   - Copy the token (starts with `r8_`)

4. **Supabase Service Role Key**
   - Go to: https://supabase.com/dashboard/project/czzyrmizvjqlifcivrhn/settings/api
   - Copy "service_role" secret key (NOT the anon key)

5. **Google Cloud Service Account** (For image storage)
   - Go to: https://console.cloud.google.com/iam-admin/serviceaccounts
   - Create service account with "Storage Admin" role
   - Download JSON key
   - Base64 encode it

### Step 2: Add to Railway

1. Go to Railway dashboard
2. Select your backend service
3. Go to "Variables" tab
4. Add each environment variable listed above
5. Click "Deploy" to restart with new variables

### Step 3: Verify Deployment

After Railway redeploys:
```bash
# Should return JSON (not 502)
curl https://api.imaginethisprinted.com/api/health

# Should return auth config
curl https://api.imaginethisprinted.com/api/health/auth
```

---

## 🔍 Quick Debug Commands

### Check if backend is running:
```bash
curl https://api.imaginethisprinted.com/api/health
```

### Check Railway logs:
1. Go to Railway dashboard
2. Select backend service
3. Click "Deployments"
4. View latest deployment logs
5. Look for errors about missing env vars

---

## ⚡ Minimum Required to Test AI Product Builder

If you want to test ASAP, you only need:

1. ✅ SUPABASE_URL
2. ✅ SUPABASE_ANON_KEY
3. ✅ SUPABASE_SERVICE_ROLE_KEY
4. ✅ **OPENAI_API_KEY** (CRITICAL - can't work without this)
5. ✅ **REPLICATE_API_TOKEN** (For image generation)
6. ✅ FRONTEND_URL
7. ✅ ALLOWED_ORIGINS

Everything else can be added later for enhanced functionality.

---

## 📝 Environment Variable Template for Railway

Copy this and fill in the blanks, then paste into Railway:

```env
NODE_ENV=production
PORT=4000
LOG_LEVEL=info

FRONTEND_URL=https://imaginethisprinted.com
ALLOWED_ORIGINS=https://imaginethisprinted.com,https://www.imaginethisprinted.com

SUPABASE_URL=https://czzyrmizvjqlifcivrhn.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6enlybWl6dmpxbGlmY2l2cmhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI0Mjk2MDMsImV4cCI6MjA2ODAwNTYwM30.x81uOOyApsnues3CA7QJeETIypgk0rBvC_bzxlZ_VGs
SUPABASE_SERVICE_ROLE_KEY=___FILL_THIS_IN___
DATABASE_URL=___FILL_THIS_IN___
JWT_SECRET=___GENERATE_RANDOM_STRING___

BREVO_API_KEY=___OPTIONAL___
BREVO_SENDER_EMAIL=wecare@imaginethisprinted.com
BREVO_SENDER_NAME=ImagineThisPrinted Support

STRIPE_SECRET_KEY=___OPTIONAL_FOR_NOW___
STRIPE_WEBHOOK_SECRET=___OPTIONAL_FOR_NOW___

OPENAI_API_KEY=___CRITICAL_FILL_THIS_IN___
SERPAPI_API_KEY=___RECOMMENDED___

REPLICATE_API_TOKEN=___CRITICAL_FILL_THIS_IN___
REPLICATE_API_KEY=___SAME_AS_ABOVE___
REPLICATE_PRODUCT_MODEL_ID=black-forest-labs/flux-schnell
REPLICATE_TRYON_MODEL_ID=cuuupid/idm-vton
AI_WEBHOOK_SECRET=___GENERATE_RANDOM_STRING___

GCS_PROJECT_ID=imagine-this-printed-main
GCS_BUCKET_NAME=imagine-this-printed-media
GCS_CREDENTIALS=___BASE64_ENCODED_JSON___
ASSET_BUCKET=products
```

---

## ✅ Next Steps

1. Get the API keys listed above
2. Add them to Railway
3. Redeploy backend service
4. Test: `curl https://api.imaginethisprinted.com/api/health`
5. Try AI Product Builder again

The AI Product Builder workflow itself is NOT broken - it just needs the environment variables to run!
