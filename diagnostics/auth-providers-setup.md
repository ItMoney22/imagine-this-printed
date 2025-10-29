# Authentication Providers Configuration

## Current Status (Verified via API)

**Last Checked:** 2025-10-29

### Email/Password Authentication
- **Status:** ENABLED
- **Email confirmations:** Optional (mailer_autoconfirm: false)
- **Password minimum length:** 8 characters (default)
- **Signup enabled:** Yes (disable_signup: false)
- **Email provider:** Supabase built-in (configured for development)

### OAuth Providers

#### Google OAuth
- **Status:** ENABLED
- **Configuration:** Active in Supabase Dashboard
- **Redirect URL Pattern:** `https://czzyrmizvjqlifcivrhn.supabase.co/auth/v1/callback`

#### Other Providers (Currently Disabled)
- Apple: Disabled
- Azure: Disabled
- Bitbucket: Disabled
- Discord: Disabled
- Facebook: Disabled
- GitHub: Disabled
- GitLab: Disabled
- Keycloak: Disabled
- Kakao: Disabled
- LinkedIn: Disabled
- Notion: Disabled
- Spotify: Disabled
- Slack: Disabled
- WorkOS: Disabled
- Twitch: Disabled
- Twitter: Disabled
- Phone/SMS: Disabled (SMS provider: Twilio, not configured)

### Anonymous Users
- **Status:** DISABLED

### SAML
- **Status:** DISABLED

---

## Environment Configuration

### Backend Environment (backend/.env)
- `SUPABASE_URL`: Configured
- `SUPABASE_SERVICE_ROLE_KEY`: Configured
- `SUPABASE_ANON_KEY`: Configured
- `DATABASE_URL`: Configured
- `JWT_SECRET`: Configured

### Frontend Environment (.env)
- `VITE_SUPABASE_URL`: Configured
- `VITE_SUPABASE_ANON_KEY`: Configured
- `VITE_API_BASE`: Configured
- `VITE_SITE_URL`: Configured

All environment variables are properly set and match between frontend and backend.

---

## Redirect URLs Configuration

### Current Project URL
`https://czzyrmizvjqlifcivrhn.supabase.co`

### Required Redirect URLs (Add in Supabase Dashboard)

For **Development:**
- `http://localhost:5173/auth/callback`
- `http://localhost:5173/auth/reset-password`
- `http://localhost:5173`
- `http://localhost:5173/*` (wildcard for all routes)

For **Production:**
- `https://imaginethisprinted.com/auth/callback`
- `https://imaginethisprinted.com/auth/reset-password`
- `https://imaginethisprinted.com`
- `https://imaginethisprinted.com/*` (wildcard for all routes)

**To configure redirect URLs:**
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select project: czzyrmizvjqlifcivrhn
3. Navigate to: Authentication > URL Configuration
4. Add the URLs above to "Redirect URLs" section
5. Add the URLs to "Site URL" section

---

## Google OAuth Configuration Details

### Current Setup
Google OAuth is **ENABLED** in the Supabase project.

### Configuration Steps (Already Completed)
1. Created OAuth app in Google Cloud Console
2. Added authorized redirect URI: `https://czzyrmizvjqlifcivrhn.supabase.co/auth/v1/callback`
3. Copied Client ID and Client Secret to Supabase Dashboard
4. Enabled Google provider in: Authentication > Providers > Google

### To Reconfigure (If Needed)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to: APIs & Services > Credentials
3. Create/Edit OAuth 2.0 Client ID
4. Add authorized redirect URI:
   - `https://czzyrmizvjqlifcivrhn.supabase.co/auth/v1/callback`
5. Copy Client ID and Client Secret
6. Go to Supabase Dashboard > Authentication > Providers > Google
7. Paste Client ID and Secret
8. Enable the provider

---

## Email Provider Configuration

### Current Setup
Email authentication is **ENABLED** with the following settings:

- **Email confirmations:** Optional for development (users can sign in immediately)
- **Email provider:** Supabase built-in SMTP
- **Custom SMTP:** Not configured (using default for development)

### Production Email Configuration (Recommended)

For production, configure a custom email service:

**Option 1: Brevo (Already configured in backend/.env)**
- API Key: Configured in backend
- Sender Email: wecare@imaginethisprinted.com
- Sender Name: Imagine This Printed

