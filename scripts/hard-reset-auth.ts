#!/usr/bin/env node
/**
 * Hard Reset Auth Script - NO BACKUPS (DESTRUCTIVE)
 *
 * Purpose: Delete ALL users except admin, create/ensure admin user with confirmed email
 *
 * WARNING: This script is DESTRUCTIVE and proceeds without backups by explicit request.
 *
 * Usage:
 *   1. Create .env.admin with SUPABASE_URL, SUPABASE_SERVICE_ROLE, LOGIN_EMAIL, TEMP_PASSWORD
 *   2. Run: tsx scripts/hard-reset-auth.ts
 *
 * What it does:
 *   - Lists all users in auth.users
 *   - Deletes ALL users except LOGIN_EMAIL (davidltrinidad@gmail.com)
 *   - Creates admin user if doesn't exist
 *   - Auto-confirms email (no verification link needed)
 *   - Sets temp password from .env.admin
 */

import 'dotenv/config';
import fetch from 'node-fetch';

const base = process.env.SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE!;
const email = process.env.LOGIN_EMAIL!;
const pass = process.env.TEMP_PASSWORD!;

// Validate environment
if (!base || !service || !email || !pass) {
  console.error('❌ Missing required environment variables in .env.admin');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE, LOGIN_EMAIL, TEMP_PASSWORD');
  process.exit(1);
}

console.log('🔧 Configuration:');
console.log(`   SUPABASE_URL: ${base}`);
console.log(`   LOGIN_EMAIL: ${email}`);
console.log(`   TEMP_PASSWORD: ${'*'.repeat(pass.length)}`);
console.log(`   SERVICE_ROLE: ${service.slice(0, 20)}...`);
console.log('');

/**
 * Generic admin API helper
 */
async function admin(path: string, init: any = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${service}`,
      'apikey': service,
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
  console.log('⚠️  WARNING: This is a DESTRUCTIVE operation with NO BACKUPS');
  console.log('⚠️  All users except admin will be PERMANENTLY DELETED');
  console.log('');

  // Step 1: List all users
  console.log('🔒 Listing all users...');
  const list: any = await admin('/auth/v1/admin/users');
  const users = list.users || list || [];
  console.log(`📦 Found ${users.length} users\n`);

  if (users.length === 0) {
    console.log('ℹ️  No users found. Will create admin user.\n');
  } else {
    console.log('Current users:');
    users.forEach((u: any) => {
      console.log(`   - ${u.email} (${u.id}) ${u.email === email ? '← ADMIN (KEEP)' : '← WILL DELETE'}`);
    });
    console.log('');
  }

  // Step 2: Delete all non-admin users
  let deletedCount = 0;
  for (const u of users) {
    if (u.email !== email) {
      console.log(`🗑️  Deleting: ${u.email} (${u.id})`);
      try {
        await admin(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
        deletedCount++;
        console.log('   ✅ Deleted');
      } catch (err: any) {
        console.error(`   ❌ Failed:`, err.message);
      }
    }
  }

  if (deletedCount > 0) {
    console.log(`\n🗑️  Deleted ${deletedCount} users\n`);
  } else {
    console.log('\nℹ️  No users to delete\n');
  }

  // Step 3: Ensure admin user exists with confirmed email
  console.log('👤 Ensuring admin user exists & email confirmed...');

  const adminUser = users.find((u: any) => u.email === email);

  if (adminUser) {
    // Admin exists - update password and confirm email
    console.log(`   ℹ️  Admin user already exists: ${adminUser.id}`);
    console.log('   🔑 Updating password and confirming email...');

    await admin(`/auth/v1/admin/users/${adminUser.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        password: pass,
        email_confirm: true,
        user_metadata: {
          role: 'admin',
          seeded_by: 'hard-reset',
          reset_date: new Date().toISOString()
        }
      })
    });

    console.log('   ✅ Admin user updated\n');
  } else {
    // Admin doesn't exist - create new
    console.log('   🆕 Creating new admin user...');

    try {
      const newUser = await admin('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password: pass,
          email_confirm: true,
          user_metadata: {
            role: 'admin',
            seeded_by: 'hard-reset',
            created_date: new Date().toISOString()
          }
        })
      });

      console.log(`   ✅ Admin user created: ${newUser.id}\n`);
    } catch (e: any) {
      if (String(e.message).includes('already registered')) {
        console.log('   ℹ️  Admin already present; leaving as is\n');
      } else {
        throw e;
      }
    }
  }

  // Step 4: Final verification
  console.log('🔍 Final verification...');
  const finalList: any = await admin('/auth/v1/admin/users');
  const finalUsers = finalList.users || finalList || [];

  console.log(`📊 Total users remaining: ${finalUsers.length}\n`);

  if (finalUsers.length === 1 && finalUsers[0].email === email) {
    console.log('✅ SUCCESS: Only admin user remains\n');
    console.log('=' .repeat(60));
    console.log('ADMIN CREDENTIALS');
    console.log('=' .repeat(60));
    console.log(`Email: ${email}`);
    console.log(`Password: ${pass}`);
    console.log('Status: Email confirmed ✅');
    console.log('Role: admin');
    console.log('=' .repeat(60));
    console.log('');
    console.log('⚠️  IMPORTANT: Change this password after first login!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Run: tsx scripts/truncate-public-schema.sql (via Supabase Dashboard)');
    console.log('2. Run: tsx scripts/seed-admin-profile.ts');
    console.log('3. Run: tsx scripts/verify-signin.ts');
    console.log('4. Test live sign-in at https://imaginethisprinted.com/login');
    console.log('');
  } else {
    console.warn('⚠️  WARNING: Multiple users still exist. Manual verification needed.\n');
    finalUsers.forEach((u: any) => {
      console.log(`   - ${u.email} (${u.id})`);
    });
    console.log('');
  }
}

// Execute
main()
  .then(() => {
    console.log('✅ Hard reset complete\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error during hard reset:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
