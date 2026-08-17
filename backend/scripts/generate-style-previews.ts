// Generates one preview image per art-style preset so the CreateDesignModal
// picker can show actual style samples instead of just emoji + label.
//
// Strategy:
//   * Same neutral subject ("a majestic tiger portrait") rendered in each
//     style. A consistent subject lets users see ONLY the stylistic delta.
//   * Routes through the same Flux 2 Pro + GCS persist path the live
//     /api/imagination-station/ai/generate endpoint uses, so previews look
//     EXACTLY like what users will get.
//   * Saves to a stable, predictable GCS path (`style-previews/{key}.jpg`)
//     so the frontend can hardcode the URLs without a DB lookup.
//
// Usage (one-off):
//   cd backend
//   npx tsx --env-file=.env scripts/generate-style-previews.ts
//
// Cost: ~$0.015 per style × 7 styles = ~$0.11 in Replicate credits (was ~$0.42
// on flux-1.1-pro-ultra at $0.06/image). Safe to re-run if you change the
// styles list — same paths get overwritten.

import '../load-env.js'
import Replicate from 'replicate'
import { uploadImageFromUrl } from '../services/google-cloud-storage.js'
import { AI_STYLES } from '../config/imagination-presets.js'

const SUBJECT = 'a majestic tiger portrait, head and shoulders'

// Flux 2 Pro — $0.015/MP in + $0.015/MP out, so a 1 MP text-to-image run is
// ~$0.015 vs $0.06 on flux-1.1-pro-ultra (75% cheaper) at comparable quality.
// NOTE: flux-2-pro has NO negative_prompt parameter and BFL explicitly warns
// that phrasing things as exclusions ("no background") can summon them —
// describe the desired result positively instead.
const PREVIEW_MODEL = 'black-forest-labs/flux-2-pro'

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! })

interface PreviewResult {
  key: string
  label: string
  url: string
}

function extractUrl(out: any): string {
  if (typeof out === 'string') return out
  if (Array.isArray(out)) return extractUrl(out[0])
  if (out && typeof out.url === 'function') {
    const u = out.url()
    return typeof u === 'string' ? u : u?.toString?.() ?? ''
  }
  if (out && typeof out === 'object' && 'href' in out) return String(out.href)
  return String(out)
}

async function generateOne(style: typeof AI_STYLES[number]): Promise<PreviewResult> {
  const prompt = `${SUBJECT}, ${style.prompt_suffix}, transparent background, PNG`
  console.log(`[preview-gen] ${style.key} — running Flux 2 Pro...`)
  const t0 = Date.now()
  const output = await replicate.run(PREVIEW_MODEL as `${string}/${string}`, {
    input: {
      prompt,
      aspect_ratio: '1:1',
      output_format: 'png',
      // Keep output at 1 MP — the megapixel count is what's billed, and the
      // picker renders these as small thumbnails.
      resolution: '1 MP',
      // 1 = strictest, 5 = most permissive. 2 is the model default; the
      // preview subject is a tiger portrait so no need to loosen it.
      safety_tolerance: 2,
    },
  })
  const replicateUrl = extractUrl(output)
  if (!replicateUrl) throw new Error(`No URL returned for ${style.key}`)

  // Persist to a STABLE path so we can hardcode the URL on the frontend.
  // Note: GCS public URLs in this project are signed; we'll use the public
  // direct path via uploadImageFromUrl which returns a long-lived URL.
  const objectPath = `style-previews/${style.key}.png`
  const { publicUrl } = await uploadImageFromUrl(replicateUrl, objectPath)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[preview-gen] ${style.key} ✓ ${elapsed}s — ${publicUrl.substring(0, 80)}...`)
  return { key: style.key, label: style.label, url: publicUrl }
}

async function main() {
  console.log('[preview-gen] subject:', SUBJECT)
  console.log('[preview-gen] styles:', AI_STYLES.map((s) => s.key).join(', '))
  console.log()

  const results: PreviewResult[] = []
  for (const style of AI_STYLES) {
    try {
      results.push(await generateOne(style))
    } catch (err: any) {
      console.error(`[preview-gen] ${style.key} ✗`, err?.message ?? err)
    }
  }

  console.log()
  console.log('=== STYLE PREVIEW URLs ===')
  console.log('Paste this into src/components/CreateDesignModal.tsx STYLE_PRESETS:')
  console.log()
  for (const r of results) {
    console.log(`  // ${r.label}`)
    console.log(`  '${r.key}': '${r.url}',`)
  }
}

main().catch((e) => { console.error('[preview-gen] ❌', e?.message ?? e); process.exit(1) })
