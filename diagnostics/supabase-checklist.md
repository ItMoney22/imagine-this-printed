# PHASE 3: Supabase Console Checklist

This checklist documents the required Supabase console settings for authentication to work correctly.

## Auth Settings → URL Configuration

Navigate to: **Authentication → URL Configuration**

### Required Settings

1. **Site URL**
   - **Local Development**: `http://localhost:5173`
   - **Production**: `https://imaginethisprinted.com` (or your actual domain)
   - **Purpose**: The main URL where your app is hosted

2. **Redirect URLs** (Allowed)
   Add ALL of the following URLs:
   - `http://localhost:5173/auth/callback` (local dev)
   - `http://localhost:5173/auth/reset-password` (local dev - password reset)
   - `http://localhost:4173/auth/callback` (local preview build)
   - `https://imaginethisprinted.com/auth/callback` (production)
   - `https://imaginethisprinted.com/auth/reset-password` (production - password reset)
   - Any other production URLs or staging URLs

3. **Additional URLs** (if using magic links)
   - Ensure the magic link redirect URLs match the above

## Auth Settings → Providers

Navigate to: **Authentication → Providers**

### Email Provider

- [x] **Email**: Enabled
- [x] **Confirm email**: Enabled (recommended) or Disabled (for testing)
- [x] **Secure email change**: Enabled (recommended)

### Google OAuth (if using)

- [x] **Google**: Enabled
- Ensure you have:
  - Google Client ID configured
  - Google Client Secret configured
  - Authorized redirect URIs in Google Cloud Console match Supabase callback URLs

### Disable Unused Providers

Disable any providers you're not using to reduce attack surface.

## PKCE Flow (Optional but Recommended)

Navigate to: **Authentication → Settings**

- [x] **Enable PKCE**: Recommended for enhanced security
- The `@supabase/supabase-js` client library handles PKCE automatically

## Database → RLS Policies

Navigate to: **Database → Tables**

### Required Tables and Policies

Check that the following tables exist and have RLS enabled:

#### `user_profiles` Table

```sql
-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own profile
CREATE POLICY "Users can read own profile"
ON public.user_profiles FOR SELECT
USING (auth.uid() = id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update own profile"
ON public.user_profiles FOR UPDATE
USING (auth.uid() = id);

-- Policy: Insert profile on first sign-in (via trigger or function)
-- This depends on your implementation
```

#### `user_wallets` Table

```sql
-- Enable RLS
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own wallet
CREATE POLICY "Users can read own wallet"
ON public.user_wallets FOR SELECT
USING (auth.uid() = user_id);

-- Policy: Users can update their own wallet (if needed)
CREATE POLICY "Users can update own wallet"
ON public.user_wallets FOR UPDATE
USING (auth.uid() = user_id);
```

### Profile Creation Trigger

You may need a trigger or function to automatically create a profile when a user signs up:

```sql
-- Function to create user profile on sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, username, display_name, role, email_verified)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', SPLIT_PART(NEW.email, '@', 1)),
    'customer',
    NEW.email_confirmed_at IS NOT NULL
  );

  INSERT INTO public.user_wallets (user_id, points_balance, itc_balance)
  VALUES (NEW.id, 0, 0);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to run on user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

## Email Templates (if using email confirmation)

Navigate to: **Authentication → Email Templates**

### Confirm Signup

Ensure the email template includes a link that redirects to your allowed redirect URLs:
- Example: `{{ .ConfirmationURL }}`

### Password Reset

Ensure the reset link redirects to `/auth/reset-password`:
- Example: `{{ .ConfirmationURL }}`

## Domain / SMTP (Optional)

If you want to use a custom domain for emails:

Navigate to: **Project Settings → Auth → SMTP Settings**

- Configure your SMTP provider (e.g., SendGrid, Mailgun, Brevo)
- Verify the sender email domain

## Verification Steps

After configuring the above:

1. ✅ Test sign-up with email/password
2. ✅ Test sign-in with email/password
3. ✅ Test Google OAuth (if enabled)
4. ✅ Test password reset flow
5. ✅ Test magic link (if enabled)
6. ✅ Verify profile is created in `user_profiles` table
7. ✅ Verify wallet is created in `user_wallets` table
8. ✅ Test that RLS policies block unauthorized access

## Common Issues

### Issue: "Invalid redirect URL"
- **Cause**: The redirect URL is not in the allowed list
- **Fix**: Add the URL to **Redirect URLs** in Supabase console

### Issue: "No profile found after sign-in"
- **Cause**: No trigger to create profile, or trigger failed
- **Fix**: Check `handle_new_user()` function and trigger exist and work

### Issue: "Email not delivered"
- **Cause**: SMTP not configured or email in spam
- **Fix**: Check SMTP settings, verify sender domain, check spam folder

### Issue: "PKCE code verifier missing"
- **Cause**: PKCE flow interrupted or browser storage cleared
- **Fix**: Ensure cookies/localStorage are allowed, try sign-in again

## Screenshots Required

To complete this phase, take screenshots of:

1. ✅ Authentication → URL Configuration (showing Site URL and Redirect URLs)
2. ✅ Authentication → Providers (showing enabled providers)
3. ✅ Database → user_profiles table (showing RLS enabled)
4. ✅ Database → user_wallets table (showing RLS enabled)
5. ✅ SQL Editor → handle_new_user function and trigger

**Note**: Screenshots should be saved in `diagnostics/screenshots/` folder.
