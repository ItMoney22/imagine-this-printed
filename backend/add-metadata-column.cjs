const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addMetadataColumn() {
  console.log('🔧 Adding metadata column to product_assets table...\n');

  try {
    // Execute the SQL using the PostgREST admin endpoint
    const sql = `
ALTER TABLE product_assets
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN product_assets.metadata IS 'Stores AI model information (model_id, model_name, generated_at)';

CREATE INDEX IF NOT EXISTS idx_product_assets_metadata ON product_assets USING GIN (metadata);
    `.trim();

    console.log('Executing SQL:');
    console.log(sql);
    console.log('');

    // Use Supabase SQL query execution
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: sql })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('❌ Error response:', text);

      // Try direct postgres connection
      console.log('\n🔄 Trying direct database connection...\n');

      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL
      });

      const client = await pool.connect();

      try {
        await client.query(sql);
        console.log('✅ Metadata column added successfully via direct connection!');
      } finally {
        client.release();
        await pool.end();
      }
    } else {
      console.log('✅ Metadata column added successfully!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

addMetadataColumn();
