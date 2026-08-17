// A/B bench: single-call flux-2-pro vs the live 2-step mockup chain.
//
// WHY THIS EXISTS
//   backend/services/image-flow/worker-helpers.ts generates flat_lay and
//   ghost_mannequin mockups with a 2-step chain:
//       google/imagen-4-fast (empty garment, text-only)  ->  $0.020
//       google/nano-banana   (composite design onto it)  ->  $0.039
//                                                    total  $0.059
//   The MOCKUP_FLUX2_SINGLE_CALL prototype collapses that into ONE
//   black-forest-labs/flux-2-pro call taking the design (and optionally a
//   blank-garment photo) as reference images, at $0.015/MP in + $0.015/MP out.
//
//   The 2-step chain is not arbitrary — it exists because several single-call
//   attempts kept hallucinating a wearer / the Mr. Imagine mascot, and what
//   finally fixed it was Imagen's dedicated `negative_prompt` field. flux-2-pro
//   has NO negative_prompt and BFL warn that naming a thing to exclude can
//   summon it. So the only honest way to compare is to run all three arms on
//   the same design and grade the output.
//
// ARMS
//   A  2-step chain      imagen-4-fast -> nano-banana      (current production)
//   B  flux-2-pro x1     refs = [design]
//   C  flux-2-pro x1     refs = [blank garment, design]    (multi-reference)
//
// USAGE
//   REPLICATE_API_TOKEN=r8_... node backend/scripts/ab-mockup-flux2.mjs
//   REPLICATE_API_TOKEN=r8_... node backend/scripts/ab-mockup-flux2.mjs --color white
//
// Zero repo dependencies (global fetch only) so it runs without a backend
// npm install. Prompts below MIRROR worker-helpers.ts — if you change the
// prompts there, re-sync them here before trusting a re-run.
//
// Cost per full run: ~$0.31.

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const TOKEN = process.env.REPLICATE_API_TOKEN
if (!TOKEN) {
  console.error('REPLICATE_API_TOKEN missing')
  process.exit(1)
}

const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SHIRT_COLOR = argOf('color', 'black')
const PRODUCT_TYPE = argOf('product', 'tshirt')
const OUT_DIR = argOf('out', join(process.cwd(), 'ab-mockup-out'))
mkdirSync(OUT_DIR, { recursive: true })

const PRODUCT_NAMES = { tshirt: 't-shirt', hoodie: 'hoodie', tank: 'tank top' }
const COLOR_DESC = { black: 'black', white: 'white', gray: 'heather gray', grey: 'heather grey' }
const PLACEMENT_DESC = {
  'front-center': 'centered on the chest area',
  'left-pocket': 'small, positioned on the left chest pocket area',
  'back-only': 'large, centered on the back of the shirt',
  'pocket-front-back-full': 'small on the front-left pocket and large on the back',
}

// ---------------------------------------------------------------- replicate

async function run(modelId, input, label) {
  const t0 = Date.now()
  const res = await fetch(`https://api.replicate.com/v1/models/${modelId}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({ input }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`${modelId} ${res.status}: ${JSON.stringify(body).slice(0, 400)}`)

  let pred = body
  while (!['succeeded', 'failed', 'canceled'].includes(pred.status)) {
    await new Promise((r) => setTimeout(r, 1500))
    const p = await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${TOKEN}` } })
    pred = await p.json()
  }
  const secs = (Date.now() - t0) / 1000
  if (pred.status !== 'succeeded') {
    throw new Error(`${modelId} ${pred.status}: ${pred.error ?? 'no error msg'}`)
  }
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output
  console.log(`   ${label.padEnd(34)} ${secs.toFixed(1)}s  ${modelId}`)
  return { url, secs, predictTime: pred.metrics?.predict_time ?? null }
}

async function save(url, name) {
  const r = await fetch(url)
  const buf = Buffer.from(await r.arrayBuffer())
  const p = join(OUT_DIR, name)
  writeFileSync(p, buf)
  return p
}

// ------------------------------------------------- prompts (mirror the repo)

