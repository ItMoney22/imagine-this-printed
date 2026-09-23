// Jev IP sweep — READ-ONLY pass of the catalogue through the regex gate and
// Jev's IP classifier, side by side, so the two can be measured on real rows
// before JEV_IP_GATE is flipped to `enforce` (David's rule 6, 2026-09-23).
//
// Writes nothing to the database. It reports; a human decides.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENROUTER_API_KEY=... \
//     npx tsx scripts/jev-ip-sweep.ts --out <dir> [--status active,draft] [--limit N]
//
// Output: <dir>/jev-ip-sweep-<date>.json (every row) and .md (the review list).
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCopyrightGate } from '../services/etsy-copyright-gate.js'
import { classifyIpBatch, designPromptOf, SAFE_CONFIDENCE, type JevIpInput } from '../services/jev-ip-gate.js'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const outDir = arg('out') || '.'
const statuses = (arg('status') || 'active,draft').split(',')
const limit = Number(arg('limit')) || Infinity

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required')
const supabase = createClient(url, key, { auth: { persistSession: false } })

async function loadProducts() {
  // PostgREST silently caps unbounded selects at 1000 — page explicitly.
  const rows: any[] = []
  for (let from = 0; rows.length < limit; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, status, is_active, category, description, meta_title, meta_description, search_keywords, metadata')
      .in('status', statuses)
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows.slice(0, limit)
}

async function loadEtsyStates() {
  const { data } = await supabase.from('etsy_listings').select('product_id, state, tier')
  const m = new Map<string, string[]>()
  for (const l of data ?? []) m.set(l.product_id, [...(m.get(l.product_id) ?? []), `${l.tier || 'primary'}:${l.state}`])
  return m
}

const esc = (s: string) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()

async function main() {
  const started = Date.now()
  const [products, etsy] = await Promise.all([loadProducts(), loadEtsyStates()])
  console.log(`[jev-ip-sweep] ${products.length} products (${statuses.join(', ')})`)

  const inputs: Record<string, JevIpInput> = {}
  for (const p of products) {
    inputs[p.id] = {
      name: p.meta_title || p.name,
      description: p.description || p.meta_description,
      tags: String(p.search_keywords || '').split(',').map((t: string) => t.trim()).filter(Boolean),
      designPrompt: designPromptOf(p.metadata)
    }
  }
  // Every row goes to Jev, including regex-blocked ones: measuring agreement
  // with the floor is half the point of the sweep.
  const decisions = await classifyIpBatch(inputs, { batchSize: 25 })

  const rows = products.map(p => {
    const regex = runCopyrightGate(inputs[p.id])
    const jev = decisions[p.id]
    const bucket =
      !regex.pass ? (jev.verdict === 'pass' ? 'regex_only' : 'both')
      : jev.verdict === 'block' ? 'jev_new_block'
      : jev.verdict === 'review' ? (jev.tier === 'likely_ip_reference' || jev.tier === 'definite_brand_or_character' ? 'jev_new_ip_flag' : 'jev_low_confidence')
      : jev.verdict === 'unavailable' ? 'jev_unavailable'
      : 'clear'
    return {
      id: p.id, name: p.name, status: p.status, is_active: p.is_active, category: p.category,
      etsy: etsy.get(p.id) ?? [],
      regex_pass: regex.pass, regex_terms: regex.matchedTerms,
      jev_verdict: jev.verdict, jev_tier: jev.tier, jev_confidence: jev.confidence,
      jev_safe_probability: jev.safeProbability, jev_reason: jev.reason,
      bucket
    }
  })

  const count = (b: string) => rows.filter(r => r.bucket === b).length
  const summary = {
    generated_at: new Date().toISOString(),
    statuses, products: rows.length, safe_confidence_bar: SAFE_CONFIDENCE,
    seconds: Math.round((Date.now() - started) / 1000),
    regex_blocked: rows.filter(r => !r.regex_pass).length,
    buckets: Object.fromEntries(['clear', 'both', 'regex_only', 'jev_new_block', 'jev_new_ip_flag', 'jev_low_confidence', 'jev_unavailable'].map(b => [b, count(b)])),
    tiers: Object.fromEntries(['clean', 'generic_theme', 'likely_ip_reference', 'definite_brand_or_character'].map(t => [t, rows.filter(r => r.jev_tier === t).length]))
  }

  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  const jsonPath = join(outDir, `jev-ip-sweep-${stamp}.json`)
  writeFileSync(jsonPath, JSON.stringify({ summary, rows }, null, 2))

  const byConf = (a: any, b: any) => (b.jev_confidence ?? 0) - (a.jev_confidence ?? 0)
  const table = (list: any[]) =>
    ['| Product | Status | Etsy | Jev tier | Conf | Safe | Id |', '|---|---|---|---|---|---|---|',
      ...list.map(r => `| ${esc(r.name)} | ${r.status}${r.is_active ? '' : ' (inactive)'} | ${r.etsy.join(', ') || '—'} | ${r.jev_tier ?? '—'} | ${r.jev_confidence?.toFixed(2) ?? '—'} | ${r.jev_safe_probability?.toFixed(2) ?? '—'} | \`${r.id}\` |`)].join('\n')
  const section = (title: string, blurb: string, bucket: string) => {
    const list = rows.filter(r => r.bucket === bucket).sort(byConf)
    return `## ${title} (${list.length})\n\n${blurb}\n\n${list.length ? table(list) : '_none_'}\n`
  }
  const md = [
    `# Jev IP sweep — ${stamp}`,
    '',
    `Read-only. ${rows.length} products (status ${statuses.join('/')}), ${summary.seconds}s. Regex denylist runs first and is a floor; Jev only adds flags.`,
    `Auto-accept bar: clean + generic_theme probability ≥ ${SAFE_CONFIDENCE}.`,
    '',
    '| Bucket | Rows | Meaning |', '|---|---|---|',
    `| clear | ${count('clear')} | Regex passed, Jev confident it is safe |`,
    `| both | ${count('both')} | Regex blocked AND Jev flagged — agreement |`,
    `| regex_only | ${count('regex_only')} | Regex blocked, Jev thought it safe — regex stays the floor (check for false positives) |`,
    `| jev_new_block | ${count('jev_new_block')} | Regex passed, Jev ≥${SAFE_CONFIDENCE} sure it NAMES a brand/character |`,
    `| jev_new_ip_flag | ${count('jev_new_ip_flag')} | Regex passed, Jev thinks it paraphrases or may name IP |`,
    `| jev_low_confidence | ${count('jev_low_confidence')} | Regex passed, Jev leans safe but under the bar → human |`,
    `| jev_unavailable | ${count('jev_unavailable')} | No Jev answer (lane error) |`,
    '',
    section('New blocks — Jev is sure these name IP the regex missed', 'Highest priority for David. Nothing was changed; each needs a keep / rename / pull decision.', 'jev_new_block'),
    section('New IP flags — likely paraphrases', 'The class of miss the regex cannot see by construction.', 'jev_new_ip_flag'),
    section('Low confidence — would be routed to a human', 'Jev leaned safe but not by enough to auto-accept.', 'jev_low_confidence'),
    section('Regex-only blocks — Jev disagreed', 'Regex stays authoritative. Listed so false positives in the denylist can be spotted.', 'regex_only')
  ].join('\n')
  const mdPath = join(outDir, `jev-ip-sweep-${stamp}.md`)
  writeFileSync(mdPath, md)

  console.log(JSON.stringify(summary, null, 2))
  console.log(`[jev-ip-sweep] wrote ${jsonPath} and ${mdPath}`)
}

main().catch(e => {
  console.error('[jev-ip-sweep] failed:', e?.message || e)
  process.exit(1)
})
