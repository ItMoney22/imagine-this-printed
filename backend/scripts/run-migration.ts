import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env' })

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runMigration() {
  console.log('Running migration: 20251209000000_product_assets_role_columns.sql')

  // Run each statement via RPC or direct query
  // Supabase JS client can execute raw SQL via rpc if you have a function
  // Or we use the postgres connection directly

  // Let's just execute the column additions via Supabase API

  // 1. Add columns (this won't work directly, need postgres)
  // Instead, let's check if columns exist first
  const { data: columns, error: colError } = await supabase
    .from('product_assets')
    .select('*')
    .limit(1)

  if (colError) {
    console.error('Error checking table:', colError)
    return
  }

  console.log('Sample row columns:', columns?.[0] ? Object.keys(columns[0]) : 'no rows')

  // Check if asset_role column exists
  const hasAssetRole = columns?.[0] && 'asset_role' in columns[0]
  console.log('Has asset_role column:', hasAssetRole)

  if (!hasAssetRole) {
    console.log('\n⚠️ The new columns need to be added via Supabase Dashboard SQL Editor.')
    console.log('Please run this SQL in the Supabase Dashboard:\n')
    console.log(fs.readFileSync('../supabase/migrations/20251209000000_product_assets_role_columns.sql', 'utf8'))
    return
  }

  console.log('\n✅ Columns already exist! Running backfill updates...')

  // Run backfill updates via Supabase client
  // Update mockups
  const { data: mockups, error: mockupError } = await supabase
    .from('product_assets')
    .select('id, kind, metadata, asset_role')
    .eq('kind', 'mockup')
    .is('asset_role', null)

  if (mockupError) {
    console.error('Error fetching mockups:', mockupError)
  } else {
    console.log(`Found ${mockups?.length || 0} mockups to update`)

    for (const mockup of mockups || []) {
      const template = mockup.metadata?.template || 'flat_lay'
      const assetRole = template === 'mr_imagine' ? 'mockup_mr_imagine' : 'mockup_flat_lay'
      const displayOrder = template === 'mr_imagine' ? 3 : 2

      const { error } = await supabase
        .from('product_assets')
        .update({ asset_role: assetRole, display_order: displayOrder })
        .eq('id', mockup.id)

      if (error) {
        console.error(`Error updating mockup ${mockup.id}:`, error)
      } else {
        console.log(`Updated mockup ${mockup.id}: ${assetRole}`)
      }
    }
  }

  // Update source/dtf designs
  const { data: designs, error: designError } = await supabase
    .from('product_assets')
    .select('id, kind, metadata, asset_role, is_primary')
    .in('kind', ['source', 'dtf'])
    .is('asset_role', null)

  if (designError) {
    console.error('Error fetching designs:', designError)
  } else {
    console.log(`Found ${designs?.length || 0} designs to update`)

    for (const design of designs || []) {
      const isSelected = design.metadata?.is_selected === true

      const { error } = await supabase
        .from('product_assets')
        .update({
          asset_role: 'design',
          is_primary: isSelected,
          display_order: isSelected ? 1 : 99
        })
        .eq('id', design.id)

      if (error) {
        console.error(`Error updating design ${design.id}:`, error)
      } else {
        console.log(`Updated design ${design.id}: is_primary=${isSelected}`)
      }
    }
  }

  // Update auxiliary (nobg, upscaled)
  const { data: auxiliary, error: auxError } = await supabase
    .from('product_assets')
    .select('id, kind')
    .in('kind', ['nobg', 'upscaled'])
    .is('asset_role', null)

  if (auxError) {
    console.error('Error fetching auxiliary:', auxError)
  } else {
    console.log(`Found ${auxiliary?.length || 0} auxiliary assets to update`)

    for (const aux of auxiliary || []) {
      const { error } = await supabase
        .from('product_assets')
        .update({ asset_role: 'auxiliary', display_order: 99 })
        .eq('id', aux.id)

      if (error) {
        console.error(`Error updating auxiliary ${aux.id}:`, error)
      } else {
        console.log(`Updated auxiliary ${aux.id}`)
      }
    }
  }

  console.log('\n✅ Migration complete!')
}

runMigration().catch(console.error)
