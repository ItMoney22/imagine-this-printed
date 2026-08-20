// ---------------------------------------------------------------------------
// design-e2e.ts — one design, all the way through, with nothing hand-waved.
//
// David 2026-08-19: "do 3 designs full e2e even where an agent looks at the
// design approves it all ready to go for etsy and tiktok."
//
// The stages, in order. Every one of them is a real call to the real service
// the storefront already uses — this script wires them together, it does not
// reimplement them:
//
//   1 GENERATE   runOpenAIImage (gpt-image-2) -> design PNG on GCS
//   2 COPY       title / description / tags written to clear the QA gate's
//                own SEO thresholds (the 300-char description minimum is what
//                failed 24 of the 43 live products on 2026-08-19)
//   3 PRODUCT    draft row + design_preview asset
//   4 MOCKUPS    replicate_mockup_v2 jobs -> the WORKER renders them
//   5 GALLERY    images = [design, ...mockups]  (the gate reads it this way:
//                images[0] is the artwork, images.slice(1) are the mockups)
//   6 QA         submitForQa('storefront') — the vision agent looks at the
//                rendered garment and votes. Writes an immutable
//                design_qa_reviews row + a metadata.qa_gate stamp.
//   7 ETSY       composeEtsyPack + runCopyrightGate + submitForQa('etsy')
//   8 TIKTOK     a social_outbox row, status 'draft' — the queue is
//                review-gated on purpose, so this stages the post, it does
//                NOT publish it.
//
// NOTHING GOES LIVE. Products land as status='draft'. Etsy is composed but not
// pushed (no ETSY_ENABLED here). TikTok is queued but not posted. Going live is
// a separate, human decision.
//
//   cd backend && npx tsx --env-file=.env scripts/design-e2e.ts --dry
//   cd backend && npx tsx --env-file=.env scripts/design-e2e.ts
//   cd backend && npx tsx --env-file=.env scripts/design-e2e.ts --count 1
//
// --dry prints the plan and the briefs, spends nothing, writes nothing.
// The WORKER MUST BE RUNNING for stage 4 (npm --prefix backend run worker).
// ---------------------------------------------------------------------------
import OpenAI from 'openai'
import { supabase } from '../lib/supabase.js'
import { runOpenAIImage } from '../services/image-flow/providers/openai-image.js'
import { submitForQa } from '../services/design-qa-gate.js'
import { composeEtsyPack } from '../services/etsy-seo-composer.js'
import { runCopyrightGate } from '../services/etsy-copyright-gate.js'
import { slugify, generateUniqueSlug } from '../utils/slugify.js'

const DRY = process.argv.includes('--dry')
const COUNT = Number(process.argv[process.argv.indexOf('--count') + 1]) || 3
const MOCKUP_TIMEOUT_MS = Number(process.env.E2E_MOCKUP_TIMEOUT_MS || 10 * 60 * 1000)
const REMBG_TIMEOUT_MS = Number(process.env.E2E_REMBG_TIMEOUT_MS || 4 * 60 * 1000)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-5.6-terra'

// A brief is a buyer, not a vibe. "Trash" designs come from prompts that name
// an aesthetic and no one to sell it to, so each of these names the shopper.
//
// SECOND RULE, learned the expensive way on 2026-08-19: a brief must describe a
// CONTAINED SUBJECT — an emblem, a badge, an isolated character — never a
// full-bleed scene. The original trail-runner brief asked for a sky full of
// sunburst rays with mountains below. That is a rectangle by construction: there
// is no background to remove, so it printed as a cream panel stuck on a black
// tee, and when the rembg stage tried anyway it shredded the sky into horizontal
// bands (the gate blocked that at 74/100 — correctly). The bass badge and the vet
// cat scored highest precisely because each is a contained object with dead air
// around it. Transparency is decided in the PROMPT, not in post.
interface Brief {
  key: string
  buyer: string
  prompt: string
}

