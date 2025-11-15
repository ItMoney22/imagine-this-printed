# Admin Role Not Showing - Debugging Guide

## Problem Description

User `davidltrinidad@gmail.com` has `role='admin'` in the database but is not seeing the admin navigation menu items in the frontend.

**Symptoms:**
- Database shows: `role='admin'` (confirmed via SQL query)
- User sees limited tabs in AdminDashboard: Overview, Users, Vendors, Products, Models, Audit
- User does NOT see admin dropdown menu items like: Control Panel, Orders, CRM, Marketing, Product Management, etc.

## Root Cause Analysis

The issue stems from one of the following:

1. **Session Cache** - The user's browser has cached session data with an old role value
2. **Profile Fetch Failure** - The AuthContext is failing to fetch or parse the user's profile from Supabase
3. **RLS Policy Issue** - Row Level Security policies might be blocking access to the `role` column
4. **Type Coercion** - The role value might have unexpected whitespace or casing

## Code Flow

### 1. Database → AuthContext

**File:** `src/context/SupabaseAuthContext.tsx`

```typescript
// Line 50-60: Fetches user profile
const { data: profileResult } = await supabase
  .from('user_profiles')
  .select('*')
  .eq('id', supabaseUser.id)
  .single()

// Line 95: Maps role with fallback
role: profile.role || 'customer',
```

**Key Points:**
- If `profile.role` is `null`, `undefined`, or empty string, it defaults to `'customer'`
- The query fetches ALL columns from `user_profiles` including `role`
- The role is logged in console: `[AuthContext] 🎉 User mapped successfully`

### 2. AuthContext → Navbar

**File:** `src/components/Navbar.tsx`

```typescript
// Line 201-288: Admin menu visibility check
{(user.role === 'admin' || user.role === 'manager') && (
  // Admin menu items shown here
)}
```

**Key Points:**
- Uses strict equality check (`===`) which is correct
- Both `'admin'` and `'manager'` roles should see the admin menu
- The check happens reactively whenever `user` changes

### 3. AuthContext → AdminDashboard

**File:** `src/pages/AdminDashboard.tsx`

```typescript
// Line 876: Access control check
if (user?.role !== 'admin') {
  return <AccessDenied />
}
```

**Key Points:**
- ONLY allows `'admin'` role (managers cannot access)
- Uses optional chaining (`user?.role`) to handle null user
- Shows tabs if access is granted

## Debugging Enhancements Added

### 1. AuthContext Logging

**File:** `src/context/SupabaseAuthContext.tsx` (Lines 115-120)

```typescript
// CRITICAL: Verify role was properly mapped from database
if (!mappedUser.role || mappedUser.role === 'customer') {
  console.warn('[AuthContext] ⚠️ ROLE CHECK: User role is', mappedUser.role)
  console.warn('[AuthContext] 📊 Raw profile data:', profile)
  console.warn('[AuthContext] 🔍 Profile.role value:', profile.role, 'Type:', typeof profile.role)
}
```

This will log when:
- Role is missing/undefined
- Role defaults to 'customer'
- Shows the raw database response for inspection

### 2. Navbar Role Logging

**File:** `src/components/Navbar.tsx` (Lines 13-24)

```typescript
// DEBUG: Log user role on component mount and when user changes
useEffect(() => {
  if (user) {
    console.log('[Navbar] 👤 User role check:', {
      email: user.email,
      role: user.role,
      roleType: typeof user.role,
      isAdmin: user.role === 'admin',
      isManager: user.role === 'manager',
      fullUser: user
    })
  }
}, [user])
```

This logs:
- Current role value
- Type of the role value (should be `string`)
- Boolean checks for admin/manager
- Full user object for inspection

### 3. AdminDashboard Access Logging

**File:** `src/pages/AdminDashboard.tsx` (Lines 862-874)

```typescript
useEffect(() => {
  console.log('[AdminDashboard] 🔐 Access check:', {
    user: user ? {
      id: user.id,
      email: user.email,
      role: user.role,
      roleType: typeof user.role
    } : null,
    hasAccess: user?.role === 'admin',
    condition: 'user?.role !== "admin"',
    result: user?.role !== 'admin' ? 'DENIED' : 'GRANTED'
  })
}, [user])
```

This logs:
- Access decision (GRANTED/DENIED)
- Current role value
- Access check result

### 4. Visual Role Indicator

**File:** `src/components/Navbar.tsx` (Lines 120-124)

The account menu dropdown now shows:
```
Role: admin ✓ Admin
```

This provides immediate visual feedback of the role value.

## Session Refresh Utilities

### Console Functions

**File:** `src/utils/forceRefreshSession.ts`

Two utility functions are now exposed to the browser console:

#### 1. `window.refreshSession()`

Force refresh the user's session and profile data:

```javascript
const result = await window.refreshSession()
console.log(result)
// { success: true, profile: { id, email, role, username } }
```

**Use when:**
- Role was updated in database but frontend shows old role
- User profile data is stale
- Need to verify fresh data from database

#### 2. `window.hardResetAuth()`

Nuclear option - clear ALL auth data and force sign out:

```javascript
const result = await window.hardResetAuth()
// User will be signed out and must sign in again
```

**Use when:**
- Session is corrupted
- `refreshSession()` doesn't fix the issue
- Need to start completely fresh

## Troubleshooting Steps

### Step 1: Check Console Logs

1. Open browser DevTools (F12)
2. Go to Console tab
3. Clear console
4. Refresh the page
5. Look for these log entries:

