#!/usr/bin/env node
/**
 * Create or Reset Admin User Script (IDEMPOTENT)
 *
 * Purpose: Create admin user if doesn't exist, or reset password if exists
 *
 * Usage:
 *   1. Ensure .env.admin has SUPABASE_URL, SUPABASE_SERVICE_ROLE, LOGIN_EMAIL, TEMP_PASSWORD
 *   2. Run: tsx scripts/create-or-reset-admin.ts
 *   3. Can be run multiple times safely (idempotent)
 *
 * What it does:
 *   - Looks up user by email
 *   - If not found: Creates new admin user with confirmed email
 *   - If found: Resets password and confirms email
 *   - Sets role='admin' in user_metadata
 *   - Shows final user state
 */

import 'dotenv/config';
import fetch from 'node-fetch';

const BASE = process.env.SUPABASE_URL!;
const SRV = process.env.SUPABASE_SERVICE_ROLE!;
const EMAIL = process.env.LOGIN_EMAIL!;
const PASS = process.env.TEMP_PASSWORD!;

// Validate environment
if (!BASE || !SRV || !EMAIL || !PASS) {
  console.error('❌ Missing required environment variables in .env.admin');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE, LOGIN_EMAIL, TEMP_PASSWORD');
  process.exit(1);
}

console.log('🔧 Configuration:');
console.log(`   SUPABASE_URL: ${BASE}`);
console.log(`   LOGIN_EMAIL: ${EMAIL}`);
console.log(`   TEMP_PASSWORD: ${'*'.repeat(PASS.length)}`);
console.log(`   SERVICE_ROLE: ${SRV.slice(0, 20)}...`);
console.log('');

/**
 * Generic admin API helper
 */
async function admin(path: string, init: any = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${SRV}`,
      'apikey': SRV,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }

  return res.status === 204 ? null : res.json();
}

/**
 * Main execution
 */
async function main() {
  console.log('🔎 Looking up user by email:', EMAIL);
  console.log('');

  // Step 1: Fetch all users and find admin
  const list: any = await admin('/auth/v1/admin/users');
  const users = list.users || list || [];
  let user = users.find((u: any) => u.email === EMAIL);

  // Step 2: Create or update admin user
  if (!user) {
    console.log('👤 User not found — creating admin user...');
    console.log('   Email will be auto-confirmed (no verification link needed)');
    console.log('');

    user = await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: EMAIL,
        password: PASS,
        email_confirm: true,
        user_metadata: {
          role: 'admin',
          seeded_by: 'create-or-reset-admin',
          created_at: new Date().toISOString()
        }
      })
    });

    console.log('✅ Admin user created!');
    console.log(`   User ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Email Confirmed: ${user.email_confirmed_at ? 'Yes ✅' : 'No ❌'}`);
    console.log('');
  } else {
    console.log('♻️  User found — resetting password and confirming email...');
    console.log(`   User ID: ${user.id}`);
    console.log(`   Current Email Confirmed: ${user.email_confirmed_at ? 'Yes ✅' : 'No ❌'}`);
    console.log('');

    await admin(`/auth/v1/admin/users/${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        password: PASS,
        email_confirm: true,
        user_metadata: {
          ...(user.user_metadata || {}),
          role: 'admin',
          updated_at: new Date().toISOString()
        }
      })
    });

    console.log('✅ Admin user updated!');
    console.log(`   Password reset: ${PASS}`);
    console.log('   Email confirmed: Yes ✅');
    console.log('');
  }

  // Step 3: Fetch final state to verify
  console.log('🔍 Verifying final state...');
  console.log('');

  const list2: any = await admin('/auth/v1/admin/users');
  const finalUser = (list2.users || list2 || []).find((u: any) => u.email === EMAIL);

  if (!finalUser) {
    throw new Error('Verification failed: User not found after creation/update');
  }

  console.log('📄 Final User State:');
  console.log('   ' + '='.repeat(60));
  console.log(`   User ID: ${finalUser.id}`);
  console.log(`   Email: ${finalUser.email}`);
  console.log(`   Email Confirmed: ${finalUser.email_confirmed_at || finalUser.confirmed_at || 'Not confirmed'}`);
  console.log(`   Role: ${finalUser.user_metadata?.role || 'N/A'}`);
  console.log(`   Last Sign In: ${finalUser.last_sign_in_at || 'Never'}`);
  console.log(`   Created At: ${finalUser.created_at}`);
  console.log('   ' + '='.repeat(60));
  console.log('');

  // Step 4: Success summary
  console.log('✅ SUCCESS: Admin user ready');
  console.log('');
  console.log('Credentials:');
  console.log(`   Email:    ${EMAIL}`);
  console.log(`   Password: ${PASS}`);
  console.log('');
  console.log('Next steps:');
  console.log('   1. Run: tsx scripts/seed-admin-profile.ts (if using profiles table)');
  console.log('   2. Run: tsx scripts/verify-signin-live.ts (verify REST auth)');
  console.log('   3. Test browser sign-in: https://imaginethisprinted.com/login');
  console.log('');
  console.log('⚠️  IMPORTANT: Change password after first login!');
  console.log('');
}

// Execute
main()
  .then(() => {
    console.log('✅ Complete\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  - Verify SUPABASE_SERVICE_ROLE is correct (from Supabase Dashboard)');
    console.error('  - Check EMAIL and TEMP_PASSWORD are set in .env.admin');
    console.error('  - Ensure Email/Password provider is enabled in Supabase Dashboard');
    console.error('');
    process.exit(1);
  });
