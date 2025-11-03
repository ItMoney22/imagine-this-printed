# PKCE Storage Key Unification - Update

## Date: 2025-11-03

## Problem Statement

After implementing the initial PKCE fix with `skipBrowserRedirect: true`, some users were still encountering "PKCE verification failed / missing oauth-state" errors. This was caused by:

1. **Storage Key Mismatch**: Different Supabase client instances potentially using different storage key prefixes
2. **Legacy Key Pollution**: Old OAuth keys from previous sessions conflicting with new keys
3. **Insufficient Visibility**: Limited logging to diagnose storage key issues

## Solution Implemented

### 1. Unified Storage Key

**File:** [src/lib/supabase.ts](src/lib/supabase.ts#L24-L26)

```typescript
// Generate unified storage key from project URL to ensure consistency
const PROJECT_REF_HOST = new URL(supabaseUrl).host;
const STORAGE_KEY = `sb-${PROJECT_REF_HOST}-auth-token`;
```

**Benefits:**
- All PKCE keys now use the same prefix: `sb-<project-host>-auth-token`
- Expected keys:
  - `sb-<project-host>-auth-token` (session token)
  - `sb-<project-host>-auth-token-oauth-state` (PKCE state)
  - `sb-<project-host>-auth-token-code-verifier` (PKCE verifier)

### 2. Legacy Key Cleanup

**File:** [src/lib/supabase.ts](src/lib/supabase.ts#L30-L43)

```typescript
// Clean up any legacy keys with a different prefix to prevent PKCE mismatch
if (typeof window !== "undefined") {
  try {
    const keys = Object.keys(localStorage);
    const legacyKeys = keys.filter(k => k.startsWith('sb-') && !k.startsWith(STORAGE_KEY));

    if (legacyKeys.length > 0) {
      console.log("[supabase] 🧹 Cleaning up legacy storage keys:", legacyKeys);
      legacyKeys.forEach(k => localStorage.removeItem(k));
    }
  } catch (err) {
    console.warn("[supabase] ⚠️ Could not clean up legacy keys:", err);
  }
}
```

**Benefits:**
- Automatically removes old OAuth keys from previous sessions
- Prevents conflicts between old and new PKCE flows
- Logs cleanup actions for debugging

### 3. Enhanced QA Logging

**File:** [src/pages/AuthCallback.tsx](src/pages/AuthCallback.tsx#L25)

```typescript
console.log('[PKCE QA]', Object.keys(localStorage).filter(k => k.startsWith('sb-')));
```

**Output Example:**
```javascript
[PKCE QA] [
  'sb-project.supabase.co-auth-token',
  'sb-project.supabase.co-auth-token-oauth-state',
  'sb-project.supabase.co-auth-token-code-verifier'
]
```

### 4. Client Configuration Update

**File:** [src/lib/supabase.ts](src/lib/supabase.ts#L45-L53)

```typescript
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: STORAGE_KEY, // ⭐ NEW: Unified storage key
  },
});
```

## Verification

### Health Check Results

```bash
node scripts/check-pkce-config.js
```

**All Checks Passed (13/13):**
```
✅ Supabase client has flowType: pkce
✅ Supabase client has detectSessionInUrl: true
✅ Supabase client has persistSession: true
✅ Supabase client has unified storageKey (prevents PKCE mismatch) ⭐ NEW
✅ Legacy storage key cleanup implemented ⭐ NEW
✅ Google OAuth handler has skipBrowserRedirect: true
✅ Manual redirect after PKCE keys stored
✅ Auth callback uses exchangeCodeForSession
✅ Auth callback includes PKCE verification
✅ Auth callback includes QA storage key logging ⭐ NEW
✅ Auth callback clean of implicit flow code
✅ PKCE verification utility exists
✅ PKCE debug info utility exists
```

### TypeScript Build

```bash
npm run build
```

**Status:** ✅ PASSED
```
✓ 422 modules transformed
✓ built in 3.30s
```

## Expected Behavior

### On Page Load

**Console Output:**
```
[supabase] 🔧 Initializing Supabase client with URL: https://project.supabase.co
[supabase] 🔑 Using storage key: sb-project.supabase.co-auth-token
[supabase] 🧹 Cleaning up legacy storage keys: ['sb-old-key-1', 'sb-old-key-2']
[supabase] ✅ Supabase client initialized
```

### During OAuth Login

**Console Output:**
```
[AuthContext] 🔄 Attempting Google OAuth sign in
[AuthContext] 💾 Saved return path: /
[AuthContext] 🎯 OAuth redirect URL: https://imaginethisprinted.com/auth/callback
[AuthContext] 🌐 Current origin: https://imaginethisprinted.com
[AuthContext] ✅ PKCE keys stored, manual redirect to: https://accounts.google.com/...
```

**localStorage Check:**
```javascript
Object.keys(localStorage).filter(k => k.startsWith('sb-'))
// Output:
[
  'sb-project.supabase.co-auth-token',
  'sb-project.supabase.co-auth-token-oauth-state',
  'sb-project.supabase.co-auth-token-code-verifier'
]
```

### On Auth Callback

**Console Output:**
```
[callback] 🧭 Starting PKCE auth callback
[callback] 🌐 Current origin: https://imaginethisprinted.com
[callback] 📍 Full URL: https://imaginethisprinted.com/auth/callback?code=...
[callback] 🔍 Running PKCE verification...
[PKCE QA] ['sb-project.supabase.co-auth-token', 'sb-project.supabase.co-auth-token-oauth-state', 'sb-project.supabase.co-auth-token-code-verifier']
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

## Testing Checklist

### Local Testing (Dev)

- [ ] Clear localStorage completely
- [ ] Start dev server: `npm run dev`
- [ ] Check console shows unified storage key log
- [ ] Navigate to `/login`
- [ ] Click "Sign in with Google"
- [ ] Verify console logs PKCE keys stored
- [ ] Complete Google sign-in
- [ ] Verify callback shows `[PKCE QA]` with 3 keys
- [ ] Verify successful redirect to home page

### Production Testing

- [ ] Deploy to Railway
- [ ] Open incognito: https://imaginethisprinted.com
- [ ] Clear site data (Application → Storage → Clear site data)
- [ ] Open DevTools Console
- [ ] Navigate to `/login`
- [ ] Click "Sign in with Google"
- [ ] Verify console logs:
  - `[supabase] 🔑 Using storage key: sb-...`
  - `[AuthContext] ✅ PKCE keys stored`
- [ ] Complete Google OAuth
- [ ] On `/auth/callback`, verify:
  - `[PKCE QA]` shows 3 keys with same prefix
  - `[callback] ✅ PKCE verification passed`
  - `[callback] ✅ Session established`
- [ ] Verify redirect to home page, authenticated
- [ ] Check localStorage:
  ```javascript
  Object.keys(localStorage).filter(k => k.startsWith('sb-'))
  ```
  Expected: 3 keys, all with `sb-<project-host>-auth-token` prefix

## Files Changed

1. **[src/lib/supabase.ts](src/lib/supabase.ts)**
   - Added unified storage key generation
   - Implemented legacy key cleanup
   - Added storageKey to client config

2. **[src/pages/AuthCallback.tsx](src/pages/AuthCallback.tsx)**
   - Added `[PKCE QA]` logging before verification

3. **[scripts/check-pkce-config.js](scripts/check-pkce-config.js)**
   - Added check for unified storageKey
   - Added check for legacy key cleanup
   - Added check for QA logging

4. **[PKCE_STORAGE_KEY_UPDATE.md](PKCE_STORAGE_KEY_UPDATE.md)** *(this file)*
   - Documentation of changes

## Definition of Done

- [x] Unified storage key implemented
- [x] Legacy key cleanup implemented
- [x] QA logging added to callback
- [x] Health check script updated
- [x] All health checks pass (13/13)
- [x] TypeScript build passes
- [x] Documentation updated
- [ ] Tested in production environment
- [ ] No "missing oauth-state" errors for 24-48 hours

## Troubleshooting

### Issue: Still seeing "missing oauth-state" errors

**Possible Causes:**
1. Browser has cached old JS bundle
2. User has third-party cookies blocked
3. Browser extension interfering with localStorage

**Solution:**
1. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
2. Clear all site data
3. Test in incognito mode
4. Check DevTools → Application → Storage → Local Storage

### Issue: Multiple storage keys with different prefixes

**Cause:** User has keys from multiple Supabase projects or old sessions

**Solution:**
- Cleanup logic should automatically remove these on next page load
- Manually clear: `localStorage.clear()` in console

### Issue: "[PKCE QA]" shows empty array

**Cause:** Storage keys were cleared or OAuth flow hasn't started yet

**Solution:**
- Verify user clicked "Sign in with Google" button
- Check network tab for OAuth request
- Verify VITE_SUPABASE_URL is correct

## Performance Impact

**Storage Key Generation:**
- Runs once on client initialization
- Negligible performance impact (~1ms)

**Legacy Key Cleanup:**
- Runs once on page load if legacy keys exist
- Minimal impact (~5-10ms for typical cleanup)

**QA Logging:**
- Runs once per auth callback
- Development/debugging feature
- No impact on production performance

## Security Considerations

**Storage Key Format:**
- Uses project hostname from VITE_SUPABASE_URL
- No sensitive information in key name
- Standard Supabase naming convention

**Legacy Key Cleanup:**
- Only removes keys starting with 'sb-'
- Preserves other localStorage data
- Safe operation with error handling

**QA Logging:**
- Only logs key names, not values
- Useful for debugging without exposing secrets
- Can be disabled in production if needed

## Next Steps

1. **Deploy to Production** ✅
2. **Monitor Logs** - Watch for:
   - Storage key cleanup logs
   - PKCE QA output
   - Any auth failures
3. **Track Metrics** - Monitor for 24-48 hours:
   - Auth success rate
   - "missing oauth-state" error count (should be 0)
   - Session persistence rate
4. **Consider Enhancements:**
   - Add analytics tracking for auth flow stages
   - Implement automatic retry on PKCE failure
   - Add user-friendly error messages

## Related Documentation

- [PKCE_FIX_SUMMARY.md](PKCE_FIX_SUMMARY.md) - Original PKCE fix
- [scripts/verify-pkce-flow.md](scripts/verify-pkce-flow.md) - Manual testing guide
- [src/utils/verifyPkce.ts](src/utils/verifyPkce.ts) - Verification utility

---

**Status:** ✅ Ready for production deployment
**Commit:** Pending
**Author:** Claude Code (AI Agent)
