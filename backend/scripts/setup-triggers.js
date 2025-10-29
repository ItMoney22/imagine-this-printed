import * as dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('Missing required environment variable: DATABASE_URL');
  process.exit(1);
}

async function setupTriggers() {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
  });

  try {
    console.log('🔧 Setting up user profile triggers...\n');

    console.log('Reading triggers SQL...');
    const triggersSQL = await fs.readFile(
      path.join(__dirname, '../prisma/migrations/003_user_triggers.sql'),
      'utf-8'
    );

    console.log('Connecting to database...');
    const client = await pool.connect();

    try {
      console.log('Creating triggers in database...\n');

      // Execute the entire SQL file at once
      await client.query(triggersSQL);

      console.log('✅ User triggers created successfully!');
      console.log('\nTriggers configured:');
      console.log('  1. handle_new_user() function - Creates user_profiles and user_wallets on signup');
      console.log('  2. on_auth_user_created trigger - Executes on auth.users INSERT');
      console.log('  3. handle_user_delete() function - Cascades deletion of related data');
      console.log('  4. on_auth_user_deleted trigger - Executes on auth.users DELETE');
      console.log('\nKey features:');
      console.log('  - User profile created automatically on signup with email and full_name');
      console.log('  - User wallet created with 0.00 ITC and USD balances');
      console.log('  - Unique 8-character referral code generated from MD5 hash');
      console.log('  - Deletion of auth.users cascades to user_profiles and related tables');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Error setting up triggers:', err.message);
    if (err.detail) {
      console.error('Details:', err.detail);
    }
    return false;
  } finally {
    await pool.end();
  }
}

// Run setup
setupTriggers().then(success => {
  if (!success) {
    console.log('\n📋 MANUAL SETUP INSTRUCTIONS:');
    console.log('================================');
    console.log('\nIf direct database connection is not available, apply triggers manually:');
    console.log('\n1. Open Supabase Dashboard: https://app.supabase.com');
    console.log('2. Select your project: imagine-this-printed');
    console.log('3. Click "SQL Editor" in the left sidebar');
    console.log('4. Click "New Query"');
    console.log('5. Open file: backend/prisma/migrations/003_user_triggers.sql');
    console.log('6. Copy and paste the SQL into the editor');
    console.log('7. Click "Run"');
    console.log('\nFor detailed instructions, see: docs/TASK-5-TRIGGERS-SETUP.md');
  }
  process.exit(success ? 0 : 1);
});
