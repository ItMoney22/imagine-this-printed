// ---------------------------------------------------------------------------
// Etsy listing composer — model A/B harness.
//
// Runs the EXACT production system prompt + user payload from
// services/etsy-seo-composer.ts through two models against real catalogue rows,
// then reports the sanitized packs side by side with token counts and cost, so
// a model swap is a reviewed decision instead of a hopeful one.
//
// Built 2026-07-26 for the gpt-4o -> google/gemini-2.5-flash-lite migration
// (Watchtower ef674fdc-62e8-4908-a96e-bc21ac01089e).
//
//   cd backend
//   npx tsx --env-file=.env scripts/compare-etsy-seo-models.ts
//   npx tsx --env-file=.env scripts/compare-etsy-seo-models.ts --limit 3 \
//     --challenger google/gemini-3.5-flash-lite
//
// READ-ONLY: selects products, never writes products.metadata.etsy_pack. The
// real composer is what persists packs; this only shows what it would produce.
// ---------------------------------------------------------------------------
import { writeFileSync } from 'node:fs'
import OpenAI from 'openai'
import { supabase } from '../lib/supabase.js'
import { METAL_SYSTEM_PROMPT, SYSTEM_PROMPT, sanitizePack } from '../services/etsy-seo-composer.js'
import { MAX_TAGS, MAX_TAG_LEN, MAX_TITLE_LEN } from '../services/etsy-listing-fields.js'
import { completionTokenParam } from '../services/model-compat.js'

const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const BASELINE = arg('--baseline', 'gpt-4o')
const CHALLENGER = arg('--challenger', 'google/gemini-2.5-flash-lite')
const LIMIT = Number(arg('--limit', '3'))

// USD per 1M tokens, verified 2026-07-26 (OpenRouter /api/v1/models for the
// google/* ids, OpenAI's pricing page for the openai ids).
const PRICING: Record<string, { in: number; out: number }> = {
  'gpt-4o': { in: 2.5, out: 10.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-5.4-nano': { in: 0.05, out: 0.4 },
  'google/gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
  'google/gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'google/gemini-3.5-flash-lite': { in: 0.3, out: 2.5 }
}

const isOpenRouterModel = (m: string) => m.includes('/')

function clientFor(model: string): OpenAI {
  if (isOpenRouterModel(model)) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error(`${model} needs OPENROUTER_API_KEY`)
    return new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'HTTP-Referer': 'https://imaginethisprinted.com', 'X-Title': 'ITP - Etsy model A/B' }
    })
  }
  if (!process.env.OPENAI_API_KEY) throw new Error(`${model} needs OPENAI_API_KEY`)
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

interface Run {
  model: string
  ok: boolean
  error?: string
  title?: string
  tags?: string[]
  description?: string
  promptTokens: number
  completionTokens: number
  costUsd: number
  ms: number
}

async function runModel(model: string, product: any): Promise<Run> {
  const started = Date.now()
  const base: Run = { model, ok: false, promptTokens: 0, completionTokens: 0, costUsd: 0, ms: 0 }
  try {
    // Identical to composeEtsyPack()'s call — prompt, payload, JSON mode, budget.
    const completion = await clientFor(model).chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      ...completionTokenParam(model, 900),
      messages: [
        { role: 'system', content: String(product.category) === 'metal-art' ? METAL_SYSTEM_PROMPT : SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            name: product.name,
            description: product.description,
            category: product.category,
            existing_keywords: product.search_keywords,
            original_prompt: product.metadata?.original_prompt || product.metadata?.image_prompt || null
          })
        }
      ]
    })

    const usage = completion.usage
    const price = PRICING[model] || { in: 0, out: 0 }
    const promptTokens = usage?.prompt_tokens ?? 0
    const completionTokens = usage?.completion_tokens ?? 0
    const fields = sanitizePack(JSON.parse(completion.choices[0]?.message?.content || '{}'), product)

    return {
      ...base,
      ok: !!fields,
      error: fields ? undefined : 'sanitizePack rejected the response (missing title/description/tags)',
      title: fields?.title,
      tags: fields?.tags,
      description: fields?.description,
      promptTokens,
      completionTokens,
      costUsd: (promptTokens / 1e6) * price.in + (completionTokens / 1e6) * price.out,
      ms: Date.now() - started
    }
  } catch (err: any) {
    return { ...base, error: err?.message || String(err), ms: Date.now() - started }
  }
}

