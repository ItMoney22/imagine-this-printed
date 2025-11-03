#!/usr/bin/env node
/**
 * Reset Auth and Data Script
 *
 * Purpose: Clean production auth users (keeping only admin) and create/ensure admin user
 *
 * WARNING: This script deletes all users except the admin. Create a backup first!
 *
 * Usage:
 *   1. Create .env.admin with SUPABASE_URL, SUPABASE_SERVICE_ROLE, LOGIN_EMAIL, TEMP_PASSWORD
 *   2. Run: tsx scripts/reset-auth-and-data.ts
 *
 * Requirements:
 *   - Service role key (admin access)
 *   - Manual backup confirmation before running
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import fetch from 'node-fetch';

// Load .env.admin
dotenv.config({ path: path.resolve(process.cwd(), '.env.admin') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE;
const ADMIN_EMAIL = process.env.LOGIN_EMAIL;
const TEMP_PASSWORD = process.env.TEMP_PASSWORD;

// Validate required environment variables
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ADMIN_EMAIL || !TEMP_PASSWORD) {
  console.error('❌ Missing required environment variables in .env.admin');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE, LOGIN_EMAIL, TEMP_PASSWORD');
  process.exit(1);
}

console.log('🔧 Configuration loaded:');
console.log(`   SUPABASE_URL: ${SUPABASE_URL}`);
console.log(`   ADMIN_EMAIL: ${ADMIN_EMAIL}`);
console.log(`   SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY.slice(0, 20)}...`);
console.log('');

// Admin API endpoints
const AUTH_ADMIN_API = `${SUPABASE_URL}/auth/v1/admin`;

/**
 * List all users via Admin API
 */
async function listUsers(): Promise<any[]> {
  console.log('📋 Fetching all users...');

  const response = await fetch(`${AUTH_ADMIN_API}/users`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list users: ${response.status} ${error}`);
  }

  const data: any = await response.json();
  return data.users || [];
}

/**
 * Delete a user by ID via Admin API
 */
async function deleteUser(userId: string): Promise<void> {
  const response = await fetch(`${AUTH_ADMIN_API}/users/${userId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete user ${userId}: ${response.status} ${error}`);
  }
}

/**
 * Create a new user via Admin API
 */
async function createUser(email: string, password: string): Promise<any> {
  console.log(`👤 Creating admin user: ${email}`);

  const response = await fetch(`${AUTH_ADMIN_API}/users`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        username: 'admin',
        display_name: 'Administrator',
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create user: ${response.status} ${error}`);
  }

  return await response.json();
}

/**
 * Update user password and confirm email via Admin API
 */
async function updateUser(userId: string, password: string): Promise<void> {
  console.log(`🔑 Updating admin user password...`);

  const response = await fetch(`${AUTH_ADMIN_API}/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      password,
      email_confirm: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update user: ${response.status} ${error}`);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting auth reset...\n');

  // Step 1: List all users
  const users = await listUsers();
  console.log(`   Found ${users.length} total users\n`);

  if (users.length === 0) {
    console.log('ℹ️  No users found. Creating admin user...\n');
    await createUser(ADMIN_EMAIL!, TEMP_PASSWORD!);
    console.log('✅ Admin user created successfully\n');
    return;
  }

  // Step 2: Find admin user
  const adminUser = users.find(u => u.email === ADMIN_EMAIL);

  if (adminUser) {
    console.log(`✅ Admin user found: ${adminUser.email} (ID: ${adminUser.id})\n`);
  } else {
    console.log(`⚠️  Admin user not found. Will create after cleanup.\n`);
  }

  // Step 3: Delete all non-admin users
  const usersToDelete = users.filter(u => u.email !== ADMIN_EMAIL);

  if (usersToDelete.length === 0) {
    console.log('ℹ️  No users to delete (only admin exists)\n');
  } else {
    console.log(`🗑️  Deleting ${usersToDelete.length} non-admin users...\n`);

    for (const user of usersToDelete) {
      try {
        await deleteUser(user.id);
        console.log(`   ✅ Deleted: ${user.email} (${user.id})`);
      } catch (error: any) {
        console.error(`   ❌ Failed to delete ${user.email}:`, error.message);
      }
    }
    console.log('');
  }

  // Step 4: Create or update admin user
  if (adminUser) {
    // Admin exists - update password and ensure email is confirmed
    await updateUser(adminUser.id, TEMP_PASSWORD!);
    console.log('✅ Admin user updated with temp password and confirmed email\n');
  } else {
    // Admin doesn't exist - create new
    await createUser(ADMIN_EMAIL!, TEMP_PASSWORD!);
    console.log('✅ Admin user created successfully\n');
  }

  // Step 5: Final verification
  const finalUsers = await listUsers();
  console.log('📊 Final user count:', finalUsers.length);

  if (finalUsers.length === 1 && finalUsers[0].email === ADMIN_EMAIL) {
    console.log('✅ SUCCESS: Only admin user remains\n');
    console.log('🔐 Admin credentials:');
    console.log(`   Email: ${ADMIN_EMAIL}`);
    console.log(`   Password: ${TEMP_PASSWORD}`);
    console.log(`   Status: Email confirmed\n`);
    console.log('⚠️  IMPORTANT: Change this password after first login!\n');
  } else {
    console.warn('⚠️  WARNING: Multiple users still exist. Manual verification needed.\n');
    finalUsers.forEach(u => {
      console.log(`   - ${u.email} (${u.id})`);
    });
  }
}

// Execute
main()
  .then(() => {
    console.log('✅ Reset complete\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
