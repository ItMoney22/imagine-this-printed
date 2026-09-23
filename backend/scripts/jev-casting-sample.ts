// Jev casting sample — READ-ONLY measurement of Jev's model casting against
// the current method on real listings, before STEP_FLOW_CASTING_JEV is ever
// flipped from 'shadow' to 'on' (David's Jev rule 6, 2026-09-23).
//
// For each product it compares three things on the SAME listing words the
// Step Flow passes to castForDesign (product name + Step Flow idea):
//   • keywords  — pickByKeywords, the deterministic floor;
//   • recorded  — the cast the live chain actually made, where one is stored
//                 in metadata.step_flow (mostly Mrs. Imagine's vision pass);
//   • jev       — askJev + evaluateJevCast, exactly the production path.
//
// Writes nothing to the database. It reports; a human decides.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENROUTER_API_KEY=... \
//     npx tsx scripts/jev-casting-sample.ts --out <dir> [--limit 300]
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getGarment, photographableAudiences, type GarmentId } from '../shared/catalog-capability.js'
import { listShotSubjects } from '../services/etsy-model-shots.js'
import { askJev } from '../services/jev.js'
import { buildJevCastQuestions, buildJevCastState, evaluateJevCast, pickByKeywords } from '../services/step-flow/casting.js'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const outDir = arg('out') || '.'
const limit = Number(arg('limit')) || 300

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required')
const supabase = createClient(url, key, { auth: { persistSession: false } })

const esc = (s: unknown) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()

