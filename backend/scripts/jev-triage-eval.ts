// Jev triage eval — the old method vs the deterministic floor vs Jev, scored
// against hand labels on real rows (plus clearly-marked synthetic rows for the
// classes production has never seen). Run this BEFORE flipping JEV_TRIAGE, and
// again whenever a question's wording changes.
//
//   npx tsx --env-file=.env scripts/jev-triage-eval.ts <dataset.json> [--out report.json]
//
// The dataset lives OUTSIDE the repo — it is real customer and supplier mail.
// Shape: { tickets: [{source, input: TicketInput, label: {category, priority}}],
//          emails:  [{source, input: EmailInput,  label: {label, reply}}],
//          etsy:    [{source, message, items, label}] }
//
// "old" = what production did before Jev: the customer-picked category and
// `billing ? high : medium` for tickets; summarize every inbox email; no Etsy
// flag at all.
//
// Etsy buyer notes (task 7f91312c, 2026-09-23): re-checked whether production
// has any real Etsy orders with a buyer note yet — it has ZERO (not "zero with
// a note" — zero Etsy orders at all: `orders` has no `source='etsy'` rows).
// Receipt ingest is still blocked on the `transactions_r` re-consent (task
// c93b557e). When `data.etsy` is missing or empty, evalEtsy() below falls back
// to ETSY_SYNTHETIC_FALLBACK — a harder, hand-built 30-row set (vs. the
// original 12) that is safe to commit because none of it is real customer
// text. It exists to pressure-test the floor keywords, not to stand in for
// real-world label distribution. Re-run against real notes once ingest flows
// (see docs/reports/jev-triage-eval-2026-09-23.md and the follow-up task filed
// alongside this dataset) — a populated `data.etsy` always takes priority.

import { readFileSync, writeFileSync } from 'node:fs'
import {
  combineEmail,
  combineEtsyFlag,
  combineTicket,
  emailFloor,
  emailQuestions,
  etsyFlagFloor,
  ETSY_FLAG_CRITERIA,
  ticketFloor,
  ticketQuestions,
  triageEtsyBuyerMessage,
  triageTicket,
  wantsSummary,
  type EmailInput,
  type EtsyFlag,
  type TicketInput,
} from '../lib/jev-triage.js'
import { askJev, type JevAnswers, type JevChoiceQuestion } from '../lib/jev.js'

interface Row<I, L> { source: string; input: I; label: L }

