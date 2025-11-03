#!/usr/bin/env node
/**
 * Auth Diagnostics Script
 *
 * Purpose: Comprehensive diagnostics report with pass/fail checks for all auth configuration
 *
 * Usage:
 *   1. Ensure .env.admin has all required variables
 *   2. Run: tsx scripts/auth-diagnose.ts
 *
 * Checks:
 *   - Environment variables
 *   - Supabase connectivity
 *   - Admin user existence
 *   - Admin profile existence
 *   - Email/password sign-in
 *   - Auth configuration
 *   - Feature flags
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import fetch from 'node-fetch';

// Load .env.admin
dotenv.config({ path: path.resolve(process.cwd(), '.env.admin') });

// Also load .env for frontend variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const LOGIN_EMAIL = process.env.LOGIN_EMAIL;
const TEMP_PASSWORD = process.env.TEMP_PASSWORD;
const PUBLIC_URL = process.env.PUBLIC_URL;

// API endpoints
const AUTH_ADMIN_API = `${SUPABASE_URL}/auth/v1/admin`;
const AUTH_API = `${SUPABASE_URL}/auth/v1`;
const REST_API = `${SUPABASE_URL}/rest/v1`;

// Track results
const results: { check: string; status: 'PASS' | 'FAIL' | 'WARN'; message: string }[] = [];

function addCheck(check: string, status: 'PASS' | 'FAIL' | 'WARN', message: string) {
  results.push({ check, status, message });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} ${check}: ${message}`);
}

/**
 * Check 1: Environment Variables
 */
async function checkEnvironmentVariables() {
  console.log('\n📋 Checking Environment Variables...\n');

  if (SUPABASE_URL) {
    addCheck('SUPABASE_URL', 'PASS', SUPABASE_URL);
  } else {
    addCheck('SUPABASE_URL', 'FAIL', 'Missing');
  }

  if (SERVICE_ROLE_KEY) {
    addCheck('SUPABASE_SERVICE_ROLE', 'PASS', `${SERVICE_ROLE_KEY.slice(0, 20)}...`);
  } else {
    addCheck('SUPABASE_SERVICE_ROLE', 'FAIL', 'Missing');
  }

  if (SUPABASE_ANON_KEY) {
    addCheck('SUPABASE_ANON_KEY', 'PASS', `${SUPABASE_ANON_KEY.slice(0, 20)}...`);
  } else {
    addCheck('SUPABASE_ANON_KEY', 'FAIL', 'Missing (needed for sign-in verification)');
  }

  if (LOGIN_EMAIL) {
    addCheck('LOGIN_EMAIL', 'PASS', LOGIN_EMAIL);
  } else {
    addCheck('LOGIN_EMAIL', 'FAIL', 'Missing');
  }

  if (TEMP_PASSWORD) {
    addCheck('TEMP_PASSWORD', 'PASS', '*'.repeat(TEMP_PASSWORD.length));
  } else {
    addCheck('TEMP_PASSWORD', 'FAIL', 'Missing');
  }

  if (PUBLIC_URL) {
    addCheck('PUBLIC_URL', 'PASS', PUBLIC_URL);
  } else {
    addCheck('PUBLIC_URL', 'WARN', 'Missing (needed for frontend testing)');
  }
}

/**
 * Check 2: Supabase Connectivity
 */
async function checkSupabaseConnectivity() {
  console.log('\n🌐 Checking Supabase Connectivity...\n');

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      headers: {
        'apikey': SUPABASE_ANON_KEY!,
      },
    });

    if (response.ok || response.status === 404) {
      addCheck('Supabase API', 'PASS', 'Reachable');
    } else {
      addCheck('Supabase API', 'FAIL', `HTTP ${response.status}`);
    }
  } catch (error: any) {
    addCheck('Supabase API', 'FAIL', error.message);
  }
}

/**
 * Check 3: Admin User Existence
 */
