import { Pool } from 'pg'
import * as fs from 'fs'
import * as path from 'path'
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
    console.log('Running migration: 20251223000000_email_templates.sql\n')

    const migrationPath = path.join(__dirname, '../../supabase/migrations/20251223000000_email_templates.sql')
    const sql = fs.readFileSync(migrationPath, 'utf8')

    // Execute the entire migration
    await client.query(sql)

    console.log('✅ Migration completed successfully!')

    // Verify the tables exist
    const { rows: tables } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('email_templates', 'email_logs')
    `)

    console.log('\nTables created:', tables.map(r => r.table_name).join(', '))

    // Check template count
    const { rows: templates } = await client.query(`
      SELECT template_key, name, ai_enabled, mr_imagine_enabled
      FROM email_templates
      ORDER BY template_key
    `)

    console.log('\nEmail templates seeded:')
    console.table(templates)

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
