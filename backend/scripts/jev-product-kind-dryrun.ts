// Jev product-kind dry run — READ-ONLY comparison of how the pipeline guesses a
// product's kind today against Jev, on the live catalogue, before
// PRODUCT_KIND_JEV is ever flipped from 'shadow' to 'on' (David's Jev rule 7,
// 2026-09-23; task 28ab467c).
//
// For every product it records:
//   • legacy  — the four guesses exactly as the code made them before this task
//               (copied below from a28c1b1 so the comparison survives the change):
//               copy-repair kindOf, the composer's tee-or-metal prompt + hoodie
//               anchor, the approval route's category default, the taxonomy id;
//   • floor   — shared/product-kind floorKindOf (the deterministic fallback now);
//   • jev     — the production question (services/product-kind-jev.ts), its
//               choice, confidence and full probability spread;
//   • decision — decideProductKind in 'shadow' and in 'on' at the bar.
// and writes a disagreement report (markdown) plus every row (JSON).
//
// Writes nothing to the database. It reports; a human decides.
//
//   cd backend && npx tsx --env-file=<backend .env> scripts/jev-product-kind-dryrun.ts \
//     --out ../docs/reports [--limit 3000] [--concurrency 6] [--bar 0.85]
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { askJev } from '../services/jev.js'
import {
  buildProductKindQuestions,
  buildProductKindState,
  hasKindWords,
  readProductKind,
} from '../services/product-kind-jev.js'
import {
  PRODUCT_KINDS,
  adminKindOf,
  categoryForKind,
  decideProductKind,
  floorKindOf,
  type JevKindRead,
  type ProductKind,
} from '../shared/product-kind.js'
import { CATEGORY_TAXONOMY_DEFAULTS } from '../shared/etsy-tiers.js'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const outDir = arg('out') || '.'
const limit = Number(arg('limit')) || 5000
const concurrency = Math.max(1, Number(arg('concurrency')) || 6)
const bar = Number(arg('bar')) || 0.85

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required')
const supabase = createClient(url, key, { auth: { persistSession: false } })

const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()

// --- the legacy guesses, verbatim from a28c1b1 ------------------------------
function legacyIsHoodie(p: any): boolean {
  if (String(p.category ?? '') === 'hoodies') return true
  const garment = p.metadata?.step_flow?.garment ?? p.metadata?.garment
  if (typeof garment === 'string' && /hoodie|sweatshirt/i.test(garment)) return true
  return /\bhoodie\b|\bsweatshirt\b/i.test(String(p.name ?? ''))
}
function legacyCopyKind(p: any): 'hoodie' | 'tee' | 'metal' | 'transfer' | 'other' {
  const category = String(p.category ?? '')
  const garment = p.metadata?.step_flow?.garment ?? p.metadata?.garment ?? null
  if (category === 'metal-art') return 'metal'
  if (category === 'dtf-transfers') return 'transfer'
  if (category === 'hoodies') return 'hoodie'
  if (legacyIsHoodie({ category, name: p.name, metadata: { garment } })) return 'hoodie'
  if (category === 'shirts') return 'tee'
  if (/tee|shirt/i.test(String(garment ?? ''))) return 'tee'
  return 'other'
}
/** What the composer's prompt + anchor wrote: metal copy, or TEE copy (at the hoodie anchor if it spotted one). */
function legacyComposer(p: any): string {
  if (String(p.category) === 'metal-art') return 'metal'
  return legacyIsHoodie(p) ? 'tee-copy@hoodie-price' : 'tee-copy'
}
function legacyApprovalCategory(p: any): string | null {
  const tmpl = String(p.metadata?.product_template || p.metadata?.category || '').toLowerCase()
  const kind = (tmpl.includes('metal') || tmpl.includes('wall')) ? 'metal' : (tmpl.includes('3d') || tmpl.includes('toy')) ? '3d' : 'apparel'
  if (kind === 'metal') return 'metal-art'
  if (kind === '3d') return '3d-prints'
  return p.category || 'shirts'
}
const taxonomyOf = (category: string | null) => (category ? CATEGORY_TAXONOMY_DEFAULTS[category] ?? null : null)

