# Quick Admin Reset Guide

**Idempotent workflow** - Can be run multiple times safely without deleting data.

## Setup

```bash
# 1. Install dependencies
npm i -D tsx node-fetch@3 dotenv @types/node

# 2. Create .env.admin (if not exists)
cp .env.admin.example .env.admin

# 3. Fill in .env.admin:
SUPABASE_URL="https://czzyrmizvjqlifcivrhn.supabase.co"
SUPABASE_SERVICE_ROLE="<GET_FROM_SUPABASE_DASHBOARD>"
SUPABASE_ANON_KEY="<SAME_AS_VITE_SUPABASE_ANON_KEY>"
LOGIN_EMAIL="davidltrinidad@gmail.com"
TEMP_PASSWORD="Dmoney!2025!Reset"
PUBLIC_URL="https://imaginethisprinted.com"
```

## Execution

```bash
# 1. Create or reset admin user (idempotent)
npx tsx scripts/create-or-reset-admin.ts

# 2. Seed profile row with role='admin' (if using profiles table)
npx tsx scripts/seed-admin-profile.ts

# 3. Verify REST auth works
npx tsx scripts/verify-signin-live.ts
```

## Browser Test

1. Open **Incognito** window
2. Navigate to: https://imaginethisprinted.com/login
3. Enter:
   - Email: `davidltrinidad@gmail.com`
   - Password: `Dmoney!2025!Reset`
4. Click "Sign In"
5. **Expected:** Redirects to `/`, logged in
6. **Verify:** localStorage has `sb-czzyrmizvjqlifcivrhn-auth-token`

## Troubleshooting

### "Invalid login credentials"
```bash
# Re-run to reset password and confirm email
npx tsx scripts/create-or-reset-admin.ts
```

### Verify in Supabase Dashboard
1. Go to: Auth → Users
2. Confirm `davidltrinidad@gmail.com` exists
3. Verify "Email Confirmed" is checked ✅
4. Go to: Auth → Providers
5. Verify "Email" is enabled

### Still failing?
```bash
# Run diagnostics
npx tsx scripts/auth-diagnose.ts
```

## Credentials

**Email:** `davidltrinidad@gmail.com`
**Password:** `Dmoney!2025!Reset`
**URL:** https://imaginethisprinted.com/login

⚠️ Change password after first login!
