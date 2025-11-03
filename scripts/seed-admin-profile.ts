#!/usr/bin/env node
/**
 * Seed Admin Profile Script
 *
 * Purpose: Upsert admin profile row in profiles table with role='admin'
 *
 * Usage:
 *   1. Ensure .env.admin has SUPABASE_URL, SUPABASE_SERVICE_ROLE, LOGIN_EMAIL
 *   2. Run: tsx scripts/seed-admin-profile.ts
 *
 * Requirements:
 *   - Service role key (bypasses RLS)
 *   - Admin user must exist in auth.users
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import fetch from 'node-fetch';

// Load .env.admin
dotenv.config({ path: path.resolve(process.cwd(), '.env.admin') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE;
const ADMIN_EMAIL = process.env.LOGIN_EMAIL;

// Validate required environment variables
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ADMIN_EMAIL) {
  console.error('❌ Missing required environment variables in .env.admin');
  console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE, LOGIN_EMAIL');
  process.exit(1);
}

console.log('🔧 Configuration loaded:');
console.log(`   SUPABASE_URL: ${SUPABASE_URL}`);
console.log(`   ADMIN_EMAIL: ${ADMIN_EMAIL}`);
console.log('');

// API endpoints
const AUTH_ADMIN_API = `${SUPABASE_URL}/auth/v1/admin`;
const REST_API = `${SUPABASE_URL}/rest/v1`;

/**
 * Get admin user from auth.users
 */
async function getAdminUser(): Promise<any> {
  console.log('🔍 Fetching admin user from auth.users...');

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
    throw new Error(`Failed to fetch users: ${response.status} ${error}`);
  }

  const data: any = await response.json();
  const users = data.users || [];
  const adminUser = users.find((u: any) => u.email === ADMIN_EMAIL);

  if (!adminUser) {
    throw new Error(`Admin user not found with email: ${ADMIN_EMAIL}`);
  }

  console.log(`   ✅ Found admin user: ${adminUser.email} (ID: ${adminUser.id})\n`);
  return adminUser;
}

/**
 * Upsert admin profile using REST API
 */
async function upsertAdminProfile(userId: string, email: string): Promise<void> {
  console.log('📝 Upserting admin profile...');

  const profileData = {
    user_id: userId,
    email: email,
    username: 'admin',
    display_name: 'Administrator',
    role: 'admin',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Using upsert with on_conflict parameter
  const response = await fetch(`${REST_API}/profiles?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(profileData),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to upsert profile: ${response.status} ${error}`);
  }

  console.log('   ✅ Admin profile upserted successfully\n');
}

/**
 * Verify profile exists using REST API
 */
async function verifyProfile(userId: string): Promise<void> {
  console.log('🔍 Verifying profile...');

  const response = await fetch(`${REST_API}/profiles?user_id=eq.${userId}&select=*`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to verify profile: ${response.status} ${error}`);
  }

  const profiles: any[] = await response.json();

  if (profiles.length === 0) {
    throw new Error('Profile verification failed: No profile found');
  }

  const profile = profiles[0];
  console.log('   ✅ Profile verified:\n');
  console.log(`   User ID: ${profile.user_id}`);
  console.log(`   Email: ${profile.email}`);
  console.log(`   Username: ${profile.username}`);
  console.log(`   Display Name: ${profile.display_name}`);
  console.log(`   Role: ${profile.role}`);
  console.log(`   Created: ${profile.created_at}`);
  console.log(`   Updated: ${profile.updated_at}\n`);

  if (profile.role !== 'admin') {
    throw new Error(`Profile role mismatch: expected 'admin', got '${profile.role}'`);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting admin profile seed...\n');

  // Step 1: Get admin user
  const adminUser = await getAdminUser();

  // Step 2: Upsert profile
  await upsertAdminProfile(adminUser.id, adminUser.email);

  // Step 3: Verify profile
  await verifyProfile(adminUser.id);

  console.log('✅ Admin profile seeded and verified successfully\n');
}

// Execute
main()
  .then(() => {
    console.log('✅ Seed complete\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