const BRIEFS: Brief[] = [
  {
    key: 'trail-runner',
    buyer: 'trail runners who do early-morning long runs and buy race-day shirts',
    prompt:
      'A retro trail-running badge emblem: a lone runner cresting a ridge line, ' +
      'silhouetted against a rising sun, framed inside a heavy circular emblem border ' +
      'with layered mountain silhouettes and pine trees along the lower arc. Limited ' +
      'palette of burnt orange, cream and deep forest green. Bold woodcut linework, ' +
      'flat spot colours, distressed screen-print texture. The emblem carries no ' +
      'lettering, and the artwork ends cleanly at the circular border with nothing ' +
      'behind it.'
  },
  {
    key: 'cat-vet-tech',
    buyer: 'veterinary techs and vet nurses who buy funny work shirts for their clinic team',
    prompt:
      'A warm, funny illustration of a chunky tabby cat sitting smugly on a stack of ' +
      'clipboards wearing a tiny surgical cap. Clean bold linework, flat colours, ' +
      'cream and dusty-teal palette, thick outlines, screen-print friendly. ' +
      'The artwork contains no lettering of any kind.'
  },
  {
    key: 'bass-fishing',
    buyer: 'weekend bass fishermen aged 30-55 who buy shirts at tackle shops',
    prompt:
      'A retro tackle-box badge illustration: a largemouth bass breaking the water ' +
      'surface, framed by a heavy circular emblem border with a sunburst behind it. ' +
      'Muted 70s palette of mustard, rust, olive and cream. Bold woodcut linework, ' +
      'flat spot colours, distressed print texture. The emblem carries no lettering.'
  }
]

const log = (stage: string, msg: string) => console.log(`  [${stage.padEnd(8)}] ${msg}`)

/** Positive-descriptor DTF prompt. Image models follow "do this" far better
 *  than "don't do that", which is why the shape is described, not forbidden. */
function dtfPrompt(brief: Brief): string {
  return (
    `${brief.prompt}\n\n` +
    'Render as a standalone screen-print graphic on a fully transparent background, ' +
    'centred with even margins, high contrast, crisp edges suitable for DTF transfer ' +
    'printing at 300 DPI on a black garment. The artwork fills the frame edge to edge.'
  )
}

/**
 * Listing copy written to the gate's actual thresholds rather than to taste:
 * storefront wants a 30-70 char title and >=5 tags, and the description
 * minimum is 300 characters with the first ~155 standing alone as the mobile
 * search preview. Writing to the numbers is why these can pass on submission one.
 */
async function writeCopy(brief: Brief): Promise<{ title: string; description: string; tags: string[] }> {
  const res = await openai.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You write product listings for a US print-on-demand t-shirt shop. You write for a ' +
          'specific buyer, never in generic marketplace filler. Reply with JSON only: ' +
          '{"title": string, "description": string, "tags": string[]}. ' +
          'HARD RULES: title is 35-68 characters, plain readable English, no emoji, no commas ' +
          'stacked as keywords, and it does NOT contain any third-party brand or franchise name. ' +
          'description is AT LEAST 340 characters and at most 900. It MUST open with a single ' +
          'short sentence under 140 characters that ends in a period and stands alone as the ' +
          'mobile search preview, then a blank line, then the rest. tags is exactly 13 ' +
          'lowercase tags, each under 20 characters, and at least four of them must also appear ' +
          'as words in the title or description.'
      },
      {
        role: 'user',
        content: `The shirt design: ${brief.prompt}\n\nThe buyer: ${brief.buyer}\n\nWrite the listing.`
      }
    ],
    response_format: { type: 'json_object' }
  })
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}')
  const tags: string[] = Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t)) : []
  return {
    title: String(parsed.title ?? '').trim(),
    description: String(parsed.description ?? '').trim(),
    tags: tags.filter(Boolean).slice(0, 13)
  }
}

/** Mirrors saveDraftProductRow in routes/admin/ai-products.ts, plus the copy. */
async function createProduct(
  brief: Brief,
  copy: { title: string; description: string; tags: string[] },
  designUrl: string,
  modelId: string,
  objectPath: string
) {
  const baseSlug = slugify(copy.title.slice(0, 60))
  const { data: existing } = await supabase.from('products').select('slug').like('slug', `${baseSlug}%`)
  const slug = generateUniqueSlug(baseSlug, (existing ?? []).map((p: any) => p.slug).filter(Boolean))

  const { data: product, error } = await supabase
    .from('products')
    .insert({
      name: copy.title,
      slug,
      description: copy.description,
      price: 24.99,
      status: 'draft',
      is_active: false,
      images: [designUrl],
      category: 'shirts',
      // Required: products_print_locations_valid CHECK makes >=1 placement
      // mandatory when category='shirts'. The one-shot path sidesteps this by
      // filing shirts under 't-shirts' instead, which is part of why the
      // catalogue taxonomy is split in two.
      print_locations: ['front_image'],
      search_keywords: copy.tags.join(', '),
      metadata: {
        ai_generated: true,
        e2e_run: true,
        brief_key: brief.key,
        target_buyer: brief.buyer,
        original_prompt: brief.prompt,
        model_id: modelId,
        product_type: 'tshirt',
        shirt_color: 'black',
        print_placement: 'front-center',
        print_size_inches: 11
      }
    })
    .select('id, name, slug')
    .single()
  if (error) throw new Error(`product insert failed: ${error.message}`)

  const { data: asset, error: assetErr } = await supabase
    .from('product_assets')
    .insert({
      product_id: product.id,
      // MUST be 'source'. The worker's mockup resolution walks
      // selected > dtf > nobg > source (ai-jobs-worker.ts ~line 655) and its
      // "is there anything to render from" precheck looks for kind='source'
      // specifically — a 'design_preview' asset is invisible to both, and the
      // jobs fail with "No source image available for mockup generation".
      kind: 'source',
      // path is NOT NULL — it is the GCS object key, not the signed URL, so a
      // re-signed link never orphans the row from its bytes.
      path: objectPath,
      url: designUrl,
      is_primary: true,
      display_order: 0
    })
    .select('id')
    .single()
  if (assetErr) throw new Error(`design asset insert failed: ${assetErr.message}`)

  return { product, assetId: asset.id as string }
}