**Option 2: Configure Custom SMTP in Supabase**
1. Go to: Authentication > Email Templates
2. Navigate to: Settings > SMTP Settings
3. Configure custom SMTP provider
4. Test email delivery

### Email Templates
Default Supabase templates are active for:
- Confirmation email
- Password reset email
- Magic link email
- Email change confirmation

**To customize templates:**
1. Go to: Authentication > Email Templates
2. Edit each template with custom branding
3. Use variables: `{{ .ConfirmationURL }}`, `{{ .Token }}`, etc.

---

## Password Policy

### Current Settings
- **Minimum length:** 8 characters (Supabase default)
- **Complexity requirements:** Not enforced (default)
- **Password reset:** Enabled via email

### To Update Password Policy
1. Go to: Authentication > Providers > Email
2. Scroll to "Password Settings"
3. Configure:
   - Minimum password length
   - Require uppercase
   - Require lowercase
   - Require numbers
   - Require special characters

---

## Security Recommendations

### Immediate Actions Required
1. **Add Redirect URLs** in Supabase Dashboard (see list above)
2. **Enable Email Confirmations** for production (currently optional)
3. **Configure Custom SMTP** for reliable email delivery
4. **Customize Email Templates** with branding

### Optional Enhancements
1. **Enable MFA/2FA** for admin accounts
2. **Configure rate limiting** on auth endpoints
3. **Set up breach password protection**
4. **Add captcha** for signup/signin forms
5. **Enable additional OAuth providers** as needed:
   - GitHub (for developers)
   - Facebook (for social users)
   - Apple (for iOS users)

### Monitoring
- Review auth logs regularly in: Authentication > Logs
- Monitor failed login attempts
- Track signup conversion rates
- Monitor email delivery rates

---

## Testing Authentication

### Manual Testing Steps
1. **Email/Password Signup:**
   - Visit: `http://localhost:5173`
   - Click "Sign Up"
   - Enter email and password
   - Verify account creation

2. **Email/Password Login:**
   - Visit: `http://localhost:5173`
   - Click "Log In"
   - Enter credentials
   - Verify successful login

3. **Google OAuth:**
   - Visit: `http://localhost:5173`
   - Click "Sign in with Google"
   - Complete OAuth flow
   - Verify account creation/login

4. **Password Reset:**
   - Click "Forgot Password"
   - Enter email
   - Check email for reset link
   - Complete password reset

### Automated Testing
Run the auth flow test:
```bash
cd diagnostics
node auth-flow-test.js
```

---

## API Endpoints

### Supabase Auth API
- Base URL: `https://czzyrmizvjqlifcivrhn.supabase.co/auth/v1`
- Settings: `/settings` (public, shows enabled providers)
- Signup: `/signup` (POST)
- Login: `/token?grant_type=password` (POST)
- Logout: `/logout` (POST)
- Session: `/user` (GET)

### Testing Auth Settings
```bash
curl -X GET "https://czzyrmizvjqlifcivrhn.supabase.co/auth/v1/settings" \
  -H "apikey: YOUR_ANON_KEY"
```

---

## Troubleshooting

### Common Issues

**Issue: Email not being sent**
- Check SMTP configuration
- Verify email templates are not disabled
- Check spam folder
- Review auth logs for errors

**Issue: OAuth callback failing**
- Verify redirect URL is configured correctly
- Check OAuth credentials in Supabase Dashboard
- Ensure OAuth app is enabled in provider console

**Issue: User signup disabled**
- Check `disable_signup` setting in Dashboard
- Verify RLS policies allow user creation
- Check for IP/rate limiting

**Issue: JWT token invalid**
- Verify JWT_SECRET matches between environments
- Check token expiration settings
- Ensure clocks are synchronized

---

## Next Steps

After authentication providers are verified:
1. Test complete auth flow (Task 7)
2. Verify user profile creation triggers work
3. Test wallet creation on signup
4. Verify RLS policies protect user data
5. Test auth middleware in backend API
6. Document any additional OAuth providers needed

---

## Resources

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Supabase Dashboard](https://app.supabase.com/project/czzyrmizvjqlifcivrhn)
- [Google OAuth Setup](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Email Templates Guide](https://supabase.com/docs/guides/auth/auth-email-templates)
