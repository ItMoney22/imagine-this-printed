// A seller's reminders (David 2026-10-26: "setup reminders for her through email with her assistant reminding her to
// post etc."). When one is due, her store assistant (store-assistant.ts, the same brain, facts and memory she chats
// with) writes it fresh, and it goes to the store's own inbox (crystal@imaginethisprinted.com, never her personal
// sign-in address) from her assistant through sendViaResend, after the suppression check. Times are Eastern. The clock that calls fireReminder
// is worker/store-reminders-sweep.ts; the card that switches them on and off is src/pages/store/StoreReminders.tsx.
import Stripe from 'stripe'
import { supabase } from '../lib/supabase.js'
import { askStoreAssistant, type StoreFacts } from './store-assistant.js'
import { sendViaResend, EMAIL_DOMAIN } from './email-resend.js'
import { getSuppression } from './email-suppression.js'
import { QR_STAND } from '../shared/qr-stand.js'

export const REMINDER_TZ = 'America/New_York'
export const REMINDER_KINDS = ['instagram', 'orders', 'product', 'custom'] as const
export type ReminderKind = (typeof REMINDER_KINDS)[number]

const FROM = process.env.STORE_REMINDER_FROM || `Your store assistant <assistant@${EMAIL_DOMAIN}>`
// A reply to a reminder reaches real people, like every other ITP email.
const REPLY_TO = `wecare@${EMAIL_DOMAIN}`
const SITE_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

export type ReminderRow = {
  id: string
  storefront_id: string
  kind: ReminderKind
  title: string
  note: string | null
  /** Eastern weekdays, 0 Sunday .. 6 Saturday. */
  days: number[]
  /** Eastern wall clock, 'HH:MM' or 'HH:MM:SS'. */
  time_of_day: string
  enabled: boolean
  /** No slot earlier than this sends. */
  armed_at: string
  sort: number
}

// ---------------------------------------------------------------------------
// Eastern time
// ---------------------------------------------------------------------------

const easternFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: REMINDER_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** What an Eastern wall clock and calendar show at an instant. */
export function easternParts(at: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const p = Object.fromEntries(easternFormat.formatToParts(at).map(x => [x.type, x.value]))
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour) % 24, mm: Number(p.minute) }
}

/** The instant an Eastern wall-clock time happens on an Eastern calendar day (daylight saving included). */
export function easternToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  const offsetAt = (t: number) => {
    const p = easternParts(new Date(t))
    return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - t
  }
  // Second pass settles a clock change that falls between the first guess and the answer.
  return new Date(wall - offsetAt(wall - offsetAt(wall)))
}

const clock = (timeOfDay: string) => {
  const [hh, mm] = String(timeOfDay).split(':').map(Number)
  return { hh: hh || 0, mm: mm || 0 }
}

/** The reminder's most recent slot at or before `now` (looks back one week), or null. */
export function latestSlot(days: number[], timeOfDay: string, now: Date): Date | null {
  const { hh, mm } = clock(timeOfDay)
  const today = easternParts(now)
  for (let back = 0; back <= 7; back++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d - back))
    if (!days.includes(day.getUTCDay())) continue
    const slot = easternToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm)
    if (slot.getTime() <= now.getTime()) return slot
  }
  return null
}

/**
 * The slot to send now, or null. A slot older than `graceMs` is let go rather than mailed late (the worker was down,
 * or she switched it on after it passed), and nothing before armed_at ever sends.
 */
