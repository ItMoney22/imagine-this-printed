// ---------------------------------------------------------------------------
// A store owner's referral cut (David 2026-10-26, Crystal first): "if one of her referrals use
// her link and buy a shirt she gets a cut. She needs her own link to give her stuff."
//
// Not a third referral system. Her link IS the friend link (imaginethisprinted.com/<any page>
// ?ref=CODE, kept on the visitor's device by src/utils/referral-capture.ts); the code just
// belongs to her store (vendor_storefronts.referral_code) instead of an account's
// referral_codes row. The cut itself follows the QR stand reseller's rule
// (services/qr-stand-builds.ts): a percent of the products after discounts, never shipping or
// tax, booked once the order is paid.
//
//   1. checkout  routes/stripe.ts  resolveStoreReferral() stamps orders.metadata.store_referral
//   2. paid      order-payment.ts  payStoreReferralCut()  transfers her cut to the store's
//                                  Stripe Express account, tied to the order's charge
//   3. refund    order-refunds.ts  reverseStoreReferralCut() takes it back
//
// The cut WAITS on the order (cut.status waiting_percent / waiting_payouts) until David sets
// the store's referral_percent and her payouts can take transfers; settleWaitingStoreReferrals()
// pays everything waiting when either becomes true.
// ---------------------------------------------------------------------------
import Stripe from 'stripe'
import { supabase } from '../lib/supabase.js'

type Logger = { info?: Function; warn?: Function; error?: Function } | undefined
type Db = { from: (table: string) => any }
type TransferApi = Pick<Stripe, 'transfers' | 'accounts'>

let client: Stripe | null = null
function defaultStripe(): TransferApi {
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' })
  return client
}

export type CutStatus =
  | 'paid'             // transferred to her account
  | 'waiting_percent'  // David hasn't set the store's referral percent yet
  | 'waiting_payouts'  // her Express account can't take transfers yet
  | 'nothing'          // no products left after discounts, or 0%
  | 'own_order'        // the store's owner bought through her own link
  | 'failed'           // Stripe refused: error says why; a settle retries it
  | 'reversed'         // the order was refunded after she was paid
  | 'cancelled'        // the order was refunded before she was paid

export interface StoreReferralCut {
  status: CutStatus
  base_cents: number
  percent: number | null
  amount_cents: number
  transfer_id?: string | null
  error?: string | null
  updated_at: string
}

export interface StoreReferralStamp {
  storefront_id: string
  slug: string
  code: string
  recorded_at: string
  cut?: StoreReferralCut
}

const WAITING: CutStatus[] = ['waiting_percent', 'waiting_payouts', 'failed']

/** Pure: a code as the site stores it (same rule as src/utils/referral-capture.ts). */
export function normalizeStoreReferralCode(raw: unknown): string | null {
  const code = String(raw ?? '').trim().toUpperCase()
  return /^[A-Z0-9]{4,20}$/.test(code) ? code : null
}

/** Pure: what her percent is OF: the products after coupon/wholesale discounts, in cents. */
export function referralBaseCents(order: { subtotal?: unknown; discount_amount?: unknown }): number {
  const cents = Math.round((Number(order.subtotal) || 0) * 100) - Math.round((Number(order.discount_amount) || 0) * 100)
  return Math.max(0, cents)
}

/** Pure: her cut in cents, rounded DOWN so we never pay a fraction of a cent more than the percent. */
export function storeReferralCutCents(baseCents: number, percent: number | null | undefined): number {
  if (percent == null || !Number.isFinite(Number(percent)) || Number(percent) <= 0) return 0
  return Math.floor((Math.max(0, baseCents) * Number(percent)) / 100)
}

/** Pure: the code a store gets when it has none: its slug's letters and digits (crystal -> CRYSTAL). */
export function storeReferralCodeFromSlug(slug: string, suffix = ''): string | null {
  return normalizeStoreReferralCode(`${String(slug).replace(/[^a-z0-9]/gi, '')}${suffix}`.slice(0, 20))
}

/** Is this a store's code? The wallet's apply route asks, so a store link is kept for checkout. */
export async function isStoreReferralCode(raw: unknown, db: Db = supabase): Promise<boolean> {
  const code = normalizeStoreReferralCode(raw)
  if (!code) return false
  const { data } = await db.from('vendor_storefronts').select('id').eq('referral_code', code).maybeSingle()
  return !!data
}

/**
 * Checkout: the stamp to put on orders.metadata.store_referral, or null. A paused store pays
 * nothing, and the store's owner buying through her own link is not a referral.
 */
