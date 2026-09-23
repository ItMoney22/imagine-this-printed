import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AskJev, JevChoiceQuestion, JevResult } from './jev.js'
import {
  EMAIL_LABEL_CRITERIA,
  ETSY_FLAG_CRITERIA,
  NEEDS_REPLY_CRITERIA,
  SUPPORT_CATEGORY_CRITERIA,
  SUPPORT_PRIORITY_CRITERIA,
  combineTicket,
  emailFloor,
  emailQuestions,
  etsyFlagFloor,
  sortByReplyUrgency,
  sortTicketQueue,
  ticketFloor,
  ticketQuestions,
  triageEmails,
  triageEtsyBuyerMessage,
  triageTicket,
  wantsSummary,
} from './jev-triage.js'

// Every test injects a fake Jev — none of them may reach the network, whatever
// keys the shell happens to carry (a live key in env once turned a "no model"
// test into real spend and flaky assertions).

type Canned = Record<string, { choice: string; confidence: number }>
function fakeJev(canned: Canned | null, calls: { questions: Record<string, JevChoiceQuestion> }[] = []): AskJev {
  return async (_state, questions) => {
    calls.push({ questions })
    if (!canned) return null
    const answers: JevResult['answers'] = {}
    for (const [k, v] of Object.entries(canned)) answers[k] = { type: 'choice', ...v }
    return { answers, usage: { input_tokens: 0, output_tokens: 0, cost: 0 } }
  }
}
const throwingJev: AskJev = async () => { throw new Error('boom') }

let savedMode: string | undefined
beforeEach(() => { savedMode = process.env.JEV_TRIAGE; delete process.env.JEV_TRIAGE })
afterEach(() => { if (savedMode === undefined) delete process.env.JEV_TRIAGE; else process.env.JEV_TRIAGE = savedMode })

describe('every Jev question is a multi-option choice with a written description per option', () => {
  const all: Record<string, JevChoiceQuestion> = { ...ticketQuestions(), ...emailQuestions('e0') }
  it.each(Object.entries(all))('%s', (_key, q) => {
    expect(q.type).toBe('choice')
    const opts = Object.entries(q.criteria)
    expect(opts.length).toBeGreaterThanOrEqual(3)
    for (const [, desc] of opts) expect(desc.length).toBeGreaterThan(30)
  })
  it('option sets match the spec exactly', () => {
    expect(Object.keys(SUPPORT_CATEGORY_CRITERIA)).toEqual(['order_status', 'wrong_or_damaged', 'refund_request', 'design_help', 'bulk_quote', 'billing', 'spam'])
    expect(Object.keys(SUPPORT_PRIORITY_CRITERIA)).toEqual(['urgent', 'high', 'normal', 'low'])
    expect(Object.keys(EMAIL_LABEL_CRITERIA)).toEqual(['sales_lead', 'customer_issue', 'supplier', 'etsy_notification', 'newsletter', 'spam'])
    expect(Object.keys(NEEDS_REPLY_CRITERIA)).toEqual(['today', 'this_week', 'no'])
    expect(Object.keys(ETSY_FLAG_CRITERIA)).toEqual(['none', 'personalization', 'change_request', 'problem'])
  })
})