export function dueSlot(r: Pick<ReminderRow, 'days' | 'time_of_day' | 'armed_at' | 'enabled'>, now: Date, graceMs: number): Date | null {
  if (!r.enabled) return null
  const slot = latestSlot(r.days, r.time_of_day, now)
  if (!slot) return null
  if (slot.getTime() < new Date(r.armed_at).getTime()) return null
  if (now.getTime() - slot.getTime() > graceMs) return null
  return slot
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function timeLabel(timeOfDay: string): string {
  const { hh, mm } = clock(timeOfDay)
  const h12 = hh % 12 || 12
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${hh < 12 ? 'AM' : 'PM'}`
}

/** "Mon, Wed, Fri at 10 AM", "Every day at 9 AM", "Sundays at 10 AM". */
export function scheduleLabel(days: number[], timeOfDay: string): string {
  const set = [...new Set(days)].sort((a, b) => a - b)
  const key = set.join(',')
  const when =
    set.length === 7 ? 'Every day'
      : key === '1,2,3,4,5' ? 'Weekdays'
        : key === '0,6' ? 'Weekends'
          : set.length === 1 ? `${DAY_LONG[set[0]]}s`
            : set.map(d => DAY_SHORT[d]).join(', ')
  return `${when} at ${timeLabel(timeOfDay)}`
}

// ---------------------------------------------------------------------------
// What her assistant writes
// ---------------------------------------------------------------------------

export type ReminderContext = {
  facts: StoreFacts
  storeName: string
  slug: string
  /** Where the reminder goes: the store's in-app inbox (storeInboxAddress), null when it has none. */
  to: string | null
  newOrders24h: number
  ordersToShip: number
}

const easternDay = (at: Date) => {
  const p = easternParts(at)
  return DAY_LONG[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]
}

/** The one-turn ask her assistant answers: what this reminder is and the facts it needs for it. */
export function reminderAsk(r: Pick<ReminderRow, 'kind' | 'title' | 'note'>, ctx: Pick<ReminderContext, 'newOrders24h' | 'ordersToShip'>, slot: Date): string {
  const what: Record<ReminderKind, string> = {
    instagram:
      'Remind her it is time to post on Instagram. Give her one post idea built on one of her real products (name it and its price from the facts), then a ready-to-paste caption with three to six hashtags.',
    orders:
      `Remind her to check her orders. Today: ${ctx.newOrders24h} new paid order(s) in the last 24 hours, and ${ctx.ordersToShip} order(s) with things she ships herself still waiting to go out. ` +
      'Say plainly what needs doing. If nothing came in, give her one quick thing she can do today to bring in a sale.',
    product:
      'Nudge her to add a new product this week. Suggest one specific product that fits her store (from what she already sells and what you remember about her), with a name and a price idea, and say which card adds it: Add a product for things she makes, Create a design to have one made.',
    custom:
      `She set this reminder herself: "${r.title}${r.note ? ` (${r.note})` : ''}". Remind her of it and add one concrete, useful tip for it.`,
  }
  return [
    `(This is not a chat. It is her scheduled "${r.title}" reminder for ${easternDay(slot)}, sent to her email.`,
    `Write the email body to her, from you, her store assistant. ${what[r.kind]}`,
    // Measured 2026-10-26: unprompted, it told her to launch her draft store from Settings, which only ITP can do.
    'Only send her to things she can do on her store page: Add a product, Create a design, Payouts, and Settings (Instagram, tagline, her shipping). Imagine This Printed switches her store live, not her.',
    'Plain text, no subject line, no markdown. Start with a short warm hello using her first name.)',
  ].join(' ')
}

export function reminderSubject(r: Pick<ReminderRow, 'kind' | 'title'>, slot: Date): string {
  switch (r.kind) {
    case 'instagram': return 'Time to post on Instagram'
    case 'orders': return `Your orders check for ${easternDay(slot)}`
    case 'product': return 'Add a new product this week'
    default: return r.title
  }
}

/** Used when her assistant can't answer: the reminder still lands, plainly. */
export function templateBody(r: Pick<ReminderRow, 'kind' | 'title' | 'note'>, ctx: Pick<ReminderContext, 'facts' | 'newOrders24h' | 'ordersToShip'>): string {
  const first = ctx.facts.ownerFirst
  switch (r.kind) {
    case 'instagram':
      return `Hi ${first}! It's time to post on Instagram. Pick one of your products, take a bright photo of it, and tell people where to buy it.`
    case 'orders':
      return ctx.newOrders24h || ctx.ordersToShip
        ? `Hi ${first}! You have ${ctx.newOrders24h} new order(s) since yesterday and ${ctx.ordersToShip} waiting for you to ship. Open your store page to see them.`
        : `Hi ${first}! No new orders since yesterday. A quick post about your newest product is a good way to bring one in.`
    case 'product':
      return `Hi ${first}! This is your reminder to add a new product this week. Add something you make in Add a product, or have one made in Create a design.`
    default:
      return `Hi ${first}! This is your reminder: ${r.title}${r.note ? ` (${r.note})` : ''}.`
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const PAGE_ANCHOR: Record<ReminderKind, string> = { instagram: '#products', orders: '#orders', product: '#products', custom: '#reminders' }

export function reminderHtml(r: Pick<ReminderRow, 'kind' | 'title' | 'days' | 'time_of_day'>, ctx: Pick<ReminderContext, 'storeName' | 'slug'>, body: string): string {
  const url = `${SITE_URL}/vendor/store/${encodeURIComponent(ctx.slug)}${PAGE_ANCHOR[r.kind]}`
  const paragraphs = body
    .split(/\n{2,}|\r\n\r\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p style="margin:0 0 14px;white-space:pre-wrap;">${esc(p)}</p>`)
    .join('')
  return (
    `<div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#241530;font-size:15px;line-height:1.6;">` +
      `<p style="margin:0 0 4px;font-size:13px;color:#6b5d78;">${esc(ctx.storeName)} &middot; your store assistant</p>` +
      `<h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#702a8f;">${esc(r.title)}</h1>` +
      paragraphs +
      `<p style="margin:22px 0;"><a href="${url}" style="display:inline-block;background:#e8407a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:12px;">Open your store</a></p>` +
      `<p style="margin:0;font-size:12px;color:#6b5d78;">You get this because your &ldquo;${esc(r.title)}&rdquo; reminder is on (${esc(scheduleLabel(r.days, r.time_of_day))}, Eastern time). Switch it off under Reminders on your store page.</p>` +
    `</div>`
  )
}

// ---------------------------------------------------------------------------
// Her store, read the way the assistant route reads it (routes/vendor-store.ts)
// ---------------------------------------------------------------------------

let stripe: Stripe | null = null
async function payoutsReady(accountId: string | null): Promise<boolean> {
  if (!accountId || !process.env.STRIPE_SECRET_KEY) return false
  try {
    stripe ||= new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' })
    const account = await stripe.accounts.retrieve(accountId)
    return account.capabilities?.transfers === 'active'
  } catch {
    return false
  }
}

/**
 * Where reminders go: the store's own inbox (vendor_storefronts.inbox_mailbox_id, task f4a337b0), which is
 * crystal@imaginethisprinted.com for Crystal. Never owner_email: that is the address she signs in with, her personal
 * mail, and on 2026-10-26 it was changed to it minutes before a live test sent there. No active inbox, no reminder.
 */
export async function storeInboxAddress(inboxMailboxId: string | null | undefined): Promise<string | null> {
  if (!inboxMailboxId) return null
  const { data } = await supabase.from('email_mailboxes').select('address, is_active').eq('id', inboxMailboxId).maybeSingle()
  return data?.is_active ? String(data.address) : null
}

export async function loadReminderContext(storefrontId: string, now: Date = new Date()): Promise<ReminderContext | null> {
  const { data: store } = await supabase.from('vendor_storefronts').select('*').eq('id', storefrontId).maybeSingle()
  if (!store) return null
  const [{ data: items }, { data: orders }, { data: memories }, ready, to] = await Promise.all([
    supabase.from('vendor_store_items').select('*').eq('storefront_id', store.id),
    supabase
      .from('orders')
      .select('created_at, total, metadata, fulfillment_status')
      .eq('source', `store:${store.slug}`)
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('vendor_store_assistant_memory').select('fact').eq('storefront_id', store.id).order('created_at', { ascending: false }).limit(20),
    payoutsReady(store.stripe_account_id),
    storeInboxAddress(store.inbox_mailbox_id),
  ])
  const isItp = (i: any) => !!i.product_id || i.metadata?.line_type === QR_STAND.lineIdPrefix
  const paid = (orders || []) as any[]
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000
  return {
    storeName: store.name,
    slug: store.slug,
    to,
    newOrders24h: paid.filter(o => new Date(o.created_at).getTime() >= dayAgo).length,
    ordersToShip: paid.filter(o => o.fulfillment_status === 'unfulfilled' && (o.metadata?.items || []).some((i: any) => i.maker === 'vendor')).length,
    facts: {
      storeName: store.name,
      ownerFirst: String(store.theme?.ownerFirst || store.name.split(/[’']/)[0]),
      status: store.status,
      payoutsReady: ready,
      feePercent: Number(store.fee_percent),
      instagram: store.instagram ?? null,
      items: ((items || []) as any[]).map(i => ({ name: i.name, kind: isItp(i) ? 'itp' : 'own', priceCents: i.price_cents, itpCostCents: i.itp_cost_cents, active: i.active })),
      orders: paid.map(o => ({ createdAt: o.created_at, totalCents: Math.round(Number(o.total) * 100), shareCents: o.metadata?.vendor_store?.split?.vendorShareCents ?? null })),
      memories: ((memories || []) as Array<{ fact: string }>).map(m => m.fact),
    },
  }
}

// ---------------------------------------------------------------------------
// Firing one claimed slot
// ---------------------------------------------------------------------------

/** A row of vendor_store_reminder_sends this worker owns (it won the insert, or re-claimed a failed try). */
export type ClaimedSend = {
  id: string
  reminder_id: string
  slot_at: string
  attempts: number
  subject: string | null
  body: string | null
  written_by: 'assistant' | 'template' | null
}

export type FireOutcome = { status: 'sent' | 'skipped' | 'failed'; resendId?: string; writtenBy?: 'assistant' | 'template'; error?: string }

const update = (id: string, patch: Record<string, unknown>) => supabase.from('vendor_store_reminder_sends').update(patch).eq('id', id)

/**
 * Write (once) and send one claimed slot. The written email is saved on the send row before it goes out, and the
 * Resend idempotency key is the slot itself, so a retry of a failed try sends the same message and can never
 * deliver it twice.
 */
export async function fireReminder(claim: ClaimedSend, now: Date = new Date()): Promise<FireOutcome> {
  // She may have switched it off (or her store paused) between the sweep's read and this claim.
  const { data: r } = await supabase.from('vendor_store_reminders').select('*').eq('id', claim.reminder_id).maybeSingle()
  const reminder = r as ReminderRow | null
  const { data: store } = reminder
    ? await supabase.from('vendor_storefronts').select('status').eq('id', reminder.storefront_id).maybeSingle()
    : { data: null }
  if (!reminder || !reminder.enabled || !store || store.status === 'paused') {
    const error = !reminder ? 'reminder deleted' : !reminder.enabled ? 'switched off' : 'store paused'
    await update(claim.id, { status: 'skipped', error })
    return { status: 'skipped', error }
  }

  const ctx = await loadReminderContext(reminder.storefront_id, now)
  if (!ctx?.to) {
    await update(claim.id, { status: 'skipped', error: 'store has no inbox' })
    return { status: 'skipped', error: 'store has no inbox' }
  }
  const suppression = await getSuppression(ctx.to)
  if (suppression) {
    await update(claim.id, { status: 'skipped', to_email: ctx.to, error: `suppressed (${suppression.reason})` })
    return { status: 'skipped', error: `suppressed (${suppression.reason})` }
  }

  const slot = new Date(claim.slot_at)
  let subject = claim.subject
  let body = claim.body
  let writtenBy = claim.written_by
  if (!subject || !body) {
    subject = reminderSubject(reminder, slot)
    try {
      body = (await askStoreAssistant(ctx.facts, [{ role: 'user', text: reminderAsk(reminder, ctx, slot) }])).reply
      writtenBy = 'assistant'
    } catch (err: any) {
      console.warn(`[store-reminders] assistant didn't write ${reminder.id}, sending the plain version:`, err?.message || String(err))
      body = templateBody(reminder, ctx)
      writtenBy = 'template'
    }
    await update(claim.id, { to_email: ctx.to, subject, body, written_by: writtenBy })
  }

  try {
    const { id: resendId } = await sendViaResend({
      from: FROM,
      to: [ctx.to],
      reply_to: REPLY_TO,
      subject,
      html: reminderHtml(reminder, ctx, body),
      text: body,
      idempotencyKey: `store-reminder-${reminder.id}-${slot.toISOString()}`,
    })
    await update(claim.id, { status: 'sent', resend_id: resendId, sent_at: now.toISOString(), error: null })
    return { status: 'sent', resendId, writtenBy: writtenBy ?? undefined }
  } catch (err: any) {
    const error = String(err?.message || err).slice(0, 300)
    await update(claim.id, { status: 'failed', error })
    return { status: 'failed', error, writtenBy: writtenBy ?? undefined }
  }
}
