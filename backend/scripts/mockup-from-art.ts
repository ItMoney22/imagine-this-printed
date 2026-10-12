/**
 * Give a garment that has NO shirt photo one, from the art it already carries:
 * composite images[0] onto the blank (services/mockup-composite.ts) and put the
 * result in products.images. Free, no model. Task 732f8a71.
 *
 * Art with no alpha (a flat square background) is keyed out from its corner colour.
 *
 *   npx tsx scripts/mockup-from-art.ts --product <uuid> [--color black] [--out preview.png]   # preview only
 *   npx tsx scripts/mockup-from-art.ts --product <uuid> --apply                               # upload + write
 *
 * Env comes from --env <file> (default ./.env) with override, so a dispatch window's
 * inherited keys can't shadow it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import sharp from 'sharp'

const argv = process.argv.slice(2)
const arg = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
dotenv.config({ path: arg('--env') ?? '.env', override: true })

const COLOR_HEX: Record<string, string> = { black: '#141414', white: '#ffffff', navy: '#1f2a44' }

/** Make a flat-background image transparent by distance from its corner colour. */
async function keyOutBackground(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const at = (x: number, y: number) => (y * w + x) * 4
  const corners = [at(2, 2), at(w - 3, 2), at(2, h - 3), at(w - 3, h - 3)]
  const bg = [0, 1, 2].map((c) => corners.reduce((s, o) => s + data[o + c], 0) / 4)
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2])
    const a = Math.min(1, Math.max(0, (d - 28) / 40)) // soft edge between 28 and 68
    data[i + 3] = Math.round(data[i + 3] * a)
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

async function main(): Promise<void> {
  const id = arg('--product')
  if (!id) { console.error('usage: --product <uuid> [--color black] [--out file] [--apply]'); process.exit(1) }
  const { createClient } = await import('@supabase/supabase-js')
  const { compositeMockup, placementFor } = await import('../services/mockup-composite.js')
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: p, error } = await sb.from('products').select('id,name,category,images').eq('id', id).single()
  if (error || !p) { console.error('no product', error?.message); process.exit(1) }

  const garment = p.category === 'hoodies' ? 'hoodie' : 'tshirt'
  const color = arg('--color') ?? 'black'
  const here = path.dirname(fileURLToPath(import.meta.url))
  const base = fs.readFileSync(path.join(here, 'assets/blank-bases', garment === 'hoodie' ? 'blank-hoodie.png' : 'blank-premium-retail-fit-tee.png'))
  let design = Buffer.from(await (await fetch(p.images[0])).arrayBuffer())
  const meta = await sharp(design).metadata()
  if (!meta.hasAlpha) design = await keyOutBackground(design)
  const r = await compositeMockup({ base, design, colorHex: COLOR_HEX[color] ?? COLOR_HEX.black, size: 1024, ...placementFor(garment) })

  const out = arg('--out') ?? path.join(process.env.TEMP ?? '.', `mockup-${id.slice(0, 8)}.png`)
  fs.writeFileSync(out, r.buffer)
  console.log(`${p.name}: preview ${out}`)
  if (!argv.includes('--apply')) return

  const { uploadImageFromBuffer } = await import('../services/google-cloud-storage.js')
  const slug = String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const { publicUrl } = await uploadImageFromBuffer(r.buffer, `mockups/${slug}/composite/${slug}-${color}-${Date.now()}.png`, 'image/png')
  const { error: e2 } = await sb.from('products').update({ images: [publicUrl, ...p.images.filter((u: string) => u !== publicUrl)] }).eq('id', id)
  console.log(e2 ? `FAIL ${e2.message}` : `applied ${publicUrl}`)
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