export async function resolveStoreReferral(
  raw: unknown,
  buyerUserId: string | null,
  db: Db = supabase
): Promise<StoreReferralStamp | null> {
  const code = normalizeStoreReferralCode(raw)
  if (!code) return null
  const { data: store } = await db
    .from('vendor_storefronts')
    .select('id, slug, status, owner_user_id')
    .eq('referral_code', code)
    .maybeSingle()
  if (!store || store.status === 'paused') return null
  if (buyerUserId && store.owner_user_id && store.owner_user_id === buyerUserId) return null
  return { storefront_id: store.id, slug: store.slug, code, recorded_at: new Date().toISOString() }
}

/** A store that has no code yet gets one (slug first, then slug + digits if a person's code has it). */
export async function ensureStoreReferralCode(
  store: { id: string; slug: string; referral_code?: string | null },
  db: Db = supabase
): Promise<string | null> {
  if (store.referral_code) return store.referral_code
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = storeReferralCodeFromSlug(store.slug, attempt === 0 ? '' : String(Math.floor(100 + Math.random() * 900)))
    if (!code) return null
    const { data: personal } = await db.from('referral_codes').select('id').eq('code', code).maybeSingle()
    if (personal) continue
    const { error } = await db
      .from('vendor_storefronts')
      .update({ referral_code: code, updated_at: new Date().toISOString() })
      .eq('id', store.id)
      .is('referral_code', null)
    if (!error) {
      store.referral_code = code
      return code
    }
  }
  return null
}

async function payoutsCanTakeTransfers(stripe: TransferApi, accountId: string | null): Promise<boolean> {
  if (!accountId) return false
  try {
    const account = await stripe.accounts.retrieve(accountId)
    return account.capabilities?.transfers === 'active'
  } catch {
    return false
  }
}

async function writeCut(db: Db, orderId: string, stamp: StoreReferralStamp, cut: StoreReferralCut, log?: Logger) {
  // Re-read so a write by another paid-order step (print status, QR stand) isn't clobbered.
  const { data: row } = await db.from('orders').select('metadata').eq('id', orderId).single()
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  const { error } = await db
    .from('orders')
    .update({ metadata: { ...metadata, store_referral: { ...stamp, cut } }, updated_at: new Date().toISOString() })
    .eq('id', orderId)
  if (error) log?.error?.({ err: error, orderId }, '[store-referral] could not record the cut on the order')
}

/**
 * The order is paid: pay the store owner her cut, or record why it waits. Safe to call again
 * (the settle sweep does): a paid cut is never paid twice, and the Stripe idempotency key is
 * the order. Never throws; the payment already succeeded.
 */
export async function payStoreReferralCut(
  orderId: string,
  log?: Logger,
  deps: { db?: Db; stripe?: TransferApi } = {}
): Promise<StoreReferralCut | null> {
  const db = deps.db ?? supabase
  try {
    const { data: order } = await db
      .from('orders')
      .select('id, order_number, user_id, subtotal, discount_amount, total, payment_status, charge_id, metadata')
      .eq('id', orderId)
      .single()
    const stamp: StoreReferralStamp | undefined = order?.metadata?.store_referral
    if (!order || !stamp?.storefront_id) return null
    if (stamp.cut && !WAITING.includes(stamp.cut.status)) return stamp.cut
    if (order.payment_status !== 'paid') return stamp.cut ?? null

    const { data: store } = await db
      .from('vendor_storefronts')
      .select('id, slug, owner_user_id, stripe_account_id, referral_percent, status')
      .eq('id', stamp.storefront_id)
      .maybeSingle()

    const base = referralBaseCents(order)
    const percent = store?.referral_percent == null ? null : Number(store.referral_percent)
    const now = new Date().toISOString()
    const cut = (status: CutStatus, extra: Partial<StoreReferralCut> = {}): StoreReferralCut => ({
      status,
      base_cents: base,
      percent,
      amount_cents: storeReferralCutCents(base, percent),
      transfer_id: null,
      error: null,
      updated_at: now,
      ...extra
    })

    let result: StoreReferralCut
    if (!store) {
      result = cut('failed', { error: 'store not found' })
    } else if (store.owner_user_id && order.user_id === store.owner_user_id) {
      result = cut('own_order', { amount_cents: 0 })
    } else if (percent == null) {
      result = cut('waiting_percent')
    } else if (cut('nothing').amount_cents <= 0) {
      result = cut('nothing')
    } else {
      const stripe = deps.stripe ?? defaultStripe()
      if (!(await payoutsCanTakeTransfers(stripe, store.stripe_account_id))) {
        result = cut('waiting_payouts')
      } else {
        // Never more than the card was charged (store credit can pay part of an order).
        const charged = Math.round((Number(order.total) || 0) * 100)
        const amount = Math.min(storeReferralCutCents(base, percent), charged)
        try {
          const transfer = await stripe.transfers.create(
            {
              amount,
              currency: 'usd',
              destination: store.stripe_account_id,
              ...(order.charge_id ? { source_transaction: order.charge_id } : {}),
              transfer_group: order.order_number || order.id,
              description: `Referral share of order ${order.order_number || order.id}`,
              metadata: { purpose: 'store_referral', vendor_store: store.slug, order_id: order.id, order_number: order.order_number || '' }
            },
            { idempotencyKey: `store-referral-cut-${order.id}` }
          )
          result = cut('paid', { amount_cents: amount, transfer_id: transfer.id })
          log?.info?.({ orderId, store: store.slug, amount, transfer: transfer.id }, '[store-referral] cut paid')
        } catch (err: any) {
          result = cut('failed', { error: String(err?.message || err).slice(0, 300) })
          log?.error?.({ err, orderId, store: store.slug }, '[store-referral] transfer failed')
        }
      }
    }

    await writeCut(db, orderId, stamp, result, log)
    return result
  } catch (err) {
    log?.error?.({ err, orderId }, '[store-referral] paid-order step threw')
    return null
  }
}

