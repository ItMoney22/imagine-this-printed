// Helper script to get a valid user JWT token from Supabase
// Usage: node get-user-token.mjs <email> <password>

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://czzyrmizvjqlifcivrhn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6enlybWl6dmpxbGlmY2l2cmhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI0Mjk2MDMsImV4cCI6MjA2ODAwNTYwM30.x81uOOyApsnues3CA7QJeETIypgk0rBvC_bzxlZ_VGs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getUserToken(email, password) {
  console.log('\n🔐 Getting user token from Supabase...');
  console.log(`Email: ${email}`);

  try {
    // Sign in
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('\n❌ Authentication failed:', error.message);
      process.exit(1);
    }

    if (!data.session) {
      console.error('\n❌ No session returned');
      process.exit(1);
    }

    console.log('\n✅ Authentication successful!');
    console.log('\nUser ID:', data.user.id);
    console.log('Email:', data.user.email);
    console.log('\n📋 Access Token (copy this):');
    console.log('─'.repeat(80));
    console.log(data.session.access_token);
    console.log('─'.repeat(80));
    console.log('\n💡 Usage:');
    console.log('export USER_TOKEN="' + data.session.access_token + '"');
    console.log('\nOr in your test script:');
    console.log('const USER_TOKEN = "' + data.session.access_token + '";');
    console.log('\n⏰ Token expires at:', new Date(data.session.expires_at * 1000).toLocaleString());
    console.log('🔄 Refresh token available:', !!data.session.refresh_token);
    console.log('');

    // Sign out to clean up
    await supabase.auth.signOut();

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('\n📖 Usage: node get-user-token.mjs <email> <password>');
  console.log('\nExample:');
  console.log('  node get-user-token.mjs test@example.com mypassword123');
  console.log('');
  process.exit(1);
}

const [email, password] = args;
getUserToken(email, password);
