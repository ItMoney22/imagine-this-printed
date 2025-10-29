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
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifyTables() {
  try {
    console.log('\nVerifying core tables...');
    const tables = ['user_profiles', 'user_wallets', 'products', 'orders'];
    let allExist = true;

    for (const table of tables) {
      try {
        const { error } = await supabase.from(table).select('*').limit(1);
        if (error) throw error;
        console.log(`  ✅ ${table} exists`);
      } catch (err) {
        console.log(`  ❌ ${table} missing`);
        allExist = false;
      }
    }

    return allExist;
  } catch (err) {
    console.error('Verification error:', err);
    return false;
  }
}

async function runMigration() {
  try {
    console.log('Reading migration file...');
    const migrationSQL = await fs.readFile(
      path.join(__dirname, '../prisma/migrations/001_initial_schema.sql'),
      'utf-8'
    );

    console.log('Attempting to run migration...');
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: migrationSQL
    });

    if (error) {
      // Tables might already exist - verify them instead
      console.log('Note: Migration via RPC not available. Verifying existing tables...');
      const tablesExist = await verifyTables();

      if (tablesExist) {
        console.log('\n✅ All core database tables already exist');
        console.log('\nDatabase schema verification complete:');
        console.log('  - user_profiles: Ready for user data');
        console.log('  - user_wallets: Ready for wallet operations');
        console.log('  - products: Ready for product listings');
        console.log('  - orders: Ready for order management');
        return true;
      } else {
        console.error('❌ Migration failed and core tables missing:', error);
        return false;
      }
    }

    console.log('✅ Database schema created successfully');
    return true;
  } catch (err) {
    console.error('Error:', err);
    return false;
  }
}

runMigration();