// worker-helpers.buildEmptyGarmentPromptPair
function emptyGarmentPromptPair(template) {
  const productName = PRODUCT_NAMES[PRODUCT_TYPE] ?? 't-shirt'
  const fabricColor = COLOR_DESC[SHIRT_COLOR] ?? 'black'
  const isWhite = SHIRT_COLOR === 'white'
  const bgDesc = isWhite
    ? 'a soft neutral light-gray seamless studio background (#d6d8dc)'
    : 'a pure white (#FFFFFF) seamless background'
  const lightAssertion = isWhite
    ? ` The ${productName} fabric is genuinely bright white (#FFFFFF) cotton — render it as a clearly white, well-lit garment that stands out against the gray backdrop; never darken, shade, or tint it gray or black.`
    : ''
  const darkNeg = isWhite
    ? ', black garment, dark garment, gray garment, charcoal shirt, navy shirt, underexposed garment, dim garment'
    : ''
  const noWearerNeg = `real human, person, face, head, hands, arms, legs, skin, model, wearer, mascot, character, cartoon character, animal, furry creature, purple character, Mr. Imagine, logos, text, graphics, print on fabric${darkNeg}`
  const noWearerOrFormNeg = `human, body, head, face, hands, arms, legs, skin, model, wearer, mannequin shape, mascot, character, cartoon character, animal, furry creature, purple character, Mr. Imagine, logos, text, graphics, print on fabric, multiple garments${darkNeg}`

  if (template === 'ghost_mannequin') {
    return {
      prompt: `Professional ghost-mannequin / invisible-mannequin product photograph of a single plain ${fabricColor} ${productName} on ${bgDesc}. The garment holds its 3D shape — shoulders filled, chest rounded, natural torso taper, slight sleeve volume, hollow collar showing the inside fabric — as if a person had been completely removed from the photo. Standard Amazon / Shopify listing photography. Soft grounding shadow, clean even studio e-commerce lighting.${lightAssertion} Just the empty hollow garment, centered, e-commerce catalog quality.`,
      negativePrompt: noWearerNeg,
    }
  }
  return {
    prompt: `Professional flat-lay catalog photograph of a single plain ${fabricColor} ${productName}, laid flat by itself on ${bgDesc}. Camera shoots straight down — top-down overhead view. Fabric lies flat with slight natural texture and minor wrinkles, soft even studio lighting, subtle grounding shadow.${lightAssertion} Just the empty garment laid flat, nothing else in the frame.`,
    negativePrompt: noWearerOrFormNeg,
  }
}

// worker-helpers.buildCompositePrompt
function compositePrompt(template) {
  const productName = PRODUCT_NAMES[PRODUCT_TYPE] ?? 't-shirt'
  const placement = PLACEMENT_DESC['front-center']
  const forbiddenList =
    template === 'ghost_mannequin'
      ? `do NOT add a real human wearer, model, mascot, character, cartoon character, animal, furry creature, purple character, or "Mr. Imagine" into the scene. Do NOT add any face, head, hands, arms, or skin. Keep the invisible-mannequin garment form from INPUT 1 exactly as-is — empty and unworn.`
      : `do NOT add a wearer, model, mannequin, mascot, character, cartoon character, animal, furry creature, purple character, or "Mr. Imagine" into the scene. Do NOT add any body, head, face, hands, arms, or skin. Keep the flat-lay garment from INPUT 1 exactly as-is.`
  return `INPUT 1 is a product photograph of an empty plain ${productName}. INPUT 2 is a flat 2D graphic design (a decal / DTF print artwork). Task: print the graphic from INPUT 2 onto the ${productName} in INPUT 1, ${placement}. Preserve INPUT 1 exactly — same scene, same camera angle, same lighting, same background, same garment shape, same fabric color, no wearer added. Preserve INPUT 2's colors, shapes, and proportions exactly. Make the print look like a realistic DTF transfer on cotton — sized correctly, conforming to the fabric's curvature and folds. STRICTLY FORBIDDEN: ${forbiddenList} The garment stays empty exactly as in INPUT 1 — the only change is that the graphic from INPUT 2 now appears printed on the fabric. Output a single composited photograph: the unchanged empty-garment scene from INPUT 1, with the graphic from INPUT 2 printed on the garment, nothing else added.`
}

