# Vercel Environment Variables Setup

## Critical Issue: "Failed to fetch" with status 0

This error indicates that the Supabase environment variables are not properly configured in Vercel production environment.

## Required Environment Variables

Add these to your Vercel project settings:

### 1. Supabase Configuration
```
VITE_SUPABASE_URL=https://czzyrmizvjqlifcivrhn.supabase.co
VITE_SUPABASE_ANON_KEY=[Copy from .env.local file - JWT token starting with eyJ...]
```

### 2. Stripe Configuration  
```
VITE_STRIPE_PUBLISHABLE_KEY=[Copy from .env.local file - publishable key starting with pk_live_]
```

### 3. Other Required Variables
```
VITE_REPLICATE_API_TOKEN=[Copy from .env.local file]
VITE_SHIPPO_API_TOKEN=[Copy from .env.local file] 
VITE_ITC_WALLET_ADDRESS=[Copy from .env.local file]
VITE_ITC_USD_RATE=0.10
SUPPORT_EMAIL=support@imaginethisprinted.com
VITE_OPENAI_API_KEY=[Copy from .env.local file]
```

**Important:** Copy the actual values from your local `.env.local` file. Do not use placeholder values.

## How to Add to Vercel:

1. Go to your Vercel dashboard
2. Select your project (imagine-this-printed)
3. Go to Settings → Environment Variables
4. Add each variable above with the exact name and value
5. Set Environment to "Production, Preview, Development"
6. Click "Save"
7. Redeploy the application

## Debugging in Production:

Once deployed, open the browser console on https://www.imaginethisprinted.com and look for:

1. **Environment Diagnostic Report** (auto-runs in production)
2. **Critical Error Alerts** if environment variables are missing
3. **Network Test Results** showing connectivity status

## Manual Debug Commands:

In browser console, run:
```javascript
checkEnvironment()  // Full diagnostic report
testConnectivity()  // Test Supabase connectivity  
```

## Expected Console Output (when working):

```
🚀 Production environment detected - running automatic diagnostic...
🔧 Supabase Configuration: {url: "https://czzyrmizvjqlifcivrhn.supabase.co", urlValid: true, hasKey: true, keyValid: true}
✅ Network test successful: {external: {...}, disable_signup: false}
✅ Supabase URL is accessible: {status: 200, ok: true}
```

## If Still Getting "Failed to fetch":

1. Verify all environment variables are set in Vercel
2. Trigger a new deployment after adding variables
3. Check browser console for specific error details
4. Ensure CORS is not blocking requests (unlikely but possible)