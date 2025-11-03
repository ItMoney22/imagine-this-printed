#!/usr/bin/env node
/**
 * Verify Live Sign-In Script
 *
 * Purpose: Test email/password auth via REST API + provide instructions for browser test
 *
 * Usage:
 *   1. Ensure .env.admin has all required variables
 *   2. Run: tsx scripts/verify-signin-live.ts
 *   3. Follow browser instructions to complete live test
 *
 * What it does:
 *   - Checks frontend is reachable
 *   - Tests email/password auth via Supabase Auth REST API
 *   - Provides instructions for manual browser test
 */

import 'dotenv/config';
import fetch from 'node-fetch';

const base = process.env.SUPABASE_URL!;
const anon = process.env.SUPABASE_ANON_KEY!;
const site = process.env.PUBLIC_URL!;
const email = process.env.LOGIN_EMAIL!;
const pass = process.env.TEMP_PASSWORD!;

// Validate environment
if (!base || !anon || !site || !email || !pass) {
  console.error('❌ Missing required environment variables in .env.admin');
  console.error('Required: SUPABASE_URL, SUPABASE_ANON_KEY, PUBLIC_URL, LOGIN_EMAIL, TEMP_PASSWORD');
  process.exit(1);
}

console.log('🔧 Configuration:');
console.log(`   SUPABASE_URL: ${base}`);
console.log(`   PUBLIC_URL: ${site}`);
console.log(`   LOGIN_EMAIL: ${email}`);
console.log(`   ANON_KEY: ${anon.slice(0, 20)}...`);
console.log('');

async function main() {
  // Step 1: Check frontend is reachable
  console.log('🌐 Checking frontend reachability...');
  console.log(`   URL: ${site}/login`);

  try {
    const loginPage = await fetch(`${site}/login`);
    if (loginPage.ok) {
      console.log('   ✅ Login page reachable (HTTP 200)\n');
    } else {
      console.warn(`   ⚠️  Login page returned HTTP ${loginPage.status}\n`);
    }
  } catch (err: any) {
    console.error('   ❌ Login page not reachable:', err.message);
    console.error('   Make sure the site is deployed and accessible\n');
  }

  // Step 2: Test email/password auth via REST API
  console.log('🔐 Testing email/password auth via Supabase Auth REST API...');
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${'*'.repeat(pass.length)}\n`);

  try {
    const authResponse = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anon
      },
      body: JSON.stringify({
        email,
        password: pass
      })
    });

    const statusOk = authResponse.ok;
    const body: any = await authResponse.json();

    if (statusOk) {
      console.log('   ✅ Auth REST API: SUCCESS');
      console.log(`   Status: ${authResponse.status}`);
      console.log(`   Access Token: ${body.access_token?.slice(0, 30)}...`);
      console.log(`   User ID: ${body.user?.id}`);
      console.log(`   User Email: ${body.user?.email}`);
      console.log('');
    } else {
      console.error('   ❌ Auth REST API: FAILED');
      console.error(`   Status: ${authResponse.status}`);
      console.error(`   Error: ${body.error || 'Unknown'}`);
      console.error(`   Description: ${body.error_description || 'No description'}`);
      console.error('');
      throw new Error('REST auth failed — check Email/Password provider in Supabase Dashboard');
    }
  } catch (err: any) {
    console.error('❌ REST API test failed:', err.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  1. Verify Email/Password provider is enabled in Supabase Dashboard');
    console.error('  2. Verify admin user exists: tsx scripts/hard-reset-auth.ts');
    console.error('  3. Check SUPABASE_ANON_KEY is correct');
    console.error('  4. Check LOGIN_EMAIL and TEMP_PASSWORD match admin user');
    console.error('');
    process.exit(1);
  }

  // Step 3: Browser test instructions
  console.log('=' .repeat(70));
  console.log('MANUAL BROWSER TEST REQUIRED');
  console.log('=' .repeat(70));
  console.log('');
  console.log('✅ Server-side auth REST API works!');
  console.log('');
  console.log('Now test the live sign-in flow in your browser:');
  console.log('');
  console.log('1. Open an INCOGNITO/PRIVATE browser window');
  console.log('');
  console.log('2. Navigate to:');
  console.log(`   ${site}/login`);
  console.log('');
  console.log('3. Enter credentials:');
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${pass}`);
  console.log('');
  console.log('4. Click "Sign In"');
  console.log('');
  console.log('5. Expected behavior:');
  console.log('   ✅ Redirects to homepage (/)');
  console.log('   ✅ Shows user as logged in');
  console.log('   ✅ localStorage contains: sb-<ref>-auth-token');
  console.log('');
  console.log('6. Open DevTools → Application → Local Storage');
  console.log('   Verify auth token is present');
  console.log('');
  console.log('7. Take screenshot of:');
  console.log('   - Logged in homepage');
  console.log('   - localStorage with auth token');
  console.log('');
  console.log('=' .repeat(70));
  console.log('');
  console.log('After successful browser test, run:');
  console.log('  tsx scripts/auth-diagnose.ts');
  console.log('');
}

main()
  .then(() => {
    console.log('✅ Verification complete\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Verification failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