// Hand-labeled, entirely synthetic (no real customer text) — safe to commit.
// 8 none / 8 personalization / 7 change_request / 7 problem. A few rows are
// deliberately adversarial against the deterministic floor:
//   - "Not urgent..." / "Nothing urgent..." used to false-positive `problem`
//     via the bare "urgent" keyword (fixed alongside this dataset).
//   - "Names:Ava and Ben" / "Name: Ava, Number: 7" used to miss `personalization`
//     because the old regex required a space before the colon (fixed).
//   - Three rows ("wedding date", "make it say", "birthday in 3 days") carry
//     no floor keyword at all, so they only pass if Jev's raw read is right.
const ETSY_SYNTHETIC_FALLBACK: { source: string; message: string; items: string[]; label: EtsyFlag }[] = [
  { source: 'synthetic', message: "Thank you so much, can't wait to get this!", items: ['Custom Tee'], label: 'none' },
  { source: 'synthetic', message: "This is a gift for my sister's birthday :)", items: ['Hoodie'], label: 'none' },
  { source: 'synthetic', message: 'You guys are the best, appreciate it!', items: ['Custom Tee'], label: 'none' },
  { source: 'synthetic', message: '😍😍😍 obsessed already', items: ['Poster'], label: 'none' },
  { source: 'synthetic', message: 'Not urgent, just wanted to say I loved my last order!', items: ['Custom Tee'], label: 'none' },
  { source: 'synthetic', message: 'Nothing urgent, just wanted to say thanks for the quick shipping last time!', items: ['Hoodie'], label: 'none' },
  { source: 'synthetic', message: 'So happy with my last order, ordering more soon!', items: ['Custom Tee'], label: 'none' },
  { source: 'synthetic', message: '   ', items: ['Custom Tee'], label: 'none' },
  { source: 'synthetic', message: "Please put 'Coach Dan' on the back", items: ['Jersey'], label: 'personalization' },
  { source: 'synthetic', message: 'Name: Ava, Number: 7', items: ['Jersey'], label: 'personalization' },
  { source: 'synthetic', message: 'Can you monogram the initials J.T.M. on the pocket?', items: ['Towel'], label: 'personalization' },
  { source: 'synthetic', message: 'Names:Ava and Ben', items: ['Ornament'], label: 'personalization' },
  { source: 'synthetic', message: 'the name on it should be Sam', items: ['Mug'], label: 'personalization' },
  { source: 'synthetic', message: "For the jersey - name 'Rodriguez' number 22", items: ['Jersey'], label: 'personalization' },
  { source: 'synthetic', message: 'put our wedding date 06.14.2026 under the design', items: ['Sign'], label: 'personalization' },
  { source: 'synthetic', message: "make it say 'Est. 2027' please", items: ['Custom Tee'], label: 'personalization' },
  { source: 'synthetic', message: 'Can I switch the color to navy instead of black?', items: ['Hoodie'], label: 'change_request' },
  { source: 'synthetic', message: 'Please change size to XL, I ordered L by mistake', items: ['Custom Tee'], label: 'change_request' },
  { source: 'synthetic', message: 'I need to update my shipping address to 123 Elm St', items: ['Custom Tee'], label: 'change_request' },
  { source: 'synthetic', message: 'Can you cancel this order, I found it cheaper elsewhere', items: ['Poster'], label: 'change_request' },
  { source: 'synthetic', message: 'Wrong size selected, need medium not small', items: ['Custom Tee'], label: 'change_request' },
  { source: 'synthetic', message: "Actually I'd like 2 instead of 1, can you add another?", items: ['Custom Tee'], label: 'change_request' },
  { source: 'synthetic', message: 'Sorry, can you cancel the personalization and just ship it blank?', items: ['Jersey'], label: 'change_request' },
  { source: 'synthetic', message: "This never arrived and it's been 3 weeks, I'm really upset", items: ['Custom Tee'], label: 'problem' },
  { source: 'synthetic', message: "The shirt I got is damaged, there's a hole in it", items: ['Custom Tee'], label: 'problem' },
  { source: 'synthetic', message: 'I need this by Friday for a funeral, is that possible?', items: ['Hoodie'], label: 'problem' },
  { source: 'synthetic', message: 'This is not what I ordered, please help ASAP', items: ['Custom Tee'], label: 'problem' },
  { source: 'synthetic', message: "My daughter's birthday is in 3 days, will this make it in time?", items: ['Hoodie'], label: 'problem' },
  { source: 'synthetic', message: "I'm so disappointed this took so long to ship, but I still love it!", items: ['Custom Tee'], label: 'problem' },
  { source: 'synthetic', message: "Please rush this, it's urgent, needed by tomorrow for a work event", items: ['Custom Tee'], label: 'problem' },
]

const args = process.argv.slice(2)
const path = args.find((a) => !a.startsWith('--'))
if (!path) {
  console.error('usage: tsx scripts/jev-triage-eval.ts <dataset.json> [--out report.json]')
  process.exit(1)
}
const outIdx = args.indexOf('--out')
const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined
const data = JSON.parse(readFileSync(path, 'utf8'))
process.env.JEV_TRIAGE = 'on'

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a')
const report: Record<string, unknown> = {}
let cost = 0
const counted = async (state: Record<string, unknown>, q: Record<string, JevChoiceQuestion>) => {
  const r = await askJev(state, q, { timeoutMs: 20000 })
  cost += r?.usage.cost ?? 0
  return r
}