/** Pay every cut of this store that is still waiting (her percent was just set, or payouts went live). */
export async function settleWaitingStoreReferrals(
  storefrontId: string,
  log?: Logger,
  deps: { db?: Db; stripe?: TransferApi } = {}
): Promise<number> {
  const db = deps.db ?? supabase
  const { data: rows, error } = await db
    .from('orders')
    .select('id, metadata')
    .eq('metadata->store_referral->>storefront_id', storefrontId)
    .eq('payment_status', 'paid')
    .limit(200)
  if (error) {
    log?.error?.({ err: error, storefrontId }, '[store-referral] could not read waiting cuts')
    return 0
  }
  let paid = 0
  for (const row of rows || []) {
    const status = row.metadata?.store_referral?.cut?.status
    if (status && !WAITING.includes(status)) continue
    const cut = await payStoreReferralCut(row.id, log, deps)
    if (cut?.status === 'paid') paid++
  }
  return paid
}

/** For her store manager: the orders that came through her link and what each paid her. */
export async function storeReferralOrders(storefrontId: string, db: Db = supabase) {
  const { data } = await db
    .from('orders')
    .select('order_number, created_at, subtotal, discount_amount, payment_status, metadata')
    .eq('metadata->store_referral->>storefront_id', storefrontId)
    .in('payment_status', ['paid', 'refunded', 'partially_refunded'])
    .order('created_at', { ascending: false })
    .limit(50)
  return ((data || []) as any[]).map(o => {
    const cut: StoreReferralCut | undefined = o.metadata?.store_referral?.cut
    return {
      orderNumber: o.order_number as string,
      createdAt: o.created_at as string,
      productsCents: referralBaseCents(o),
      cutCents: cut?.amount_cents ?? 0,
      status: (cut?.status ?? 'waiting_percent') as CutStatus
    }
  })
}

/**
 * Refund: take her cut back. A paid cut is reversed on Stripe; a waiting one is cancelled so a
 * later settle never pays it. Shaped like the other steps of reverseOrderSideEffects().
 */
export async function reverseStoreReferralCut(
  orderId: string,
  log?: Logger,
  deps: { db?: Db; stripe?: TransferApi } = {}
): Promise<{ ok: boolean; skipped: boolean; reason?: string; details?: Record<string, any> }> {
  const db = deps.db ?? supabase
  try {
    const { data: order } = await db.from('orders').select('id, metadata').eq('id', orderId).single()
    const stamp: StoreReferralStamp | undefined = order?.metadata?.store_referral
    const cut = stamp?.cut
    if (!stamp || !cut) return { ok: true, skipped: true, reason: 'no store referral' }
    if (['reversed', 'cancelled', 'nothing', 'own_order'].includes(cut.status)) {
      return { ok: true, skipped: true, reason: `already ${cut.status}` }
    }
    const now = new Date().toISOString()
    if (cut.status !== 'paid' || !cut.transfer_id) {
      await writeCut(db, orderId, stamp, { ...cut, status: 'cancelled', updated_at: now }, log)
      return { ok: true, skipped: false, details: { cancelled: cut.status } }
    }
    const stripe = deps.stripe ?? defaultStripe()
    const reversal = await stripe.transfers.createReversal(
      cut.transfer_id,
      { metadata: { purpose: 'store_referral_refund', order_id: orderId } },
      { idempotencyKey: `store-referral-reversal-${orderId}` }
    )
    await writeCut(db, orderId, stamp, { ...cut, status: 'reversed', updated_at: now }, log)
    return { ok: true, skipped: false, details: { transfer: cut.transfer_id, reversal: reversal.id, amount_cents: cut.amount_cents } }
  } catch (err: any) {
    log?.error?.({ err, orderId }, '[store-referral] reversal failed')
    return { ok: false, skipped: false, reason: String(err?.message || err).slice(0, 300) }
  }
}
