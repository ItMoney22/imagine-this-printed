// A/B/C bake-off: Nano Banana 2.1 vs flux-2-pro vs GPT Image 2.5 Flare on 20
// real ITP products, graded by the EXISTING fidelity QA (board task d9c0e648).
//
// WHY THIS EXISTS
//   Nano Banana 2.1 went GA 2026-10-06 and its model card admits poor small
//   text at 1K. Before any generative default moves, every candidate draws the
//   same 20 real products and the production QA judges them. The winner is
//   picked on QA pass rate, never price. This script changes NO default: it
//   calls each engine directly and never touches the worker or the catalog.
//
// THE TEST SET  (scripts/fixtures/image-model-bakeoff-20.json)
//   10 mockups   (flat_lay / ghost_mannequin, the production single-call
//                 flux-2-pro prompt from worker-helpers.buildFlux2SingleCallPrompt)
//   10 on-person (the production gpt-image prompt, etsy-model-shots.buildGptPrompt,
//                 with a FIXED persona + scene per product so all three engines
//                 get byte-identical prompts)
//   12 of the 20 designs carry lettering, 4 of them small lettering.
//
// THE QA  (unchanged production code)
//   mockup    -> services/mockup-qa.checkMockup        (fidelity + coverage)
//   on_person -> services/etsy-model-shots.verifyShot  (holistic + word-by-word)
//   ONE render per product per engine, no corrective retry: first-pass rate is
//   the clean comparison (production buys one retry for every engine alike).
//
// ENGINES (all at ~1 MP, so the "small text at 1K" weakness is what is tested)
//   nano-banana-2.1  Gemini API generateContent, imageSize 1K   (GEMINI_API_KEY)
//   flux-2-pro       Replicate black-forest-labs/flux-2-pro, 1 MP (REPLICATE_API_TOKEN)
//   gpt-image-2.5-flare  OpenAI images.edit, quality high       (OPENAI_API_KEY)
//
// RUN (from backend/):
//   SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=x \
//   OPENAI_API_KEY=... REPLICATE_API_TOKEN=... GEMINI_API_KEY=... \
//   npx tsx scripts/ab-image-models-bakeoff.ts [--out dir] [--only 1,2,3]
// The dummy Supabase env is deliberate: nothing here may read or write the DB.
// Re-running resumes: a product/engine pair already in results.json is skipped.
//
// Cost per full run, list prices 2026-10-09: ~60 renders + ~120 QA vision calls,
// roughly $8-10 (Flare high at 1024x1536 is most of it).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI, { toFile } from 'openai'
import { buildFlux2SingleCallPrompt, type RunMockupOpts } from '../services/image-flow/worker-helpers.js'
import { buildGptPrompt, verifyShot, type ShotPlan } from '../services/etsy-model-shots.js'
import { checkMockup } from '../services/mockup-qa.js'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const argOf = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const OUT_DIR = argOf('out', join(process.cwd(), 'bakeoff-out'))
const ONLY = argOf('only', '')
  .split(',')
  .filter(Boolean)
  .map(Number)
mkdirSync(OUT_DIR, { recursive: true })

interface Product {
  idx: number
  productId: string
  name: string
  status: string
  arm: 'mockup' | 'on_person'
  template?: 'flat_lay' | 'ghost_mannequin'
  shirtColor: 'black' | 'white'
  productType: 'tshirt' | 'hoodie'
  garmentNoun?: string
  persona?: string
  scene?: string
  designUrl: string
  designKind: 'art' | 'text' | 'small-text'
}

const ENGINES = ['nano-banana-2.1', 'flux-2-pro', 'gpt-image-2.5-flare'] as const
type Engine = (typeof ENGINES)[number]

const products: Product[] = JSON.parse(readFileSync(join(here, 'fixtures/image-model-bakeoff-20.json'), 'utf8'))
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ------------------------------------------------------------------ prompts