describe('support tickets', () => {
  const damaged = { subject: 'Arrived damaged', description: 'The print is peeling and one hoodie has a hole', customerCategory: 'general' }
  const bulk = { subject: 'Team shirts', description: 'Need a quote for 150 shirts for our league', customerCategory: 'general' }

  it('floor keeps the old billing -> high rule', () => {
    expect(ticketFloor({ subject: 'x', description: 'y', customerCategory: 'billing' })).toMatchObject({ category: 'billing', minPriority: 'high', priority: 'high' })
  })

  it('floor lifts damaged orders and bulk quotes to at least high', () => {
    expect(ticketFloor(damaged)).toMatchObject({ category: 'wrong_or_damaged', minPriority: 'high' })
    expect(ticketFloor(bulk)).toMatchObject({ category: 'bulk_quote', minPriority: 'high' })
  })

  it('a confident Jev answer decides category and priority, and normal is stored as medium', async () => {
    const tr = await triageTicket(
      { subject: 'When will it ship', description: 'Just checking on ITP-8891', customerCategory: 'order' },
      fakeJev({ t_category: { choice: 'order_status', confidence: 0.97 }, t_priority: { choice: 'normal', confidence: 0.9 } })
    )
    expect(tr).toMatchObject({ category: 'order_status', priority: 'normal', dbPriority: 'medium', needsReview: false, categorySource: 'jev' })
  })

  it('bulk quotes and damaged orders can be raised to urgent by Jev', async () => {
    const tr = await triageTicket(bulk, fakeJev({ t_category: { choice: 'bulk_quote', confidence: 0.99 }, t_priority: { choice: 'urgent', confidence: 0.9 } }))
    expect(tr.priority).toBe('urgent')
    expect(tr.dbPriority).toBe('urgent')
  })

  it('Jev can never push a floored ticket below high, even when confident', async () => {
    const tr = await triageTicket(damaged, fakeJev({ t_category: { choice: 'wrong_or_damaged', confidence: 0.99 }, t_priority: { choice: 'low', confidence: 0.99 } }))
    expect(tr.priority).toBe('high')
    expect(tr.prioritySource).toBe('floor')
  })

  it('a confident bulk/damaged CATEGORY lifts priority even when the floor had no keyword', async () => {
    const tr = await triageTicket(
      { subject: 'Church event', description: 'How much for tees for our congregation?', customerCategory: 'general' },
      fakeJev({ t_category: { choice: 'bulk_quote', confidence: 0.95 }, t_priority: { choice: 'normal', confidence: 0.5 } })
    )
    expect(tr.category).toBe('bulk_quote')
    expect(tr.priority).toBe('high')
    expect(tr.needsReview).toBe(true) // priority answer was under the bar
  })

  it('low confidence falls back to the floor and goes to human review — the ticket is kept', async () => {
    const tr = await triageTicket(
      { subject: 'Question', description: 'hello?', customerCategory: 'billing' },
      fakeJev({ t_category: { choice: 'spam', confidence: 0.4 }, t_priority: { choice: 'low', confidence: 0.4 } })
    )
    expect(tr).toMatchObject({ category: 'billing', priority: 'high', needsReview: true, reviewReason: 'low_confidence', categorySource: 'floor' })
  })

  it('lane down (null) or throwing never fails the ticket', async () => {
    for (const ask of [fakeJev(null), throwingJev]) {
      const tr = await triageTicket(damaged, ask)
      expect(tr).toMatchObject({ category: 'wrong_or_damaged', priority: 'high', dbPriority: 'high', needsReview: true, reviewReason: 'jev_unavailable' })
    }
  })

  it('off-menu answers are ignored, not trusted', async () => {
    const tr = await triageTicket(
      { subject: 'x', description: 'y' },
      fakeJev({ t_category: { choice: 'delete_it', confidence: 0.99 }, t_priority: { choice: 'normal', confidence: 0.99 } })
    )
    expect(tr.category).toBeNull()
    expect(tr.needsReview).toBe(true)
  })

  it('shadow mode records Jev but lets the floor decide', async () => {
    process.env.JEV_TRIAGE = 'shadow'
    const tr = await triageTicket(
      { subject: 'hi', description: 'test', customerCategory: 'general' },
      fakeJev({ t_category: { choice: 'spam', confidence: 0.99 }, t_priority: { choice: 'low', confidence: 0.99 } })
    )
    expect(tr).toMatchObject({ category: null, priority: 'normal', mode: 'shadow', reviewReason: 'shadow' })
    expect(tr.jev?.category?.choice).toBe('spam')
  })

  it('off mode makes no call', async () => {
    process.env.JEV_TRIAGE = 'off'
    const calls: any[] = []
    const tr = await triageTicket(bulk, fakeJev({}, calls))
    expect(calls).toHaveLength(0)
    expect(tr.priority).toBe('high')
  })

  it('combineTicket with no answers equals the floor', () => {
    const floor = ticketFloor(bulk)
    expect(combineTicket(floor, null, 'on')).toMatchObject({ category: 'bulk_quote', priority: 'high' })
  })

  it('admin queue sorts live tickets urgent-first, closed last, newest within a band — nothing dropped', () => {
    const rows = [
      { id: 'a', status: 'open', priority: 'medium', created_at: '2026-09-20' },
      { id: 'b', status: 'resolved', priority: 'urgent', created_at: '2026-09-22' },
      { id: 'c', status: 'open', priority: 'urgent', created_at: '2026-09-19' },
      { id: 'd', status: 'waiting', priority: 'high', created_at: '2026-09-21' },
      { id: 'e', status: 'open', priority: 'medium', created_at: '2026-09-23' },
      { id: 'f', status: 'open', priority: 'low', created_at: '2026-09-23' },
    ]
    expect(sortTicketQueue(rows).map((r) => r.id)).toEqual(['c', 'd', 'e', 'a', 'f', 'b'])
  })
})

