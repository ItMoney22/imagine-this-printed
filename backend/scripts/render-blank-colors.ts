// ---------------------------------------------------------------------------
// Render every blank-tee colour from one white base per tier (David 2026-09-02:
// "so many colors dont have swatches ... use our key to make the color shirts
// you need. i approve not a highend model tho").
//
// One cheap flux-schnell white tee per tier was generated once and cut out
// (Replicate 851-labs/background-remover) into
// backend/scripts/assets/blank-bases/<tier-slug>.png (RGBA). This script then
// MULTIPLIES that base by each colour's swatch hex from
// backend/shared/blank-line.ts, drops it on a neutral studio ground with a
// soft shadow, and writes public/blanks/<tier-slug>/<colour-slug>.webp.
//
// Why multiply instead of asking the model for 165 colours: a white shirt
// keeps every fold and seam in its luminance, so base × colour gives the
// EXACT swatch hex with real shading, identical framing across all colours,
// zero per-image AI cost, and re-rendering is instant when a hex is tweaked.
//
// Usage (from backend/):
//   npx tsx scripts/render-blank-colors.ts            # all tiers, all colours
//   npx tsx scripts/render-blank-colors.ts --tier premium --only "Navy,True Royal"
//   npx tsx scripts/render-blank-colors.ts --force     # overwrite existing files
// ---------------------------------------------------------------------------
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { BLANK_LINE, colorSlug, type BlankTierSpec } from '../shared/blank-line.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASES_DIR = path.resolve(__dirname, 'assets/blank-bases')
const PUBLIC_DIR = path.resolve(__dirname, '../../public/blanks')

const OUT_SIZE = 1000
const GROUND = { r: 243, g: 244, b: 246 } // #F3F4F6 — matches the site's light card ground
const SHADOW_BLUR = 20
const SHADOW_OPACITY = 0.18
const SHADOW_OFFSET_Y = 10

const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const FORCE = flag('force')
const ONLY_TIER = opt('tier')
const ONLY_COLORS = opt('only')?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`bad hex ${hex}`)
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** base (RGBA raw) × colour, alpha untouched. */
function multiplyTint(raw: Buffer, channels: number, rgb: { r: number; g: number; b: number }): Buffer {
  const out = Buffer.from(raw)
  const fr = rgb.r / 255, fg = rgb.g / 255, fb = rgb.b / 255
  for (let i = 0; i < out.length; i += channels) {
    out[i] = Math.round(out[i] * fr)
    out[i + 1] = Math.round(out[i + 1] * fg)
    out[i + 2] = Math.round(out[i + 2] * fb)
  }
  return out
}

async function loadBase(tier: BlankTierSpec) {
  const file = path.join(BASES_DIR, `${tier.slug}.png`)
  if (!fs.existsSync(file)) throw new Error(`missing base cutout ${file}`)
  // Fit the cutout into the output square with breathing room, keep alpha.
  const fitted = await sharp(file)
    .ensureAlpha()
    .trim({ threshold: 8 })
    .resize(Math.round(OUT_SIZE * 0.84), Math.round(OUT_SIZE * 0.84), { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer()
  const { data, info } = await sharp(fitted).raw().toBuffer({ resolveWithObject: true })
  // Soft ground shadow from the blurred alpha, offset slightly downward.
  const shadowAlpha = await sharp(fitted).extractChannel(3).blur(SHADOW_BLUR).linear(SHADOW_OPACITY, 0).toBuffer()
  const shadow = await sharp({ create: { width: info.width, height: info.height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .joinChannel(shadowAlpha)
    .png()
    .toBuffer()
  return { data, info, shadow }
}

async function renderTier(tier: BlankTierSpec) {
  const outDir = path.join(PUBLIC_DIR, tier.slug)
  fs.mkdirSync(outDir, { recursive: true })
  const { data, info, shadow } = await loadBase(tier)
  const left = Math.round((OUT_SIZE - info.width) / 2)
  const top = Math.round((OUT_SIZE - info.height) / 2)

  let written = 0, skipped = 0
  for (const color of tier.colors) {
    if (ONLY_COLORS && !ONLY_COLORS.includes(color.name.toLowerCase())) continue
    const out = path.join(outDir, `${colorSlug(color.name)}.webp`)
    if (fs.existsSync(out) && !FORCE) { skipped++; continue }
    const tinted = await sharp(multiplyTint(data, info.channels, hexToRgb(color.hex)), {
      raw: { width: info.width, height: info.height, channels: info.channels as 4 }
    }).png().toBuffer()
    await sharp({ create: { width: OUT_SIZE, height: OUT_SIZE, channels: 3, background: GROUND } })
      .composite([
        { input: shadow, left, top: top + SHADOW_OFFSET_Y },
        { input: tinted, left, top }
      ])
      .webp({ quality: 82 })
      .toFile(out)
    written++
  }
  console.log(`${tier.grade.padEnd(8)} ${tier.slug}: ${written} written, ${skipped} skipped (${tier.colors.length} colours)`)
}

async function run() {
  const tiers = BLANK_LINE.filter(t => !ONLY_TIER || t.id === ONLY_TIER || t.slug === ONLY_TIER)
  if (tiers.length === 0) throw new Error(`no tier matches --tier ${ONLY_TIER}`)
  for (const t of tiers) await renderTier(t)
}

run().catch(err => { console.error('❌ render-blank-colors failed:', err?.message || err); process.exit(1) })