function promptFor(p: Product): { prompt: string; aspect: '1:1' | '3:4'; openaiSize: '1024x1024' | '1024x1536' } {
  if (p.arm === 'mockup') {
    const opts: RunMockupOpts = {
      template: p.template!,
      designImageUrl: p.designUrl,
      productType: p.productType,
      shirtColor: p.shirtColor,
      printPlacement: 'front-center',
      printSizeInches: 11,
    }
    return { prompt: buildFlux2SingleCallPrompt(opts), aspect: '1:1', openaiSize: '1024x1024' }
  }
  const plan: ShotPlan = {
    key: `bakeoff-${p.idx}`,
    label: 'bake-off model',
    persona: p.persona!,
    scene: p.scene!,
    treatment: 'shot on a 50mm lens at f/2.8 in natural window light',
    signature: `bakeoff-${p.idx}`,
    variant: `BAKE${String(p.idx).padStart(2, '0')}`,
    audience: 'adult',
  }
  return {
    prompt: buildGptPrompt(plan, p.shirtColor, 'front-center', 11, p.garmentNoun ?? 'crew neck t-shirt'),
    aspect: '3:4',
    openaiSize: '1024x1536',
  }
}

// ------------------------------------------------------------------ engines

async function fetchBytes(url: string): Promise<Buffer> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`fetch ${url.slice(0, 80)} -> ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

const designCache = new Map<string, Buffer>()
async function design(p: Product): Promise<Buffer> {
  if (!designCache.has(p.designUrl)) designCache.set(p.designUrl, await fetchBytes(p.designUrl))
  return designCache.get(p.designUrl)!
}

async function drawNano(p: Product, prompt: string, aspect: string): Promise<Buffer> {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent',
    {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { parts: [{ inline_data: { mime_type: 'image/png', data: (await design(p)).toString('base64') } }, { text: prompt }] },
        ],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: '1K' } },
      }),
    }
  )
  const body: any = await res.json()
  if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  const part = body?.candidates?.[0]?.content?.parts?.find((x: any) => x.inlineData)
  if (!part) throw new Error(`gemini: no image (${body?.candidates?.[0]?.finishReason ?? 'no candidate'})`)
  return Buffer.from(part.inlineData.data, 'base64')
}

// A Replicate account under its credit floor is throttled to 6 creations a
// minute with a burst of 1 (seen live 2026-10-09). A 429 is the account, not
// the model, so flux calls go one at a time and a 429 waits and retries instead
// of being scored as a flux-2-pro failure.
let fluxQueue: Promise<unknown> = Promise.resolve()
function drawFlux(p: Product, prompt: string, aspect: string): Promise<Buffer> {
  const next = fluxQueue.then(() => drawFluxNow(p, prompt, aspect))
  fluxQueue = next.catch(() => undefined)
  return next
}

async function drawFluxNow(p: Product, prompt: string, aspect: string): Promise<Buffer> {
  const token = process.env.REPLICATE_API_TOKEN
  let res: Response
  let pred: any
  for (let attempt = 0; ; attempt++) {
    res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-2-pro/predictions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({
        input: { prompt, input_images: [p.designUrl], aspect_ratio: aspect, output_format: 'png', resolution: '1 MP', safety_tolerance: 5 },
      }),
    })
    pred = await res.json()
    if (res.status !== 429 || attempt >= 8) break
    await new Promise((r) => setTimeout(r, 1000 * Math.max(11, Number(pred?.retry_after) || 0)))
  }
  if (!res.ok) throw new Error(`replicate ${res.status}: ${JSON.stringify(pred).slice(0, 300)}`)
  while (!['succeeded', 'failed', 'canceled'].includes(pred.status)) {
    await new Promise((r) => setTimeout(r, 1500))
    pred = await (await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${token}` } })).json()
  }
  if (pred.status !== 'succeeded') throw new Error(`flux-2-pro ${pred.status}: ${pred.error ?? ''}`)
  return fetchBytes(Array.isArray(pred.output) ? pred.output[0] : pred.output)
}

