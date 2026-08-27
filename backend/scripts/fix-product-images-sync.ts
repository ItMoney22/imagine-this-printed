/**
 * Fix product images sync - ensures all asset types are synced to products.images
 * Run with: DOTENV_CONFIG_PATH=.env npx tsx scripts/fix-product-images-sync.ts
 */

import { supabase } from '../lib/supabase.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function fixProductImagesSync() {
  console.log('🔧 Fixing product images sync...\n')

  try {
    // Read migration SQL
    const migrationPath = path.join(__dirname, '../../supabase/migrations/20251209000001_sync_product_images.sql')

    if (!fs.existsSync(migrationPath)) {
      console.error('❌ Migration file not found:', migrationPath)
      process.exit(1)
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8')

    console.log('📄 Migration SQL preview (first 500 chars):')
    console.log('─'.repeat(80))
    console.log(migrationSQL.substring(0, 500) + '...')
    console.log('─'.repeat(80))
    console.log()

    // Try to execute via RPC
    const { data, error } = await supabase.rpc('exec_sql', {
      sql_query: migrationSQL
    })

    if (error) {
      console.error('❌ RPC execution failed:', error.message)
      console.log('\n⚠️  The exec_sql RPC function may not exist.')
      console.log('\n📝 Manual steps required:')
      console.log('1. Go to Supabase Dashboard > SQL Editor')
      console.log('2. Copy the SQL from: supabase/migrations/20251209000001_sync_product_images.sql')
      console.log('3. Paste and run it manually')
      console.log('\nAlternatively, run individual sync commands below:\n')

      // Try to sync products directly
      await manualSync()
      return
    }

    console.log('✅ Migration applied successfully!\n')
    await verifySync()

  } catch (error: any) {
    console.error('❌ Unexpected error:', error.message)
    console.log('\nAttempting manual sync...\n')
    await manualSync()
  }
}

async function manualSync() {
  console.log('🔄 Attempting manual product sync...\n')

  // Get all products with assets
  const { data: productsWithAssets, error: fetchError } = await supabase
    .from('product_assets')
    .select('product_id, url, kind')
    .not('url', 'is', null)

  if (fetchError) {
    console.error('❌ Failed to fetch product assets:', fetchError.message)
    return
  }

  if (!productsWithAssets || productsWithAssets.length === 0) {
    console.log('ℹ️  No product assets found in database')
    return
  }

  // Group by product_id
  const assetsByProduct = new Map<string, typeof productsWithAssets>()
  for (const asset of productsWithAssets) {
    if (!assetsByProduct.has(asset.product_id)) {
      assetsByProduct.set(asset.product_id, [])
    }
    assetsByProduct.get(asset.product_id)!.push(asset)
  }

  console.log(`📊 Found ${assetsByProduct.size} products with assets`)
  console.log(`📊 Total assets: ${productsWithAssets.length}\n`)

  // Sort by priority and update each product
  const kindPriority: Record<string, number> = {
    'mockup': 1,
    'dtf': 2,
    'source': 3,
    'nobg': 4,
    'upscaled': 5,
  }

  let syncedCount = 0
  let errorCount = 0

  for (const [productId, assets] of assetsByProduct) {
    // Sort assets by priority
    const sortedAssets = assets
      .filter(a => ['mockup', 'source', 'dtf', 'nobg', 'upscaled'].includes(a.kind))
      .sort((a, b) => (kindPriority[a.kind] || 99) - (kindPriority[b.kind] || 99))

    const imageUrls = sortedAssets.map(a => a.url)

    if (imageUrls.length === 0) continue

    // Update product images
    const { error: updateError } = await supabase
      .from('products')
      .update({ images: imageUrls })
      .eq('id', productId)

    if (updateError) {
      console.error(`  ❌ Failed to sync product ${productId}:`, updateError.message)
      errorCount++
    } else {
      console.log(`  ✅ Synced product ${productId.substring(0, 8)}... (${imageUrls.length} images)`)
      syncedCount++
    }
  }

  console.log(`\n📊 Sync complete: ${syncedCount} products synced, ${errorCount} errors`)
}

async function verifySync() {
  console.log('🔍 Verifying sync...\n')

  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, images, status')
    .not('images', 'eq', '{}')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('❌ Verification failed:', error.message)
    return
  }

  if (!products || products.length === 0) {
    console.log('⚠️  No products found with images')
    return
  }

  console.log('✅ Products with images:')
  for (const product of products) {
    const imageCount = product.images?.length || 0
    console.log(`  - ${product.name} (${product.status}): ${imageCount} images`)
  }
}

fixProductImagesSync()