async function evalTickets() {
  const rows: Row<TicketInput, { category: string; priority: string }>[] = data.tickets || []
  const oldCat = (t: TicketInput) => ({ billing: 'billing', technical_issue: 'design_help' } as Record<string, string>)[t.customerCategory || ''] ?? null
  const oldPri = (t: TicketInput) => ((t.customerCategory === 'billing') ? 'high' : 'normal')
  const tally = { n: rows.length, old: { cat: 0, pri: 0 }, floor: { cat: 0, pri: 0 }, jevRaw: { cat: 0, pri: 0, answered: 0 }, final: { cat: 0, pri: 0 }, confident: 0, confidentCatRight: 0, reviewed: 0, elevatedMissed: 0, elevatedTotal: 0 }
  const misses: unknown[] = []
  for (const r of rows) {
    const floor = ticketFloor(r.input)
    const res = await counted(
      { business: 'Imagine This Printed — custom apparel, DTF transfers, 3D prints, sold on our site and on Etsy', ticket: `Subject: ${r.input.subject}\nCustomer picked category: ${r.input.customerCategory || 'none'}\nMessage: ${r.input.description.slice(0, 2500)}` },
      ticketQuestions()
    )
    const tr = combineTicket(floor, res?.answers ?? null, 'on')
    if (oldCat(r.input) === r.label.category) tally.old.cat++
    if (oldPri(r.input) === r.label.priority) tally.old.pri++
    if (floor.category === r.label.category) tally.floor.cat++
    if (floor.priority === r.label.priority) tally.floor.pri++
    if (tr.jev?.category) {
      tally.jevRaw.answered++
      if (tr.jev.category.choice === r.label.category) tally.jevRaw.cat++
      if (tr.jev.priority?.choice === r.label.priority) tally.jevRaw.pri++
    }
    if (tr.category === r.label.category) tally.final.cat++
    if (tr.priority === r.label.priority) tally.final.pri++
    if (tr.categorySource === 'jev') { tally.confident++; if (tr.category === r.label.category) tally.confidentCatRight++ }
    if (tr.needsReview) tally.reviewed++
    if (r.label.category === 'wrong_or_damaged' || r.label.category === 'bulk_quote') {
      tally.elevatedTotal++
      if (tr.priority !== 'urgent' && tr.priority !== 'high') tally.elevatedMissed++
    }
    if (tr.category !== r.label.category || tr.priority !== r.label.priority) {
      misses.push({ source: r.source, subject: r.input.subject.slice(0, 60), want: r.label, got: { category: tr.category, priority: tr.priority, review: tr.needsReview }, jev: tr.jev })
    }
  }
  console.log(`\n== SUPPORT TICKETS (${tally.n} rows: ${rows.filter((r) => r.source !== 'synthetic').length} real) ==`)
  console.log(`category   old ${pct(tally.old.cat, tally.n)} | floor ${pct(tally.floor.cat, tally.n)} | jev raw ${pct(tally.jevRaw.cat, tally.jevRaw.answered)} | final ${pct(tally.final.cat, tally.n)}`)
  console.log(`priority   old ${pct(tally.old.pri, tally.n)} | floor ${pct(tally.floor.pri, tally.n)} | jev raw ${pct(tally.jevRaw.pri, tally.jevRaw.answered)} | final ${pct(tally.final.pri, tally.n)}`)
  console.log(`confident category calls ${tally.confident}/${tally.n}, right ${pct(tally.confidentCatRight, tally.confident)}; sent to human review ${tally.reviewed}`)
  console.log(`damaged/bulk rows below high: ${tally.elevatedMissed}/${tally.elevatedTotal}`)
  if (misses.length) console.log('misses:', JSON.stringify(misses.slice(0, 15), null, 1))
  report.tickets = { tally, misses }
  // Sanity: the live path gives the same answer shape as the batch path.
  await triageTicket(rows[0]?.input ?? { subject: '', description: '' }, counted)
}