describe('shared mailbox', () => {
  const emails = [
    { id: 'm1', from_address: 'email@email.etsy.com', subject: 'Venturing into the Christinaverse', body: 'picks for you' },
    { id: 'm2', from_address: 'karen@gmail.com', subject: 'Quote for 60 reunion shirts', body: 'can you send a quote' },
    { id: 'm3', from_address: 'support@transfersuperstars.com', subject: 'Football season', body: 'promo' },
    { id: 'm4', from_address: 'no-reply@jiffy.com', subject: 'Your shipment was delivered', body: '' },
    { id: 'm5', from_address: 'sam@outlook.com', subject: 'Question about my order', body: 'can I change size' },
  ]

  it('floor: etsy.com is Etsy, no-reply senders and auto-replies need no reply', () => {
    expect(emailFloor(emails[0])).toMatchObject({ label: 'etsy_notification' })
    expect(emailFloor(emails[3])).toMatchObject({ needsReply: 'no' })
    expect(emailFloor({ id: 'x', from_address: 'a@b.com', subject: 'Automatic reply: Welcome' })).toMatchObject({ needsReply: 'no', label: 'newsletter' })
    expect(emailFloor(emails[1])).toEqual({ label: undefined, needsReply: undefined, rules: [] })
  })

  it('one batched call; every message comes back; confident answers decide; unsure is kept for the summary', async () => {
    const calls: any[] = []
    const out = await triageEmails(emails, fakeJev({
      e0_label: { choice: 'newsletter', confidence: 0.99 }, e0_reply: { choice: 'no', confidence: 0.99 },
      e1_label: { choice: 'sales_lead', confidence: 0.99 }, e1_reply: { choice: 'today', confidence: 0.95 },
      e2_label: { choice: 'newsletter', confidence: 0.9 }, e2_reply: { choice: 'no', confidence: 0.9 },
      e3_label: { choice: 'supplier', confidence: 0.9 }, e3_reply: { choice: 'today', confidence: 0.99 },
      e4_label: { choice: 'customer_issue', confidence: 0.6 }, e4_reply: { choice: 'no', confidence: 0.5 },
    }, calls))
    expect(calls).toHaveLength(1)
    expect([...out.keys()]).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
    expect(out.get('m1')).toMatchObject({ label: 'etsy_notification', labelSource: 'floor', needsReply: 'no' }) // floor label wins
    expect(out.get('m2')).toMatchObject({ label: 'sales_lead', needsReply: 'today', needsReview: false })
    expect(out.get('m4')).toMatchObject({ needsReply: 'no', replySource: 'floor' }) // a no-reply sender stays no
    expect(out.get('m5')).toMatchObject({ label: null, needsReply: 'unsure', needsReview: true }) // low confidence: kept, to a human
    expect(wantsSummary(out.get('m5')!)).toBe(true)
    expect(wantsSummary(out.get('m3')!)).toBe(false)
  })

  it('summarization gate + reorder never drops a message', async () => {
    const out = await triageEmails(emails, fakeJev({
      e1_label: { choice: 'sales_lead', confidence: 0.99 }, e1_reply: { choice: 'this_week', confidence: 0.95 },
      e2_label: { choice: 'newsletter', confidence: 0.9 }, e2_reply: { choice: 'no', confidence: 0.9 },
      e4_label: { choice: 'customer_issue', confidence: 0.95 }, e4_reply: { choice: 'today', confidence: 0.95 },
    }))
    const sorted = sortByReplyUrgency(emails, (e) => out.get(e.id))
    expect(sorted).toHaveLength(emails.length)
    // today, then unsure, then this week, then no (input order within a bucket)
    expect(sorted.map((e) => e.id)).toEqual(['m5', 'm1', 'm2', 'm3', 'm4'])
    // m1 (etsy floor label, jev silent) is unsure -> kept for the summary
    expect(emails.filter((e) => wantsSummary(out.get(e.id)!)).map((e) => e.id)).toEqual(['m1', 'm2', 'm5'])
  })

  it('lane down: nothing is hidden — everything without a hard no stays in the summary', async () => {
    for (const ask of [fakeJev(null), throwingJev]) {
      const out = await triageEmails(emails, ask)
      expect(emails.filter((e) => wantsSummary(out.get(e.id)!)).map((e) => e.id)).toEqual(['m1', 'm2', 'm3', 'm5'])
      expect(out.get('m4')!.needsReply).toBe('no')
    }
  })
})