/**
 * Transparency is guaranteed HERE rather than at generation time, by putting the
 * design through the same replicate_rembg stage the product builder already uses.
 * The worker writes a kind='nobg' asset; the mockups are then rendered from that
 * asset explicitly, and it becomes the gallery's artwork image.
 *
 * A failure here is deliberately non-fatal: the run continues on the raw render so
 * the opaque-background case still reaches QA and shows up on the record.
 */
async function removeBackground(
  productId: string,
  sourceAssetId: string
): Promise<{ url: string; assetId: string } | null> {
  const { data: job, error } = await supabase
    .from('ai_jobs')
    .insert({
      product_id: productId,
      type: 'replicate_rembg',
      status: 'queued',
      input: { selected_asset_id: sourceAssetId }
    })
    .select('id')
    .single()
  if (error) {
    log('rembg', `could not queue: ${error.message} — continuing on the raw render`)
    return null
  }

  const deadline = Date.now() + REMBG_TIMEOUT_MS
  for (;;) {
    const { data: asset } = await supabase
      .from('product_assets')
      .select('id, url')
      .eq('product_id', productId)
      .eq('kind', 'nobg')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (asset?.url) {
      log('rembg', 'transparent PNG ready — mockups will print from it')
      return { url: asset.url as string, assetId: asset.id as string }
    }

    const { data: row } = await supabase
      .from('ai_jobs')
      .select('status, error')
      .eq('id', job.id)
      .maybeSingle()
    if (row?.status === 'failed') {
      log('rembg', `FAILED: ${row.error ?? 'unknown'} — falling back to the raw render`)
      return null
    }
    if (Date.now() > deadline) {
      log('rembg', 'timed out — falling back to the raw render (is the worker running?)')
      return null
    }
    await new Promise(r => setTimeout(r, 4000))
  }
}

/** The garment fan-out, matching services/product-build.ts. */
async function enqueueMockups(productId: string, designAssetId: string): Promise<number> {
  const baseInput = {
    product_type: 'shirts',
    productType: 'tshirt',
    shirtColor: 'black',
    printPlacement: 'front-center',
    printSizeInches: 11,
    selected_asset_id: designAssetId
  }
  const jobs = [
    { template: 'flat_lay' },
    { template: 'ghost_mannequin' },
    { template: 'mr_imagine' },
    { template: 'flat_lay', printPlacement: 'left-pocket' }
  ].map(extra => ({
    product_id: productId,
    type: 'replicate_mockup_v2',
    status: 'queued',
    input: { ...baseInput, ...extra }
  }))

  const { error } = await supabase.from('ai_jobs').insert(jobs)
  if (error) throw new Error(`mockup enqueue failed: ${error.message}`)
  return jobs.length
}

/** Polls until the worker has rendered them, or gives up loudly. */
async function waitForMockups(productId: string): Promise<string[]> {
  const deadline = Date.now() + MOCKUP_TIMEOUT_MS
  let lastReport = ''
  for (;;) {
    const { data: assets } = await supabase
      .from('product_assets')
      .select('url')
      .eq('product_id', productId)
      .eq('kind', 'mockup')
      .order('display_order', { ascending: true })
    const { data: jobs } = await supabase
      .from('ai_jobs')
      .select('status')
      .eq('product_id', productId)
      .eq('type', 'replicate_mockup_v2')

    const urls = (assets ?? []).map((a: any) => a.url).filter((u: any): u is string => typeof u === 'string')
    const settled = (jobs ?? []).filter((j: any) => j.status === 'succeeded' || j.status === 'failed').length
    const failed = (jobs ?? []).filter((j: any) => j.status === 'failed').length

    const report = `${urls.length} mockup(s), ${settled}/${jobs?.length ?? 0} jobs settled${failed ? `, ${failed} FAILED` : ''}`
    if (report !== lastReport) {
      log('mockups', report)
      lastReport = report
    }

    if (jobs?.length && settled >= jobs.length) return urls
    if (Date.now() > deadline) {
      log('mockups', `TIMEOUT after ${Math.round(MOCKUP_TIMEOUT_MS / 1000)}s — is the worker running?`)
      return urls
    }
    await new Promise(r => setTimeout(r, 5000))
  }
}