// Objective checks the prompt actually asks for. Not a quality verdict — that
// stays human — but it catches a challenger that breaks Etsy's hard limits.
function compliance(run: Run) {
  const tags = run.tags || []
  const title = run.title || ''
  const firstLine = (run.description || '').split('\n')[0] || ''
  return {
    title_len: title.length,
    title_within_etsy_limit: title.length <= MAX_TITLE_LEN,
    title_in_target_50_90: title.length >= 50 && title.length <= 90,
    title_not_keyword_stuffed: (title.match(/,/g) || []).length === 0,
    tag_count: tags.length,
    tags_exactly_13: tags.length === MAX_TAGS,
    tags_within_20_chars: tags.every(t => t.length <= MAX_TAG_LEN),
    tags_unique: new Set(tags.map(t => t.toLowerCase())).size === tags.length,
    hook_len: firstLine.length,
    hook_within_155: firstLine.length <= 155,
    description_len: (run.description || '').length
  }
}

async function main() {
  console.log(`\nEtsy composer A/B — baseline "${BASELINE}" vs challenger "${CHALLENGER}"\n`)

  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, description, category, search_keywords, metadata')
    .eq('status', 'active')
    .not('search_keywords', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(LIMIT)
  if (error) throw new Error(`Product query failed: ${error.message}`)
  if (!products?.length) throw new Error('No active products with search_keywords found')

  const results: any[] = []
  for (const product of products) {
    console.log(`\n${'='.repeat(78)}\n${product.name}  [${product.category}]\n${'='.repeat(78)}`)
    // Sequential on purpose: same-second rate-limit noise would muddy latency.
    const baseline = await runModel(BASELINE, product)
    const challenger = await runModel(CHALLENGER, product)

    for (const run of [baseline, challenger]) {
      console.log(`\n--- ${run.model} ---`)
      if (!run.ok) {
        console.log(`  FAILED: ${run.error}`)
        continue
      }
      console.log(`  TITLE (${run.title!.length} chars): ${run.title}`)
      console.log(`  TAGS  (${run.tags!.length}): ${run.tags!.join(' · ')}`)
      console.log(`  DESC  (${run.description!.length} chars):\n${run.description!.split('\n').map(l => '    ' + l).join('\n')}`)
      console.log(
        `  tokens ${run.promptTokens} in / ${run.completionTokens} out · ` +
          `$${run.costUsd.toFixed(6)} · ${run.ms}ms`
      )
      console.log(`  compliance: ${JSON.stringify(compliance(run))}`)
    }
    results.push({ product: { id: product.id, name: product.name, category: product.category }, baseline, challenger })
  }

  const sum = (k: 'baseline' | 'challenger') => results.reduce((a, r) => a + (r[k].costUsd || 0), 0)
  const baseTotal = sum('baseline')
  const chalTotal = sum('challenger')
  const per12 = (t: number) => (t / results.length) * 12

  console.log(`\n${'='.repeat(78)}\nCOST\n${'='.repeat(78)}`)
  console.log(`  ${BASELINE.padEnd(30)} $${baseTotal.toFixed(6)} for ${results.length} · $${per12(baseTotal).toFixed(4)} per 12-listing batch`)
  console.log(`  ${CHALLENGER.padEnd(30)} $${chalTotal.toFixed(6)} for ${results.length} · $${per12(chalTotal).toFixed(4)} per 12-listing batch`)
  if (chalTotal > 0) console.log(`  reduction: ${(baseTotal / chalTotal).toFixed(1)}x cheaper`)

  const out = `etsy-seo-model-ab-${BASELINE.replace(/\//g, '_')}-vs-${CHALLENGER.replace(/\//g, '_')}.json`
  writeFileSync(out, JSON.stringify({ baseline: BASELINE, challenger: CHALLENGER, results }, null, 2))
  console.log(`\nFull JSON -> backend/${out}\n`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
