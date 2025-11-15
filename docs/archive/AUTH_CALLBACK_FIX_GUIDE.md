# Auth Callback Fix Guide

## Problem Summary

The authentication callback was stuck on "Completing sign in..." due to a **race condition** between two competing OAuth flows:

1. **PKCE Code Flow** (recommended, modern)
2. **Implicit Token Flow** (deprecated, problematic)

### Root Cause

The previous implementation tried to handle BOTH flows simultaneously, creating race conditions:
- `exchangeCodeForSession()` for PKCE code
- `setSession()` for implicit tokens (which hangs)
- `onAuthStateChange` listener competing with both
- 3-second timeout as a band-aid

When Google OAuth returned with implicit tokens, `setSession()` would hang while the auth context's `onAuthStateChange` listener would fire `SIGNED_IN`, but the callback page remained stuck waiting for the hanging promise.

## Solution Implemented

### 1. Rewritten AuthCallback Component

**Location:** [src/pages/AuthCallback.tsx](src/pages/AuthCallback.tsx)

**Changes:**
- ✅ **PKCE-first approach**: Prioritizes `exchangeCodeForSession()` with the `code` parameter
- ✅ **No race conditions**: Removed competing listeners and timeouts
- ✅ **Clear state machine**: Shows status (parsing → exchanging → verifying → redirecting)
- ✅ **Proper error handling**: Catches and displays OAuth errors
- ✅ **Fallback for implicit flow**: Still handles implicit tokens but warns they're not recommended
- ✅ **Verification step**: Confirms session exists before redirecting
- ✅ **Clean URL handling**: Removes OAuth parameters from URL
- ✅ **Router fallback**: Uses React Router first, then `window.location` if needed

### 2. Added Auth Error Page

**Location:** [src/pages/AuthError.tsx](src/pages/AuthError.tsx)

- Displays OAuth errors with user-friendly messages
- Shows error codes for debugging
- Provides actionable troubleshooting steps
- Includes retry buttons

### 3. Removed Competing Code Paths

- Deleted the race-prone `Promise.race()` pattern
- Removed duplicate `onAuthStateChange` subscription in callback
- Eliminated arbitrary timeouts

## Configuration Requirements

### Supabase Dashboard Settings

To ensure PKCE flow is used (and avoid implicit tokens):

1. **Navigate to:** Supabase Dashboard → Authentication → URL Configuration

2. **Add these Redirect URLs:**
   ```
   http://localhost:5173/auth/callback      # Local development
   https://your-domain.com/auth/callback    # Production (replace with actual domain)
   ```

3. **Navigate to:** Authentication → Providers → Google

4. **Verify Google OAuth Settings:**
   - Enabled: ✅ Yes
   - Client ID: (from Google Cloud Console)
   - Client Secret: (from Google Cloud Console)

5. **Check Flow Settings:**
   - In Supabase, the default is **PKCE (Authorization Code Flow)**
   - If you see "Flow Type" setting, ensure it's NOT set to "Implicit"
   - Modern Supabase (v2+) uses PKCE by default

### Google Cloud Console Settings

1. **Navigate to:** Google Cloud Console → APIs & Services → Credentials

