// Jev triage for support tickets, the shared mailbox and Etsy buyer notes.
//
// Every decision here follows the same four rules (David, 2026-09-23):
//   1. Jev is only ever asked a multi-option `choice`, with a written
//      description for every option.
//   2. An answer under the confidence bar is NO OPINION. The row is kept, the
//      deterministic floor decides, and the row is marked needsReview so a
//      human sees it. Nothing is dropped because Jev was unsure or down.
//   3. Jev never takes a destructive action. It labels, orders and filters
//      what gets summarized — it never archives, deletes or rejects anything.
//   4. The deterministic checks stay as the FLOOR: a priority can never land
//      below what the rules say, and a hard rule (billing is high, a no-reply
//      sender cannot be replied to) is never overridden.
//
// Mode (JEV_TRIAGE): 'on' lets a confident Jev answer decide above the floor;
// 'shadow' runs Jev and records its answer but the floor decides; 'off' skips
// the call. The default is 'on' — measured before switching over, see
// backend/scripts/jev-triage-eval.ts and the handoff for task 2a83afec.

import { askJev as liveAskJev, readChoice, type AskJev, type JevAnswers, type JevChoiceQuestion } from './jev.js'

export type TriageMode = 'on' | 'shadow' | 'off'

export function triageMode(): TriageMode {
  const v = (process.env.JEV_TRIAGE || '').toLowerCase()
  if (v === 'off' || process.env.JEV === 'off') return 'off'
  if (v === 'shadow') return 'shadow'
  return 'on'
}

/** What a caller records about how a decision was reached. */
export interface JevVote<T extends string> {
  choice: T
  confidence: number
}

export type DecisionSource = 'jev' | 'floor'

// ---------------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------------

export const SUPPORT_CATEGORIES = [
  'order_status',
  'wrong_or_damaged',
  'refund_request',
  'design_help',
  'bulk_quote',
  'billing',
  'spam',
] as const
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]

export const SUPPORT_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number]

/** support_tickets.priority has a CHECK of low|medium|high|urgent — 'normal' is stored as 'medium'. */
export type DbTicketPriority = 'urgent' | 'high' | 'medium' | 'low'
export function toDbPriority(p: SupportPriority): DbTicketPriority {
  return p === 'normal' ? 'medium' : p
}

const PRIORITY_RANK: Record<SupportPriority, number> = { urgent: 3, high: 2, normal: 1, low: 0 }
function maxPriority(a: SupportPriority, b: SupportPriority | undefined): SupportPriority {
  return b !== undefined && PRIORITY_RANK[b] > PRIORITY_RANK[a] ? b : a
}

/** Sort key for the admin queue: urgent first. Unknown values sort with medium. */
export function dbPriorityRank(p: string | null | undefined): number {
  switch (p) {
    case 'urgent': return 0
    case 'high': return 1
    case 'low': return 3
    default: return 2
  }
}

const CLOSED_STATUSES = new Set(['resolved', 'closed'])

/**
 * Admin queue order: live tickets before resolved/closed ones, then urgent ->
 * low, then newest first. Pure reorder — nothing is filtered out.
 */
export function sortTicketQueue<T extends { status?: string | null; priority?: string | null; created_at?: string | null }>(tickets: T[]): T[] {
  return [...tickets].sort((a, b) =>
    Number(CLOSED_STATUSES.has(a.status || '')) - Number(CLOSED_STATUSES.has(b.status || '')) ||
    dbPriorityRank(a.priority) - dbPriorityRank(b.priority) ||
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  )
}

