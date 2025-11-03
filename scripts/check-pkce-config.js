#!/usr/bin/env node

/**
 * PKCE Configuration Health Check
 *
 * Validates that all PKCE OAuth configuration is correct before deployment.
 * Run this before testing the OAuth flow.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const checks = {
  passed: [],
  failed: [],
  warnings: []
};

function pass(message) {
  checks.passed.push(`✅ ${message}`);
}

function fail(message) {
  checks.failed.push(`❌ ${message}`);
}

function warn(message) {
  checks.warnings.push(`⚠️  ${message}`);
}

console.log('\n🔍 PKCE OAuth Configuration Health Check\n');
console.log('━'.repeat(50));

// Check 1: Supabase client configuration
try {
  const supabaseFile = readFileSync(join(rootDir, 'src/lib/supabase.ts'), 'utf-8');

  if (supabaseFile.includes("flowType: 'pkce'")) {
    pass('Supabase client has flowType: pkce');
  } else {
    fail('Supabase client missing flowType: pkce');
  }

  if (supabaseFile.includes('detectSessionInUrl: true')) {
    pass('Supabase client has detectSessionInUrl: true');
  } else {
    warn('Supabase client missing detectSessionInUrl: true (may cause issues)');
  }

  if (supabaseFile.includes('persistSession: true')) {
    pass('Supabase client has persistSession: true');
  } else {
    fail('Supabase client missing persistSession: true');
  }
} catch (error) {
  fail(`Cannot read src/lib/supabase.ts: ${error.message}`);
}

// Check 2: Auth context configuration
try {
  const authContextFile = readFileSync(join(rootDir, 'src/context/SupabaseAuthContext.tsx'), 'utf-8');

  if (authContextFile.includes('skipBrowserRedirect: true')) {
    pass('Google OAuth handler has skipBrowserRedirect: true (CRITICAL FIX)');
  } else {
    fail('Google OAuth handler MISSING skipBrowserRedirect: true (CRITICAL)');
  }

  if (authContextFile.includes('window.location.assign(data.url)')) {
    pass('Manual redirect after PKCE keys stored');
  } else {
    fail('Manual redirect missing after PKCE key storage');
  }

  // Note: flowType is set at the client level in supabase.ts, not in OAuth options
} catch (error) {
  fail(`Cannot read src/context/SupabaseAuthContext.tsx: ${error.message}`);
}

// Check 3: Auth callback implementation
try {
  const callbackFile = readFileSync(join(rootDir, 'src/pages/AuthCallback.tsx'), 'utf-8');

  if (callbackFile.includes('exchangeCodeForSession')) {
    pass('Auth callback uses exchangeCodeForSession');
  } else {
    fail('Auth callback missing exchangeCodeForSession');
  }

  if (callbackFile.includes('verifyPkceStorage')) {
    pass('Auth callback includes PKCE verification');
  } else {
    warn('Auth callback missing PKCE verification (QA feature)');
  }

  if (callbackFile.includes('setSession') && !callbackFile.includes('exchangeCodeForSession')) {
    fail('Auth callback uses setSession (implicit flow) instead of exchangeCodeForSession');
  } else {
    pass('Auth callback clean of implicit flow code');
  }
} catch (error) {
  fail(`Cannot read src/pages/AuthCallback.tsx: ${error.message}`);
}

// Check 4: PKCE verification utility exists
try {
  const pkceVerifyFile = readFileSync(join(rootDir, 'src/utils/verifyPkce.ts'), 'utf-8');

  if (pkceVerifyFile.includes('verifyPkceStorage')) {
    pass('PKCE verification utility exists');
  }

  if (pkceVerifyFile.includes('getPkceDebugInfo')) {
    pass('PKCE debug info utility exists');
  }
} catch (error) {
  warn('PKCE verification utility (src/utils/verifyPkce.ts) not found (optional QA feature)');
}

// Check 5: Environment variables reminder
warn('Remember to verify environment variables:');
console.log('   - VITE_SUPABASE_URL (format: https://<project-ref>.supabase.co)');
console.log('   - VITE_SUPABASE_ANON_KEY');

// Print results
console.log('\n' + '━'.repeat(50));
console.log('\n📊 Results:\n');

if (checks.passed.length > 0) {
  console.log('Passed Checks:');
  checks.passed.forEach(msg => console.log(`  ${msg}`));
  console.log('');
}

if (checks.warnings.length > 0) {
  console.log('Warnings:');
  checks.warnings.forEach(msg => console.log(`  ${msg}`));
  console.log('');
}

if (checks.failed.length > 0) {
  console.log('Failed Checks:');
  checks.failed.forEach(msg => console.log(`  ${msg}`));
  console.log('');
}

console.log('━'.repeat(50));

// Exit with appropriate code
if (checks.failed.length > 0) {
  console.log('\n❌ Configuration check FAILED. Please fix the issues above.\n');
  process.exit(1);
} else if (checks.warnings.length > 0) {
  console.log('\n⚠️  Configuration check passed with warnings.\n');
  process.exit(0);
} else {
  console.log('\n✅ All checks passed! PKCE configuration looks good.\n');
  process.exit(0);
}