// worker-helpers.buildFlux2SingleCallPrompt — positive-only, no exclusions.
function flux2SingleCallPrompt(template, hasGarmentRef) {
  const productName = PRODUCT_NAMES[PRODUCT_TYPE] ?? 't-shirt'
  const fabricColor = COLOR_DESC[SHIRT_COLOR] ?? 'black'
  const placement = PLACEMENT_DESC['front-center']
  const isWhite = SHIRT_COLOR === 'white'
  const bgDesc = isWhite
    ? 'a soft neutral light-gray seamless studio background (#d6d8dc)'
    : 'a pure white (#FFFFFF) seamless background'
  const lightAssertion = isWhite
    ? ` The fabric is bright white (#FFFFFF) cotton, well lit and clearly lighter than the gray backdrop.`
    : ''
  const designIdx = hasGarmentRef ? 'image 2' : 'image 1'
  const garmentClause = hasGarmentRef
    ? `Image 1 is a photograph of the blank ${fabricColor} ${productName} — keep its exact fabric colour, cut, and proportions. `
    : ''
  const sceneDesc =
    template === 'ghost_mannequin'
      ? `Professional ghost-mannequin product photograph of a single ${fabricColor} ${productName} on ${bgDesc}. The garment is empty and unworn and holds its own three-dimensional shape — shoulders filled out, chest rounded, natural torso taper, slight sleeve volume, and a hollow collar opening that reveals the inside of the fabric, as an invisible-mannequin e-commerce catalog shot. Soft grounding shadow, clean even studio lighting.`
      : `Professional flat-lay catalog photograph of a single ${fabricColor} ${productName} lying flat and unworn on ${bgDesc}, photographed straight down from directly overhead. The fabric lies flat with soft natural texture and minor natural wrinkles, soft even studio lighting, subtle grounding shadow.`

  return `${garmentClause}${sceneDesc}${lightAssertion} The artwork in ${designIdx} is printed on the ${productName} ${placement}, rendered as a realistic DTF transfer on cotton that follows the fabric's curvature and folds while preserving the artwork's exact colours, shapes, and proportions. The frame contains only the empty garment resting on an uninterrupted seamless backdrop, photographed as a clean product-only e-commerce listing image.`
}

// ------------------------------------------------------------------- arms

const FLUX2 = 'black-forest-labs/flux-2-pro'
const IMAGEN = 'google/imagen-4-fast'
const NANO = 'google/nano-banana'

async function armA(template, designUrl) {
  const { prompt, negativePrompt } = emptyGarmentPromptPair(template)
  const scene = await run(
    IMAGEN,
    { prompt, negative_prompt: negativePrompt, aspect_ratio: '1:1', safety_filter_level: 'block_only_high' },
    `A1 ${template} scene`
  )
  const comp = await run(
    NANO,
    { prompt: compositePrompt(template), image_input: [scene.url, designUrl], aspect_ratio: '1:1', output_format: 'png' },
    `A2 ${template} composite`
  )
  return { url: comp.url, secs: scene.secs + comp.secs, costUsd: 0.059, sceneUrl: scene.url }
}

async function armB(template, designUrl) {
  const r = await run(
    FLUX2,
    {
      prompt: flux2SingleCallPrompt(template, false),
      input_images: [designUrl],
      aspect_ratio: '1:1',
      output_format: 'png',
      resolution: '1 MP',
      safety_tolerance: 5,
    },
    `B  ${template} flux2 x1ref`
  )
  return { url: r.url, secs: r.secs, costUsd: 0.03 }
}

async function armC(template, designUrl, garmentUrl) {
  const r = await run(
    FLUX2,
    {
      prompt: flux2SingleCallPrompt(template, true),
      input_images: [garmentUrl, designUrl],
      aspect_ratio: '1:1',
      output_format: 'png',
      resolution: '1 MP',
      safety_tolerance: 5,
    },
    `C  ${template} flux2 x2ref`
  )
  return { url: r.url, secs: r.secs, costUsd: 0.045 }
}

