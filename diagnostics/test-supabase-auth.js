// Test Supabase authentication directly
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('🔍 Testing Supabase connection...\n');
console.log('Configuration:');
console.log('- URL:', supabaseUrl);
console.log('- Key (last 8 chars):', supabaseAnonKey ? `...${supabaseAnonKey.slice(-8)}` : 'MISSING');
console.log('');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Test 1: Check if we can reach Supabase
async function testConnection() {
  console.log('📡 Test 1: Checking Supabase connection...');
  try {
    const { data, error } = await supabase.from('user_profiles').select('count', { count: 'exact', head: true });

    if (error) {
      console.error('❌ Database query failed:', error.message);
      console.error('   Details:', error);
      return false;
    }

    console.log('✅ Successfully connected to Supabase database');
    return true;
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    return false;
  }
}

// Test 2: Try to sign in with test credentials
async function testSignIn() {
  console.log('\n🔐 Test 2: Testing authentication...');

  // Try signing up a test user (in case it doesn't exist)
  const testEmail = 'test@example.com';
  const testPassword = 'TestPassword123!';

  console.log('   Attempting test sign-in with:', testEmail);

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (signInError) {
    console.log('   Sign-in failed (expected if user doesn\'t exist):', signInError.message);

    // Try to create the test user
    console.log('   Attempting to create test user...');
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: testEmail,
      password: testPassword,
      options: {
        data: {
          username: 'testuser',
          display_name: 'Test User',
        }
      }
    });

    if (signUpError) {
      console.error('❌ Sign-up also failed:', signUpError.message);
      return false;
    }

    if (signUpData.user) {
      console.log('✅ Test user created successfully');
      console.log('   User ID:', signUpData.user.id);
      console.log('   Note: Email confirmation may be required');
      return true;
    }
  } else if (signInData.user) {
    console.log('✅ Sign-in successful!');
    console.log('   User ID:', signInData.user.id);
    console.log('   Email:', signInData.user.email);

    // Sign out the test user
    await supabase.auth.signOut();
    console.log('   Signed out test user');
    return true;
  }

  return false;
}

// Test 3: Check auth configuration
async function testAuthConfig() {
  console.log('\n⚙️  Test 3: Checking auth configuration...');

  try {
    // Check if email confirmations are required
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      console.log('   Session check error:', error.message);
    } else {
      console.log('✅ Auth session API is accessible');
    }

    // Test OAuth provider configuration
    console.log('\n   OAuth providers:');
    console.log('   - Google OAuth redirect URL should be:');
    console.log(`     ${supabaseUrl}/auth/v1/callback`);
    console.log('   - Make sure this is added to your Google OAuth app');

    return true;
  } catch (error) {
    console.error('❌ Auth config check failed:', error.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('🚀 Starting Supabase authentication tests\n');
  console.log('=' .repeat(50));

  const connectionOk = await testConnection();
  if (!connectionOk) {
    console.log('\n⚠️  Cannot proceed with other tests - connection failed');
    process.exit(1);
  }

  await testSignIn();
  await testAuthConfig();

  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary:');
  console.log('- Database connection: ✅ Working');
  console.log('- Authentication: Check results above');
  console.log('- Next steps: Review any errors and check Supabase dashboard settings');

  console.log('\n💡 Common issues to check:');
  console.log('1. Email confirmations enabled? Check Supabase Auth settings');
  console.log('2. Database tables exist? Check if user_profiles table is created');
  console.log('3. RLS policies configured? Check Supabase table permissions');
  console.log('4. OAuth providers configured? Check Supabase Auth providers');
}

runTests().catch(console.error);