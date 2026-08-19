import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../backend/.env'), override: true });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const testEmail = `test_${Date.now()}@example.com`;
const testPassword = 'TestPassword123!';

async function testAuthFlow() {
  const results = {
    signup: false,
    profile: false,
    wallet: false,
    referralCode: false,
    signin: false,
    signout: false
  };

  const details = {
    testEmail: testEmail,
    userId: null,
    profileData: null,
    walletData: null,
    errors: []
  };

  console.log('🧪 Testing Complete Auth Flow');
  console.log('================================');
  console.log(`Test Email: ${testEmail}`);
  console.log(`Test Password: ${testPassword}`);

  // Test 1: Sign Up
  console.log('\n1. Testing Sign Up...');
  try {
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: testEmail,
      password: testPassword,
      options: {
        data: {
          full_name: 'Test User'
        }
      }
    });

    if (signUpError) {
      console.error('❌ Sign up failed:', signUpError.message);
      details.errors.push(`Signup: ${signUpError.message}`);
    } else if (signUpData.user) {
      console.log('✅ Sign up successful');
      console.log('   User ID:', signUpData.user.id);
      console.log('   Email:', signUpData.user.email);
      results.signup = true;
      details.userId = signUpData.user.id;
    }
  } catch (err) {
    console.error('❌ Sign up error:', err.message);
    details.errors.push(`Signup Exception: ${err.message}`);
  }

  // Wait a moment for triggers to execute
  if (results.signup) {
    console.log('\n   Waiting 2 seconds for database triggers...');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Test 2: Check Profile Created
  if (results.signup && details.userId) {
    console.log('\n2. Checking user profile...');
    try {
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', details.userId)
        .single();

      if (profileError) {
        console.error('❌ Profile not found:', profileError.message);
        details.errors.push(`Profile: ${profileError.message}`);
      } else if (profile) {
        console.log('✅ Profile created successfully');
        console.log('   Email:', profile.email);
        console.log('   Full Name:', profile.full_name);
        console.log('   Role:', profile.role);
        console.log('   Referral Code:', profile.referral_code);
        results.profile = true;
        details.profileData = profile;

        // Check referral code
        if (profile.referral_code) {
          console.log('✅ Referral code generated:', profile.referral_code);
          results.referralCode = true;
        } else {
          console.log('❌ Referral code not generated');
          details.errors.push('Referral code missing');
        }
      }
    } catch (err) {
      console.error('❌ Profile check error:', err.message);
      details.errors.push(`Profile Exception: ${err.message}`);
    }
  }

  // Test 3: Check Wallet Created
  if (results.signup && details.userId) {
    console.log('\n3. Checking user wallet...');
    try {
      const { data: wallet, error: walletError } = await supabase
        .from('user_wallets')
        .select('*')
        .eq('user_id', details.userId)
        .single();

      if (walletError) {
        console.error('❌ Wallet not found:', walletError.message);
        details.errors.push(`Wallet: ${walletError.message}`);
      } else if (wallet) {
        console.log('✅ Wallet created successfully');
        console.log('   ITC Balance:', wallet.itc_balance);
        console.log('   USD Balance:', wallet.usd_balance);
        console.log('   Total Earned:', wallet.total_earned);
        console.log('   Total Spent:', wallet.total_spent);

        // Verify balances are 0.00
        if (parseFloat(wallet.itc_balance) === 0.00 && parseFloat(wallet.usd_balance) === 0.00) {
          console.log('✅ Wallet initialized with 0.00 balances');
          results.wallet = true;
          details.walletData = wallet;
        } else {
          console.log('❌ Wallet balances not initialized to 0.00');
          details.errors.push('Wallet balances incorrect');
        }
      }
    } catch (err) {
      console.error('❌ Wallet check error:', err.message);
      details.errors.push(`Wallet Exception: ${err.message}`);
    }
  }

  // Test 4: Sign Out
  console.log('\n4. Testing Sign Out...');
  try {
    await supabase.auth.signOut();
    console.log('✅ Signed out successfully');
    results.signout = true;
  } catch (err) {
    console.error('❌ Sign out error:', err.message);
    details.errors.push(`Signout: ${err.message}`);
  }

  // Test 5: Sign In
  console.log('\n5. Testing Sign In...');
  try {
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: testEmail,
      password: testPassword
    });

    if (signInError) {
      console.error('❌ Sign in failed:', signInError.message);
      details.errors.push(`Signin: ${signInError.message}`);
    } else if (signInData.user) {
      console.log('✅ Sign in successful');
      console.log('   User ID:', signInData.user.id);
      console.log('   Session:', signInData.session ? 'Active' : 'None');
      results.signin = true;
    }
  } catch (err) {
    console.error('❌ Sign in error:', err.message);
    details.errors.push(`Signin Exception: ${err.message}`);
  }

  // Test 6: Final Sign Out
  console.log('\n6. Testing Final Sign Out...');
  try {
    await supabase.auth.signOut();
    console.log('✅ Final sign out successful');
  } catch (err) {
    console.error('❌ Final sign out error:', err.message);
  }

  // Summary
  console.log('\n================================');
  console.log('📊 Test Results Summary:');
  console.log(`  Sign Up: ${results.signup ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Profile Created: ${results.profile ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Wallet Created: ${results.wallet ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Referral Code Generated: ${results.referralCode ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Sign In: ${results.signin ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Sign Out: ${results.signout ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = Object.values(results).every(r => r === true);
  console.log(`\nOverall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  if (details.errors.length > 0) {
    console.log('\n❌ Errors Encountered:');
    details.errors.forEach(err => console.log(`   - ${err}`));
  }

  return { results, details, allPassed };
}

testAuthFlow().then(({ results, details, allPassed }) => {
  process.exit(allPassed ? 0 : 1);
});
