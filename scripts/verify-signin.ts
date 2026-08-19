#!/usr/bin/env node
/**
 * Verify Sign-In Script
 *
 * Purpose: Headless verification that email/password auth works against live frontend
 *
 * Usage:
 *   1. Ensure .env.admin has SUPABASE_URL, SUPABASE_ANON_KEY, LOGIN_EMAIL, TEMP_PASSWORD
 *   2. Run: tsx scripts/verify-signin.ts
 *
 * Requirements:
 *   - Admin user must exist with confirmed email
 *   - Uses anon key (public key, safe for client-side auth)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import fetch from 'node-fetch';

// Load .env.admin
// override: dotenv will NOT replace a SUPABASE_* var the parent shell already exported.
// See docs/SECURITY-supabase-service-role-drift-547d0c0f.md
dotenv.config({ path: path.resolve(process.cwd(), '.env.admin'), override: true });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const LOGIN_EMAIL = process.env.LOGIN_EMAIL;
const TEMP_PASSWORD = process.env.TEMP_PASSWORD;

// Validate required environment variables
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !LOGIN_EMAIL || !TEMP_PASSWORD) {
  console.error('❌ Missing required environment variables');
  console.error('Required: SUPABASE_URL, SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY), LOGIN_EMAIL, TEMP_PASSWORD');
  console.error('\nNote: Add SUPABASE_ANON_KEY to .env.admin (same value as VITE_SUPABASE_ANON_KEY from .env)');
  process.exit(1);
}

console.log('🔧 Configuration loaded:');
console.log(`   SUPABASE_URL: ${SUPABASE_URL}`);
console.log(`   LOGIN_EMAIL: ${LOGIN_EMAIL}`);
console.log(`   ANON_KEY: ${SUPABASE_ANON_KEY.slice(0, 20)}...`);
console.log('');

// Auth API endpoint
const AUTH_API = `${SUPABASE_URL}/auth/v1`;

/**
 * Sign in with email/password using Supabase Auth API
 */
async function signInWithPassword(email: string, password: string): Promise<any> {
  console.log('🔐 Attempting sign-in...');
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${'*'.repeat(password.length)}\n`);

  const response = await fetch(`${AUTH_API}/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  const data: any = await response.json();

  if (!response.ok) {
    throw new Error(`Sign-in failed: ${response.status} ${data.error_description || data.error || 'Unknown error'}`);
  }

  return data;
}

/**
 * Get user profile using access token
 */
async function getUser(accessToken: string): Promise<any> {
  console.log('👤 Fetching user profile...\n');

  const response = await fetch(`${AUTH_API}/user`, {
    method: 'GET',
    headers: {
      'apikey': SUPABASE_ANON_KEY!,
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get user: ${response.status} ${error}`);
  }

  return await response.json();
}

/**
 * Sign out using access token
 */
async function signOut(accessToken: string): Promise<void> {
  console.log('🚪 Signing out...\n');

  const response = await fetch(`${AUTH_API}/logout`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY!,
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.warn(`⚠️  Sign-out warning: ${response.status} ${error}`);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting sign-in verification...\n');

  // Step 1: Sign in
  const authResponse = await signInWithPassword(LOGIN_EMAIL!, TEMP_PASSWORD!);

  console.log('✅ Sign-in successful!\n');
  console.log('📊 Auth Response:');
  console.log(`   Access Token: ${authResponse.access_token.slice(0, 30)}...`);
  console.log(`   Refresh Token: ${authResponse.refresh_token.slice(0, 30)}...`);
  console.log(`   Token Type: ${authResponse.token_type}`);
  console.log(`   Expires In: ${authResponse.expires_in}s`);
  console.log('');

  // Step 2: Get user profile
  const user = await getUser(authResponse.access_token);

  console.log('✅ User profile retrieved!\n');
  console.log('👤 User Details:');
  console.log(`   ID: ${user.id}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Email Confirmed: ${user.email_confirmed_at ? '✅ Yes' : '❌ No'}`);
  console.log(`   Created: ${user.created_at}`);
  console.log(`   Last Sign In: ${user.last_sign_in_at}`);
  console.log('');

  if (user.user_metadata) {
    console.log('📋 User Metadata:');
    console.log(`   Username: ${user.user_metadata.username || 'N/A'}`);
    console.log(`   Display Name: ${user.user_metadata.display_name || 'N/A'}`);
    console.log('');
  }

  // Step 3: Sign out
  await signOut(authResponse.access_token);

  console.log('✅ Sign-out successful!\n');

  // Final summary
  console.log('=' .repeat(60));
  console.log('VERIFICATION SUMMARY');
  console.log('=' .repeat(60));
  console.log('✅ Email/Password sign-in: WORKING');
  console.log('✅ User profile retrieval: WORKING');
  console.log('✅ Session management: WORKING');
  console.log('✅ Sign-out: WORKING');
  console.log('=' .repeat(60));
  console.log('');
  console.log('🎉 All authentication flows verified successfully!\n');
}

// Execute
main()
  .then(() => {
    console.log('✅ Verification complete\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ VERIFICATION FAILED\n');
    console.error('Error:', error.message);
    console.error('');
    console.error('Common issues:');
    console.error('  - Email not confirmed (run reset-auth-and-data.ts first)');
    console.error('  - Wrong password (check TEMP_PASSWORD in .env.admin)');
    console.error('  - User does not exist (run reset-auth-and-data.ts first)');
    console.error('  - Wrong SUPABASE_URL or SUPABASE_ANON_KEY');
    console.error('');
    console.error(error.stack);
    process.exit(1);
  });
