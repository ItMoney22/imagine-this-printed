/**
 * Script to refresh expired GCS signed URLs for all products
 *
 * Usage: npx tsx scripts/refresh-product-images.ts
 */

import { createClient } from '@supabase/supabase-js'
import { Storage } from '@google-cloud/storage'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Initialize GCS directly to avoid any module caching issues
const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID!,
  credentials: process.env.GCS_CREDENTIALS
    ? JSON.parse(process.env.GCS_CREDENTIALS)
    : undefined,
})
const bucketName = process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main'
const bucket = storage.bucket(bucketName)

function extractPathFromUrl(signedUrl: string): string | null {
  try {
    const url = new URL(signedUrl)
    const pathname = url.pathname
    const bucketMatch = pathname.match(/^\/([^\/]+)\/(.+)$/)
    if (bucketMatch) {
      return decodeURIComponent(bucketMatch[2])
    }
    return null
  } catch {
    return null
  }
}

async function refreshUrl(signedUrl: string): Promise<string | null> {
  const path = extractPathFromUrl(signedUrl)
  if (!path) {
    console.log('   Could not extract path from URL')
    return null
  }

  try {
    const file = bucket.file(path)
    const [exists] = await file.exists()

    if (!exists) {
      console.log('   File does not exist:', path)
      return null
    }

    const [newSignedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
    })

    return newSignedUrl
  } catch (error) {
    console.log('   Error refreshing:', (error as Error).message)
    return null
  }
}

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

interface Product {
  id: string
  name: string
  images: string[]
}

async function refreshProductImages() {
  console.log('🔄 Starting product image URL refresh...\n')

  // Fetch all products with images
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, images')
    .not('images', 'is', null)

  if (error) {
    console.error('❌ Error fetching products:', error.message)
    process.exit(1)
  }

  if (!products || products.length === 0) {
    console.log('✅ No products with images found')
    return
  }

  console.log(`📦 Found ${products.length} products with images\n`)

  let totalRefreshed = 0
  let totalFailed = 0

  for (const product of products as Product[]) {
    if (!product.images || product.images.length === 0) continue

    console.log(`\n🖼️  Processing: ${product.name}`)
    console.log(`   Images: ${product.images.length}`)

    const newImages: string[] = []
    let hasChanges = false

    for (const imageUrl of product.images) {
      // Check if it's a GCS signed URL
      if (!imageUrl.includes('storage.googleapis.com')) {
        newImages.push(imageUrl)
        continue
      }

      // Check if it's expired by looking at the Expires parameter
      try {
        const url = new URL(imageUrl)
        const expires = url.searchParams.get('Expires')

        if (expires) {
          const expiryDate = new Date(parseInt(expires) * 1000)
          const now = new Date()

          if (expiryDate > now) {
            // URL is still valid
            console.log(`   ✓ Still valid until: ${expiryDate.toISOString().split('T')[0]}`)
            newImages.push(imageUrl)
            continue
          }

          console.log(`   ⚠️ Expired on: ${expiryDate.toISOString().split('T')[0]}`)
        }
      } catch {
        // If we can't parse the URL, try to refresh it anyway
      }

      // Try to refresh the signed URL
      const newUrl = await refreshUrl(imageUrl)

      if (newUrl) {
        console.log(`   ✅ Refreshed URL`)
        newImages.push(newUrl)
        hasChanges = true
        totalRefreshed++
      } else {
        console.log(`   ❌ Failed to refresh - keeping old URL`)
        newImages.push(imageUrl)
        totalFailed++
      }
    }

    // Update product if images changed
    if (hasChanges) {
      const { error: updateError } = await supabase
        .from('products')
        .update({ images: newImages })
        .eq('id', product.id)

      if (updateError) {
        console.log(`   ❌ Failed to update product: ${updateError.message}`)
      } else {
        console.log(`   💾 Product updated with new URLs`)
      }
    }
  }

  console.log('\n' + '='.repeat(50))
  console.log('📊 Summary:')
  console.log(`   Total products processed: ${products.length}`)
  console.log(`   URLs refreshed: ${totalRefreshed}`)
  console.log(`   URLs failed: ${totalFailed}`)
  console.log('='.repeat(50))
}

// Run the script
refreshProductImages()
  .then(() => {
    console.log('\n✅ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error)
    process.exit(1)
  })