describe('Etsy buyer notes', () => {
  it('floor: empty is none, narrow keywords only', () => {
    expect(etsyFlagFloor('')).toMatchObject({ flag: 'none' })
    expect(etsyFlagFloor(null)).toMatchObject({ flag: 'none' })
    expect(etsyFlagFloor('I need this by Friday')).toMatchObject({ flag: 'problem' })
    expect(etsyFlagFloor('Please switch the color to navy, I clicked black by mistake')).toMatchObject({ flag: 'change_request' })
    expect(etsyFlagFloor('Initials: J.R.T.')).toMatchObject({ flag: 'personalization' })
    expect(etsyFlagFloor('Thanks so much!')).toEqual({ rules: [] })
  })

  it('empty note: no call, flag none, no review', async () => {
    const calls: any[] = []
    const tr = await triageEtsyBuyerMessage('  ', ['Tee'], fakeJev({}, calls))
    expect(calls).toHaveLength(0)
    expect(tr).toMatchObject({ flag: 'none', needsReview: false })
  })

  it('confident Jev decides; it may raise the floor but never lower it', async () => {
    expect(await triageEtsyBuyerMessage('Thanks!', ['Tee'], fakeJev({ buyer_flag: { choice: 'none', confidence: 0.97 } })))
      .toMatchObject({ flag: 'none', needsReview: false, source: 'jev' })
    expect(await triageEtsyBuyerMessage('MARTINEZ 23 on the back', ['Jersey'], fakeJev({ buyer_flag: { choice: 'personalization', confidence: 0.95 } })))
      .toMatchObject({ flag: 'personalization', source: 'jev' })
    // floor says problem (deadline); Jev says none — floor holds
    expect(await triageEtsyBuyerMessage('need it by Friday', ['Tee'], fakeJev({ buyer_flag: { choice: 'none', confidence: 0.99 } })))
      .toMatchObject({ flag: 'problem', source: 'floor' })
  })

  it('unsure or lane down: keeps the floor flag and marks review', async () => {
    expect(await triageEtsyBuyerMessage('hmm about the shirt', ['Tee'], fakeJev({ buyer_flag: { choice: 'problem', confidence: 0.5 } })))
      .toMatchObject({ flag: 'none', needsReview: true, source: 'floor' })
    expect(await triageEtsyBuyerMessage('hmm about the shirt', ['Tee'], throwingJev))
      .toMatchObject({ flag: 'none', needsReview: true })
  })
})