async function evalEmails() {
  const rows: Row<EmailInput, { label: string; reply: string }>[] = data.emails || []
  const BATCH = 40
  const tally = { n: rows.length, floor: { label: 0 }, final: { label: 0, reply: 0 }, jevRaw: { label: 0, reply: 0, answered: 0 }, reviewed: 0, needReplyTotal: 0, needReplyKept: 0, summarizedOld: rows.length, summarizedNew: 0, labelledConfident: 0, labelledConfidentRight: 0 }
  const misses: unknown[] = []
  for (let b = 0; b < rows.length; b += BATCH) {
    const chunk = rows.slice(b, b + BATCH)
    const questions: Record<string, JevChoiceQuestion> = {}
    chunk.forEach((_, i) => Object.assign(questions, emailQuestions(`e${i}`)))
    const res = await counted(
      {
        inbox: 'Imagine This Printed shared inbox. We are a small custom-apparel print shop (our own site + an Etsy shop). We BUY blanks and transfers from suppliers and SELL printed products.',
        emails: chunk.map((r, i) => `e${i} | From: <${r.input.from_address}> | Subject: ${(r.input.subject || '').slice(0, 150)} | ${(r.input.body || '').replace(/\s+/g, ' ').slice(0, 280)}`).join('\n'),
      },
      questions
    )
    const answers: JevAnswers | null = res?.answers ?? null
    chunk.forEach((r, i) => {
      const f = emailFloor(r.input)
      const tr = combineEmail(r.input, f, answers, 'on', `e${i}`)
      if (f.label === r.label.label) tally.floor.label++
      if (tr.jev?.label) { tally.jevRaw.answered++; if (tr.jev.label.choice === r.label.label) tally.jevRaw.label++; if (tr.jev.needsReply?.choice === r.label.reply) tally.jevRaw.reply++ }
      if (tr.label === r.label.label) tally.final.label++
      if (tr.needsReply === r.label.reply) tally.final.reply++
      if (tr.labelSource === 'jev') { tally.labelledConfident++; if (tr.label === r.label.label) tally.labelledConfidentRight++ }
      if (tr.needsReview) tally.reviewed++
      if (wantsSummary(tr)) tally.summarizedNew++
      if (r.label.reply !== 'no') { tally.needReplyTotal++; if (wantsSummary(tr)) tally.needReplyKept++ }
      if (tr.label !== r.label.label || tr.needsReply !== r.label.reply) {
        misses.push({ source: r.source, from: r.input.from_address, subject: (r.input.subject || '').slice(0, 60), want: r.label, got: { label: tr.label, reply: tr.needsReply }, jev: tr.jev })
      }
    })
  }
  console.log(`\n== SHARED MAILBOX (${tally.n} rows: ${rows.filter((r) => r.source !== 'synthetic').length} real) ==`)
  console.log(`label      floor ${pct(tally.floor.label, tally.n)} | jev raw ${pct(tally.jevRaw.label, tally.jevRaw.answered)} | final ${pct(tally.final.label, tally.n)} (confident jev labels ${tally.labelledConfident}, right ${pct(tally.labelledConfidentRight, tally.labelledConfident)})`)
  console.log(`needs_reply jev raw ${pct(tally.jevRaw.reply, tally.jevRaw.answered)} | final exact ${pct(tally.final.reply, tally.n)}`)
  console.log(`summarization: old sends ${tally.summarizedOld}, new sends ${tally.summarizedNew}; reply-needed rows kept ${tally.needReplyKept}/${tally.needReplyTotal} (must be all)`)
  console.log(`sent to human review ${tally.reviewed}`)
  if (misses.length) console.log('misses:', JSON.stringify(misses.slice(0, 20), null, 1))
  report.emails = { tally, misses }
}

