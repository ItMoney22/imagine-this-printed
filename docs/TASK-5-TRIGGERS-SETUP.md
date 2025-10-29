# Task 5: User Profile Creation Triggers - Setup Guide

## Overview

Task 5 creates database triggers that automatically handle user lifecycle events:

1. **User Signup** - Automatically creates `user_profiles` and `user_wallets` records
2. **Referral Code** - Generates unique 8-character referral code from user ID hash
3. **User Deletion** - Cascades deletion of related data when user is removed

## Files Created

- `backend/prisma/migrations/003_user_triggers.sql` - Trigger definitions
- `backend/scripts/setup-triggers.js` - Documentation and verification script (no automatic setup)

## Important: Railway Deployment Note

**Triggers cannot be automatically applied in Railway deployment** because:
- Railway blocks direct PostgreSQL connections for security
- Supabase RPC functions cannot execute arbitrary SQL
- Manual application through the Dashboard is required

Use the setup script to display documentation:
```bash
cd backend
node scripts/setup-triggers.js
```

## Setup Methods

### Method 1: Manual Setup in Supabase Dashboard (Recommended)

1. Open [Supabase Dashboard](https://app.supabase.com)
2. Select your project (imagine-this-printed)
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy the entire SQL from `backend/prisma/migrations/003_user_triggers.sql`
6. Paste it into the SQL editor
7. Click **Run**
8. Wait for success confirmation

**Expected Output:**
```
Query successful
```

### Method 2: Using psql Command Line (Local Development Only)

If you have PostgreSQL CLI installed and direct database access:

```bash
psql "postgresql://postgres:[PASSWORD]@db.czzyrmizvjqlifcivrhn.supabase.co:5432/postgres?sslmode=require" \
  -f backend/prisma/migrations/003_user_triggers.sql
```

Replace `[PASSWORD]` with your database password from Supabase settings.

**Note:** This will not work in Railway deployment due to network restrictions.

## Trigger Details

### 1. handle_new_user() Function

**Trigger:** `on_auth_user_created`
**Event:** AFTER INSERT on auth.users
**Actions:**

```sql
- Inserts record into public.user_profiles with:
  - id: User's UUID from auth.users
  - email: User's email
  - full_name: From raw_user_meta_data->>'full_name'

- Inserts record into public.user_wallets with:
  - user_id: User's UUID
  - itc_balance: 0.00
  - usd_balance: 0.00

- Updates user_profiles to set:
  - referral_code: 8-char uppercase code from MD5(user_id)
```

**Error Handling:**
- Handles `unique_violation` if user_profiles already exists (idempotent)
- Handles `unique_violation` and `foreign_key_violation` for wallet creation
- Logs warnings if referral code generation fails but allows signup to complete

### 2. handle_user_delete() Function

**Trigger:** `on_auth_user_deleted`
**Event:** BEFORE DELETE on auth.users
**Actions:**

```sql
- Deletes user_profiles record
- Cascade deletes user_wallets (via FK constraint)
- Cascade deletes other related records (products, orders, etc.)
```

**Error Handling:**
- Catches all exceptions during deletion and logs warnings
- Continues with deletion even if user_profiles deletion fails
- Ensures the user auth record can be deleted even if profile cleanup has issues

## Verification

After applying triggers, test by creating a new user through the Supabase Auth API:

```bash
curl -X POST "https://czzyrmizvjqlifcivrhn.supabase.co/auth/v1/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!",
    "data": {"full_name": "Test User"}
  }'
```

Then verify the records were created:

```bash
# Check user_profiles
curl -X GET "https://czzyrmizvjqlifcivrhn.supabase.co/rest/v1/user_profiles?id=eq.USER_ID" \
  -H "Authorization: Bearer ANON_KEY"

# Check user_wallets
curl -X GET "https://czzyrmizvjqlifcivrhn.supabase.co/rest/v1/user_wallets?user_id=eq.USER_ID" \
  -H "Authorization: Bearer ANON_KEY"
```

## Troubleshooting

### Trigger Not Firing

**Symptoms:** New users created but no profile/wallet records

**Solutions:**
- Verify triggers are created in Supabase Dashboard > SQL Editor
- Check that user is signing up through auth.users (not manual insert)
- Verify RLS policies allow trigger operations (with SECURITY DEFINER)

### Connection Errors

**Error:** `getaddrinfo ENOTFOUND db.czzyrmizvjqlifcivrhn.supabase.co`

**Solution:** Use Method 2 (Manual in Dashboard) instead - you may not have direct database access from your environment.

### Permission Denied on Trigger

**Error:** `permission denied for schema auth`

**Solution:** Ensure SERVICE_ROLE_KEY is being used (has database access), not ANON_KEY.

## Technical Details

### Security

- Triggers use `SECURITY DEFINER` to run with function creator's permissions
- Functions bypass RLS policies (required for auth.users operations)
- User data is isolated via RLS policies on public tables

### Performance

- Triggers add ~10-50ms to user signup (negligible)
- Asynchronous (non-blocking) from user perspective
- Database handles all operations atomically

### Data Flow

```
User Signs Up
    ↓
POST /auth/v1/signup
    ↓
auth.users INSERT
    ↓
on_auth_user_created TRIGGER
    ↓
execute handle_new_user()
    ↓
INSERT public.user_profiles
INSERT public.user_wallets
UPDATE public.user_profiles (set referral_code)
    ↓
User fully provisioned
```

## Implementation Status

- [x] Trigger SQL created (003_user_triggers.sql)
- [x] Setup script created (setup-triggers.js)
- [ ] Triggers applied to database (See Setup Methods above)
- [ ] User signup tested end-to-end
- [ ] Deletion cascade verified

## Next Steps

1. Apply triggers using one of the methods above
2. Test user signup creates profile + wallet
3. Proceed to Task 6: Configure Authentication Providers
4. Run Task 7: Test Complete Auth Flow

## Related Files

- Database Schema: `backend/prisma/migrations/001_initial_schema.sql`
- RLS Policies: `backend/prisma/migrations/002_rls_policies.sql`
- User Profiles Table: public.user_profiles
- User Wallets Table: public.user_wallets
