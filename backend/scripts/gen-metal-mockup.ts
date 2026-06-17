// One-off (David-authorized): generate a room mockup for the metal-art product
// "Sinister Circus Spectacle" (a7a19c1e), which was submitted before mockups
// were captured. Mirrors the /ai/room-mockup pipeline (gpt-image-2), then
// attaches the result to metadata.mockup_url + metadata.assets.mockups so the
// storefront shows the art staged on a wall instead of the bare artwork.
//
// Run from backend/:  npx tsx scripts/gen-metal-mockup.ts
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { editOpenAIImage } from '../services/image-flow/providers/openai-image.js'

const PRODUCT_ID = 'a7a19c1e-1c83-44ec-944e-da9d2114ae2c'
const ROOM = 'a stylish modern living room'
const SIZE = '8x11'

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: product, error } = await supabase
    .from('products')
    .select('id, name, images, metadata')
    .eq('id', PRODUCT_ID)
    .single()
  if (error || !product) throw new Error(`Product load failed: ${error?.message}`)

  const artwork = product.images?.[0]
  if (!artwork) throw new Error('Product has no artwork image to stage')
  console.log(`[mockup] Staging "${product.name}" (${SIZE}) in ${ROOM} …`)

  const sizeDesc = SIZE === '4x6'
    ? 'a SMALL 4 by 6 inch framed metal print — roughly the size of a postcard or a small desk photo frame'
    : 'a MODEST 8 by 11 inch framed metal print — about the size of a standard sheet of paper'
  const prompt = `Photorealistic interior photograph: the provided artwork printed as ${sizeDesc}, hanging on the wall of ${ROOM}. CRITICAL SCALE: show it at realistic, true-to-life size relative to the furniture and wall — it is a small-to-medium print, NOT an oversized mural or giant panel; a real 8x11 inch frame is smaller than a typical window. Style it tastefully with realistic lighting, perspective, and a little furniture/decor context. CRITICAL: keep the artwork itself EXACTLY as provided — do not alter, crop, recolor, redraw, or add any text to it; it must read as the same image, just shown framed on the wall at its true size. Magazine-quality interior design photography.`

  const r = await editOpenAIImage({
    sourceUrl: artwork,
    prompt,
    userId: product.metadata?.creator_id,
    quality: 'medium',
    objectPath: `products/${PRODUCT_ID}/mockups/room-${Date.now()}.png`,
  })
  console.log('[mockup] ✅ Generated:', r.url, `(${r.modelId})`)

  // Attach: mockup_url (legacy) + assets.mockups (role-aware display). No
  // assets.clean — metal is a physical product, so we don't enable a digital
  // download for it.
  const meta = (product.metadata && typeof product.metadata === 'object') ? product.metadata : {}
  const assets = (meta.assets && typeof meta.assets === 'object') ? meta.assets : {}
  const newMeta = {
    ...meta,
    mockup_url: r.url,
    assets: { ...assets, mockups: [r.url, ...(Array.isArray(assets.mockups) ? assets.mockups : [])] },
  }
  const { error: upErr } = await supabase.from('products').update({ metadata: newMeta }).eq('id', PRODUCT_ID)
  if (upErr) throw new Error(`Product update failed: ${upErr.message}`)
  console.log('[mockup] ✅ Attached to product metadata.mockup_url + assets.mockups')
}

main().then(() => process.exit(0)).catch((e) => { console.error('[mockup] ❌', e); process.exit(1) })
