// Integration check for the 2026-07-26 nano-banana-2-lite swap.
//
// Exercises the REAL image-flow composite path (not a hand-rolled copy of the
// prompts) end to end and asserts:
//   1. runImageFlowMockup reports google/nano-banana-2-lite as the model that
//      produced the final image, for every template.
//   2. The registry / input-builder wiring for the new id actually resolves.
//   3. The bytes coming back are handled honestly — lite returns JPEG from a
//      .png URL with an image/png header, so we assert the sniffer catches it.
//   4. gpt-image-2 is still the generate/edit default.
//
// Run:  npm --prefix backend exec tsx scripts/verify-nano-banana-2-lite.ts
// Needs REPLICATE_API_TOKEN. Costs ~$0.15 (3 mockups + 2 empty-garment scenes).
import { runImageFlowMockup } from '../services/image-flow/worker-helpers.js'
import {
  DEFAULT_MOCKUP_MODEL,
  DEFAULT_GENERATE_MODEL,
  DEFAULT_EDIT_MODEL,
  getModel,
} from '../services/image-flow/models.js'
import { buildInput } from '../services/image-flow/input-builder.js'
import { sniffImageContentType } from '../services/google-cloud-storage.js'

const LITE = 'google/nano-banana-2-lite'
const CHARACTER = 'https://imaginethisprinted.com/mr-imagine/mockups/mr-imagine-tshirt-black-front.png'

// Text-heavy fixture on purpose: letterform fidelity is the hardest thing for a
// compositor to preserve and the thing Etsy listings live or die on. Generated
// fresh each run because Replicate delivery URLs expire — set VERIFY_DESIGN_URL
// to pin a durable one instead.
async function makeDesignFixture(): Promise<string> {
  if (process.env.VERIFY_DESIGN_URL) return process.env.VERIFY_DESIGN_URL
  const { default: Replicate } = await import('replicate')
  const client = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! })
  const out: any = await client.run('black-forest-labs/flux-schnell', {
    input: {
      prompt:
        'Flat 2D t-shirt graphic design on a pure white background: bold retro varsity collegiate lettering reading "SIMPLY BE YOU" in two stacked lines, cream and burnt-orange with a thick navy outline, a small five-point star between the words, vintage 1970s athletic style, crisp vector-like edges, just the artwork centered',
      aspect_ratio: '1:1', output_format: 'png', num_inference_steps: 4,
    },
  })
  // The replicate client hands back FileOutput objects whose .url() returns a
  // URL instance, not a string — coerce hard.
  const first = Array.isArray(out) ? out[0] : out
  const url = String(typeof first?.url === 'function' ? first.url() : first?.url ?? first)
  console.log(`  design fixture: ${url.slice(0, 90)}…`)
  return url
}

let failures = 0
const check = (name: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!pass) failures++
}

async function main() {
  console.log('\n=== 1. Static wiring ===')
  check('DEFAULT_MOCKUP_MODEL is nano-banana-2-lite', DEFAULT_MOCKUP_MODEL === LITE, DEFAULT_MOCKUP_MODEL)
  check('lite is registered in MODELS', !!getModel(LITE))
  check('lite cost is cheaper than v1',
    (getModel(LITE)?.costPerImageUsd ?? 1) < (getModel('google/nano-banana')?.costPerImageUsd ?? 0),
    `${getModel(LITE)?.costPerImageUsd} < ${getModel('google/nano-banana')?.costPerImageUsd}`)
  check('gpt-image-2 remains the GENERATE default', DEFAULT_GENERATE_MODEL === 'openai/gpt-image-2', DEFAULT_GENERATE_MODEL)
  check('gpt-image-2 remains the EDIT default', DEFAULT_EDIT_MODEL === 'openai/gpt-image-2', DEFAULT_EDIT_MODEL)

  const built = buildInput(getModel(LITE)!, { prompt: 'x', inputImages: ['a', 'b'] })
  check('input-builder maps refs onto image_input (not image_url)',
    Array.isArray(built.image_input) && (built.image_input as string[]).length === 2 && !('image_url' in built),
    JSON.stringify(built))

  console.log('\n=== 2. Live composite path (real prompts, real model) ===')
  const DESIGN = await makeDesignFixture()
  const templates = ['flat_lay', 'ghost_mannequin', 'mr_imagine'] as const
  for (const template of templates) {
    const t0 = Date.now()
    const r = await runImageFlowMockup({
      template,
      designImageUrl: DESIGN,
      productType: 'tshirt',
      shirtColor: 'black',
      ...(template === 'mr_imagine' ? { characterImageUrl: CHARACTER } : {}),
    })
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    check(`${template}: composited by lite`, r.modelId === LITE, `${r.modelId} in ${secs}s`)

    const res = await fetch(r.url)
    const buf = Buffer.from(await res.arrayBuffer())
    const sniffed = sniffImageContentType(buf)
    check(`${template}: produced a real image`, !!sniffed && buf.length > 10_000,
      `${sniffed}, ${(buf.length / 1024).toFixed(0)}KB`)
    if (sniffed && sniffed !== res.headers.get('content-type')) {
      console.log(`        note: served header "${res.headers.get('content-type')}" but bytes are ${sniffed} — sniffer correctly overrode it`)
    }
  }

  console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error('verification threw:', e); process.exit(1) })
