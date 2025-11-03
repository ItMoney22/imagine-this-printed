# Admin Scripts - Authentication Reset & Verification

This directory contains comprehensive scripts for managing production authentication, resetting user data, and verifying auth flows.

## Overview

These scripts use the **Supabase Service Role Key** (admin access) to perform operations that bypass Row Level Security (RLS) and manage authentication at the database level.

**⚠️ WARNING:** These scripts can delete all user data. Always backup your database before running reset scripts.

---

## Prerequisites

### 1. Install Dependencies

```bash
npm install --save-dev tsx dotenv node-fetch@3 @types/node
```

### 2. Create `.env.admin` File

Copy the template:
```bash
cp .env.admin.example .env.admin
```

Edit `.env.admin` with your actual values:

```bash
# Supabase Configuration
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.your-service-role-key..."
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.your-anon-key..."

# Admin User Credentials
LOGIN_EMAIL="admin@example.com"
TEMP_PASSWORD="TempPassword123!"

# Frontend URL
PUBLIC_URL="https://imaginethisprinted.com"
```

**Where to find these values:**

1. **SUPABASE_URL**: Supabase Dashboard → Settings → API → Project URL
2. **SUPABASE_SERVICE_ROLE**: Supabase Dashboard → Settings → API → service_role key (secret!)
3. **SUPABASE_ANON_KEY**: Same as `VITE_SUPABASE_ANON_KEY` in your `.env` file
4. **LOGIN_EMAIL**: The email address you want for the admin account
5. **TEMP_PASSWORD**: A temporary password (change after first login)
6. **PUBLIC_URL**: Your production frontend URL

**🔒 SECURITY:** Never commit `.env.admin` to version control! It's already in `.gitignore`.

---

## Scripts

### 1. `reset-auth-and-data.ts` - Reset Users (Keep Only Admin)

**Purpose:** Delete all users except admin, then create/ensure admin user exists with confirmed email.

**What it does:**
- Lists all users in auth.users
- Deletes all users except the admin email
- Creates admin user if it doesn't exist
- Updates admin password and confirms email if user exists
- Verifies only admin user remains

**Usage:**
```bash
tsx scripts/reset-auth-and-data.ts
```

**Output:**
```
🚀 Starting auth reset...

📋 Fetching all users...
   Found 5 total users

✅ Admin user found: admin@example.com (ID: abc123...)

🗑️  Deleting 4 non-admin users...
   ✅ Deleted: user1@example.com (def456...)
   ✅ Deleted: user2@example.com (ghi789...)
   ✅ Deleted: user3@example.com (jkl012...)
   ✅ Deleted: user4@example.com (mno345...)

🔑 Updating admin user password...
✅ Admin user updated with temp password and confirmed email

📊 Final user count: 1
✅ SUCCESS: Only admin user remains

🔐 Admin credentials:
   Email: admin@example.com
   Password: TempPassword123!
   Status: Email confirmed

⚠️  IMPORTANT: Change this password after first login!

✅ Reset complete
```

**When to use:**
- Starting fresh in production
- After testing with fake users
- Cleaning up before launch
- Recovering from auth issues

---

### 2. `seed-admin-profile.ts` - Create Admin Profile Row

**Purpose:** Upsert admin profile row in `profiles` table with `role='admin'`.

**What it does:**
- Fetches admin user from auth.users
- Upserts profile row in profiles table
- Sets role to 'admin'
- Verifies profile was created correctly

**Usage:**
```bash
tsx scripts/seed-admin-profile.ts
```

**Output:**
```
🚀 Starting admin profile seed...

🔍 Fetching admin user from auth.users...
   ✅ Found admin user: admin@example.com (ID: abc123...)

📝 Upserting admin profile...
   ✅ Admin profile upserted successfully

🔍 Verifying profile...
   ✅ Profile verified:

   User ID: abc123...
   Email: admin@example.com
   Username: admin
   Display Name: Administrator
   Role: admin
   Created: 2025-11-03T12:00:00.000Z
   Updated: 2025-11-03T12:00:00.000Z

✅ Admin profile seeded and verified successfully

✅ Seed complete
```

**When to use:**
- After running reset-auth-and-data.ts
- When admin user exists but profile row is missing
- Setting up admin access for the first time

---

### 3. `verify-signin.ts` - Test Email/Password Authentication

**Purpose:** Headless verification that email/password sign-in works against the live Supabase Auth API.

**What it does:**
- Signs in with email/password using Supabase Auth API
- Retrieves user profile with access token
- Signs out to clean up session
- Reports success/failure with detailed output

**Usage:**
```bash
tsx scripts/verify-signin.ts
```