async function checkAdminUser() {
  console.log('\n👤 Checking Admin User...\n');

  try {
    const response = await fetch(`${AUTH_ADMIN_API}/users`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY!,
      },
    });

    if (!response.ok) {
      addCheck('Admin User', 'FAIL', `Failed to fetch users: HTTP ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    const users = data.users || [];
    const adminUser = users.find((u: any) => u.email === LOGIN_EMAIL);

    if (adminUser) {
      addCheck('Admin User Exists', 'PASS', `Found: ${adminUser.email}`);
      addCheck('Admin User ID', 'PASS', adminUser.id);
      addCheck('Email Confirmed', adminUser.email_confirmed_at ? 'PASS' : 'FAIL',
        adminUser.email_confirmed_at ? 'Confirmed' : 'Not confirmed');
      return adminUser;
    } else {
      addCheck('Admin User', 'FAIL', `Not found: ${LOGIN_EMAIL}`);
      return null;
    }
  } catch (error: any) {
    addCheck('Admin User', 'FAIL', error.message);
    return null;
  }
}

/**
 * Check 4: Admin Profile Existence
 */
async function checkAdminProfile(userId: string | null) {
  console.log('\n📝 Checking Admin Profile...\n');

  if (!userId) {
    addCheck('Admin Profile', 'FAIL', 'Skipped (no admin user)');
    return;
  }

  try {
    const response = await fetch(`${REST_API}/profiles?user_id=eq.${userId}&select=*`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey': SERVICE_ROLE_KEY!,
      },
    });

    if (!response.ok) {
      addCheck('Admin Profile', 'FAIL', `HTTP ${response.status}`);
      return;
    }

    const profiles: any[] = await response.json();

    if (profiles.length === 0) {
      addCheck('Admin Profile', 'FAIL', 'Profile row not found in profiles table');
      return;
    }

    const profile = profiles[0];
    addCheck('Profile Exists', 'PASS', `Found for user ${userId}`);
    addCheck('Profile Email', 'PASS', profile.email);
    addCheck('Profile Username', 'PASS', profile.username || 'N/A');
    addCheck('Profile Role', profile.role === 'admin' ? 'PASS' : 'FAIL', profile.role || 'N/A');
  } catch (error: any) {
    addCheck('Admin Profile', 'FAIL', error.message);
  }
}

/**
 * Check 5: Email/Password Sign-In
 */
async function checkSignIn() {
  console.log('\n🔐 Checking Email/Password Sign-In...\n');

  if (!SUPABASE_ANON_KEY || !LOGIN_EMAIL || !TEMP_PASSWORD) {
    addCheck('Sign-In Test', 'FAIL', 'Missing credentials');
    return;
  }

  try {
    const response = await fetch(`${AUTH_API}/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: LOGIN_EMAIL,
        password: TEMP_PASSWORD,
      }),
    });

    const data: any = await response.json();

    if (!response.ok) {
      addCheck('Sign-In Test', 'FAIL', data.error_description || data.error || 'Unknown error');
      return;
    }

    addCheck('Sign-In Test', 'PASS', 'Successfully authenticated');
    addCheck('Access Token', 'PASS', `${data.access_token.slice(0, 20)}...`);
    addCheck('Token Type', 'PASS', data.token_type);
    addCheck('Expires In', 'PASS', `${data.expires_in}s`);
  } catch (error: any) {
    addCheck('Sign-In Test', 'FAIL', error.message);
  }
}

/**
 * Check 6: Feature Flags
 */
async function checkFeatureFlags() {
  console.log('\n🚩 Checking Feature Flags...\n');

  const envPath = path.resolve(process.cwd(), '.env');

  if (!fs.existsSync(envPath)) {
    addCheck('Feature Flags', 'WARN', '.env file not found');
    return;
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');

  const googleOAuthMatch = envContent.match(/VITE_ENABLE_GOOGLE_OAUTH\s*=\s*"?([^"\n]+)"?/);
  const magicLinkMatch = envContent.match(/VITE_ENABLE_MAGIC_LINK\s*=\s*"?([^"\n]+)"?/);

  const googleEnabled = googleOAuthMatch?.[1] === 'true';
  const magicEnabled = magicLinkMatch?.[1] === 'true';

  addCheck('Google OAuth', googleEnabled ? 'WARN' : 'PASS',
    googleEnabled ? 'Enabled (not recommended)' : 'Disabled');
  addCheck('Magic Link', magicEnabled ? 'PASS' : 'WARN',
    magicEnabled ? 'Enabled' : 'Disabled');
}