/** images[0] must stay the artwork; mockups follow it. The gate depends on this. */
async function syncGallery(productId: string, designUrl: string, mockupUrls: string[]): Promise<void> {
  const { error } = await supabase.from('products').update({ images: [designUrl, ...mockupUrls] }).eq('id', productId)
  if (error) throw new Error(`gallery sync failed: ${error.message}`)
}

async function stageTikTok(
  productId: string,
  copy: { title: string; description: string; tags: string[] },
  mockupUrls: string[],
  brief: Brief
): Promise<string> {
  const hook = copy.description.split(/(?<=[.!?])\s/)[0] ?? copy.title
  const { data, error } = await supabase
    .from('social_outbox')
    .insert({
      product_id: productId,
      platform: 'tiktok',
      // social_outbox_kind_check allows only 'post' | 'listing'.
      kind: 'post',
      caption: `${hook}\n\nMade for ${brief.buyer.split(' who ')[0]}.`,
      hashtags: copy.tags.slice(0, 8).map(t => `#${t.replace(/[^a-z0-9]/gi, '')}`),
      media_urls: mockupUrls.slice(0, 4),
      status: 'draft'
    })
    .select('id')
    .single()
  if (error) throw new Error(`tiktok queue failed: ${error.message}`)
  return data.id as string
}

async function runOne(brief: Brief, index: number): Promise<Record<string, any>> {
  console.log(`\n${'='.repeat(72)}`)
  console.log(`[${index + 1}/${COUNT}] ${brief.key} — for ${brief.buyer}`)
  console.log('='.repeat(72))
  const result: Record<string, any> = { brief: brief.key }

  log('generate', 'gpt-image-2, high quality, transparent-intent DTF prompt...')
  const objectPath = `ai-products/e2e/${brief.key}-${Date.now()}.png`
  const { url: designUrl, modelId } = await runOpenAIImage({
    prompt: dtfPrompt(brief),
    objectPath,
    quality: 'high',
    // 'auto' is NOT a choice — the API rejects background:'transparent' on this
    // model outright ("Transparent background is not supported for this model").
    // And 'auto' is a coin flip: on 2026-08-19 it returned clean alpha for the cat
    // and bass briefs and an OPAQUE square for the trail-runner one, which on a
    // black tee prints as a cream rectangle around the art — the cheap-POD look.
    // The gate passed that 94/100 and was not wrong to: it scores placement and
    // fidelity, the print WAS centred and faithful, and it carries no
    // background-opacity criterion. So transparency is not left to the model at
    // all — the rembg stage below is what guarantees it.
    background: 'auto'
  })
  log('generate', `design -> ${designUrl}`)

  log('copy', 'writing listing copy to the gate thresholds...')
  const copy = await writeCopy(brief)
  log('copy', `title ${copy.title.length} chars, description ${copy.description.length} chars, ${copy.tags.length} tags`)
  if (copy.description.length < 300) {
    log('copy', 'WARNING: description under 300 — the SEO criterion will block this.')
  }

  const { product, assetId } = await createProduct(brief, copy, designUrl, modelId, objectPath)
  log('product', `${product.id}  /product/${product.slug}  (draft)`)
  result.productId = product.id
  result.slug = product.slug

  log('rembg', 'stripping the background so the print is genuinely transparent...')
  const nobg = await removeBackground(product.id, assetId)
  const printAssetId = nobg?.assetId ?? assetId
  const printUrl = nobg?.url ?? designUrl
  result.transparent = Boolean(nobg)

  const queued = await enqueueMockups(product.id, printAssetId)
  log('mockups', `queued ${queued} render jobs — waiting on the worker`)
  const mockupUrls = await waitForMockups(product.id)
  if (!mockupUrls.length) {
    log('mockups', 'no mockups rendered; QA will fail on missing photos. Continuing so the failure is on the record.')
  }
  await syncGallery(product.id, printUrl, mockupUrls)
  log('gallery', `images = [design, ${mockupUrls.length} mockup(s)]`)

  log('qa', 'submitting to the vision agent (storefront channel)...')
  const store = await submitForQa({ productId: product.id, channel: 'storefront', submittedBy: 'design-e2e' })
  log('qa', `${store.verdict.status.toUpperCase()} ${store.verdict.score}/100 — ${store.verdict.blockingCount} blocking, ${store.verdict.warningCount} warning`)
  for (const item of store.verdict.rework) {
    log('qa', `  ${item.severity === 'block' ? '[BLOCK]' : '[warn] '} ${item.criterion}: ${item.issue}`)
  }
  result.storefront = { status: store.verdict.status, score: store.verdict.score, reviewId: store.reviewId }

  const gate = runCopyrightGate({ name: copy.title, description: copy.description, tags: copy.tags, aiGenerated: true })
  log('etsy', `copyright gate: ${gate.pass ? 'PASS' : 'BLOCKED — ' + gate.reasons.join('; ')}`)
  result.copyright = { pass: gate.pass, reasons: gate.reasons, matched: gate.matchedTerms }

  try {
    const pack: any = await composeEtsyPack(product.id)
    log('etsy', `pack composed: "${pack?.title ?? '(no title)'}" with ${(pack?.tags ?? []).length} tags`)
    const etsy = await submitForQa({ productId: product.id, channel: 'etsy', submittedBy: 'design-e2e' })
    log('etsy', `QA ${etsy.verdict.status.toUpperCase()} ${etsy.verdict.score}/100`)
    for (const item of etsy.verdict.rework) {
      log('etsy', `  ${item.severity === 'block' ? '[BLOCK]' : '[warn] '} ${item.criterion}: ${item.issue}`)
    }
    result.etsy = { status: etsy.verdict.status, score: etsy.verdict.score, reviewId: etsy.reviewId }
  } catch (e: any) {
    log('etsy', `pack/QA step failed: ${e?.message}`)
    result.etsy = { error: e?.message }
  }

  const outboxId = await stageTikTok(product.id, copy, mockupUrls, brief)
  log('tiktok', `queued in social_outbox as DRAFT (${outboxId}) — needs your approval before it can post`)
  result.tiktok = outboxId

  return result
}

