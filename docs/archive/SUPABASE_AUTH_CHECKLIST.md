# Supabase Dashboard Authentication Checklist

This checklist ensures your Supabase project is configured correctly for multi-domain OAuth authentication.

## Navigation
Go to: **Supabase Dashboard** → Your Project → **Authentication** → **URL Configuration**

## 1. Site URL
Set the primary site URL:
```
https://imaginethisprinted.com
```

**Purpose**: This is the default redirect URL for email confirmations and the primary domain for your app.

---

## 2. Redirect URLs (CRITICAL for OAuth)
Add ALL domains where users might authenticate:

### Production Domain:
```
https://imaginethisprinted.com/auth/callback
https://imaginethisprinted.com/auth/reset-password
```

### Railway Domains:
Find your Railway domains by running:
```bash
railway domain
```

Then add them in this format:
```
https://your-app-name.up.railway.app/auth/callback
https://your-app-name.up.railway.app/auth/reset-password
```

**If you have a custom Railway subdomain:**
```
https://custom-subdomain.railway.app/auth/callback
https://custom-subdomain.railway.app/auth/reset-password
```

### Development (if needed):
```
http://localhost:5173/auth/callback
http://localhost:5173/auth/reset-password
```

**Note**: Each URL must be on its own line or comma-separated.

---

## 3. Additional Redirect URLs (under Advanced Settings)
Ensure the same URLs are in the "Additional Redirect URLs" section if it exists in your Supabase version.

---

## 4. Auth Providers → Google OAuth
Navigate to: **Authentication** → **Providers** → **Google**

### Settings:
- ✅ **Enabled**: ON
- ✅ **Client ID**: (Your Google OAuth Client ID)
- ✅ **Client Secret**: (Your Google OAuth Client Secret)

### Authorized redirect URIs in Google Cloud Console:
Make sure your Google OAuth app has these redirect URIs:
```
https://czzyrmizvjqlifcivrhn.supabase.co/auth/v1/callback
```

---

## 5. PKCE Flow (Recommended)
Navigate to: **Authentication** → **Settings** → **Auth Flow Type**

**Recommended Setting**:
- ✅ **PKCE with PKCE Flow** (most secure)
- ⚠️ If you need to support legacy clients, you can enable "Implicit Flow" but PKCE is preferred

**Why PKCE?**: More secure for client-side apps, prevents authorization code interception attacks.

---

## 6. Session Settings
Navigate to: **Authentication** → **Settings**

### Recommended Settings:
- **JWT Expiry**: 3600 (1 hour) - default is fine
- **Refresh Token Expiry**: 2592000 (30 days) - adjust as needed
- **Refresh Token Reuse Interval**: 10 (seconds)

---

## 7. CORS Origins (If Applicable)
Navigate to: **Project Settings** → **API** → **CORS Allowed Origins**

Add the same domains:
```
https://imaginethisprinted.com
https://your-app-name.up.railway.app
http://localhost:5173
```

---

## 8. Email Templates (Optional but Recommended)
Navigate to: **Authentication** → **Email Templates**

Update these templates to use your brand:
- **Confirm signup**
- **Invite user**
- **Magic Link**
- **Change Email Address**
- **Reset Password**

Make sure the redirect URLs in templates use: `{{ .SiteURL }}/auth/callback`

---

## Verification Checklist

Run through this checklist after making changes:

- [ ] Site URL is set to production domain
- [ ] All redirect URLs include `/auth/callback`
- [ ] Railway domain(s) are included in redirect URLs
- [ ] Google OAuth is enabled with correct credentials
- [ ] PKCE flow is enabled (preferred)
- [ ] CORS origins include all deployment domains
- [ ] Email templates use correct redirect URLs
- [ ] Test OAuth flow on each domain:
  - [ ] imaginethisprinted.com
  - [ ] Railway production URL
  - [ ] localhost (dev)

---

## Testing the Configuration

After updating settings, test the auth flow:

1. **Clear browser cache and localStorage**
2. **Visit each domain and try Google sign-in**
3. **Check browser console for errors**
4. **Verify you're redirected to `/auth/callback`**
5. **Confirm session persists after page refresh**

---

## Troubleshooting

### Error: "redirect_uri_mismatch"
- **Cause**: The redirect URL is not in Supabase's allowed list
- **Fix**: Add the exact URL to Redirect URLs in Supabase dashboard

### Error: "Invalid flow type"
- **Cause**: Mismatch between PKCE/Implicit flow settings
- **Fix**: Ensure your code uses PKCE flow and it's enabled in Supabase

### Session not persisting
- **Cause**: localStorage not being set correctly
- **Fix**: Check storageKey matches in client config (should be `itp-auth-v1`)

### CORS errors
- **Cause**: Domain not in CORS allowed origins
- **Fix**: Add domain to CORS settings in Project Settings → API

---

## Railway-Specific Notes

Railway deployments can have multiple URLs:
1. **Default Railway URL**: `your-app-name.up.railway.app`
2. **Custom domain**: `imaginethisprinted.com`

**IMPORTANT**: You must add BOTH to Supabase redirect URLs for auth to work on both!

To find your Railway URLs:
```bash
railway status
railway domain
```

---

## Security Best Practices

✅ **DO:**
- Use PKCE flow for web apps
- Set reasonable token expiry times
- Use HTTPS for all production domains
- Rotate secrets regularly

❌ **DON'T:**
- Share your Supabase service role key (keep it in Railway env vars only)
- Use HTTP in production
- Allow wildcards in redirect URLs
- Disable PKCE unless absolutely necessary

---

**Last Updated**: 2025-10-17
**Project**: Imagine This Printed
**Supabase Version**: v2.53.0
