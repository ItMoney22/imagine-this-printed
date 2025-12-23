import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../backend/.env') });

const { Pool } = pg;

async function createFunction() {
  const url = process.env.DATABASE_URL;
  const match = url?.match(/postgresql:\/\/([^:]+):([^@]+)@/);
  const password = match?.[2];

  // Supabase pooler connection string (Session mode, port 5432)
  const dbUrl = `postgresql://postgres.czzyrmizvjqlifcivrhn:${password}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;

  console.log('Connecting to Supabase pooler...');
  console.log('Password found:', password ? 'Yes' : 'No');

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  const sql = `
    CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
    RETURNS TEXT AS $func$
    DECLARE
      user_role TEXT;
    BEGIN
      SELECT role INTO user_role
      FROM public.user_profiles
      WHERE id = user_id;
      RETURN COALESCE(user_role, 'customer');
    END;
    $func$ LANGUAGE plpgsql SECURITY DEFINER;
  `;

  try {
    await pool.query(sql);
    console.log('✅ get_user_role function created');

    await pool.query('GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated');
    await pool.query('GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO anon');
    console.log('✅ Permissions granted');

    const result = await pool.query("SELECT public.get_user_role('00000000-0000-0000-0000-000000000000')");
    console.log('✅ Function test result:', result.rows[0]);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

createFunction();
