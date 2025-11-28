import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load backend .env
dotenv.config({ path: join(__dirname, '../backend/.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTables() {
  const tables = [
    'user_profiles',
    'user_wallets',
    'products',
    'orders',
    'referral_codes',
    'itc_transactions',
    'points_transactions'
  ];

  console.log('Checking for existence of key tables...');
  
  let allExist = true;

  for (const table of tables) {
    // Try to select 0 rows, just to check if table exists (if it doesn't, it should error)
    const { error } = await supabase.from(table).select('count', { count: 'exact', head: true });
    
    if (error) {
      // Code 42P01 is "relation does not exist" in Postgres, but Supabase API might return 404 or other error
      if (error.message.includes('does not exist') || error.code === '42P01' || error.code === 'PGRST200') {
        console.error(`❌ Table '${table}' NOT FOUND.`);
        allExist = false;
      } else {
        console.log(`✅ Table '${table}' exists (or access allowed).`);
      }
    } else {
      console.log(`✅ Table '${table}' exists.`);
    }
  }

  if (allExist) {
    console.log('\nAll checked tables appear to exist.');
  } else {
    console.log('\n❌ Some tables are missing.');
  }
}

checkTables();
