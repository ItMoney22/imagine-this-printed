/**
 * Rebuild a product's garment mockups by COMPOSITING its real print file onto a
 * blank, instead of asking an image model to draw the design again.
 *
 * See services/mockup-composite.ts for why. Short version, measured on
 * "Unleashed Power Athlete Hoodie": the print file's blue ink sits at 0.937
 * saturation, the generative shots came back at 0.64-0.85, and every one of
 * them redrew the artwork — a different helmet, a different "23", drawstrings
 * laid across the print. Compositing lands at 0.87 with the artwork itself
 * untouched, because nothing regenerates it.
 *
 * Writes `kind:'mockup'` rows with asset_role `mockup_composite_<colour>`, so
 * it never overwrites a generative shot the Step Flow is managing. Re-running
 * replaces its own rows only.
 *
 *   npx tsx scripts/composite-mockups.ts --product <uuid>
 *   npx tsx scripts/composite-mockups.ts --product <uuid> --colors white,black,navy
 *   npx tsx scripts/composite-mockups.ts --product <uuid> --dry-run
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { compositeMockup, placementFor } from '../services/mockup-composite.js'
import { uploadImageFromBuffer } from '../services/google-cloud-storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASES_DIR = path.resolve(__dirname, 'assets/blank-bases')
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

/** Garment colours we stock, as the hex the fabric actually is. */
const COLOR_HEX: Record<string, string> = {
  white: '#ffffff',
  black: '#141414',
  navy: '#1f2a44',
  'heather-grey': '#b7b9bc',
  grey: '#b7b9bc',
  red: '#9b2226',
  'forest-green': '#2b4a3f',
  'royal-blue': '#1d4ed8',
  sand: '#d8cbb4',
}

/** Which base cut-out stands in for a garment. */
function baseFileFor(garment: string): string {
  if (/hoodie|sweatshirt/i.test(garment)) return 'blank-hoodie.png'
  return 'blank-premium-retail-fit-tee.png'
}

const argv = process.argv.slice(2)
const arg = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }

async function main(): Promise<void> {
  const productId = arg('--product')
  const dryRun = argv.includes('--dry-run')
  if (!productId) { console.error('usage: --product <uuid> [--colors white,black] [--dry-run]'); process.exit(1) }

  const { data: product } = await supabase.from('products').select('id,name,category,metadata').eq('id', productId).single()
  if (!product) { console.error(`no product ${productId}`); process.exit(1) }

  const stepFlow = (product.metadata as any)?.step_flow ?? {}
  const garment: string = stepFlow.garment ?? (String(product.category) === 'hoodies' ? 'hoodie' : 'tshirt')
  const requested = (arg('--colors') ?? '').split(',').map((c) => c.trim()).filter(Boolean)
  const colours = requested.length
    ? requested
    : [stepFlow.colors?.primary, ...(stepFlow.colors?.extras ?? [])].filter(Boolean) as string[]
  const wanted = colours.length ? colours : ['white']

  const baseFile = path.join(BASES_DIR, baseFileFor(garment))
  if (!fs.existsSync(baseFile)) {
    console.error(`no blank base for ${garment} at ${baseFile} — run scripts/make-blank-base.ts --name <slug>`)
    process.exit(1)
  }

  const { data: cut } = await supabase.from('product_assets').select('url')
    .eq('product_id', productId).eq('kind', 'nobg').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!cut) { console.error('this product has no transparent print file yet'); process.exit(1) }

  console.log(`${product.name}\n  garment ${garment} · colours ${wanted.join(', ')} · base ${path.basename(baseFile)}`)
  if (dryRun) return

  const base = fs.readFileSync(baseFile)
  const design = Buffer.from(await (await fetch(cut.url)).arrayBuffer())
  const place = placementFor(garment)
  const slug = String(product.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

  for (const colour of wanted) {
    const hex = COLOR_HEX[colour] ?? COLOR_HEX.white
    const r = await compositeMockup({ base, design, colorHex: hex, size: 1024, ...place })
    const dims = await sharp(r.buffer).metadata()
    const role = `mockup_composite_${colour}`
    const { publicUrl, path: gcsPath } = await uploadImageFromBuffer(
      r.buffer, `mockups/${slug}/composite/${slug}-${colour}-${Date.now()}.png`, 'image/png'
    )
    await supabase.from('product_assets').delete().eq('product_id', productId).eq('asset_role', role)
    const { error } = await supabase.from('product_assets').insert({
      product_id: productId, kind: 'mockup', path: gcsPath, url: publicUrl,
      width: dims.width ?? 1024, height: dims.height ?? 1024,
      asset_role: role, is_primary: false, display_order: 20,
      metadata: {
        rendered_by: 'mockup-composite',
        garment, colour, color_hex: hex,
        print_box: r.printBox, garment_box: r.garmentBox,
        base: path.basename(baseFile),
        // No model, no cost: the whole point is that the artwork is the real
        // print file rather than a redraw of it.
        cost_usd: 0,
        rendered_at: new Date().toISOString(),
      },
    })
    console.log(error ? `  FAIL ${colour}: ${error.message}` : `  ok   ${colour} -> ${role}`)
  }
}

main().catch((e) => { console.error('composite-mockups failed:', e?.message || e); process.exit(1) })
