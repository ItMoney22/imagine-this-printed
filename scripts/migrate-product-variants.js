import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Explicit module-relative path + override: the old form was cwd-relative (broken
// unless run from scripts/) and non-overriding (lost to the parent shell).
dotenv.config({ path: path.resolve(fileURLToPath(import.meta.url), '../../backend/.env'), override: true });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrate() {
  try {
    // Check if columns exist first
    const { data: columns, error: checkError } = await supabase
      .from('products')
      .select('sizes, colors')
      .limit(1);

    if (!checkError) {
      console.log('Columns already exist: sizes and colors');
      process.exit(0);
    }

    // If error, columns don't exist - we need to add them via SQL
    // Since Supabase JS can't run DDL, we'll use the REST SQL endpoint
    console.log('Columns need to be added via Supabase Dashboard or direct SQL connection');
    console.log('SQL to run:');
    console.log(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS sizes TEXT[] DEFAULT '{}';

      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS colors TEXT[] DEFAULT '{}';
    `);
  } catch (err) {
    console.error('Error:', err.message);
  }
}
migrate();
