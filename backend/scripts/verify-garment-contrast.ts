/**
 * verify-garment-contrast.ts — the evidence run for Watchtower task 884edc98.
 *
 * David, 2026-09-01: "look at this design it should go on a white shirt because
 * of how it looks but it was mocked on a black shirt so now it looks like this."
 * Two things had to be proven, not asserted:
 *
 *   A. A dark stick-figure golf design now lands on a LIGHT garment.
 *   B. The live black-on-black listings FAIL the new contrast criterion when
 *      re-evaluated, and did not before.
 *
 * Part A runs on synthetic fixtures drawn here, so it is deterministic, free,
 * and reproducible on any machine with no API keys at all. Part B runs against
 * the real artwork of real products and needs Supabase credentials; it is
 * skipped with a loud line when they are absent, never faked.
 *
 * Usage:
 *   npx tsx backend/scripts/verify-garment-contrast.ts              # fixtures only
 *   npx tsx backend/scripts/verify-garment-contrast.ts --live       # + live listings
 *   npx tsx backend/scripts/verify-garment-contrast.ts --url <png>  # one file
 */
import sharp from 'sharp'
import {
  measureArtworkLuminanceFromBuffer,
  measureArtworkLuminance,
  type ArtworkLuminance,
} from '../services/image-metrics.js'
import {
  pickGarmentColor,
  scoreGarment,
  GARMENT_LABEL,
  MIN_INK_CONTRAST,
  BLOCK_VANISHING_FRACTION,
  RENDERABLE_COLORS,
} from '../services/garment-color.js'
import { checkDesignContrast } from '../services/presentation-qa.js'

const args = process.argv.slice(2)
const wantLive = args.includes('--live')
const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null

// ---------------------------------------------------------------------------
// Fixtures. Drawn as SVG so the artwork is described, not stored: a reader can
// see exactly what is being measured, and the numbers below are re-derivable.
// ---------------------------------------------------------------------------
const SIZE = 640

/** The brief David was complaining about: a stick figure golfer, black line art
 *  on a transparent background. No fills, no colour — just strokes, which is
 *  what makes it vanish on a dark garment. */
const golfStickFigure = (ink: string) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <g stroke="${ink}" stroke-width="9" fill="none" stroke-linecap="round">
    <circle cx="300" cy="150" r="42" />
    <line x1="300" y1="192" x2="300" y2="340" />
    <line x1="300" y1="235" x2="235" y2="300" />
    <line x1="300" y1="235" x2="380" y2="270" />
    <line x1="300" y1="340" x2="250" y2="470" />
    <line x1="300" y1="340" x2="355" y2="470" />
    <line x1="380" y1="270" x2="470" y2="400" />
    <line x1="470" y1="400" x2="500" y2="430" />
    <path d="M110 500 q190 -60 400 0" />
  </g>
  <circle cx="160" cy="470" r="14" fill="${ink}" />
</svg>`

/** The same art inverted: pale ink, which is the mirror failure on a white tee. */
const paleLineArt = () => golfStickFigure('#F2F2F2')

/** A full-colour badge: mid and bright tones, which should hold up on both
 *  bases and therefore earn a second colourway. */
const colourBadge = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <circle cx="320" cy="320" r="200" fill="#E11D48" />
  <circle cx="320" cy="320" r="150" fill="#F59E0B" />
  <circle cx="320" cy="320" r="95" fill="#0EA5E9" />
  <rect x="250" y="300" width="140" height="40" fill="#FFFFFF" />
</svg>`