async function main(): Promise<void> {
  // --only lets a rerun target the briefs that have not been built yet without
  // paying to regenerate the ones that already passed.
  const onlyArg = process.argv[process.argv.indexOf('--only') + 1]
  const only = process.argv.includes('--only') ? onlyArg.split(',').map(s => s.trim()) : null
  const briefs = only ? BRIEFS.filter(b => only.includes(b.key)) : BRIEFS.slice(0, COUNT)
  if (!briefs.length) throw new Error(`no briefs matched --only ${onlyArg}`)

  console.log(`\nDesign e2e — ${briefs.length} design(s)`)
  console.log(`  target DB : ${process.env.SUPABASE_URL}`)
  console.log("  products land as status='draft' — nothing goes live from this script")
  console.log('  etsy      : composed + QA reviewed, NOT published')
  console.log('  tiktok    : queued as draft in social_outbox, NOT posted\n')

  if (DRY) {
    console.log('--dry: no spend, no writes. Briefs that would run:\n')
    for (const b of briefs) {
      console.log(`  ${b.key}`)
      console.log(`    buyer : ${b.buyer}`)
      console.log(`    prompt: ${b.prompt.slice(0, 120)}...\n`)
    }
    return
  }

  const results: any[] = []
  for (const [i, brief] of briefs.entries()) {
    try {
      results.push(await runOne(brief, i))
    } catch (e: any) {
      console.log(`\n  FAILED ${brief.key}: ${e?.message}\n`)
      results.push({ brief: brief.key, error: e?.message })
    }
  }

  console.log(`\n${'='.repeat(72)}`)
  console.log('SUMMARY')
  console.log('='.repeat(72))
  for (const r of results) {
    if (r.error) {
      console.log(`  ${String(r.brief).padEnd(14)} ERROR ${r.error}`)
      continue
    }
    const s = r.storefront ? `${r.storefront.status} ${r.storefront.score}/100` : '-'
    const e = r.etsy?.score != null ? `${r.etsy.status} ${r.etsy.score}/100` : r.etsy?.error ? 'error' : '-'
    console.log(`  ${String(r.brief).padEnd(14)} storefront ${s.padEnd(16)} etsy ${e.padEnd(16)} /product/${r.slug}`)
  }
  const passed = results.filter(r => r.storefront?.status === 'passed').length
  console.log(`\n  ${passed}/${results.length} passed the storefront gate on submission #1.`)
  console.log('  Nothing is live. Activating is a separate human call.\n')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
