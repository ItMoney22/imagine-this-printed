# PKCE OAuth Flow Configuration

This document outlines the required configuration for PKCE (Proof Key for Code Exchange) OAuth flow with Supabase and Google.

## What Changed

The application now uses PKCE flow exclusively for OAuth authentication, which is more secure than the implicit flow. This means:

- OAuth redirects now use `?code=...&state=...` in the URL (query parameters)
- NO MORE `#access_token=...` in the URL hash (implicit flow is disabled)
- The auth callback exchanges the code for a session using `exchangeCodeForSession()`

## Required Dashboard Configurations

### 1. Supabase Dashboard Settings

Navigate to: **Authentication → URL Configuration**

#### Site URL
Set your production domain:
```
https://imaginethisprinted.com
```

#### Additional Redirect URLs
Add ALL environments where OAuth will be used:
```
http://localhost:5173/auth/callback
https://imaginethisprinted.com/auth/callback
```

Add any staging/preview domains as needed:
```
https://staging.imaginethisprinted.com/auth/callback
https://preview.imaginethisprinted.com/auth/callback
```

### 2. Google Cloud Console Settings

Navigate to: **APIs & Services → Credentials → OAuth 2.0 Client IDs → Web client**

#### Authorized redirect URIs

Add your Supabase project callback URL (NOT your app's callback):
```
https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback
```

**Important:**
- This is the Supabase-to-Google redirect, NOT your app's `/auth/callback`
- Your Supabase project reference can be found in the Supabase dashboard URL
- Example: If your project URL is `https://abcdefghijk.supabase.co`, then add:
  ```
  https://abcdefghijk.supabase.co/auth/v1/callback
  ```

## How to Verify PKCE is Working

1. Click "Sign in with Google" in your application
2. After Google authentication, check the URL when redirected back:
   - ✅ Correct: `https://yourapp.com/auth/callback?code=xxx&state=yyy`
   - ❌ Wrong: `https://yourapp.com/auth/callback#access_token=xxx`
3. The page should navigate away within 1-2 seconds
4. Check browser DevTools → Application → Local Storage:
   - Look for key: `itp-auth-v1`
   - Should contain session data

## Troubleshooting

### "No PKCE code in URL" Error
This means the implicit flow is still being used. Check:
1. Supabase client has `flowType: 'pkce'` in `src/lib/supabase.ts`
2. `signInWithOAuth` includes `options.flowType: 'pkce'` in `src/context/SupabaseAuthContext.tsx`
3. Supabase dashboard has correct redirect URLs configured

### Stuck on "Exchanging credentials..."
This usually means:
1. The redirect URL in Supabase dashboard doesn't match your current domain
2. Google Cloud Console doesn't have the correct Supabase callback URL
3. Browser extensions are interfering (test in Incognito mode)

### Console Errors: "message channel closed before a callback"
These red console lines are usually from Chrome extensions, not your code:
- Test in Incognito mode - if errors disappear, they're from extensions
- These errors don't affect OAuth functionality
- Safe to ignore if OAuth is working correctly

## Code Changes Summary

### src/lib/supabase.ts
```typescript
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce', // ← Force PKCE flow
    detectSessionInUrl: false, // ← Prevent auto-reading hash tokens
    // ... other settings
  },
});
```

### src/context/SupabaseAuthContext.tsx
```typescript
await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: `${window.location.origin}/auth/callback`,
    // Note: flowType is inherited from global client config
    // ... other options
  },
});
```

### src/pages/AuthCallback.tsx
```typescript
// PKCE FLOW ONLY - require code parameter
const code = params.get('code');
if (!code) {
  throw new Error('No PKCE code in URL (implicit flow is disabled)');
}

// Exchange the authorization code for a session
await supabase.auth.exchangeCodeForSession(window.location.href);
```

All implicit flow fallback code has been removed.

## Security Benefits

PKCE provides several security advantages over implicit flow:

1. **No tokens in URL**: Access tokens are never exposed in browser history or logs
2. **Code verifier**: Prevents authorization code interception attacks
3. **Server-side exchange**: Token exchange happens server-side, not in the browser
4. **Recommended by OAuth 2.1**: PKCE is the recommended flow for all OAuth clients

## Next Steps

After making these configuration changes:

1. Clear browser cache and localStorage
2. Test OAuth flow in Incognito mode
3. Verify URL contains `?code=` instead of `#access_token=`
4. Confirm successful navigation away from `/auth/callback`
5. Test across all environments (localhost, staging, production)