async function fixture(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer()
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

function table(lum: ArtworkLuminance): string {
  return RENDERABLE_COLORS.map(c => {
    const s = scoreGarment(lum, c)
    return `      ${GARMENT_LABEL[c].padEnd(13)} vanishing ${pct(s.vanishing).padStart(6)}   mean contrast ${String(s.meanContrast).padStart(6)}:1   ${s.ok ? 'ok' : 'FAILS'}`
  }).join('\n')
}

async function report(name: string, buf: Buffer, expect?: string) {
  const lum = await measureArtworkLuminanceFromBuffer(buf, `fixture:${name}`)
  if (!lum.ok) {
    console.log(`\n${name}: UNREADABLE — ${lum.error}`)
    return
  }
  const pick = pickGarmentColor(lum, { garment: 'tshirt' })
  console.log(`\n--- ${name}`)
  console.log(`    ink ${pct(lum.inkFraction)} of frame | median luma ${lum.medianLuma} | p10 ${lum.p10Luma} | p90 ${lum.p90Luma}`)
  console.log(table(lum))
  console.log(`    PICK: ${pick ? GARMENT_LABEL[pick.color] : '(none)'}${pick?.alternates.length ? ` + colourway ${pick.alternates.map(a => GARMENT_LABEL[a]).join(', ')}` : ''}`)
  if (expect) {
    const ok = pick?.color === expect
    console.log(`    EXPECTED ${expect} -> ${ok ? 'PASS' : 'FAIL'}`)
    if (!ok) process.exitCode = 1
  }

  // And what the QA gate says about that same artwork on a BLACK garment,
  // which is what every one of these products used to be stamped with.
  const onBlack = checkDesignContrast(lum, 'black', null, true, 'front-center')
  const blocking = onBlack.findings.filter(f => f.severity === 'block')
  console.log(`    QA on a BLACK garment: ${onBlack.ok ? 'passes' : 'BLOCKS'}${blocking.length ? ` — ${blocking[0].issue}` : ''}`)
}

async function reportLiveUrl(label: string, url: string, garmentColor: string | null) {
  const lum = await measureArtworkLuminance(url)
  if (!lum.ok) {
    console.log(`\n--- ${label}\n    UNREADABLE — ${lum.error}`)
    return
  }
  const pick = pickGarmentColor(lum, { garment: 'tshirt' })
  const verdict = checkDesignContrast(lum, garmentColor, null, true, 'front-center')
  const blocking = verdict.findings.filter(f => f.severity === 'block')
  console.log(`\n--- ${label}`)
  console.log(`    stamped shirt_color: ${garmentColor ?? 'null (renders BLACK)'}`)
  console.log(`    ink ${pct(lum.inkFraction)} of frame | median luma ${lum.medianLuma}`)
  console.log(table(lum))
  console.log(`    PICK: ${pick ? GARMENT_LABEL[pick.color] : '(none)'}`)
  console.log(`    NEW design_contrast criterion: ${verdict.ok ? 'passes' : 'BLOCKS'}`)
  for (const f of verdict.findings) console.log(`      [${f.severity}] ${f.issue}`)
  if (blocking.length) console.log(`      fix: ${blocking[0].fix}`)
}

async function main() {
  console.log('=========================================================')
  console.log(' GARMENT CONTRAST — verification run (task 884edc98)')
  console.log(` contrast floor ${MIN_INK_CONTRAST}:1 | blocks above ${pct(BLOCK_VANISHING_FRACTION)} vanishing ink`)
  console.log('=========================================================')

  if (urlArg) {
    await reportLiveUrl(urlArg, urlArg, args.includes('--on') ? args[args.indexOf('--on') + 1] : null)
    return
  }

  console.log('\n### A. FIXTURES — deterministic, no keys required')
  await report('golf stick figure, BLACK line art (the design David photographed)', await fixture(golfStickFigure('#111111')), 'white')
  await report('the same art in PALE ink', await fixture(paleLineArt()), 'black')
  await report('full-colour badge (mid + bright tones)', await fixture(colourBadge))

  if (!wantLive) {
    console.log('\n(skipping the live half — pass --live to run it against real listings)')
    return
  }

  console.log('\n### B. LIVE LISTINGS — real artwork off the production catalogue')
  const { supabase } = await import('../lib/supabase.js')
  const names = [
    'Stick Figure Fail',
    'Golf Club Polo for the Best Dad',
    "Best By Par",
  ]
  for (const name of names) {
    const { data: rows } = await supabase
      .from('products')
      .select('id, name, metadata')
      .ilike('name', `%${name}%`)
      .limit(1)
    const product = rows?.[0]
    if (!product) {
      console.log(`\n--- ${name}: not found in the catalogue`)
      continue
    }
    const { data: assets } = await supabase
      .from('product_assets')
      .select('kind, url, created_at')
      .eq('product_id', product.id)
      .in('kind', ['dtf', 'nobg', 'source'])
      .order('created_at', { ascending: false })
    const of = (kind: string) => (assets ?? []).find(a => a.kind === kind)?.url as string | undefined
    const artwork = of('dtf') ?? of('nobg') ?? of('source')
    if (!artwork) {
      console.log(`\n--- ${product.name}: no artwork asset`)
      continue
    }
    await reportLiveUrl(`${product.name}  [${product.id.slice(0, 8)}]`, artwork, (product.metadata as any)?.shirt_color ?? null)
  }
}

main().catch(err => {
  console.error('verification run failed:', err?.message || err)
  process.exit(1)
})
