/**
 * Apply admin_settings table migration to Supabase
 * Run with: npx tsx scripts/apply-admin-settings-migration.ts
 */

import { supabase } from '../lib/supabase.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function applyMigration() {
  console.log('🚀 Applying admin_settings migration...\n')

  try {
    // Read migration SQL
    const migrationPath = path.join(__dirname, '../migrations/create_admin_settings.sql')
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8')

    console.log('📄 Migration SQL:')
    console.log('─'.repeat(80))
    console.log(migrationSQL)
    console.log('─'.repeat(80))
    console.log()

    // Execute migration using Supabase SQL RPC
    // Note: This requires service role key
    const { data, error } = await supabase.rpc('exec_sql', {
      sql_query: migrationSQL
    })

    if (error) {
      console.error('❌ Migration failed:', error.message)
      console.error('Details:', error)
      console.log('\n⚠️  Manual steps required:')
      console.log('1. Go to Supabase Dashboard > SQL Editor')
      console.log('2. Copy the SQL from: backend/migrations/create_admin_settings.sql')
      console.log('3. Paste and run it manually')
      process.exit(1)
    }

    console.log('✅ Migration applied successfully!\n')

    // Verify table creation
    const { data: settings, error: verifyError } = await supabase
      .from('admin_settings')
      .select('*')
      .eq('key', 'voice')
      .single()

    if (verifyError) {
      console.error('⚠️  Verification failed:', verifyError.message)
      console.log('\nPlease verify manually in Supabase Dashboard')
    } else {
      console.log('✅ Verification successful!')
      console.log('Voice settings:', JSON.stringify(settings, null, 2))
    }

    console.log('\n🎉 Admin settings migration complete!')
  } catch (error: any) {
    console.error('❌ Unexpected error:', error.message)
    console.log('\n📝 Manual migration instructions:')
    console.log('1. Open Supabase Dashboard')
    console.log('2. Navigate to SQL Editor')
    console.log('3. Run the SQL from: backend/migrations/create_admin_settings.sql')
    process.exit(1)
  }
}

applyMigration()