export const SUPPORT_CATEGORY_CRITERIA: Record<SupportCategory, string> = {
  order_status: 'Asking where an order is, when it ships, tracking, delivery timing, or an order that has not arrived yet',
  wrong_or_damaged: 'An order ARRIVED but something is wrong with it: damaged, broken, misprinted, faded, wrong item, wrong size or colour, missing piece',
  refund_request: 'Wants their money back, to cancel an order for a refund, or to return an item',
  design_help: 'Needs help with artwork, the design tool, file formats, mockups, custom design questions, or using the site or their account',
  bulk_quote: 'A potential bulk, wholesale, team, event, school or business order — asking for pricing on many pieces. A sales lead',
  billing: 'A problem with a charge: double charged, wrong amount, payment failed, invoice, coupon or gift card or ITC balance',
  spam: 'Not a real customer: random gibberish, bot-filled form fields, SEO or marketing pitches, test submissions, link spam',
}

export const SUPPORT_PRIORITY_CRITERIA: Record<SupportPriority, string> = {
  urgent: 'A damaged or wrong order the customer is upset about, a large bulk order or deadline-driven event order, or money taken without the order being fulfilled — handle within hours',
  high: 'A real customer with a problem that blocks them (billing issue, refund, order missing past its window) or a bulk-quote lead — handle today',
  normal: 'A routine question from a real customer: order status, design help, general questions — handle within a day',
  low: 'Spam, tests, gibberish, or nothing to act on — can wait or be ignored',
}

export interface TicketInput {
  subject: string
  description: string
  /** What the customer picked on the contact form (free text, may be missing). */
  customerCategory?: string | null
  orderId?: string | null
}