**Output:**
```
🚀 Starting sign-in verification...

🔐 Attempting sign-in...
   Email: admin@example.com
   Password: ****************

✅ Sign-in successful!

📊 Auth Response:
   Access Token: eyJhbGciOiJIUzI1NiIsInR5cCI6...
   Refresh Token: v1.eyJhbGciOiJIUzI1NiIsInR5cC...
   Token Type: bearer
   Expires In: 3600s

👤 Fetching user profile...

✅ User profile retrieved!

👤 User Details:
   ID: abc123...
   Email: admin@example.com
   Email Confirmed: ✅ Yes
   Created: 2025-11-03T10:00:00.000Z
   Last Sign In: 2025-11-03T12:00:00.000Z

📋 User Metadata:
   Username: admin
   Display Name: Administrator

🚪 Signing out...

✅ Sign-out successful!

============================================================
VERIFICATION SUMMARY
============================================================
✅ Email/Password sign-in: WORKING
✅ User profile retrieval: WORKING
✅ Session management: WORKING
✅ Sign-out: WORKING
============================================================

🎉 All authentication flows verified successfully!

✅ Verification complete
```

**When to use:**
- After running reset-auth-and-data.ts
- Testing auth configuration changes
- Debugging sign-in issues
- Verifying production deployment

**Common errors:**
- **"Invalid login credentials"**: Wrong password or user doesn't exist
- **"Email not confirmed"**: Run reset-auth-and-data.ts to auto-confirm
- **"User not found"**: Admin user doesn't exist, run reset-auth-and-data.ts first

---

### 4. `auth-diagnose.ts` - Comprehensive Diagnostics

**Purpose:** Run comprehensive health checks on all auth configuration and report pass/fail status.

**What it does:**
- Checks environment variables
- Tests Supabase connectivity
- Verifies admin user existence
- Checks admin profile row
- Tests email/password sign-in
- Validates feature flags
- Checks auth configuration files
- Verifies PKCE configuration
- Generates summary report

**Usage:**
```bash
tsx scripts/auth-diagnose.ts
```

**Output:**
```
🚀 Starting Authentication Diagnostics...
Generated: 2025-11-03T12:00:00.000Z

📋 Checking Environment Variables...

✅ SUPABASE_URL: https://abc123.supabase.co
✅ SUPABASE_SERVICE_ROLE: eyJhbGciOiJIUzI1NiIs...
✅ SUPABASE_ANON_KEY: eyJhbGciOiJIUzI1NiIs...
✅ LOGIN_EMAIL: admin@example.com
✅ TEMP_PASSWORD: ****************
✅ PUBLIC_URL: https://imaginethisprinted.com

🌐 Checking Supabase Connectivity...

✅ Supabase API: Reachable

👤 Checking Admin User...

✅ Admin User Exists: Found: admin@example.com
✅ Admin User ID: abc123...
✅ Email Confirmed: Confirmed

📝 Checking Admin Profile...

✅ Profile Exists: Found for user abc123...
✅ Profile Email: admin@example.com
✅ Profile Username: admin
✅ Profile Role: admin

🔐 Checking Email/Password Sign-In...

✅ Sign-In Test: Successfully authenticated
✅ Access Token: eyJhbGciOiJIUzI1NiIs...
✅ Token Type: bearer
✅ Expires In: 3600s

🚩 Checking Feature Flags...

✅ Google OAuth: Disabled
✅ Magic Link: Enabled

📁 Checking Auth Configuration Files...

✅ src/lib/supabase.ts: Exists
✅ src/context/SupabaseAuthContext.tsx: Exists
✅ src/pages/Login.tsx: Exists
✅ src/pages/AuthCallback.tsx: Exists

🔒 Checking PKCE Configuration...

✅ PKCE Flow Type: Configured
✅ detectSessionInUrl: Enabled
✅ Unified Storage Key: Configured

================================================================================
DIAGNOSTICS SUMMARY
================================================================================

Total Checks: 28
✅ Passed: 28
❌ Failed: 0
⚠️  Warnings: 0

================================================================================

🎉 ALL CHECKS PASSED! Authentication is properly configured.
```

**When to use:**
- After any auth configuration changes
- Before production deployment
- Debugging auth issues
- Verifying setup is complete

**Exit codes:**
- `0`: All checks passed
- `1`: One or more checks failed

---

## Recommended Workflow

### Initial Setup (Fresh Production)

```bash
# 1. Create .env.admin with your credentials
cp .env.admin.example .env.admin
nano .env.admin  # Fill in values

# 2. Reset auth (delete all users, create admin)
tsx scripts/reset-auth-and-data.ts

# 3. Seed admin profile
tsx scripts/seed-admin-profile.ts

# 4. Verify sign-in works
tsx scripts/verify-signin.ts

# 5. Run full diagnostics
tsx scripts/auth-diagnose.ts
```

### Production Reset (Cleanup)

```bash
# 1. Backup database first!
# Supabase Dashboard → Database → Backups → Create Backup

# 2. Reset auth (keeps admin only)
tsx scripts/reset-auth-and-data.ts

# 3. Seed admin profile
tsx scripts/seed-admin-profile.ts

# 4. Verify everything works
tsx scripts/verify-signin.ts
tsx scripts/auth-diagnose.ts
```

