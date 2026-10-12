// ---------------------------------------------------------------------------
// Accuracy check for the unfulfillable-claim half of the Jev copy pass.
// Watchtower task 728d9207.
//
// Live copy almost never makes a bad claim (0 of 60 on 2026-09-23), so a
// benchmark over real rows alone measures nothing about the thing we care
// about. This takes REAL apparel listings and derives labelled variants from
// each one — the original, seeded claims, claims PARAPHRASED past the regex,
// a wrong product noun, and design-subject traps ("Sherman tank", "Marco Polo")
// that must NOT be flagged — then scores the deterministic floor, Jev, and the
// two combined against the labels.
//
//   cd backend && npx tsx --env-file=.env scripts/qa-jev-challenge.ts [rows]
//
// Reads products only; writes nothing; no vision calls.
// ---------------------------------------------------------------------------
import { supabase } from '../lib/supabase.js'
import { buildPresentationInput } from '../services/design-qa-gate.js'
import { findUnfulfillableClaims, interpretCopyReview, buildCopyQuestions, type PresentationInput } from '../services/presentation-qa.js'
import { askJev } from '../services/jev.js'

type Label = 'ok' | 'bad'
type Variant = { kind: string; label: Label; input: PresentationInput }

/** Swap the product noun; a title with no noun to swap gets one appended, so the variant is really seeded. */
const swapNoun = (s: string, to: string) => {
  const swapped = s.replace(/\b(t-?shirts?|shirts?|tees?|hoodies?|sweatshirts?)\b/gi, to)
  return swapped === s ? `${s} ${to}` : swapped
}

function variantsOf(base: PresentationInput): Variant[] {
  const v = (kind: string, label: Label, over: Partial<PresentationInput>): Variant => ({ kind, label, input: { ...base, ...over } })
  return [
    v('original', 'ok', {}),
    v('seeded:embroidered', 'bad', { description: `${base.description}\n\nAlso available as a premium embroidered version.` }),
    v('seeded:tank-top', 'bad', { title: swapNoun(base.title, 'Tank Top') }),
    v('seeded:sublimation-polo', 'bad', { description: `Our sublimation-printed polo shirt edition. ${base.description}` }),
    v('paraphrase:stitched', 'bad', { description: `${base.description}\n\nThe design is stitched in raised thread for a textured, hand-sewn finish.` }),
    v('paraphrase:sleeveless', 'bad', { description: `${base.description}\n\nCut as a sleeveless summer top with deep armholes for the gym.` }),
    v('wrong-noun:mug', 'bad', { title: swapNoun(base.title, 'Coffee Mug'), description: `A glossy 11 oz ceramic coffee mug. ${base.description}` }),
    v('trap:sherman-tank', 'ok', { title: `Sherman Tank WW2 History ${base.category === 'hoodies' ? 'Hoodie' : 'Tee'}`, description: `${base.description}\n\nThe artwork: a Sherman tank rolling through the Ardennes.` }),
    v('trap:marco-polo', 'ok', { title: `Marco Polo Silk Road Explorer ${base.category === 'hoodies' ? 'Hoodie' : 'Tee'}`, description: `${base.description}\n\nThe artwork: Marco Polo's route across a vintage map.` })
  ]
}

async function main(): Promise<void> {
  const n = Number(process.argv[2] || 12)
  const { data, error } = await supabase
    .from('products')
    .select('id, name, category')
    .eq('status', 'active')
    .in('category', ['shirts', 'hoodies'])
    .order('created_at', { ascending: false })
    .limit(n)
  if (error) throw error

  const tally: Record<string, { floor: [number, number]; jev: [number, number]; combined: [number, number]; unsure: number; escaped: number }> = {}
  const miss: string[] = []
  const blankUnsure: string[] = []
  let blankRows = 0
  let cost = 0
  let calls = 0
  for (const p of data ?? []) {
    const isBlank = /\bblank\b/i.test(p.name ?? '')
    if (isBlank) blankRows++
    const base = await buildPresentationInput(p.id, 'storefront')
    for (const variant of variantsOf(base)) {
      const { state, questions } = buildCopyQuestions(variant.input)
      const jev = await askJev(state, questions)
      calls++
      cost += jev?.usage.cost ?? 0
      const review = interpretCopyReview(variant.input, jev, 'enforce')
      const floorBad = findUnfulfillableClaims(variant.input).length > 0
      const jevBad = review.jevBlocks
      const t = (tally[variant.kind] ??= { floor: [0, 0], jev: [0, 0], combined: [0, 0], unsure: 0, escaped: 0 })
      const right = (said: boolean) => (said === (variant.label === 'bad') ? 1 : 0)
      t.floor[0] += right(floorBad); t.floor[1]++
      t.jev[0] += right(jevBad); t.jev[1]++
      t.combined[0] += right(floorBad || jevBad); t.combined[1]++
      if (review.needsHumanReview) t.unsure++
      // The failure that matters: bad copy that is neither blocked nor put in front of a person.
      if (variant.label === 'bad' && !floorBad && !jevBad && !review.needsHumanReview) t.escaped++
      if (!right(floorBad || jevBad)) {
        const m = review.measured.jev as { copy_class?: string; copy_class_confidence?: number } | string
        miss.push(`${variant.kind.padEnd(24)} ${p.name} -> jev ${typeof m === 'object' ? `${m.copy_class} ${m.copy_class_confidence}` : m}`)
      }
      // Blanks (task e0a39743): the "original" copy on a real blank listing must
      // not need a human just because it has no design to describe.
      if (isBlank && variant.kind === 'original' && review.needsHumanReview) {
        const m = review.measured.jev as { copy_class?: string; copy_class_confidence?: number } | string
        blankUnsure.push(`${p.name} -> jev ${typeof m === 'object' ? `${m.copy_class} ${m.copy_class_confidence}` : m}`)
      }
    }
  }

  const pct = ([a, b]: [number, number]) => `${a}/${b} (${b ? Math.round((a / b) * 100) : 0}%)`
  console.log(`\n${'variant'.padEnd(26)}${'floor'.padEnd(14)}${'jev'.padEnd(14)}${'floor+jev'.padEnd(14)}unsure->human  escaped`)
  const all = { floor: [0, 0] as [number, number], jev: [0, 0] as [number, number], combined: [0, 0] as [number, number], unsure: 0, escaped: 0 }
  for (const [kind, t] of Object.entries(tally)) {
    console.log(`${kind.padEnd(26)}${pct(t.floor).padEnd(14)}${pct(t.jev).padEnd(14)}${pct(t.combined).padEnd(14)}${String(t.unsure).padEnd(15)}${t.escaped}`)
    for (const k of ['floor', 'jev', 'combined'] as const) { all[k][0] += t[k][0]; all[k][1] += t[k][1] }
    all.unsure += t.unsure
    all.escaped += t.escaped
  }
  console.log(`${'ALL'.padEnd(26)}${pct(all.floor).padEnd(14)}${pct(all.jev).padEnd(14)}${pct(all.combined).padEnd(14)}${String(all.unsure).padEnd(15)}${all.escaped}`)
  console.log(`\n${calls} Jev calls, $${cost.toFixed(5)} total`)
  console.log(`\nBlank listings in sample: ${blankRows}. Unwarranted human-review on real blank copy: ${blankUnsure.length}`)
  if (blankUnsure.length) console.log(`  ${blankUnsure.join('\n  ')}`)
  if (miss.length) console.log(`\nWrong answers (floor+jev):\n  ${miss.join('\n  ')}`)
}

main().catch(e => { console.error(e); process.exit(1) })
