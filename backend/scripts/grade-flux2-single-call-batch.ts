// Watchtower task 6456344b — grade MOCKUP_FLUX2_SINGLE_CALL on a real batch.
//
// Sets MOCKUP_FLUX2_SINGLE_CALL=true (this IS the worker env flag worker-helpers
// reads via flux2SingleCallEnabled()) and drives the REAL runImageFlowMockup()
// function — not a hand-rolled copy of the prompts — across flat_lay and
// ghost_mannequin templates, using real design artwork pulled read-only from
// the live product_assets table (kind='source', asset_role='design'). Does NOT
// write anything to product_assets — mockupResult.modelId is exactly what
// ai-jobs-worker.ts would store at product_assets.metadata.model_id (see its
// insert at ~line 1056), so recording it here is a faithful proxy without
// touching the live catalog.
//
// console.warn is monkey-patched during each call to capture the fallback
// reason worker-helpers logs on any flux-2-pro failure ("flux-2-pro
// single-call failed, falling back") so an E005-sensitivity refusal can be
// told apart from a timeout/network failure.
//
// Run:  npm --prefix backend exec tsx scripts/grade-flux2-single-call-batch.ts
// Needs backend/.env (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/REPLICATE_API_TOKEN).
import '../load-env.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { supabase } from '../lib/supabase.js'
import { runImageFlowMockup } from '../services/image-flow/worker-helpers.js'

process.env.MOCKUP_FLUX2_SINGLE_CALL = 'true'

const OUT_DIR = process.env.GRADE_OUT_DIR || join(process.cwd(), 'flux2-grade-out')
mkdirSync(OUT_DIR, { recursive: true })

const TEMPLATES = ['flat_lay', 'ghost_mannequin'] as const
const COLORS = ['black', 'white', 'gray'] as const
const JOBS_PER_TEMPLATE = Number(process.env.GRADE_JOBS_PER_TEMPLATE || 20)

async function fetchRealDesigns(n: number): Promise<{ url: string; productId: string }[]> {
  const { data, error } = await supabase
    .from('product_assets')
    .select('url, product_id, created_at')
    .eq('kind', 'source')
    .eq('asset_role', 'design')
    .not('url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(400)
  if (error) throw new Error(`product_assets query failed: ${error.message}`)
  // Dedupe by product_id so we get N DISTINCT products' artwork, not repeats
  // from the same product's multiple design variants.
  const seen = new Set<string>()
  const out: { url: string; productId: string }[] = []
  for (const row of data ?? []) {
    if (!row.url || seen.has(row.product_id)) continue
    seen.add(row.product_id)
    out.push({ url: row.url, productId: row.product_id })
    if (out.length >= n) break
  }
  if (out.length === 0) throw new Error('no real design assets found in product_assets')
  return out
}

interface JobResult {
  idx: number
  template: string
  color: string
  designUrl: string
  productId: string
  modelId: string
  singleCallSucceeded: boolean
  fallbackWarning: string | null
  isE005: boolean
  secs: number
  imageUrl: string
  savedPath: string
  error: string | null
}

async function runOneJob(idx: number, template: 'flat_lay' | 'ghost_mannequin', color: string, design: { url: string; productId: string }): Promise<JobResult> {
  const warnings: string[] = []
  const origWarn = console.warn
  console.warn = (...args: any[]) => {
    warnings.push(args.map(String).join(' '))
    origWarn(...args)
  }
  const t0 = Date.now()
  try {
    const r = await runImageFlowMockup({
      template,
      designImageUrl: design.url,
      productType: 'tshirt',
      shirtColor: color as any,
    })
    const secs = (Date.now() - t0) / 1000
    const fallbackWarning = warnings.find(w => w.includes('flux-2-pro single-call failed')) ?? null
    const isE005 = !!fallbackWarning && /sensitive|E005|flagged/i.test(fallbackWarning)
    const singleCallSucceeded = r.modelId === 'black-forest-labs/flux-2-pro'

    const imgRes = await fetch(r.url)
    const buf = Buffer.from(await imgRes.arrayBuffer())
    const fname = `${String(idx).padStart(3, '0')}-${template}-${color}-${singleCallSucceeded ? 'flux2' : 'fallback'}.png`
    const savedPath = join(OUT_DIR, fname)
    writeFileSync(savedPath, buf)

    console.log(`[${idx}] ${template}/${color} -> ${r.modelId} (${secs.toFixed(1)}s)${fallbackWarning ? '  FELL BACK: ' + fallbackWarning.slice(0, 100) : ''}`)

    return {
      idx, template, color, designUrl: design.url, productId: design.productId,
      modelId: r.modelId, singleCallSucceeded, fallbackWarning, isE005, secs,
      imageUrl: r.url, savedPath, error: null,
    }
  } catch (e: any) {
    console.log(`[${idx}] ${template}/${color} -> JOB FAILED: ${e?.message ?? e}`)
    return {
      idx, template, color, designUrl: design.url, productId: design.productId,
      modelId: 'NONE', singleCallSucceeded: false, fallbackWarning: null, isE005: false,
      secs: (Date.now() - t0) / 1000, imageUrl: '', savedPath: '', error: e?.message ?? String(e),
    }
  } finally {
    console.warn = origWarn
  }
}

async function main() {
  console.log(`[grade] MOCKUP_FLUX2_SINGLE_CALL=${process.env.MOCKUP_FLUX2_SINGLE_CALL}, ${JOBS_PER_TEMPLATE} jobs/template x ${TEMPLATES.length} templates, out=${OUT_DIR}`)
  const designs = await fetchRealDesigns(12)
  console.log(`[grade] pulled ${designs.length} real design assets from live product_assets`)

  const results: JobResult[] = []
  let idx = 0
  for (const template of TEMPLATES) {
    for (let i = 0; i < JOBS_PER_TEMPLATE; i++) {
      const color = COLORS[i % COLORS.length]
      const design = designs[i % designs.length]
      idx++
      const r = await runOneJob(idx, template, color, design)
      results.push(r)
      writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2))
    }
  }

  const total = results.length
  const jobFailures = results.filter(r => r.error).length
  const attempted = total - jobFailures
  const singleCallSuccesses = results.filter(r => r.singleCallSucceeded).length
  const fallbacks = results.filter(r => !r.singleCallSucceeded && !r.error).length
  const e005Count = results.filter(r => r.isE005).length
  const otherFallbackCount = fallbacks - e005Count
  const modelTally: Record<string, number> = {}
  for (const r of results) modelTally[r.modelId] = (modelTally[r.modelId] ?? 0) + 1

  console.log('\n=== SUMMARY ===')
  console.log(`total jobs: ${total}  (job-level failures/exceptions: ${jobFailures})`)
  console.log(`single-call flux-2-pro succeeded: ${singleCallSuccesses}/${attempted}`)
  console.log(`fell back to 2-step chain: ${fallbacks}/${attempted}  (E005-sensitive: ${e005Count}, other reason: ${otherFallbackCount})`)
  console.log('model_id tally:', JSON.stringify(modelTally, null, 2))
  console.log(`\nImages + full per-job results written to ${OUT_DIR}`)

  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify({
    total, jobFailures, attempted, singleCallSuccesses, fallbacks, e005Count, otherFallbackCount, modelTally,
  }, null, 2))
}

main().catch(e => {
  console.error('[grade] FATAL:', e?.message ?? e)
  process.exit(1)
})