async function loadProducts() {
  // Listings that went through the Step Flow first (they carry a recorded
  // cast to compare against), then the most recent of the rest.
  const cols = 'id, name, status, metadata'
  const cast = await supabase
    .from('products')
    .select(cols)
    .not('metadata->step_flow->casting', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (cast.error) throw new Error(cast.error.message)
  const rest = await supabase
    .from('products')
    .select(cols)
    .in('status', ['active', 'draft'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (rest.error) throw new Error(rest.error.message)
  const seen = new Set<string>()
  return [...(cast.data ?? []), ...(rest.data ?? [])]
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .slice(0, limit)
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

async function main() {
  const started = Date.now()
  const products = await loadProducts()
  console.log(`[jev-casting-sample] ${products.length} products`)
  let cost = 0

  const rows = await mapLimit(products, 8, async (p: any) => {
    const sf = p.metadata?.step_flow ?? {}
    const recorded = sf.casting ?? null
    const garment: GarmentId = getGarment(sf.garment ?? p.metadata?.garment)?.id ?? 'tshirt'
    const bands = photographableAudiences(garment)
    const subjects = listShotSubjects(bands)
    const opts = { productName: p.name ?? undefined, idea: typeof sf.idea === 'string' ? sf.idea : undefined }
    const context = [opts.productName, opts.idea].filter(Boolean).join(' — ').slice(0, 500)
    const keyword = pickByKeywords(context, bands)
    const result = await askJev(buildJevCastState(opts, bands, getGarment(garment)?.label ?? 'T-Shirt'), buildJevCastQuestions(subjects))
    cost += Number(result?.usage?.cost ?? 0)
    const { verdict, subject } = evaluateJevCast(result, subjects, keyword, 'on')
    return {
      id: p.id,
      name: p.name,
      idea: opts.idea ?? '',
      garment,
      keyword: keyword?.id ?? null,
      keywordBand: keyword?.audience ?? null,
      recorded: recorded ? { subjectId: recorded.subjectId, source: recorded.source, band: recorded.audience, read: recorded.read?.audience } : null,
      jev: verdict,
      jevCast: subject?.id ?? null,
      jevBand: subject?.audience ?? null,
    }
  })

  const n = rows.length
  const answered = rows.filter((r) => r.jev.verdict !== 'unavailable')
  const accepted = rows.filter((r) => r.jev.verdict === 'accepted')
  const low = rows.filter((r) => r.jev.verdict === 'low-confidence')
  const rejected = rows.filter((r) => r.jev.verdict === 'rejected')
  const withKeyword = rows.filter((r) => r.keyword)
  const withRecorded = rows.filter((r) => r.recorded)
  const recAcc = withRecorded.filter((r) => r.jevCast)
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-')
  const audCounts: Record<string, number> = {}
  for (const r of rows) audCounts[r.jev.designAudience ?? 'no opinion'] = (audCounts[r.jev.designAudience ?? 'no opinion'] ?? 0) + 1
  const confs = answered.map((r) => r.jev.subjectConfidence ?? 0).sort((a, b) => a - b)
  const median = confs.length ? confs[Math.floor(confs.length / 2)] : 0

  const summary = {
    products: n,
    answered: answered.length,
    accepted: accepted.length,
    lowConfidence: low.length,
    rejected: rejected.length,
    medianSubjectConfidence: Number(median.toFixed(2)),
    keywordMatched: withKeyword.length,
    keywordOnlyWouldDefault: n - withKeyword.length,
    jevAcceptedWhereKeywordsHadNothing: accepted.filter((r) => !r.keyword).length,
    agreeWithKeywordExact: accepted.filter((r) => r.keyword && r.keyword === r.jevCast).length,
    acceptedWithKeyword: accepted.filter((r) => r.keyword).length,
    recordedCasts: withRecorded.length,
    recordedAcceptedByJev: recAcc.length,
    agreeWithRecordedExact: recAcc.filter((r) => r.recorded!.subjectId === r.jevCast).length,
    agreeWithRecordedBand: recAcc.filter((r) => r.recorded!.band === r.jevBand).length,
    youthCasts: accepted.filter((r) => r.jevBand === 'youth').length,
    designAudience: audCounts,
    costUsd: Number(cost.toFixed(5)),
    seconds: Math.round((Date.now() - started) / 1000),
  }
  console.log(summary)

  mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 10)
  writeFileSync(join(outDir, `jev-casting-sample-${stamp}.json`), JSON.stringify({ summary, rows }, null, 2))

  const line = (r: (typeof rows)[number]) =>
    `| ${esc(r.name).slice(0, 60)} | ${r.keyword ?? '-'} | ${r.recorded ? `${r.recorded.subjectId} (${r.recorded.source})` : '-'} | ${
      r.jev.subjectId ?? '-'
    } @ ${r.jev.subjectConfidence?.toFixed(2) ?? '-'} | ${r.jev.designAudience ?? '-'} @ ${r.jev.audienceConfidence?.toFixed(2) ?? '-'} | ${r.jev.verdict} |`
  const head = '| Listing | Keywords | Recorded cast | Jev subject | Jev design_audience | Verdict |\n|---|---|---|---|---|---|'
  const md = `# Jev casting sample — ${stamp}

Read-only. ${n} real products; Jev asked exactly as \`castForDesign\` would in
\`STEP_FLOW_CASTING_JEV=on\`, gated by \`evaluateJevCast\`. Nothing was written.

## Summary

| | |
|---|---|
| Jev answered | ${answered.length} / ${n} |
| Accepted (confident, consistent, agrees with keyword band) | ${accepted.length} (${pct(accepted.length, n)}) |
| Low confidence → human review | ${low.length} (${pct(low.length, n)}) |
| Rejected (contradiction / keyword-band clash / off-menu) | ${rejected.length} (${pct(rejected.length, n)}) |
| Median subject confidence | ${summary.medianSubjectConfidence} |
| Keyword floor matched anything | ${withKeyword.length} / ${n} (the rest fall to the plain default today) |
| Jev cast where keywords had nothing | ${summary.jevAcceptedWhereKeywordsHadNothing} |
| Accepted & same archetype as keywords | ${summary.agreeWithKeywordExact} / ${summary.acceptedWithKeyword} |
| Recorded live casts (vision chain) | ${withRecorded.length} |
| …Jev accepted & same archetype | ${summary.agreeWithRecordedExact} / ${recAcc.length} |
| …Jev accepted & same age band | ${summary.agreeWithRecordedBand} / ${recAcc.length} |
| Youth (child) casts Jev would make | ${summary.youthCasts} |
| design_audience | ${Object.entries(audCounts).map(([k, v]) => `${k}: ${v}`).join(', ')} |
| Cost / time | $${summary.costUsd} / ${summary.seconds}s |

## Recorded casts vs Jev

${head}
${withRecorded.map(line).join('\n') || '| (none) | | | | | |'}

## Review list (low confidence / rejected)

${head}
${[...low, ...rejected].slice(0, 80).map(line).join('\n') || '| (none) | | | | | |'}

## Accepted

${head}
${accepted.slice(0, 120).map(line).join('\n') || '| (none) | | | | | |'}
`
  writeFileSync(join(outDir, `jev-casting-sample-${stamp}.md`), md)
  console.log(`[jev-casting-sample] wrote ${outDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
