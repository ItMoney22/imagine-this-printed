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
  type TicketInput,
} from '../lib/jev-triage.js'
import { askJev, type JevAnswers, type JevChoiceQuestion } from '../lib/jev.js'

interface Row<I, L> { source: string; input: I; label: L }

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
  const rows: { source: string; message: string; items: string[]; label: string }[] = data.etsy || []
  const tally = { n: rows.length, floor: 0, final: 0, jevRaw: 0, answered: 0, reviewed: 0, problemsMissed: 0, problems: 0 }
  const misses: unknown[] = []
  for (const r of rows) {
    const floor = etsyFlagFloor(r.message)
    const tr = await triageEtsyBuyerMessage(r.message, r.items, counted)
    if ((floor.flag ?? 'none') === r.label) tally.floor++
    if (tr.jev) { tally.answered++; if (tr.jev.choice === r.label) tally.jevRaw++ }
    if (tr.flag === r.label) tally.final++
    if (tr.needsReview) tally.reviewed++
    if (r.label === 'problem') { tally.problems++; if (tr.flag !== 'problem' && !tr.needsReview) tally.problemsMissed++ }
    if (tr.flag !== r.label) misses.push({ message: r.message, want: r.label, got: tr.flag, review: tr.needsReview, jev: tr.jev })
  }
  void combineEtsyFlag; void ETSY_FLAG_CRITERIA
  console.log(`\n== ETSY BUYER NOTES (${tally.n} rows, all synthetic — prod has no Etsy orders with a buyer note yet) ==`)
  console.log(`flag  old n/a (no flag existed) | floor ${pct(tally.floor, tally.n)} | jev raw ${pct(tally.jevRaw, tally.answered)} | final ${pct(tally.final, tally.n)}`)
  console.log(`problems silently missed (wrong flag AND not sent to review): ${tally.problemsMissed}/${tally.problems}; sent to review ${tally.reviewed}`)
  if (misses.length) console.log('misses:', JSON.stringify(misses, null, 1))
  report.etsy = { tally, misses }
}

await evalTickets()
await evalEmails()
await evalEtsy()
console.log(`\nJev spend for this run: $${cost.toFixed(5)}`)
report.costUsd = cost
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 1))
