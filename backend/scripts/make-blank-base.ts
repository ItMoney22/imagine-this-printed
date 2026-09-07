/**
 * Make a blank-garment BASE cut-out for services/mockup-composite.ts.
 *
 * A base is a WHITE garment photographed flat, background removed, saved RGBA.
 * White because a white garment carries every fold and seam in its luminance,
 * so one base multiplies into any colour with real shading (the trick
 * scripts/render-blank-colors.ts already uses for 165 blank-tee colours) — and
 * a base is generated ONCE, so the mockups built from it are free, instant, and
 * framed identically across every colour and every design.
 *
 * Deliberately a cheap model: nothing here is creative work. It is a plain
 * white garment on a plain background, and it gets cut out immediately.
 *
 *   npx tsx scripts/make-blank-base.ts --name hoodie --garment "pullover hoodie"
 *   npx tsx scripts/make-blank-base.ts --name hoodie --force
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { runReplicate } from '../services/image-flow/providers/replicate.js'
import { removeBackgroundToBuffer } from '../services/background-removal.js'
import { uploadImageFromBuffer } from '../services/google-cloud-storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASES_DIR = path.resolve(__dirname, 'assets/blank-bases')

const argv = process.argv.slice(2)
const arg = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const name = arg('--name')
const garment = arg('--garment') ?? name
const force = argv.includes('--force')
const model = arg('--model') ?? 'black-forest-labs/flux-schnell'

async function main(): Promise<void> {
  if (!name) {
    console.error('usage: --name <slug> [--garment "pullover hoodie"] [--force]')
    process.exit(1)
  }
  const out = path.join(BASES_DIR, `blank-${name}.png`)
  if (fs.existsSync(out) && !force) {
    console.log(`${out} already exists — pass --force to replace it`)
    return
  }

  // A MID-GREY backdrop, never white. A white garment on a white ground is the
  // one case the house background remover cannot win: the field colour IS the
  // garment colour, so the colour key has nothing to separate, and the
  // segmentation ink-pass then restores background enclosed by the silhouette
  // as if it were ink — the first hoodie base came back with rectangular holes
  // punched through the shoulders for exactly that reason. On grey the garment
  // is the one salient subject on a field that is neither black nor white, so
  // the router sends it to subject segmentation, which is the right tool for a
  // single solid object with nothing floating free of it.
  const prompt =
    `Professional e-commerce product photograph of a single plain WHITE ${garment}, laid flat and photographed ` +
    `straight down from directly overhead, centred, on a plain medium-grey (#8a8a8a) seamless background that ` +
    `clearly contrasts with the white fabric. The garment is completely blank with no print, no graphic, no logo ` +
    `and no label. Soft even studio lighting, natural fabric folds and visible seams, sharp focus, the full ` +
    `garment inside the frame with a little space around it.`

  console.log(`rendering a blank ${garment} with ${model}...`)
  const r = await runReplicate({
    modelId: model,
    input: { prompt, aspect_ratio: '1:1', output_format: 'png', num_outputs: 1 },
    timeoutMs: 180_000,
  })

  // Cut it out with the house background remover, which since 2026-09-03 keys a
  // solid field rather than reaching for subject segmentation.
  const removal = await removeBackgroundToBuffer(r.imageUrls[0], 'blank-base')
  const cut = await sharp(removal.buffer).ensureAlpha().trim({ threshold: 8 }).png().toBuffer()

  const { data, info } = await sharp(cut).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let opaque = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 200) opaque++
  const share = opaque / (info.width * info.height)
  if (share < 0.25) {
    console.error(`the cut-out is only ${(share * 100).toFixed(0)}% opaque — that is a bad silhouette, not a garment. Not saving.`)
    process.exit(1)
  }

  fs.mkdirSync(BASES_DIR, { recursive: true })
  fs.writeFileSync(out, cut)
  // Also parked in the bucket so a fresh checkout or another machine can pull
  // the same base rather than paying to regenerate a slightly different one.
  const { publicUrl } = await uploadImageFromBuffer(cut, `blank-bases/blank-${name}.png`, 'image/png')
  console.log(`saved ${out} (${info.width}x${info.height}, ${(share * 100).toFixed(0)}% opaque, cut via ${removal.method})`)
  console.log(`mirrored to ${publicUrl.split('?')[0]}`)
}

main().catch((e) => { console.error('make-blank-base failed:', e?.message || e); process.exit(1) })