async function evalEtsy() {
  const real: { source: string; message: string; items: string[]; label: EtsyFlag }[] = data.etsy || []
  const usingSynthetic = real.length === 0
  const rows = usingSynthetic ? ETSY_SYNTHETIC_FALLBACK : real
  const tally = { n: rows.length, floor: 0, final: 0, jevRaw: 0, answered: 0, reviewed: 0, problemsMissed: 0, problems: 0 }
  const classes: EtsyFlag[] = ['none', 'personalization', 'change_request', 'problem']
  // confusion[actual][predicted]
  const confusion: Record<EtsyFlag, Record<EtsyFlag, number>> = {
    none: { none: 0, personalization: 0, change_request: 0, problem: 0 },
    personalization: { none: 0, personalization: 0, change_request: 0, problem: 0 },
    change_request: { none: 0, personalization: 0, change_request: 0, problem: 0 },
    problem: { none: 0, personalization: 0, change_request: 0, problem: 0 },
  }
  const misses: unknown[] = []
  for (const r of rows) {
    const floor = etsyFlagFloor(r.message)
    const tr = await triageEtsyBuyerMessage(r.message, r.items, counted)
    if ((floor.flag ?? 'none') === r.label) tally.floor++
    if (tr.jev) { tally.answered++; if (tr.jev.choice === r.label) tally.jevRaw++ }
    if (tr.flag === r.label) tally.final++
    if (tr.needsReview) tally.reviewed++
    if (r.label === 'problem') { tally.problems++; if (tr.flag !== 'problem' && !tr.needsReview) tally.problemsMissed++ }
    confusion[r.label][tr.flag]++
    if (tr.flag !== r.label) misses.push({ message: r.message, want: r.label, got: tr.flag, review: tr.needsReview, jev: tr.jev, floor: floor.flag ?? 'none' })
  }
  void combineEtsyFlag; void ETSY_FLAG_CRITERIA
  console.log(`\n== ETSY BUYER NOTES (${tally.n} rows${usingSynthetic ? ', SYNTHETIC FALLBACK — prod has 0 Etsy orders total (blocked on task c93b557e, transactions_r scope)' : `, ${rows.filter((r) => r.source !== 'synthetic').length} real`}) ==`)
  console.log(`flag  old n/a (no flag existed) | floor ${pct(tally.floor, tally.n)} | jev raw ${pct(tally.jevRaw, tally.answered)} | final ${pct(tally.final, tally.n)}`)
  console.log(`problems silently missed (wrong flag AND not sent to review): ${tally.problemsMissed}/${tally.problems}; sent to review ${tally.reviewed}`)
  console.log('confusion (rows = actual, cols = predicted):')
  console.log(['        '.padEnd(17), ...classes.map((c) => c.slice(0, 12).padEnd(13))].join(''))
  for (const actual of classes) {
    console.log([actual.padEnd(17), ...classes.map((pred) => String(confusion[actual][pred]).padEnd(13))].join(''))
  }
  const perClass = classes.map((c) => {
    const tp = confusion[c][c]
    const totalActual = classes.reduce((s, a) => s + confusion[c][a], 0)
    const totalPredicted = classes.reduce((s, a) => s + confusion[a][c], 0)
    const recall = totalActual ? tp / totalActual : NaN
    const precision = totalPredicted ? tp / totalPredicted : NaN
    return { class: c, precision: isNaN(precision) ? 'n/a' : precision.toFixed(2), recall: isNaN(recall) ? 'n/a' : recall.toFixed(2), support: totalActual }
  })
  console.log('per-class precision/recall:', JSON.stringify(perClass))
  if (misses.length) console.log('misses:', JSON.stringify(misses, null, 1))
  report.etsy = { tally, usingSynthetic, confusion, perClass, misses }
}

await evalTickets()
await evalEmails()
await evalEtsy()
console.log(`\nJev spend for this run: $${cost.toFixed(5)}`)
report.costUsd = cost
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 1))