const RE_DAMAGED = /\b(damaged|broken|cracked|torn|ripped|defect(ive)?|misprint(ed)?|faded|peel(ing|ed)|wrong (size|item|colou?r|shirt|order|design|print)|missing (item|piece)s?)\b/i
const RE_BULK = /\b(bulk|wholesale|quote|team (order|shirts)|(\d{2,}|dozens?|hundreds?) (shirts|tees|pieces|units|hoodies|items))\b/i
const RE_REFUND = /\b(refund|money back|chargeback|return (my|the|this)|cancel (my|the|this) order)\b/i
const RE_BILLING = /\b(charged|double charge|billing|invoice|payment (failed|declined)|card (was )?declined|gift ?card|coupon|itc balance)\b/i
const RE_STATUS = /\b(where is my order|tracking|track my|hasn'?t (arrived|shipped)|not (arrived|received|shipped)|when will (it|my order) (ship|arrive)|order status|delivery)\b/i
const RE_DESIGN = /\b(design|artwork|logo|mockup|upload|file format|png|svg|resolution|log ?in|sign ?in|password|account)\b/i

/** Maps the contact form's categories (and legacy ones) onto the Jev menu. */
function mapCustomerCategory(raw: string | null | undefined): SupportCategory | undefined {
  switch ((raw || '').toLowerCase().trim()) {
    case 'billing': return 'billing'
    case 'order':
    case 'order_status':
    case 'shipping': return 'order_status'
    case 'product_quality':
    case 'damaged':
    case 'wrong_or_damaged': return 'wrong_or_damaged'
    case 'refund':
    case 'refund_request':
    case 'returns': return 'refund_request'
    case 'design':
    case 'design_help':
    case 'technical':
    case 'technical_issue':
    case 'account': return 'design_help'
    case 'bulk':
    case 'wholesale':
    case 'bulk_quote': return 'bulk_quote'
    default: return undefined
  }
}

export interface TicketFloor {
  /** Deterministic category, or undefined when the rules have no opinion. */
  category?: SupportCategory
  /** The lowest priority this ticket may be given, whoever decides. */
  minPriority?: SupportPriority
  /** What the old code would have stored with no Jev at all. */
  priority: SupportPriority
  rules: string[]
}

/**
 * The deterministic floor. Keeps the pre-Jev rule (billing -> high) and adds
 * the two the task names as must-route-to-the-top: a damaged/wrong order and
 * a bulk-quote lead are never below high, whatever Jev says.
 */
export function ticketFloor(t: TicketInput): TicketFloor {
  const text = `${t.subject}\n${t.description}`
  const rules: string[] = []
  let category = mapCustomerCategory(t.customerCategory)
  if (category) rules.push(`customer_category:${category}`)
  let minPriority: SupportPriority | undefined

  if (RE_DAMAGED.test(text)) { category ??= 'wrong_or_damaged'; minPriority = 'high'; rules.push('keyword:damaged') }
  if (RE_BULK.test(text)) { category ??= 'bulk_quote'; minPriority = 'high'; rules.push('keyword:bulk') }
  if (!category && RE_REFUND.test(text)) { category = 'refund_request'; rules.push('keyword:refund') }
  if (!category && RE_BILLING.test(text)) { category = 'billing'; rules.push('keyword:billing') }
  if (!category && RE_STATUS.test(text)) { category = 'order_status'; rules.push('keyword:status') }
  if (!category && RE_DESIGN.test(text)) { category = 'design_help'; rules.push('keyword:design') }
  // The pre-Jev rule, kept verbatim: a billing ticket is high.
  if (category === 'billing' || (t.customerCategory || '').toLowerCase() === 'billing') {
    minPriority = maxPriority('high', minPriority)
    rules.push('rule:billing_is_high')
  }
  if (category === 'wrong_or_damaged' || category === 'bulk_quote') minPriority = maxPriority('high', minPriority)

  return { category, minPriority, priority: minPriority ?? 'normal', rules }
}

export interface TicketTriage {
  category: SupportCategory | null
  priority: SupportPriority
  dbPriority: DbTicketPriority
  needsReview: boolean
  reviewReason?: 'jev_unavailable' | 'low_confidence' | 'shadow'
  categorySource: DecisionSource
  prioritySource: DecisionSource
  jev?: { category?: JevVote<SupportCategory>; priority?: JevVote<SupportPriority> }
  floor: TicketFloor
  mode: TriageMode
}

export const TICKET_CONFIDENCE_BAR = 0.75

export function ticketQuestions(key = 't'): Record<string, JevChoiceQuestion> {
  return {
    [`${key}_category`]: {
      type: 'choice',
      instructions: `Support ticket ${key}: what is this ticket actually about? Judge from what the customer wrote, not the category they picked.`,
      criteria: SUPPORT_CATEGORY_CRITERIA,
    },
    [`${key}_priority`]: {
      type: 'choice',
      instructions: `Support ticket ${key}: how soon does the team need to act on it?`,
      criteria: SUPPORT_PRIORITY_CRITERIA,
    },
  }
}

/** Pure: combine the floor with whatever Jev said. Exported for tests + the eval. */
export function combineTicket(floor: TicketFloor, answers: JevAnswers | null, mode: TriageMode, key = 't'): TicketTriage {
  const cat = answers ? readChoice(answers, `${key}_category`, SUPPORT_CATEGORIES) : undefined
  const pri = answers ? readChoice(answers, `${key}_priority`, SUPPORT_PRIORITIES) : undefined
  const jev = answers ? { category: cat, priority: pri } : undefined
  const catSure = cat && cat.confidence >= TICKET_CONFIDENCE_BAR
  const priSure = pri && pri.confidence >= TICKET_CONFIDENCE_BAR

  if (mode !== 'on' || !answers) {
    const priority = floor.priority
    return {
      category: floor.category ?? null,
      priority,
      dbPriority: toDbPriority(priority),
      needsReview: true,
      reviewReason: mode === 'shadow' && answers ? 'shadow' : 'jev_unavailable',
      categorySource: 'floor',
      prioritySource: 'floor',
      jev,
      floor,
      mode,
    }
  }

  const category = catSure ? cat!.choice : floor.category ?? null
  let priority: SupportPriority = priSure ? pri!.choice : floor.priority
  // A confident category the task says must route to the top lifts priority
  // even when the priority answer itself was unsure.
  if (category === 'wrong_or_damaged' || category === 'bulk_quote') priority = maxPriority(priority, 'high')
  // The floor: never below what the deterministic rules demand.
  priority = maxPriority(priority, floor.minPriority)

  return {
    category,
    priority,
    dbPriority: toDbPriority(priority),
    needsReview: !(catSure && priSure),
    reviewReason: catSure && priSure ? undefined : 'low_confidence',
    categorySource: catSure ? 'jev' : 'floor',
    prioritySource: priSure && PRIORITY_RANK[pri!.choice] >= PRIORITY_RANK[priority] ? 'jev' : 'floor',
    jev,
    floor,
    mode,
  }
}

function ticketState(t: TicketInput): Record<string, unknown> {
  return {
    business: 'Imagine This Printed — custom apparel, DTF transfers, 3D prints, sold on our site and on Etsy',
    ticket: [
      `Subject: ${t.subject.slice(0, 200)}`,
      `Customer picked category: ${t.customerCategory || 'none'}`,
      t.orderId ? `Order id given: ${String(t.orderId).slice(0, 60)}` : 'No order id given',
      `Message: ${t.description.slice(0, 2500)}`,
    ].join('\n'),
  }
}

export async function triageTicket(t: TicketInput, ask: AskJev = liveAskJev): Promise<TicketTriage> {
  const floor = ticketFloor(t)
  const mode = triageMode()
  if (mode === 'off') return combineTicket(floor, null, mode)
  let res = null
  try {
    res = await ask(ticketState(t), ticketQuestions())
  } catch {
    res = null
  }
  return combineTicket(floor, res?.answers ?? null, mode)
}

/** One line for the internal ticket note / admin notification. */
export function describeTicketTriage(tr: TicketTriage): string {
  const v = (x?: JevVote<string>) => (x ? `${x.choice} @ ${x.confidence.toFixed(2)}` : 'no answer')
  return [
    `[Jev triage · mode ${tr.mode}] category=${tr.category ?? 'unclassified'} (${tr.categorySource}), priority=${tr.priority} (${tr.prioritySource})`,
    `Jev: category ${v(tr.jev?.category)}, priority ${v(tr.jev?.priority)}; floor rules: ${tr.floor.rules.join(', ') || 'none'}`,
    tr.needsReview ? `NEEDS HUMAN TRIAGE (${tr.reviewReason}) — nothing was auto-closed or dropped.` : 'Confident — no human triage needed.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Shared mailbox
// ---------------------------------------------------------------------------

export const EMAIL_LABELS = ['sales_lead', 'customer_issue', 'supplier', 'etsy_notification', 'newsletter', 'spam'] as const
export type EmailLabel = (typeof EMAIL_LABELS)[number]

export const NEEDS_REPLY = ['today', 'this_week', 'no'] as const
export type NeedsReply = (typeof NEEDS_REPLY)[number]

export const EMAIL_LABEL_CRITERIA: Record<EmailLabel, string> = {
  sales_lead: 'A real person or business that wants to BUY from us: a quote request, bulk or custom order inquiry, wholesale interest, a collaboration that brings us an order',
  customer_issue: 'A customer (or a marketplace on their behalf) with a question or problem about an order, a product, a refund, shipping or their account',
  supplier: 'A company we buy from or ship with writing about a SPECIFIC purchase or account of ours: an order confirmation, shipment, invoice, or a support ticket we opened with them. Their marketing blasts are newsletter, not supplier',
  etsy_notification: 'An automated message from Etsy about our own shop: sales, payments, sign-in alerts, weekly shop stats, listing performance, seller tips',
  newsletter: 'Marketing or promotional mail sent to a list — including promo blasts and design tips from our own suppliers: product promos, trend roundups, platform announcements, "rate us" review requests, receipts from tools we subscribe to, automatic out-of-office replies',
  spam: 'Unsolicited cold pitches (SEO, lead lists, lead-gen agencies, influencer offers for unrelated products), phishing, or junk',
}

export const NEEDS_REPLY_CRITERIA: Record<NeedsReply, string> = {
  today: 'A person is waiting on us: a customer problem, a sales lead, a supplier asking us a question, or an account/policy notice with a deadline in the next day or two',
  this_week: 'Someone real would appreciate a reply or an action from us, but nothing breaks if it waits a few days',
  no: 'Nothing to reply to: automated notifications, newsletters, promotions, receipts, auto-replies, cold pitches and spam',
}

export interface EmailInput {
  id: string
  from_address: string
  from_name?: string | null
  subject?: string | null
  /** Plain-text body snippet (already stripped of HTML). */
  body?: string
}

export interface EmailFloor {
  label?: EmailLabel
  /** Only ever 'no' — a hard "cannot be replied to" — or undefined. */
  needsReply?: 'no'
  rules: string[]
}

const RE_NOREPLY = /^(no-?reply|do-?not-?reply|noreply\.[a-z.]+|mailer-daemon|postmaster)@/i
const RE_AUTOREPLY = /^(automatic reply|auto(matische)? ?(reply|antwort)|out of (the )?office|abwesenheitsnotiz)\b/i
const ETSY_DOMAIN = /@([a-z0-9-]+\.)*etsy\.com$/i

/**
 * Deterministic floor for mail. Only rules that cannot be wrong: a no-reply
 * address cannot be answered, an auto-responder is not a conversation, and
 * mail from etsy.com is Etsy. Everything else is left to Jev or a human.
 */
export function emailFloor(e: EmailInput): EmailFloor {
  const from = (e.from_address || '').trim().toLowerCase()
  const subject = (e.subject || '').trim()
  const rules: string[] = []
  let label: EmailLabel | undefined
  let needsReply: 'no' | undefined
  if (ETSY_DOMAIN.test(from)) { label = 'etsy_notification'; rules.push('domain:etsy') }
  if (RE_NOREPLY.test(from)) { needsReply = 'no'; rules.push('sender:no_reply') }
  if (RE_AUTOREPLY.test(subject)) { needsReply = 'no'; label ??= 'newsletter'; rules.push('subject:auto_reply') }
  return { label, needsReply, rules }
}

export interface EmailTriage {
  id: string
  label: EmailLabel | null
  /** 'unsure' means no confident answer — treated as needing a reply so nothing is hidden. */
  needsReply: NeedsReply | 'unsure'
  needsReview: boolean
  labelSource: DecisionSource
  replySource: DecisionSource
  jev?: { label?: JevVote<EmailLabel>; needsReply?: JevVote<NeedsReply> }
  floor: EmailFloor
  mode: TriageMode
}

export const EMAIL_CONFIDENCE_BAR = 0.75

/** Only 'no' is excluded from summaries — 'unsure' stays in. */
export function wantsSummary(t: Pick<EmailTriage, 'needsReply'>): boolean {
  return t.needsReply !== 'no'
}

const REPLY_ORDER: Record<EmailTriage['needsReply'], number> = { today: 0, unsure: 1, this_week: 2, no: 3 }

/** Stable reorder: today, then unsure, then this week, then no; input order kept within a bucket. */
export function sortByReplyUrgency<T>(items: T[], triageOf: (item: T) => EmailTriage | undefined): T[] {
  return items
    .map((item, i) => ({ item, i, r: REPLY_ORDER[triageOf(item)?.needsReply ?? 'unsure'] }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item)
}

function emailKey(i: number): string {
  return `e${i}`
}

export function emailQuestions(key: string): Record<string, JevChoiceQuestion> {
  return {
    [`${key}_label`]: {
      type: 'choice',
      instructions: `Email ${key}: what kind of email is this, for the Imagine This Printed shared inbox?`,
      criteria: EMAIL_LABEL_CRITERIA,
    },
    [`${key}_reply`]: {
      type: 'choice',
      instructions: `Email ${key}: does someone at Imagine This Printed need to reply to it, and how soon?`,
      criteria: NEEDS_REPLY_CRITERIA,
    },
  }
}

export function combineEmail(e: EmailInput, floor: EmailFloor, answers: JevAnswers | null, mode: TriageMode, key: string): EmailTriage {
  const lab = answers ? readChoice(answers, `${key}_label`, EMAIL_LABELS) : undefined
  const rep = answers ? readChoice(answers, `${key}_reply`, NEEDS_REPLY) : undefined
  const jev = answers ? { label: lab, needsReply: rep } : undefined
  const useJev = mode === 'on' && Boolean(answers)
  const labSure = useJev && lab && lab.confidence >= EMAIL_CONFIDENCE_BAR
  const repSure = useJev && rep && rep.confidence >= EMAIL_CONFIDENCE_BAR

  // A floor label is a hard rule (etsy.com IS Etsy), so it wins.
  const label = floor.label ?? (labSure ? lab!.choice : null)
  const needsReply: EmailTriage['needsReply'] = floor.needsReply ?? (repSure ? rep!.choice : 'unsure')
  return {
    id: e.id,
    label,
    needsReply,
    needsReview: label === null || needsReply === 'unsure',
    labelSource: floor.label || !labSure ? 'floor' : 'jev',
    replySource: floor.needsReply || !repSure ? 'floor' : 'jev',
    jev,
    floor,
    mode,
  }
}

function emailLine(e: EmailInput, key: string): string {
  const body = (e.body || '').replace(/\s+/g, ' ').trim().slice(0, 280)
  return `${key} | From: ${e.from_name ? `${e.from_name} ` : ''}<${e.from_address}> | Subject: ${(e.subject || '').slice(0, 150)} | ${body}`
}

/**
 * Triage a batch of inbound messages in one Jev call. Never throws, never
 * drops a message: every input id comes back with a triage row.
 */
export async function triageEmails(emails: EmailInput[], ask: AskJev = liveAskJev): Promise<Map<string, EmailTriage>> {
  const mode = triageMode()
  const out = new Map<string, EmailTriage>()
  if (!emails.length) return out
  let answers: JevAnswers | null = null
  if (mode !== 'off') {
    const questions: Record<string, JevChoiceQuestion> = {}
    emails.forEach((_, i) => Object.assign(questions, emailQuestions(emailKey(i))))
    try {
      const res = await ask(
        {
          inbox: 'Imagine This Printed shared inbox. We are a small custom-apparel print shop (our own site + an Etsy shop). We BUY blanks and transfers from suppliers and SELL printed products.',
          emails: emails.map((e, i) => emailLine(e, emailKey(i))).join('\n'),
        },
        questions
      )
      answers = res?.answers ?? null
    } catch {
      answers = null
    }
  }
  emails.forEach((e, i) => out.set(e.id, combineEmail(e, emailFloor(e), answers, mode, emailKey(i))))
  return out
}

// ---------------------------------------------------------------------------
// Etsy buyer messages
// ---------------------------------------------------------------------------

export const ETSY_FLAGS = ['none', 'personalization', 'change_request', 'problem'] as const
export type EtsyFlag = (typeof ETSY_FLAGS)[number]

export const ETSY_FLAG_CRITERIA: Record<EtsyFlag, string> = {
  none: 'Nothing the print team must act on: a thank-you, a pleasantry, a gift note, or a note that repeats what was ordered',
  personalization: 'Details to put ON the product: a name, number, date, initials, text or colour choice for a personalised item',
  change_request: 'Wants to change the order as placed: a different size, colour, item, quantity, shipping address or speed, or to cancel',
  problem: 'Something is wrong or they are upset: a deadline we might miss, a complaint, a question that blocks printing, or a mistake in the order',
}

const ETSY_RANK: Record<EtsyFlag, number> = { none: 0, personalization: 1, change_request: 2, problem: 3 }

// Deliberately narrow: this is a MINIMUM, so a broad word like "mistake" ("I
// clicked black by mistake" is a change request) would drag Jev's right answer up.
const RE_ETSY_PROBLEM = /\b(damaged|never (arrived|received)|refund|upset|disappointed|urgent|asap|by (friday|monday|saturday|sunday|tuesday|wednesday|thursday|tomorrow))\b/i
const RE_ETSY_CHANGE = /\b(change (the|my)|instead of|switch (to|the)|different (size|colou?r)|wrong (size|colou?r) (selected|chosen)|cancel|new address|ship to)\b/i
const RE_ETSY_PERSONAL = /\b(personali[sz]|name(s)? (on|should|is|:)|put ["'“]|initials|monogram|number \d+|jersey (name|number)|text (should|to) (say|read))\b/i

export interface EtsyFlagFloor {
  flag?: EtsyFlag
  rules: string[]
}

export function etsyFlagFloor(message: string | null | undefined): EtsyFlagFloor {
  const m = (message || '').trim()
  if (!m) return { flag: 'none', rules: ['empty_message'] }
  if (RE_ETSY_PROBLEM.test(m)) return { flag: 'problem', rules: ['keyword:problem'] }
  if (RE_ETSY_CHANGE.test(m)) return { flag: 'change_request', rules: ['keyword:change'] }
  if (RE_ETSY_PERSONAL.test(m)) return { flag: 'personalization', rules: ['keyword:personalization'] }
  return { rules: [] }
}

export interface EtsyFlagTriage {
  flag: EtsyFlag
  needsReview: boolean
  source: DecisionSource
  confidence?: number
  jev?: JevVote<EtsyFlag>
  floorRules: string[]
  mode: TriageMode
}

export const ETSY_CONFIDENCE_BAR = 0.8

export function combineEtsyFlag(message: string | null | undefined, floor: EtsyFlagFloor, answers: JevAnswers | null, mode: TriageMode): EtsyFlagTriage {
  const empty = !(message || '').trim()
  const vote = answers ? readChoice(answers, 'buyer_flag', ETSY_FLAGS) : undefined
  const sure = mode === 'on' && vote && vote.confidence >= ETSY_CONFIDENCE_BAR
  if (empty) return { flag: 'none', needsReview: false, source: 'floor', floorRules: floor.rules, mode }
  // Non-empty note: the floor keyword flag is the minimum; a confident Jev may raise it.
  let flag: EtsyFlag = floor.flag ?? 'none'
  let source: DecisionSource = 'floor'
  if (sure && ETSY_RANK[vote!.choice] >= ETSY_RANK[flag]) { flag = vote!.choice; source = 'jev' }
  return {
    flag,
    needsReview: !sure,
    source,
    confidence: vote?.confidence,
    jev: vote,
    floorRules: floor.rules,
    mode,
  }
}

export async function triageEtsyBuyerMessage(
  message: string | null | undefined,
  items: string[],
  ask: AskJev = liveAskJev
): Promise<EtsyFlagTriage> {
  const floor = etsyFlagFloor(message)
  const mode = triageMode()
  // Empty notes never cost a call.
  if (mode === 'off' || !(message || '').trim()) return combineEtsyFlag(message, floor, null, mode)
  let answers: JevAnswers | null = null
  try {
    const res = await ask(
      {
        shop: 'Imagine This Printed Etsy shop — printed shirts, hoodies and gifts, many personalised',
        items_ordered: items.slice(0, 10).join('; ').slice(0, 800),
        message_from_buyer: String(message).slice(0, 2000),
      },
      {
        buyer_flag: {
          type: 'choice',
          instructions: 'The buyer left this note at checkout. What does the print team need to do about it?',
          criteria: ETSY_FLAG_CRITERIA,
        },
      }
    )
    answers = res?.answers ?? null
  } catch {
    answers = null
  }
  return combineEtsyFlag(message, floor, answers, mode)
}