/** Old copy vocabulary → the 8 kinds, so the two can be compared. */
const legacyAsKind = (k: string): ProductKind => (k === 'other' ? 'other' : (k as ProductKind))

// --- load --------------------------------------------------------------------
async function loadProducts() {
  const rows: any[] = []
  for (let from = 0; rows.length < limit; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, status, is_active, category, description, search_keywords, metadata')
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return rows.slice(0, limit)
}

async function loadEtsyListed(): Promise<Map<string, string[]>> {
  const { data, error } = await supabase.from('etsy_listings').select('product_id, tier, listing_id, state')
  if (error) throw new Error(error.message)
  const m = new Map<string, string[]>()
  for (const r of data ?? []) {
    if (!r.listing_id) continue
    const k = String(r.product_id)
    m.set(k, [...(m.get(k) ?? []), `${r.tier}:${r.state ?? '?'}`])
  }
  return m
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    })
  )
  return out
}

// --- run -----------------------------------------------------------------------
const started = Date.now()
const [products, etsy] = await Promise.all([loadProducts(), loadEtsyListed()])
console.log(`[dryrun] ${products.length} products, ${etsy.size} with an Etsy listing — asking Jev (concurrency ${concurrency})`)

let cost = 0
let inTokens = 0
let failures = 0
const rows = await pool(products, concurrency, async (p, i) => {
  const words = hasKindWords(p)
  let read: JevKindRead | null = null
  let probabilities: Record<string, number> | undefined
  if (words) {
    for (let attempt = 0; attempt < 2 && !read; attempt++) {
      const res = await askJev(buildProductKindState(p), buildProductKindQuestions(), { timeoutMs: 15000 })
      cost += Number(res?.usage?.cost ?? 0)
      inTokens += Number(res?.usage?.input_tokens ?? 0)
      read = readProductKind(res)
      probabilities = (res?.answers?.product_kind as any)?.probabilities
    }
    if (!read) failures++
  }
  if ((i + 1) % 200 === 0) console.log(`[dryrun] ${i + 1}/${products.length}`)
  const floor = floorKindOf(p)
  const admin = adminKindOf(p)
  const shadow = decideProductKind(p, words ? read : undefined, 'shadow', bar)
  const on = decideProductKind(p, words ? read : undefined, 'on', bar)
  const legacyCopy = legacyCopyKind(p)
  return {
    id: p.id,
    name: esc(p.name).slice(0, 90),
    status: p.status,
    category: p.category ?? null,
    product_type: p.metadata?.product_type ?? null,
    garment: p.metadata?.step_flow?.garment ?? (typeof p.metadata?.garment === 'string' ? p.metadata.garment : null),
    etsy: etsy.get(String(p.id)) ?? [],
    legacy: {
      copy_kind: legacyCopy,
      composer: legacyComposer(p),
      approval_category: legacyApprovalCategory(p),
      taxonomy: taxonomyOf(p.category ?? null),
    },
    admin: admin?.kind ?? null,
    floor: { kind: floor.kind, basis: floor.basis, conflict: floor.conflict, category_kind: floor.categoryKind, signals: floor.signals },
    jev: read ? { choice: read.choice, confidence: Number(read.confidence.toFixed(4)), probabilities } : null,
    words,
    shadow: { kind: shadow.kind, review: shadow.needsReview, status: shadow.jev.status },
    on: { kind: on.kind, source: on.source, review: on.needsReview, status: on.jev.status, note: on.note },
    legacy_as_kind: legacyAsKind(legacyCopy),
  }
})

// --- report ----------------------------------------------------------------------
const byId = new Map(products.map(p => [p.id, p]))
const answered = rows.filter(r => r.jev)
const confident = (b: number) => answered.filter(r => r.jev!.confidence >= b)
const agreesFloor = (r: (typeof rows)[number]) =>
  r.floor.kind === r.jev?.choice ||
  (r.floor.kind === 'tee' && r.jev?.choice === 'youth_tee') ||
  (r.floor.kind === 'youth_tee' && r.jev?.choice === 'tee')
const count = <T,>(xs: T[], f: (x: T) => string) => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const pctOf = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-')
const listed = (r: (typeof rows)[number]) => r.etsy.length > 0