2. **OAuth 2.0 Client IDs → Your Client → Authorized redirect URIs:**
   ```
   https://[your-supabase-project].supabase.co/auth/v1/callback
   ```
   (NOT your application's callback URL - Supabase handles the redirect)

3. **Verify scopes include:**
   - `openid`
   - `email`
   - `profile`

### Environment Variables

**Frontend (.env or .env.local):**
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key
VITE_SITE_URL=http://localhost:5173  # or production URL
```

**Backend (backend/.env):**
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...your-anon-key
FRONTEND_URL=http://localhost:5173  # or production URL
```

## Testing the Fix

### Local Testing Steps

1. **Start both servers:**
   ```bash
   # Terminal 1 - Backend
   cd backend
   npm start

   # Terminal 2 - Frontend
   npm run dev
   ```

2. **Test in Incognito/Private Window:**
   - Open `http://localhost:5173` in incognito mode
   - Click "Sign In" → "Continue with Google"
   - Complete Google OAuth consent

3. **Watch Console Logs:**
   ```
   [callback] 🧭 Starting auth callback
   [callback] 🔍 Params detected: { hasCode: true, ... }
   [callback] 🔑 PKCE code found → exchangeCodeForSession
   [callback] ✅ Session established: { hasSession: true, userId: '...' }
   [callback] 🔍 Verifying session...
   [callback] ✅ Session verified: { userId: '...', email: '...' }
   [callback] 💾 localStorage check: { hasData: true, hasToken: true }
   [callback] 🧹 Cleaning URL...
   [callback] 🎯 Redirecting to: /
   [callback] 🚀 Navigating with React Router...
   ```

4. **Expected Behavior:**
   - Callback page shows: "Processing authentication..." → "Exchanging credentials..." → "Redirecting..."
   - Redirects to home page in <2 seconds
   - Navbar shows user info (profile picture, name)
   - No "Completing sign in..." hang

### Warning Signs

If you see these warnings in console, your OAuth is NOT using PKCE:
```
[callback] ⚠️ IMPLICIT TOKENS DETECTED - Your OAuth is not using PKCE flow!
[callback] ⚠️ Please update Supabase Auth settings to use PKCE (code flow)
```

**Action:** Check Supabase Dashboard → Authentication settings to ensure PKCE is enabled.

### Network Tab Verification

1. Open DevTools → Network tab
2. Filter: `supabase.co`
3. After Google redirect, you should see:
   ```
   POST https://[project].supabase.co/auth/v1/token
   Request Payload: { "auth_code": "...", "code_verifier": "..." }
   ```
   This confirms PKCE flow.

## Troubleshooting

### Issue: "No OAuth code or tokens found"

**Cause:** Redirect URL mismatch

**Fix:**
1. Check Supabase Dashboard → URL Configuration
2. Ensure callback URL exactly matches: `http://localhost:5173/auth/callback`
3. No trailing slashes, protocol must match (http vs https)

### Issue: Still seeing implicit tokens

**Cause:** Supabase Auth settings or old OAuth consent

**Fix:**
1. Revoke app permissions in Google Account: https://myaccount.google.com/permissions
2. Clear browser cache and localStorage
3. Re-verify Supabase Auth flow type setting
4. Test in fresh incognito window

### Issue: "Authentication required" from backend

**Cause:** Session not being sent with API requests

**Fix:**
1. Verify `supabase.auth.getSession()` returns a session
2. Check that API calls include: `Authorization: Bearer <token>`
3. Confirm `SUPABASE_ANON_KEY` in backend `.env` matches frontend

### Issue: CORS errors

**Cause:** Backend `FRONTEND_URL` env var mismatch

**Fix:**
1. Ensure `backend/.env` has: `FRONTEND_URL=http://localhost:5173`
2. Check backend logs for CORS allowed origins
3. Restart backend after changing `.env`

## Architecture Changes

### Before (Problematic)

```
User clicks Google Sign In
  ↓
Google redirects with: #access_token=... OR ?code=...
  ↓
AuthCallback tries to handle BOTH:
  - exchangeCodeForSession(code)
  - setSession(tokens) ← HANGS
  ↓
Promise.race([
  setSession promise (never resolves),
  onAuthStateChange (fires SIGNED_IN),
  setTimeout 3000ms
]) ← RACE CONDITION
  ↓
"setSession timeout, proceeding anyway..."
  ↓
UI stuck on "Completing sign in..."
```

### After (Fixed)

```
User clicks Google Sign In
  ↓
Google redirects with: ?code=... (PKCE)
  ↓
AuthCallback detects code parameter
  ↓
exchangeCodeForSession(fullUrl)
  ↓
Session established ✅
  ↓
Verify session exists
  ↓
Clean URL, navigate home
  ↓
User signed in, <2 seconds total
```

## Success Criteria

✅ **Clicking "Sign in with Google" signs in and navigates in <2 seconds**
✅ **No "setSession timeout" messages in console**
✅ **No duplicate auth handlers or race conditions**
✅ **Session token present in localStorage**
✅ **Protected routes load correctly**
✅ **Backend `/api/auth/me` returns user profile**

## Files Changed

| File | Change | Purpose |
|------|--------|---------|
| `src/pages/AuthCallback.tsx` | Complete rewrite | PKCE-first, no race conditions, proper state machine |
| `src/pages/AuthError.tsx` | New file | User-friendly error handling |
| `src/App.tsx` | Added route | `/auth/error` route for OAuth failures |

## Related Documentation

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [PKCE Flow Explanation](https://supabase.com/docs/guides/auth/server-side/oauth-with-pkce-flow-for-ssr)
- [ROOT_CAUSE_REPORT.md](diagnostics/ROOT_CAUSE_REPORT.md) - Previous auth system fixes

## Next Steps for Production

1. **Add production redirect URLs:**
   - Supabase Dashboard → Add production callback URL
   - Google Cloud Console → Add production authorized redirect

2. **Update environment variables:**
   - Set production `VITE_SITE_URL` and `FRONTEND_URL`
   - Ensure `VITE_SUPABASE_URL` points to production project

3. **Test on Railway/production domain:**
   - Verify callback works on actual domain
   - Check HTTPS is properly configured
   - Test with real Google OAuth consent flow

4. **Monitor logs:**
   - Watch for implicit token warnings
   - Track successful PKCE exchanges
   - Monitor redirect timing (<2s target)

---

**Last Updated:** 2025-10-31
**Status:** ✅ Fixed
**Tested:** Local development environment
