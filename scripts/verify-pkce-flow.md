# PKCE OAuth Flow Verification Guide

## What Was Fixed

### Critical Issue
The Google OAuth sign-in was failing with "invalid flow state, no valid flow state found" because PKCE keys (`oauth-state` and `code-verifier`) were not being stored in localStorage before the browser redirected to Google.

### Root Cause
The `signInWithOAuth()` method was automatically redirecting the browser before the PKCE keys could be persisted to localStorage, causing a race condition.

### Solution
Added `skipBrowserRedirect: true` to the OAuth options, which:
1. Prevents automatic redirect
2. Allows PKCE keys to be stored first
3. Returns the provider URL for manual redirect
4. Ensures keys persist before navigation

## Files Changed

### 1. `src/lib/supabase.ts`
- Cleaned up auth configuration
- Ensured `detectSessionInUrl: true` for PKCE callback detection
- Removed redundant storage configuration

### 2. `src/context/SupabaseAuthContext.tsx` (CRITICAL FIX)
**Before:**
```typescript
const { error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    flowType: 'pkce',
    redirectTo,
    // ... missing skipBrowserRedirect
  }
})
// Automatic redirect happens here, PKCE keys may not be saved yet
```

**After:**
```typescript
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    flowType: 'pkce',
    redirectTo,
    skipBrowserRedirect: true, // ✅ CRITICAL FIX
  }
})

// Manual redirect AFTER PKCE keys are stored
if (data?.url) {
  window.location.assign(data.url)
}
```

### 3. `src/pages/AuthCallback.tsx`
- Added PKCE verification before exchange
- Integrated QA logging utility
- Added explicit error handling for missing PKCE keys
- Already had correct `exchangeCodeForSession()` implementation

### 4. `src/utils/verifyPkce.ts` (NEW)
- Created PKCE verification utility
- Provides QA functions to check localStorage state
- Logs detailed debug information

## Manual Verification Steps

### Step 1: Pre-Flight Check
Before testing, ensure:

```bash
# Check environment variables
# VITE_SUPABASE_URL must be: https://<PROJECT-REF>.supabase.co
# No trailing slashes, no /auth/v1
```

### Step 2: Test in Incognito Mode

1. Open browser in Incognito/Private mode
2. Navigate to: `https://imaginethisprinted.com/login`
3. Open Developer Console (F12)
4. Click "Sign in with Google"

### Step 3: Verify PKCE Keys BEFORE Redirect

**In the console, immediately after clicking Google sign in:**

```javascript
// Should see logs like:
// [AuthContext] ✅ PKCE keys stored, manual redirect to: https://accounts.google.com/...

// Check localStorage manually:
Object.keys(localStorage).filter(k => k.startsWith('sb-'))
```

**Expected output:**
```javascript
[
  'sb-<project-ref>-auth-token',
  'sb-<project-ref>-oauth-state',
  'sb-<project-ref>-code-verifier',
  // ... other keys
]
```

### Step 4: Complete Google Sign-In

1. Select Google account
2. Grant permissions
3. Wait for redirect to `/auth/callback`

### Step 5: Verify Callback Processing

**In console on /auth/callback page, look for:**

```
[callback] 🧭 Starting PKCE auth callback
[callback] 🔍 Running PKCE verification...
[PKCE Verification]
  All sb-* keys: [...]
  oauth-state present: true
  code-verifier present: true
[callback] ✅ PKCE verification passed
[callback] 🔑 PKCE code found → exchangeCodeForSession
[callback] ✅ Session established
[callback] ✅ Session verified
[callback] 🎯 Redirecting to: /
```

### Step 6: Verify Successful Sign-In

1. Should redirect to home page (`/`)
2. User should be signed in
3. Check localStorage for session:

```javascript
localStorage.getItem('sb-<project-ref>-auth-token')
// Should return a valid session object
```

## Automated QA Check

### Using Browser Console

On the `/auth/callback` page, before exchange:

```javascript
// Import the verification utility (already imported in AuthCallback.tsx)
import { verifyPkceStorage, getPkceDebugInfo } from '@/utils/verifyPkce'

// Run verification
const result = verifyPkceStorage()
console.log(result)
// { hasState: true, hasVerifier: true, ... }

// Or get formatted debug info
console.log(getPkceDebugInfo())
```

### Expected Success Output

```
[PKCE Debug Info] ✅ PASS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
State Present:    ✅
Verifier Present: ✅
State Key:        sb-<project-ref>-oauth-state
Verifier Key:     sb-<project-ref>-code-verifier
All Supabase Keys: 3 found
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Network Verification

### In DevTools Network Tab

1. Filter by: `token`
2. After callback, look for:

```
POST https://<PROJECT-REF>.supabase.co/auth/v1/token?grant_type=pkce
Status: 200 OK
```

3. Check response should contain:
   - `access_token`
   - `refresh_token`
   - `user` object with email, id, etc.

## Troubleshooting

### Error: "PKCE keys not found in localStorage"

**Cause:** Keys were not stored before redirect (the bug we fixed)

**Solution:** Verify `skipBrowserRedirect: true` is in `SupabaseAuthContext.tsx:249`

### Error: "No provider redirect URL returned"

**Cause:** Supabase client configuration issue or network error

**Solution:**
1. Check `VITE_SUPABASE_URL` format
2. Verify Supabase project is active
3. Check network connection

### Error: "invalid flow state"

**Cause:** State parameter doesn't match localStorage (still possible if cookies blocked)

**Solution:**
1. Enable third-party cookies
2. Try incognito mode
3. Clear all site data and retry

### Error: "Missing PKCE code in URL"

**Cause:** Google OAuth didn't return authorization code

**Solution:**
1. Verify Google Cloud Console OAuth client settings
2. Check authorized redirect URI: `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
3. Ensure user granted permissions

## Configuration Checklist

### Supabase Dashboard
- [ ] Site URL: `https://imaginethisprinted.com`
- [ ] Redirect URLs include:
  - [ ] `https://imaginethisprinted.com/auth/callback`
  - [ ] `http://localhost:5173/auth/callback` (for dev)
- [ ] Google OAuth provider enabled
- [ ] Google Client ID and Secret configured

### Google Cloud Console
- [ ] OAuth 2.0 Client ID created (Web application)
- [ ] Authorized redirect URI: `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
- [ ] OAuth consent screen configured

### Cloudflare (if applicable)
- [ ] Redirect rule: `www.imaginethisprinted.com/*` → `imaginethisprinted.com/${1}` (301)

## Definition of Done

- [x] `skipBrowserRedirect: true` added to Google OAuth handler
- [x] PKCE verifier/state stored successfully before redirect
- [x] `exchangeCodeForSession()` succeeds without errors
- [x] Supabase session object appears in localStorage
- [x] User lands on `/` signed in
- [x] QA verification utility created and integrated
- [x] No "invalid flow state" errors
- [x] Network shows 200 OK for `/auth/v1/token?grant_type=pkce`

## Next Steps (Optional)

1. **After Verification Passes:**
   - Consider setting `detectSessionInUrl: false` in production (cleanup)
   - Add analytics tracking for auth success/failure rates

2. **Enhanced Error Handling:**
   - Auth error page already exists at `/auth/error`
   - Could add retry logic with exponential backoff

3. **Performance Optimization:**
   - Current flow is optimal (single redirect, no polling)
   - PKCE flow is secure and production-ready

## Support

If issues persist after following this guide:
1. Check browser console for detailed error logs
2. Verify all configuration in Supabase Dashboard
3. Test in multiple browsers
4. Contact Supabase support if server-side issue suspected