const lines: string[] = []
const date = new Date().toISOString().slice(0, 10)
lines.push(`# Jev product-kind dry run — ${date}`, '')
lines.push(
  `Read-only. ${rows.length} live products; Jev asked on the ${rows.filter(r => r.words).length} with words, answered ${answered.length} ` +
    `(${failures} no answer after one retry). Cost $${cost.toFixed(4)} for ${inTokens.toLocaleString()} input tokens, ` +
    `${((Date.now() - started) / 1000).toFixed(0)} s. Bar under test: ${bar}. Task 28ab467c.`,
  ''
)
lines.push('Jev reads only the product\'s WORDS (name, idea/prompt, description, keywords); the floor reads its FIELDS (category, product_type, garment, template). They are independent on purpose.', '')

lines.push('## Confidence bar', '', '| bar | Jev at or over it | of those, agrees with the floor | confident disagreements | on-mode reviews |', '|---|---|---|---|---|')
for (const b of [0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
  const c = confident(b)
  const agree = c.filter(agreesFloor).length
  const reviews = rows.filter(r => decideProductKind(byId.get(r.id)!, r.words ? (r.jev as JevKindRead | null) : undefined, 'on', b).needsReview).length
  lines.push(`| ${b} | ${c.length} (${pctOf(c.length, answered.length)}) | ${agree} (${pctOf(agree, c.length)}) | ${c.length - agree} | ${reviews} |`)
}
lines.push('')

lines.push('## What decides each row with PRODUCT_KIND_JEV=on at the bar', '')
lines.push('| outcome | rows | on an Etsy listing |', '|---|---|---|')
for (const [k, n] of count(rows, r => (r.on.review ? `review (${r.on.status})` : `${r.on.source} decides`))) {
  lines.push(`| ${k} | ${n} | ${rows.filter(r => (r.on.review ? `review (${r.on.status})` : `${r.on.source} decides`) === k && listed(r)).length} |`)
}
lines.push('', `Shadow (the default) changes behaviour for ${rows.filter(r => r.shadow.review).length} row(s): those with nothing at all saying what they are, which used to become shirts.`, '')

lines.push('## Kinds: the old copy guess vs the floor vs Jev (confident)', '')
lines.push(`| kind | old copy-repair guess | floor | Jev at ${bar} |`, '|---|---|---|---|')
for (const k of [...PRODUCT_KINDS, 'none']) {
  lines.push(
    `| ${k} | ${rows.filter(r => r.legacy.copy_kind === k).length} | ${rows.filter(r => (r.floor.kind ?? 'none') === k).length} | ${confident(bar).filter(r => r.jev!.choice === k).length} |`
  )
}
lines.push('')

lines.push('## Floor kind × Jev choice (all answers)', '')
const kinds = [...PRODUCT_KINDS]
lines.push(`| floor \\ jev | ${kinds.join(' | ')} |`, `|---|${kinds.map(() => '---').join('|')}|`)
for (const f of [...kinds, null]) {
  const rs = answered.filter(r => r.floor.kind === f)
  if (!rs.length) continue
  lines.push(`| ${f ?? 'none'} | ${kinds.map(k => rs.filter(r => r.jev!.choice === k).length || '').join(' | ')} |`)
}
lines.push('')

const disagreements = confident(bar)
  .filter(r => !agreesFloor(r) || (r.floor.category_kind && r.floor.category_kind !== r.jev!.choice && !(r.floor.category_kind === 'tee' && r.jev!.choice === 'youth_tee')))
  .sort((a, b) => Number(listed(b)) - Number(listed(a)) || (a.status === 'active' ? -1 : 1) - (b.status === 'active' ? -1 : 1))
lines.push(`## Confident disagreements (Jev ≥ ${bar} vs the category/floor) — ${disagreements.length}`, '')
lines.push('Each of these goes to a human with PRODUCT_KIND_JEV=on. Listed-on-Etsy and active rows first.', '')
lines.push('| status | etsy | category | product_type | floor | Jev | old copy | old composer | name | id |', '|---|---|---|---|---|---|---|---|---|---|')
for (const r of disagreements) {
  lines.push(
    `| ${r.status} | ${r.etsy.join(' ') || '-'} | ${r.category ?? '-'} | ${r.product_type ?? '-'} | ${r.floor.kind ?? '-'}${r.floor.conflict ? ' (conflict)' : ''} | ` +
      `${r.jev!.choice} ${r.jev!.confidence.toFixed(2)} | ${r.legacy.copy_kind} | ${r.legacy.composer} | ${r.name} | ${String(r.id).slice(0, 8)} |`
  )
}
lines.push('')

const conflicts = rows.filter(r => r.floor.conflict)
lines.push(`## Rows whose own fields disagree — ${conflicts.length}`, '')
lines.push('| status | category | signals | floor | Jev | name | id |', '|---|---|---|---|---|---|---|')
for (const r of conflicts.slice(0, 80)) {
  lines.push(
    `| ${r.status} | ${r.category ?? '-'} | ${r.floor.signals.map(s => `${s.field}=${s.kind}${s.weak ? '?' : ''}`).join(', ')} | ${r.floor.kind ?? '-'} | ` +
      `${r.jev ? `${r.jev.choice} ${r.jev.confidence.toFixed(2)}` : '-'} | ${r.name} | ${String(r.id).slice(0, 8)} |`
  )
}
if (conflicts.length > 80) lines.push(`| … | ${conflicts.length - 80} more in the JSON | | | | | |`)
lines.push('')

const misCopy = rows.filter(r => r.floor.kind && !['tee', 'youth_tee', 'metal'].includes(r.floor.kind) && r.legacy.composer.startsWith('tee-copy'))
lines.push(`## Old composer wrote TEE copy for a non-tee — ${misCopy.length}`, '')
lines.push('The composer had two prompts, metal and tee; everything not metal-art got "soft unisex tee" copy.', '')
lines.push('| status | etsy | category | floor kind | Jev | name | id |', '|---|---|---|---|---|---|---|')
for (const r of misCopy) {
  lines.push(`| ${r.status} | ${r.etsy.join(' ') || '-'} | ${r.category ?? '-'} | ${r.floor.kind} | ${r.jev ? `${r.jev.choice} ${r.jev.confidence.toFixed(2)}` : '-'} | ${r.name} | ${String(r.id).slice(0, 8)} |`)
}
lines.push('')

const noFloor = rows.filter(r => !r.floor.kind)
lines.push(`## Nothing says what it is — ${noFloor.length}`, '')
lines.push('These were silently filed as shirts before. Now they go to a human (or, with Jev on and sure, to Jev\'s kind).', '')
for (const r of noFloor) lines.push(`- ${r.status} \`${String(r.id).slice(0, 8)}\` ${r.name} — Jev ${r.jev ? `${r.jev.choice} ${r.jev.confidence.toFixed(2)}` : 'no answer'}`)
lines.push('')

const lowAmbiguous = rows.filter(r => r.on.review && r.on.status === 'low-confidence')
lines.push(`## Unsure on an ambiguous row — ${lowAmbiguous.length}`, '')
for (const r of lowAmbiguous.slice(0, 40)) lines.push(`- ${r.status} \`${String(r.id).slice(0, 8)}\` ${r.name} — ${r.on.note}`)
lines.push('')

lines.push('## Jev confidence spread (all answers)', '')
const buckets = [0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1.01]
lines.push('| confidence | rows | agrees with floor |', '|---|---|---|')
for (let i = 0; i + 1 < buckets.length; i++) {
  const rs = answered.filter(r => r.jev!.confidence >= buckets[i] && r.jev!.confidence < buckets[i + 1])
  lines.push(`| ${buckets[i]}–${Math.min(1, buckets[i + 1])} | ${rs.length} | ${pctOf(rs.filter(agreesFloor).length, rs.length)} |`)
}
lines.push('')
lines.push(`Taxonomy note: a youth tee files under shirts (482) like the adult tee; \`other\` has no category (${categoryForKind('other')}), so an \`other\` row can only list after a human files it.`)

mkdirSync(outDir, { recursive: true })
const base = join(outDir, `jev-product-kind-dryrun-${date}`)
writeFileSync(`${base}.md`, lines.join('\n') + '\n')
writeFileSync(`${base}.json`, JSON.stringify({ date, bar, cost, inTokens, failures, rows }, null, 1))
console.log(`[dryrun] wrote ${base}.md and .json — $${cost.toFixed(4)}, ${answered.length}/${rows.length} answered`)
