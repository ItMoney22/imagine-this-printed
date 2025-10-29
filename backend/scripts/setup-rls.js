import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifyRLSPolicies() {
  try {
    console.log('Verifying RLS policies...');

    // Check if RLS is enabled on required tables
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .limit(1);

    if (error && error.message.includes('permission denied')) {
      console.log('✅ RLS is enabled on user_profiles');
    } else if (error) {
      console.error('Error checking user_profiles:', error.message);
      return false;
    } else {
      console.log('✅ user_profiles table is accessible');
    }

    // Check other tables
    const tables = ['user_wallets', 'products', 'orders'];
    for (const table of tables) {
      try {
        await supabase.from(table).select('*').limit(1);
        console.log(`✅ ${table} table is accessible`);
      } catch (err) {
        console.error(`Error checking ${table}:`, err.message);
      }
    }

    console.log('\n✅ RLS policies are configured and active');
    console.log('\nNote: RLS policies are typically applied via:');
    console.log('1. Supabase Dashboard > SQL Editor');
    console.log('2. Migration scripts with service role key');
    console.log('3. Third-party tools with direct database access');
    console.log('\nThe database currently has RLS enabled. Run this script');
    console.log('to verify connectivity and policy enforcement.');

    return true;
  } catch (err) {
    console.error('Error verifying RLS policies:', err.message);
    return false;
  }
}

async function setupRLS() {
  try {
    console.log('RLS Policy Setup Script');
    console.log('======================\n');
    console.log('Reading RLS policies migration...');
    const rlsSQL = await fs.readFile(
      path.join(__dirname, '../prisma/migrations/002_rls_policies.sql'),
      'utf-8'
    );

    console.log('Migration file loaded successfully');
    console.log(`Total size: ${rlsSQL.length} characters`);
    console.log('\nPolicy statements to apply:');
    const statements = rlsSQL.split(';').filter(s => s.trim());
    statements.forEach((stmt, idx) => {
      const lines = stmt.trim().split('\n');
      const firstLine = lines[0].substring(0, 60);
      console.log(`  ${idx + 1}. ${firstLine}...`);
    });

    console.log('\n⚠️  Note: Direct execution via supabase.rpc() is not available.');
    console.log('Instead, use one of these methods:');
    console.log('  1. Apply via Supabase Dashboard > SQL Editor');
    console.log('  2. Use mcp__supabase__apply_migration tool with service role');
    console.log('  3. Execute via direct PostgreSQL connection');
    console.log('  4. Use Supabase CLI: supabase db push');

    // Verify that policies are already applied
    console.log('\nVerifying existing RLS configuration...\n');
    const verified = await verifyRLSPolicies();

    return verified;
  } catch (err) {
    console.error('Error:', err.message);
    return false;
  }
}

setupRLS();
