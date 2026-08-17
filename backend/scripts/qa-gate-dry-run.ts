// ---------------------------------------------------------------------------
// Dry-run the presentation QA gate over real products WITHOUT writing anything.
//
// The point is to see what the gate actually says about the live catalogue
// before it starts blocking things — a gate whose thresholds nobody has run
// against real work is a gate that gets switched off on its first Monday.
//
//   cd backend && npx tsx --env-file=.env scripts/qa-gate-dry-run.ts [count] [channel]
//
// Reads products only. Writes nothing: no review rows, no metadata stamp.
// ---------------------------------------------------------------------------
import { supabase } from '../lib/supabase.js'
import { buildPresentationInput } from '../services/design-qa-gate.js'
import { runPresentationQa, type Channel } from '../services/presentation-qa.js'

async function main(): Promise<void> {
  const count = Number(process.argv[2] || 5)
  const channel: Channel = process.argv[3] === 'etsy' ? 'etsy' : 'storefront'

  const { data, error } = await supabase
    .from('products')
    .select('id, name, status')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(count)
  if (error) throw error
  if (!data?.length) { console.log('no active products'); return }

  console.log(`Dry-running the presentation QA gate over ${data.length} live product(s) [channel=${channel}]\n`)

  let passed = 0
  for (const product of data) {
    try {
      const input = await buildPresentationInput(product.id, channel)
      const verdict = await runPresentationQa(input)
      if (verdict.status === 'passed') passed++

      console.log(`${verdict.status === 'passed' ? 'PASS' : 'FAIL'}  ${verdict.score}/100  ${product.name}`)
      console.log(`      photos ${input.mockupUrls.length} · title ${input.title.length} chars · ${input.tags.length} tags · $${input.price}`)
      for (const id of Object.keys(verdict.criteria) as Array<keyof typeof verdict.criteria>) {
        const c = verdict.criteria[id]
        console.log(`      ${c.ok ? ' ok ' : 'FAIL'} ${String(id).padEnd(17)} ${c.summary}`)
      }
      for (const item of verdict.rework) {
        console.log(`      ${item.severity === 'block' ? '[BLOCK]' : '[warn] '} ${item.criterion}: ${item.issue}`)
      }
      console.log(`      (${verdict.durationMs}ms via ${verdict.model})\n`)
    } catch (e: any) {
      console.log(`ERROR ${product.name}: ${e?.message}\n`)
    }
  }

  console.log(`--- ${passed}/${data.length} would pass the gate as they stand today ---`)
}

main().catch(e => { console.error(e); process.exit(1) })