```
[AuthContext] 🎉 User mapped successfully: { role: 'admin', ... }
[Navbar] 👤 User role check: { role: 'admin', isAdmin: true, ... }
[AdminDashboard] 🔐 Access check: { hasAccess: true, result: 'GRANTED' }
```

### Step 2: Verify Role in Console

In the browser console, run:

```javascript
// Check current user role
const user = window.__SUPABASE_USER__ || {} // If exposed
console.log('User role:', user.role)

// Force refresh session
const result = await window.refreshSession()
console.log('Fresh profile:', result.profile)
```

### Step 3: Check Database Directly

Run this SQL query in Supabase:

```sql
SELECT id, email, role, username
FROM user_profiles
WHERE email = 'davidltrinidad@gmail.com';
```

Expected result:
```
id       | email                      | role  | username
---------|----------------------------|-------|----------
<uuid>   | davidltrinidad@gmail.com   | admin | david
```

### Step 4: Force Session Refresh

In browser console:

```javascript
// Try soft refresh first
await window.refreshSession()

// If that doesn't work, hard reset
await window.hardResetAuth()
// Then sign in again
```

### Step 5: Check for RLS Issues

Run this in Supabase SQL Editor:

```sql
-- Check RLS policies on user_profiles
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'user_profiles';
```

Ensure there's a policy allowing users to read their own profile including the `role` column.

## Common Issues & Solutions

### Issue 1: Role is null/undefined

**Symptoms:**
- Console shows: `[AuthContext] ⚠️ ROLE CHECK: User role is undefined`
- Navbar shows: `Role: customer`

**Solution:**
1. Check database: `SELECT role FROM user_profiles WHERE email = 'davidltrinidad@gmail.com'`
2. If null in DB, run: `UPDATE user_profiles SET role = 'admin' WHERE email = 'davidltrinidad@gmail.com'`
3. Run: `await window.refreshSession()` in console

### Issue 2: Role has whitespace

**Symptoms:**
- Console shows: `role: 'admin '` (with trailing space)
- `isAdmin: false`

**Solution:**
1. Update database: `UPDATE user_profiles SET role = TRIM(role) WHERE email = 'davidltrinidad@gmail.com'`
2. Run: `await window.refreshSession()`

### Issue 3: Session cache is stale

**Symptoms:**
- Database shows `role = 'admin'`
- Console shows `role = 'customer'`
- `refreshSession()` shows fresh `role = 'admin'` but UI doesn't update

**Solution:**
1. Run: `await window.hardResetAuth()`
2. Sign in again
3. Check console logs for correct role

### Issue 4: RLS policy blocking role column

**Symptoms:**
- Console shows: `profile.role: undefined`
- Other profile fields are populated correctly

**Solution:**
1. Check RLS policies in Supabase
2. Ensure policy allows reading `role` column:
```sql
CREATE POLICY "Users can view own profile"
ON user_profiles FOR SELECT
USING (auth.uid() = id);
```

### Issue 5: Type mismatch

**Symptoms:**
- Console shows: `roleType: 'object'` or `roleType: 'number'`

**Solution:**
1. Check database column type: `\d user_profiles` in psql
2. Should be `text` or `varchar`
3. If wrong type, fix schema and re-migrate

## Expected Console Output

When everything is working correctly:

```
[Debug] 🛠️ Session utilities available:
  • window.refreshSession() - Force refresh user session
  • window.hardResetAuth() - Clear all auth data and sign out

[AuthContext] 🚀 Initializing auth context...
[AuthContext] 📦 Initial session check: { hasSession: true, hasUser: true, userId: 'abc-123' }
[AuthContext] 👤 Mapping Supabase user to app user...
[AuthContext] 🔍 Fetching profile for user: abc-123
[AuthContext] 📊 Query results: { profile: { role: 'admin', ... }, wallet: { ... } }
[AuthContext] ✅ Profile data received, mapping to User object...
[AuthContext] 💰 Wallet data: { points: 0, itc_balance: 0 }
[AuthContext] 🎉 User mapped successfully: { role: 'admin', email: 'davidltrinidad@gmail.com', ... }
[AuthContext] ✅ Initial auth check complete

[Navbar] 👤 User role check: {
  email: 'davidltrinidad@gmail.com',
  role: 'admin',
  roleType: 'string',
  isAdmin: true,
  isManager: false
}

[AdminDashboard] 🔐 Access check: {
  user: { role: 'admin', email: 'davidltrinidad@gmail.com' },
  hasAccess: true,
  result: 'GRANTED'
}
```

## Files Modified

1. **src/context/SupabaseAuthContext.tsx**
   - Added role mapping verification logging (lines 115-120)

2. **src/components/Navbar.tsx**
   - Added role debugging useEffect (lines 13-24)
   - Enhanced role display in dropdown (lines 120-124)

3. **src/pages/AdminDashboard.tsx**
   - Added access check logging (lines 862-874)
   - Show current role in access denied message (line 886)

4. **src/utils/forceRefreshSession.ts** (NEW)
   - `forceRefreshSession()` - Refresh user session
   - `hardResetAuth()` - Clear all auth data

5. **src/main.tsx**
   - Expose session utilities to window object (lines 21-26)

## Next Steps

1. **User should refresh the page** - New logging will show what's happening
2. **Check console output** - Look for the role value in logs
3. **Try `window.refreshSession()`** - Force refresh from database
4. **If needed, try `window.hardResetAuth()`** - Nuclear option
5. **Report findings** - Share console output for further debugging

## Prevention

To prevent this issue in the future:

1. **Always use session refresh after role changes**
2. **Test role-based access with different users**
3. **Monitor console logs for auth state changes**
4. **Add integration tests for role-based routing**
5. **Consider adding a "Refresh Session" button in user settings**
