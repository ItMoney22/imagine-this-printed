// ---------------------------------------------------------------------------
// Benchmark the Jev copy pass against the current presentation gate on REAL
// listing rows, before PRESENTATION_QA_JEV=enforce goes anywhere near prod.
// Watchtower task 728d9207.
//
//   cd backend && npx tsx --env-file=.env scripts/qa-jev-benchmark.ts [count] [channel] [--no-photos] [--out=path.json]
//
// Reads products only. Writes nothing to the database, and makes NO vision
// calls — the point is to count the vision calls enforce mode would save, not
// to spend them. Per row it records:
//   - the current gate's deterministic copy verdict (checkSeo)
//   - the unfulfillable-claim floor hits
//   - Jev's copy class / title score / tag scores, with confidences
//   - whether the vision call runs today (every row with a photo) and whether
//     it would run under enforce (decideVision on the same deterministic floor)
// --out dumps every row so a person can grade the disagreements by hand.
// ---------------------------------------------------------------------------
import { writeFileSync } from 'node:fs'
import { supabase } from '../lib/supabase.js'
import { buildPresentationInput } from '../services/design-qa-gate.js'
import { measureImages } from '../services/image-metrics.js'
import {
  checkMockupQuality, checkPricing, checkSeo, checkSharpness, decideVision, findUnfulfillableClaims,
  isGarment, reviewCopy, shotTemplatesFrom, type Channel, type CriterionId
} from '../services/presentation-qa.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const count = Number(args.find(a => /^\d+$/.test(a)) || 40)
  const channel: Channel = args.includes('etsy') ? 'etsy' : 'storefront'
  const photos = !args.includes('--no-photos')
  const out = args.find(a => a.startsWith('--out='))?.slice(6)

  const { data, error } = await supabase
    .from('products')
    .select('id, name')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(count)
  if (error) throw error
  if (!data?.length) { console.log('no active products'); return }
  console.log(`Benchmarking Jev copy QA over ${data.length} live product(s) [channel=${channel}, photos=${photos}]\n`)

  const rows: any[] = []
  for (const product of data) {
    try {
      const input = await buildPresentationInput(product.id, channel)
      const urls = input.mockupUrls.filter(Boolean)
      const copy = await reviewCopy(input, 'enforce')
      const seo = checkSeo(input)
      const pricing = checkPricing(input)
      const blocking: Array<{ criterion: CriterionId; issue: string }> = []
      const push = (id: CriterionId, v: { findings: Array<{ severity: string; issue: string }> }) =>
        v.findings.forEach(f => f.severity === 'block' && blocking.push({ criterion: id, issue: f.issue }))
      push('seo', seo)
      push('pricing', pricing)
      if (photos) {
        const metrics = await measureImages(urls)
        push('mockup_quality', checkMockupQuality(metrics, urls.length, shotTemplatesFrom(urls), isGarment(input.category)))
        push('image_sharpness', checkSharpness(metrics))
      }
      copy.findings.forEach(f => f.severity === 'block' && blocking.push({ criterion: 'seo', issue: f.issue }))
      const gate = decideVision(blocking, copy, 'enforce')
      const jev = copy.measured.jev as any
      rows.push({
        id: product.id,
        name: product.name,
        category: input.category,
        title: input.title,
        description: input.description.slice(0, 600),
        tags: input.tags,
        has_photo: urls.length > 0,
        current_seo_ok: seo.ok,
        current_seo_blocks: seo.findings.filter(f => f.severity === 'block').map(f => f.issue),
        filler_tags_deterministic: seo.findings.find(f => (f.evidence as any)?.filler)?.evidence?.filler ?? [],
        floor_hits: findUnfulfillableClaims(input),
        jev: typeof jev === 'object' ? jev : null,
        jev_class: copy.copyClass,
        jev_blocks: copy.jevBlocks,
        human_review: copy.needsHumanReview,
        jev_findings: copy.jevFindings.map(f => `${f.severity}: ${f.issue}`),
        vision_today: urls.length > 0,
        vision_enforce: urls.length > 0 && gate.run,
        skip_reason: gate.reason
      })
      const r = rows[rows.length - 1]
      console.log(`${String(r.jev?.copy_class ?? 'n/a').padEnd(20)} ${(r.jev?.copy_class_confidence ?? 0).toFixed(2)}  ${r.vision_enforce ? 'vision' : 'SKIP  '}  ${r.floor_hits.length ? 'FLOOR ' : '      '}${product.name}`)
    } catch (e: any) {
      console.log(`ERROR ${product.name}: ${e?.message}`)
    }
  }

  const n = rows.length
  const answered = rows.filter(r => r.jev)
  const classes: Record<string, number> = {}
  for (const r of answered) classes[r.jev.copy_class] = (classes[r.jev.copy_class] ?? 0) + 1
  const visionToday = rows.filter(r => r.vision_today).length
  const visionEnforce = rows.filter(r => r.vision_enforce).length
  const cost = answered.reduce((s, r) => s + (r.jev.cost_usd ?? 0), 0)
  const ms = answered.map(r => r.jev.duration_ms as number).sort((a, b) => a - b)
  const weakTags = answered.reduce((s, r) => s + r.jev.tag_scores.filter((t: any) => t.score !== null && Math.round(t.score) <= 1 && t.confidence >= 0.75).length, 0)
  const fillerTags = rows.reduce((s, r) => s + r.filler_tags_deterministic.length, 0)
  const summary = {
    rows: n,
    jev_answered: answered.length,
    copy_class_distribution: classes,
    confident_rows: answered.filter(r => !r.human_review).length,
    human_review_rows: answered.filter(r => r.human_review).length,
    jev_blocking_rows: rows.filter(r => r.jev_blocks).length,
    floor_hit_rows: rows.filter(r => r.floor_hits.length).length,
    current_seo_failing_rows: rows.filter(r => !r.current_seo_ok).length,
    weak_tags_jev: weakTags,
    filler_tags_deterministic: fillerTags,
    vision_calls_today: visionToday,
    vision_calls_enforce: visionEnforce,
    vision_calls_saved: visionToday - visionEnforce,
    jev_cost_usd_total: Number(cost.toFixed(6)),
    jev_latency_ms_p50: ms[Math.floor(ms.length / 2)] ?? null,
    jev_latency_ms_max: ms[ms.length - 1] ?? null
  }
  console.log('\n' + JSON.stringify(summary, null, 2))
  if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