/**
 * Run one arm, recording a failure instead of aborting the bench.
 *
 * This matters: flux-2-pro DOES intermittently refuse benign garment mockups
 * with "flagged as sensitive (E005)" even at safety_tolerance 5 — the same
 * false-positive class that got Imagen 4 Ultra excluded from the design
 * fan-out. A bench that dies on the first refusal can't measure how often it
 * happens, which is exactly the number worth knowing.
 */
async function attempt(fn) {
  try {
    return await fn()
  } catch (e) {
    const msg = e?.message ?? String(e)
    console.log(`   !! ARM FAILED: ${msg.slice(0, 160)}`)
    return { url: null, secs: 0, costUsd: 0, error: msg }
  }
}

// -------------------------------------------------------------------- main

async function main() {
  console.log(`[ab] color=${SHIRT_COLOR} product=${PRODUCT_TYPE} out=${OUT_DIR}\n`)

  // A DTF-style design: bold, flat, high-contrast, isolated — matches what the
  // real design fan-out produces for garment categories.
  console.log('[ab] 0. design asset')
  const design = await run(
    FLUX2,
    {
      prompt:
        'A bold flat vector graphic of a roaring tiger head in vivid orange and teal with thick black linework, centred, isolated on a plain solid white background, screen-print style illustration with clean flat colour fills, no scene or environment around it.',
      aspect_ratio: '1:1',
      output_format: 'png',
      resolution: '1 MP',
      safety_tolerance: 5,
    },
    '   design (flux-2-pro t2i)'
  )
  await save(design.url, 'design.png')

  const results = []
  for (const template of ['flat_lay', 'ghost_mannequin']) {
    console.log(`\n[ab] ${template}`)

    // Blank garment reference for arm C — one text-to-image flux-2-pro call.
    // In production this would be a real photo of the blank product.
    const { prompt: blankPrompt } = emptyGarmentPromptPair(template)
    const blank = await attempt(() =>
      run(
        FLUX2,
        { prompt: blankPrompt, aspect_ratio: '1:1', output_format: 'png', resolution: '1 MP', safety_tolerance: 5 },
        `   blank garment ref`
      )
    )
    if (blank.url) await save(blank.url, `${template}-blank-ref.png`)

    const a = await attempt(() => armA(template, design.url))
    if (a.sceneUrl) await save(a.sceneUrl, `${template}-A-step1-scene.png`)
    if (a.url) await save(a.url, `${template}-A-2step.png`)

    const b = await attempt(() => armB(template, design.url))
    if (b.url) await save(b.url, `${template}-B-flux2-1ref.png`)

    const c = blank.url
      ? await attempt(() => armC(template, design.url, blank.url))
      : { url: null, secs: 0, costUsd: 0, error: 'no blank garment ref' }
    if (c.url) await save(c.url, `${template}-C-flux2-2ref.png`)

    results.push({ template, a, b, c })
  }

  console.log('\n=== RESULTS ===')
  console.log('template          arm                       secs    cost   status')
  const row = (tpl, name, r) =>
    console.log(
      `${tpl.padEnd(17)} ${name.padEnd(24)} ${r.secs.toFixed(1).padStart(5)}  $${r.costUsd.toFixed(3)}  ${r.error ? 'FAILED: ' + r.error.slice(0, 60) : 'ok'}`
    )
  for (const r of results) {
    row(r.template, 'A 2-step chain', r.a)
    row('', 'B flux-2-pro 1 ref', r.b)
    row('', 'C flux-2-pro 2 refs', r.c)
  }
  console.log(`\nImages written to ${OUT_DIR}`)
  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify({ SHIRT_COLOR, PRODUCT_TYPE, design: design.url, results }, null, 2))
}

main().catch((e) => {
  console.error('[ab] FAILED:', e?.message ?? e)
  process.exit(1)
})
