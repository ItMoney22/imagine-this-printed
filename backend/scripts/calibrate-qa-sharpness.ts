// ---------------------------------------------------------------------------
// Calibration tool for the presentation QA gate's image thresholds.
//
// The sharpness bar in services/presentation-qa.ts is a number, and a number
// pulled out of the air is worse than no check at all — it either blocks good
// work or waves through the blur it was meant to catch. This script measures
// the LIVE catalogue so the bar is set from the real corpus, and then proves
// the metric actually separates sharp from soft by running two ladders:
//
//   blur ladder     the sharpest real image, progressively blurred
//   upscale ladder  a real image thrown away and blown back up to 2000px,
//                   which is the failure a pixel-count-only check waves through
//
// Read-only. Run it again after any change to how mockups are rendered:
//   cd backend && npx tsx --env-file=.env scripts/calibrate-qa-sharpness.ts
// ---------------------------------------------------------------------------
import sharp from 'sharp'
import { supabase } from '../lib/supabase.js'
import { measureImage, laplacianStats, LAPLACIAN_SAMPLE_PX } from '../services/image-metrics.js'

const pct = (arr: number[], p: number): number => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}

const measureBuffer = async (buf: Buffer): Promise<{ variance: number; meanAbs: number }> => {
  const { data, info } = await sharp(buf)
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(LAPLACIAN_SAMPLE_PX, LAPLACIAN_SAMPLE_PX, { fit: 'outside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return laplacianStats(data, info.width, info.height)
}

async function main(): Promise<void> {
  const sampleSize = Number(process.argv[2] || 60)

  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, images, metadata, status')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error

  const samples: Array<{ label: string; url: string; kind: string }> = []
  for (const p of data ?? []) {
    const shots: string[] = (p as any).metadata?.etsy_shots?.images ?? []
    for (const s of shots.slice(0, 2)) if (typeof s === 'string') samples.push({ label: p.name, url: s, kind: 'etsy_shot' })
    const imgs: unknown[] = Array.isArray(p.images) ? p.images : []
    for (const s of imgs.slice(0, 1)) if (typeof s === 'string') samples.push({ label: p.name, url: s, kind: 'catalog' })
  }

  console.log(`candidates: ${data?.length ?? 0} active products -> ${samples.length} image samples`)
  const picked = samples.slice(0, sampleSize)

  const results: Array<{ label: string; kind: string; width: number; height: number; shortEdge: number; sharpness: number; edgeEnergy: number; url: string }> = []
  for (const s of picked) {
    const m = await measureImage(s.url)
    if (m.ok) {
      results.push({ label: s.label, kind: s.kind, width: m.width, height: m.height, shortEdge: m.shortEdge, sharpness: m.sharpness, edgeEnergy: m.edgeEnergy, url: s.url })
      console.log(`${m.width}x${m.height}\tshort=${m.shortEdge}\tsharp=${m.sharpness}\tedge=${m.edgeEnergy}\t${s.kind}\t${s.label.slice(0, 42)}`)
    } else {
      console.log(`FAIL\t${m.error}\t${s.kind}\t${s.url.slice(0, 90)}`)
    }
  }

  if (!results.length) { console.log('no measurable images'); return }

  const sharpVals = results.map(r => r.sharpness)
  const shortVals = results.map(r => r.shortEdge)
  console.log(`\n--- distribution over ${results.length} real images ---`)
  console.log(`sharpness  p05 ${pct(sharpVals, 0.05)}  p10 ${pct(sharpVals, 0.1)}  p25 ${pct(sharpVals, 0.25)}  p50 ${pct(sharpVals, 0.5)}  p75 ${pct(sharpVals, 0.75)}  p95 ${pct(sharpVals, 0.95)}`)
  console.log(`short edge p05 ${pct(shortVals, 0.05)}  p25 ${pct(shortVals, 0.25)}  p50 ${pct(shortVals, 0.5)}  p95 ${pct(shortVals, 0.95)}`)

  const best = results.reduce((a, b) => (a.sharpness > b.sharpness ? a : b))
  const res = await fetch(best.url)
  const buf = Buffer.from(await res.arrayBuffer())

  console.log(`\nblur ladder on "${best.label.slice(0, 42)}" (measured ${best.sharpness}):`)
  for (const sigma of [0, 0.6, 1, 1.5, 2.5, 4]) {
    const src = sigma > 0 ? await sharp(buf).blur(sigma).toBuffer() : buf
    const st = await measureBuffer(src)
    console.log(`  blur sigma ${sigma}\tsharpness ${st.variance.toFixed(2)}\tedge ${st.meanAbs.toFixed(2)}`)
  }

  console.log('\nupscale ladder (throw detail away, blow back up to 2000px):')
  for (const small of [1600, 800, 400, 200]) {
    const shrunk = await sharp(buf).resize(small, small, { fit: 'inside' }).toBuffer()
    const blown = await sharp(shrunk).resize(2000, 2000, { fit: 'inside' }).toBuffer()
    const st = await measureBuffer(blown)
    console.log(`  true detail ${small}px shown as 2000px\tsharpness ${st.variance.toFixed(2)}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