/**
 * Check 7: Auth Configuration Files
 */
async function checkAuthFiles() {
  console.log('\n📁 Checking Auth Configuration Files...\n');

  const files = [
    'src/lib/supabase.ts',
    'src/context/SupabaseAuthContext.tsx',
    'src/pages/Login.tsx',
    'src/pages/AuthCallback.tsx',
  ];

  for (const file of files) {
    const filePath = path.resolve(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      addCheck(file, 'PASS', 'Exists');
    } else {
      addCheck(file, 'FAIL', 'Missing');
    }
  }
}

/**
 * Check 8: PKCE Configuration
 */
async function checkPKCEConfig() {
  console.log('\n🔒 Checking PKCE Configuration...\n');

  const supabasePath = path.resolve(process.cwd(), 'src/lib/supabase.ts');

  if (!fs.existsSync(supabasePath)) {
    addCheck('PKCE Config', 'FAIL', 'supabase.ts not found');
    return;
  }

  const content = fs.readFileSync(supabasePath, 'utf-8');

  if (content.includes("flowType: 'pkce'")) {
    addCheck('PKCE Flow Type', 'PASS', 'Configured');
  } else {
    addCheck('PKCE Flow Type', 'FAIL', 'Not configured');
  }

  if (content.includes('detectSessionInUrl: true')) {
    addCheck('detectSessionInUrl', 'PASS', 'Enabled');
  } else {
    addCheck('detectSessionInUrl', 'WARN', 'Not explicitly enabled');
  }

  if (content.includes('storageKey:')) {
    addCheck('Unified Storage Key', 'PASS', 'Configured');
  } else {
    addCheck('Unified Storage Key', 'WARN', 'Not configured');
  }
}

/**
 * Generate Summary Report
 */
function generateSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('DIAGNOSTICS SUMMARY');
  console.log('='.repeat(80) + '\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warnings = results.filter(r => r.status === 'WARN').length;

  console.log(`Total Checks: ${results.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⚠️  Warnings: ${warnings}\n`);

  if (failed > 0) {
    console.log('❌ FAILED CHECKS:\n');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`   • ${r.check}: ${r.message}`);
    });
    console.log('');
  }

  if (warnings > 0) {
    console.log('⚠️  WARNINGS:\n');
    results.filter(r => r.status === 'WARN').forEach(r => {
      console.log(`   • ${r.check}: ${r.message}`);
    });
    console.log('');
  }

  console.log('='.repeat(80) + '\n');

  if (failed === 0 && warnings === 0) {
    console.log('🎉 ALL CHECKS PASSED! Authentication is properly configured.\n');
  } else if (failed === 0) {
    console.log('✅ All critical checks passed. Review warnings above.\n');
  } else {
    console.log('❌ Some checks failed. Review errors above and run fix scripts:\n');
    console.log('   1. tsx scripts/reset-auth-and-data.ts');
    console.log('   2. tsx scripts/seed-admin-profile.ts');
    console.log('   3. tsx scripts/verify-signin.ts\n');
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting Authentication Diagnostics...');
  console.log('Generated:', new Date().toISOString());

  await checkEnvironmentVariables();
  await checkSupabaseConnectivity();
  const adminUser = await checkAdminUser();
  await checkAdminProfile(adminUser?.id || null);
  await checkSignIn();
  await checkFeatureFlags();
  await checkAuthFiles();
  await checkPKCEConfig();

  generateSummary();
}

// Execute
main()
  .then(() => {
    const failed = results.filter(r => r.status === 'FAIL').length;
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error('\n❌ Diagnostics error:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
