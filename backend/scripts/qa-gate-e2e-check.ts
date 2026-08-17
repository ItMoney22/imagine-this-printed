// ---------------------------------------------------------------------------
// End-to-end check of the presentation QA gate against a real database.
//
// Proves the loop the acceptance criteria actually ask for, in order:
//   1. submit a design      -> a numbered review row exists and the verdict is
//                              stamped on the product
//   2. the go-live gate     -> refuses the design, with the reason
//   3. resubmit             -> submission #2, both rounds visible in history
//   4. freshness            -> editing the listing after a pass goes stale
//   5. override             -> a human can ship it, findings preserved
//
// WRITES: review rows (that is the audit trail) and products.metadata.qa_gate
// on the product it picks. It restores the product's original metadata at the
// end; the review rows are left, because a QA record is supposed to persist.
//
//   cd backend && npx tsx --env-file=.env scripts/qa-gate-e2e-check.ts [productId]
// ---------------------------------------------------------------------------
import { supabase } from '../lib/supabase.js'
import {
  submitForQa,
  reviewHistory,
  checkGate,
  evaluateGate,
  overrideQa,
  buildPresentationInput,
  fingerprintPresentation
} from '../services/design-qa-gate.js'

let failures = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (!ok) failures++
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const metadataOf = async (productId: string): Promise<Record<string, any>> => {
  const { data } = await supabase.from('products').select('metadata').eq('id', productId).maybeSingle()
  return ((data as any)?.metadata ?? {}) as Record<string, any>
}

async function main(): Promise<void> {
  let productId = process.argv[2]
  if (!productId) {
    const { data } = await supabase
      .from('products')
      .select('id, name')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
    productId = data?.[0]?.id
    if (!productId) throw new Error('no active product to test against')
    console.log(`Using "${data?.[0]?.name}" (${productId})\n`)
  }

  const originalMetadata = await metadataOf(productId)

  // --- 1. submit --------------------------------------------------------
  console.log('1. First submission')
  const first = await submitForQa({ productId, channel: 'storefront', submittedBy: 'daily-designer' })
  check('a review row was created', Boolean(first.reviewId))
  check('numbered from 1', first.submissionNo >= 1, `#${first.submissionNo}`)
  check('verdict recorded', ['passed', 'failed'].includes(first.verdict.status), first.verdict.status)
  check('every finding carries a fix', first.verdict.rework.every(r => r.fix?.length > 10), `${first.verdict.rework.length} findings`)

  const stamped = await metadataOf(productId)
  check('verdict mirrored onto the product', stamped.qa_gate?.storefront?.review_id === first.reviewId)

  // --- 2. the gate ------------------------------------------------------
  console.log('\n2. Go-live gate')
  const gate = await checkGate(productId, 'storefront')
  const expectBlocked = first.verdict.status === 'failed'
  check(
    expectBlocked ? 'a failed design is refused' : 'a passed design is allowed',
    gate.allowed === !expectBlocked,
    `${gate.code}: ${gate.reason.slice(0, 90)}`
  )
  check('a never-reviewed design is NOT treated as passed', evaluateGate({}, 'storefront').allowed === false)
  check('the Etsy channel is graded separately', evaluateGate(stamped, 'etsy').code === 'never_reviewed')

  // --- 3. resubmit ------------------------------------------------------
  console.log('\n3. Resubmission after rework')
  const second = await submitForQa({ productId, channel: 'storefront', submittedBy: 'daily-designer' })
  check('submission number advanced', second.submissionNo === first.submissionNo + 1, `#${first.submissionNo} -> #${second.submissionNo}`)
  const history = await reviewHistory(productId, 'storefront')
  check('history keeps both rounds', history.length >= 2, `${history.length} submissions on record`)
  check('history is newest-first', history[0].submission_no === second.submissionNo)

  // --- 4. freshness -----------------------------------------------------
  // Staleness only becomes observable on a PASSING stamp: a failed design is
  // already refused, and reporting "stale" instead of "failed" there would tell
  // the designer to resubmit rather than to fix anything. So the passing stamp
  // is synthesised from the real one rather than assumed — the sample design
  // may well be failing, which is the normal case today.
  console.log('\n4. Freshness — a pass must not survive an edit')
  const input = await buildPresentationInput(productId, 'storefront')
  const live = await metadataOf(productId)
  const realStamp = live.qa_gate?.storefront
  const asPassed = { qa_gate: { storefront: { ...realStamp, status: 'passed' } } }

  check('unchanged presentation keeps its pass', evaluateGate(asPassed, 'storefront', fingerprintPresentation(input)).code === 'passed')
  const edited = fingerprintPresentation({ ...input, price: input.price + 7 })
  check('a price change invalidates the pass', evaluateGate(asPassed, 'storefront', edited).code === 'stale')
  const reshot = fingerprintPresentation({ ...input, mockupUrls: [...input.mockupUrls, 'https://example.test/new-shot.png'] })
  check('a re-render invalidates the pass', evaluateGate(asPassed, 'storefront', reshot).code === 'stale')
  check('a failure still reports as failed, not stale', evaluateGate(live, 'storefront', edited).code === (realStamp?.status === 'passed' ? 'stale' : 'failed'))

  // --- 5. override ------------------------------------------------------
  console.log('\n5. Admin override')
  if (first.verdict.status === 'failed') {
    const overridden = await overrideQa({
      productId,
      channel: 'storefront',
      by: 'qa-gate-e2e-check',
      reason: 'End-to-end verification of the override path — not a real merchandising decision.'
    })
    const afterOverride = await metadataOf(productId)
    const verdict = evaluateGate(afterOverride, 'storefront')
    check('override opens the gate', verdict.allowed && verdict.code === 'overridden')
    const rows = await reviewHistory(productId, 'storefront')
    const row = rows.find(r => r.id === overridden.reviewId)
    check('override is a NEW row, not an edit', Boolean(row) && rows.length >= 3, `${rows.length} submissions`)
    check('original findings preserved on the override', Array.isArray(row?.rework) && row!.rework.length > 0)
    check('override reason recorded', String(row?.override_reason || '').includes('End-to-end'))
  } else {
    console.log('  SKIP  the sample design passed, so there is nothing to override')
  }

  // --- restore ----------------------------------------------------------
  await supabase.from('products').update({ metadata: originalMetadata }).eq('id', productId)
  const restored = await metadataOf(productId)
  check('\n  product metadata restored', JSON.stringify(restored.qa_gate) === JSON.stringify(originalMetadata.qa_gate))

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