async function drawFlare(p: Product, prompt: string, size: string): Promise<Buffer> {
  const res: any = await openai.images.edit({
    model: 'gpt-image-2.5-flare',
    image: await toFile(await design(p), 'design.png', { type: 'image/png' }),
    prompt,
    size: size as any,
    quality: 'high',
    ...(p.arm === 'mockup' ? { moderation: 'low' } : {}),
  } as any)
  const b64 = res?.data?.[0]?.b64_json
  if (!b64) throw new Error('flare: no image returned')
  return Buffer.from(b64, 'base64')
}

// --------------------------------------------------------------------- QA

function mimeOf(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.slice(8, 12).toString() === 'WEBP') return 'image/webp'
  return 'image/png'
}

/**
 * The reason text, sorted into the flags the task asks for. The QA returns one
 * sentence naming the single worst defect, so this is a reading of that
 * sentence, not a second judge.
 */
export function flagsFor(reason: string | undefined): string[] {
  if (!reason) return []
  const r = reason.toLowerCase()
  const flags: string[] = []
  if (/redrawn|re-drawn|restyl|re-illustrat|redraw|different (style|illustration|character)|simplif|altered|reinterpret/.test(r)) flags.push('art_redrawn')
  if (/text|word|letter|spell|typeface|font|legib|readable|wording|lettering/.test(r)) flags.push('text')
  if (/too small to read|illegible|blurr|unreadable|cannot read|can't read|not legible/.test(r)) flags.push('small_text_unreadable')
  if (/colou?r|instead of (white|black|gr[ae]y|red|blue|green|yellow|orange|purple|pink)|tint|hue/.test(r)) flags.push('color')
  if (/added|extra|invent|logo|watermark/.test(r)) flags.push('added_elements')
  // A missing WORD is a text defect, already flagged above; this one is art.
  if (/cropped|hidden|obscur|cut off|covered/.test(r) || (/missing/.test(r) && !flags.includes('text'))) flags.push('missing_or_hidden')
  if (/panel|box|rectangle|frame|backdrop|square/.test(r)) flags.push('framed_panel')
  if (/too large|too big|size|coverage|all-over|edge to edge/.test(r)) flags.push('coverage')
  return flags.length ? flags : ['other']
}

async function grade(p: Product, shot: Buffer): Promise<{ ok: boolean | null; reason?: string; failed?: string }> {
  const dataUrl = `data:${mimeOf(shot)};base64,${shot.toString('base64')}`
  if (p.arm === 'mockup') {
    const c = await checkMockup(p.designUrl, dataUrl, 'front-center', 11)
    return c ? { ok: c.ok, reason: c.reason, failed: c.failed } : { ok: null, reason: 'QA unavailable' }
  }
  const c = await verifyShot(p.designUrl, dataUrl, p.shirtColor)
  return c ? { ok: c.ok, reason: c.reason } : { ok: null, reason: 'QA unavailable' }
}

// ------------------------------------------------------------------- main

interface Row {
  idx: number
  productId: string
  name: string
  arm: string
  designKind: string
  engine: Engine
  ok: boolean | null
  reason?: string
  failedGate?: string
  flags: string[]
  renderError?: string
  secs: number
  file?: string
}

const resultsPath = join(OUT_DIR, 'results.json')
const results: Row[] = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : []
const save = () => writeFileSync(resultsPath, JSON.stringify(results, null, 2))

async function runOne(p: Product, engine: Engine): Promise<void> {
  const prior = results.find((r) => r.idx === p.idx && r.engine === engine && !r.renderError)
  // A render whose QA call errored is re-graded from the saved file, never re-drawn.
  if (prior?.ok === null && prior.file && existsSync(join(OUT_DIR, prior.file))) {
    const v = await grade(p, readFileSync(join(OUT_DIR, prior.file)))
    Object.assign(prior, { ok: v.ok, reason: v.reason, failedGate: v.failed, flags: v.ok === false ? flagsFor(v.reason) : [] })
    save()
    console.log(`[${p.idx}] ${engine} re-graded: ${v.ok === true ? 'PASS' : v.ok === null ? 'QA?' : 'FAIL'} ${v.reason ?? ''}`)
    return
  }
  if (prior) {
    // Flags are a reading of the stored reason, so they are refreshed for free.
    if (prior.ok === false) prior.flags = flagsFor(prior.reason)
    save()
    return
  }
  const { prompt, aspect, openaiSize } = promptFor(p)
  const t0 = Date.now()
  let row: Row
  try {
    const shot =
      engine === 'nano-banana-2.1'
        ? await drawNano(p, prompt, aspect)
        : engine === 'flux-2-pro'
          ? await drawFlux(p, prompt, aspect)
          : await drawFlare(p, prompt, openaiSize)
    const ext = mimeOf(shot).split('/')[1].replace('jpeg', 'jpg')
    const file = `${String(p.idx).padStart(2, '0')}-${p.arm}-${engine}.${ext}`
    writeFileSync(join(OUT_DIR, file), shot)
    const v = await grade(p, shot)
    row = {
      idx: p.idx, productId: p.productId, name: p.name, arm: p.arm, designKind: p.designKind, engine,
      ok: v.ok, reason: v.reason, failedGate: v.failed, flags: v.ok === false ? flagsFor(v.reason) : [],
      secs: (Date.now() - t0) / 1000, file,
    }
  } catch (e: any) {
    row = {
      idx: p.idx, productId: p.productId, name: p.name, arm: p.arm, designKind: p.designKind, engine,
      ok: false, flags: ['render_failed'], renderError: String(e?.message ?? e).slice(0, 300), secs: (Date.now() - t0) / 1000,
    }
  }
  const at = results.findIndex((r) => r.idx === p.idx && r.engine === engine)
  if (at >= 0) results[at] = row
  else results.push(row)
  save()
  console.log(
    `[${p.idx}] ${p.arm.padEnd(9)} ${engine.padEnd(20)} ${row.ok === true ? 'PASS' : row.ok === null ? 'QA?' : 'FAIL'}  ${row.secs.toFixed(0)}s  ${row.renderError ?? row.reason ?? ''}`.slice(0, 220)
  )
}

async function main() {
  const set = ONLY.length ? products.filter((p) => ONLY.includes(p.idx)) : products
  console.log(`[bakeoff] ${set.length} products x ${ENGINES.length} engines -> ${OUT_DIR}`)
  // Three products at a time, all three engines in parallel per product: it
  // keeps every provider under its rate limit and the run under ~15 minutes.
  for (let i = 0; i < set.length; i += 3) {
    await Promise.all(set.slice(i, i + 3).flatMap((p) => ENGINES.map((e) => runOne(p, e))))
  }

  const rate = (rows: Row[]) => {
    const graded = rows.filter((r) => r.ok !== null)
    const pass = graded.filter((r) => r.ok).length
    return `${pass}/${graded.length} (${graded.length ? Math.round((100 * pass) / graded.length) : 0}%)`
  }
  console.log('\n=== QA PASS RATE (render failures count as fails) ===')
  for (const e of ENGINES) {
    const rows = results.filter((r) => r.engine === e)
    console.log(
      `${e.padEnd(20)} all ${rate(rows).padEnd(12)} mockup ${rate(rows.filter((r) => r.arm === 'mockup')).padEnd(12)} on-person ${rate(rows.filter((r) => r.arm === 'on_person')).padEnd(12)} text designs ${rate(rows.filter((r) => r.designKind !== 'art'))}`
    )
  }
}

main().catch((e) => {
  console.error('[bakeoff] FATAL', e?.message ?? e)
  process.exit(1)
})
