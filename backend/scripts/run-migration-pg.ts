import { Pool } from 'pg'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('Missing DATABASE_URL')
  process.exit(1)
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
})

async function runMigration() {
  const client = await pool.connect()

  try {
    console.log('✅ Connected to database')
    console.log('Running migration: 20251209000000_product_assets_role_columns.sql\n')

    const sql = fs.readFileSync('../supabase/migrations/20251209000000_product_assets_role_columns.sql', 'utf8')

    // Execute the entire migration
    await client.query(sql)

    console.log('✅ Migration completed successfully!')

    // Verify the columns exist
    const { rows } = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'product_assets'
      AND column_name IN ('asset_role', 'is_primary', 'display_order')
    `)

    console.log('\nNew columns verified:', rows.map(r => r.column_name).join(', '))

    // Check backfill results
    const { rows: stats } = await client.query(`
      SELECT
        asset_role,
        COUNT(*) as count,
        SUM(CASE WHEN is_primary THEN 1 ELSE 0 END) as primary_count
      FROM product_assets
      GROUP BY asset_role
      ORDER BY asset_role
    `)

    console.log('\nAsset distribution after backfill:')
    console.table(stats)

  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

runMigration().catch(err => {
  console.error(err)
  process.exit(1)
})