### Debugging Auth Issues

```bash
# 1. Run diagnostics to identify issues
tsx scripts/auth-diagnose.ts

# 2. Fix identified issues (e.g., missing profile)
tsx scripts/seed-admin-profile.ts

# 3. Test sign-in
tsx scripts/verify-signin.ts

# 4. Re-run diagnostics to confirm
tsx scripts/auth-diagnose.ts
```

---

## Security Best Practices

### 1. Never Commit `.env.admin`

The `.env.admin` file contains your **Service Role Key**, which has full database access. Never commit this file.

**Verify it's in `.gitignore`:**
```bash
grep ".env.admin" .gitignore
# Should output: .env.admin
```

### 2. Rotate Service Role Key After Exposure

If you accidentally commit `.env.admin`:

1. **Immediately rotate the key:**
   - Supabase Dashboard → Settings → API → Reset service_role key
2. **Update `.env.admin` with new key**
3. **Revoke access to the old key**
4. **Remove from git history:**
   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch .env.admin" \
     --prune-empty --tag-name-filter cat -- --all
   git push --force
   ```

### 3. Use Different Passwords

- **TEMP_PASSWORD in .env.admin**: Temporary password for admin account
- **Production password**: Change immediately after first login
- **Never reuse passwords** between development and production

### 4. Restrict Service Role Key Usage

The service role key should **only** be used:
- In secure backend environments
- In trusted admin scripts (like these)
- Never in frontend code
- Never in client-side applications

---

## Troubleshooting

### Error: "Missing required environment variables"

**Cause:** `.env.admin` file missing or incomplete

**Fix:**
```bash
cp .env.admin.example .env.admin
# Fill in all values from Supabase Dashboard
```

### Error: "Failed to fetch users: HTTP 401"

**Cause:** Invalid service role key

**Fix:**
1. Verify `SUPABASE_SERVICE_ROLE` in `.env.admin`
2. Copy fresh key from Supabase Dashboard → Settings → API
3. Ensure you're using **service_role** key, not anon key

### Error: "Sign-in failed: Invalid login credentials"

**Cause:** Wrong password or user doesn't exist

**Fix:**
```bash
# Reset admin user with confirmed email
tsx scripts/reset-auth-and-data.ts
```

### Error: "Profile verification failed: No profile found"

**Cause:** Admin user exists but profile row is missing

**Fix:**
```bash
tsx scripts/seed-admin-profile.ts
```

### Error: "Email not confirmed"

**Cause:** Admin user exists but email is not confirmed

**Fix:**
```bash
# Re-run reset script to auto-confirm email
tsx scripts/reset-auth-and-data.ts
```

---

## Integration with CI/CD

These scripts can be integrated into deployment pipelines:

```bash
# In your CI/CD pipeline (e.g., GitHub Actions)

# 1. Set environment variables as secrets
# SUPABASE_URL, SUPABASE_SERVICE_ROLE, etc.

# 2. Run diagnostics to verify auth configuration
tsx scripts/auth-diagnose.ts

# 3. Exit code 0 = success, 1 = failure
# Pipeline will fail if diagnostics fail
```

**Example GitHub Actions:**
```yaml
- name: Verify Auth Configuration
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE: ${{ secrets.SUPABASE_SERVICE_ROLE }}
    SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
    LOGIN_EMAIL: ${{ secrets.ADMIN_EMAIL }}
    TEMP_PASSWORD: ${{ secrets.ADMIN_TEMP_PASSWORD }}
  run: |
    tsx scripts/auth-diagnose.ts
```

---

## Files in This Directory

- **`.env.admin.example`** - Template for environment variables
- **`reset-auth-and-data.ts`** - Delete all users, keep/create admin
- **`seed-admin-profile.ts`** - Upsert admin profile row
- **`verify-signin.ts`** - Test email/password authentication
- **`auth-diagnose.ts`** - Comprehensive diagnostics
- **`README-ADMIN-SCRIPTS.md`** - This documentation

---

## Related Documentation

- **[AUTH_EMAIL_PASSWORD.md](../AUTH_EMAIL_PASSWORD.md)** - Email/password authentication guide
- **[PKCE_MANUAL_STATE_PERSIST.md](../PKCE_MANUAL_STATE_PERSIST.md)** - PKCE OAuth fix documentation
- **[.env.example](../.env.example)** - Frontend environment variables

---

## Support

If you encounter issues with these scripts:

1. **Run diagnostics first:**
   ```bash
   tsx scripts/auth-diagnose.ts
   ```

2. **Check console output** for specific error messages

3. **Verify environment variables** in `.env.admin`

4. **Check Supabase Dashboard** for user/auth configuration

5. **Review script source code** - scripts are well-commented and readable

---

**Author:** Claude Code (AI Agent)
**Date:** 2025-11-03
**Status:** ✅ Ready for production use
