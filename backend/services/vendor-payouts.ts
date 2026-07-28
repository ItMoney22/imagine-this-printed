/**
 * Vendor payout ledger + real Stripe Connect payouts for marketplace vendors.
 *
 * Money model (matches the fee split this codebase has always documented in
 * docs/WALLET_SYSTEM_COMPLETE.md and the old src/utils/vendor-payouts.ts):
 *   vendor payout = sale − platform fee (7%) − payment processing fee (3.5%)
 * Both rates are env-overridable so the split can move without a code change.
 *
 * Why this does NOT reuse /api/wallet/connect/cashout: that endpoint cashes
 * out a user's ITC *wallet balance* (deducts user_wallets.itc_balance). Vendor
 * earnings are USD the platform owes for product sales and live in a separate
 * ledger — running them through the ITC path would debit the wrong balance and
 * would refuse any vendor holding 0 ITC. The Stripe Connect *account* is
 * shared (one Express account per user in stripe_connect_accounts), so
 * onboarding/status genuinely are reused; only the money movement is separate.
 *
 * Accrual is lazy and idempotent: every read of the ledger first sweeps paid
 * orders for line items of this vendor's products that have no ledger row yet
 * and inserts them as `pending`. That means the ledger self-heals, works for
 * historical orders, and needs no change to the checkout/webhook path. The
 * unique index uq_vendor_payouts_order_product (one row per order+product,
 * same convention as creator-margins.ts) is the concurrency backstop.
 */

import Stripe from 'stripe'
import { supabase } from '../lib/supabase.js'
import { claimOnce } from '../lib/webhook-helpers.js'

export type PayoutDb = { from: (table: string) => any }

export type StripeLike = {
  transfers: { create: (params: any) => Promise<any> }
  payouts: { create: (params: any, options?: any) => Promise<any> }
}

let defaultStripe: StripeLike | null = null
function getStripe(): StripeLike {
  if (!defaultStripe) {
    defaultStripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-02-24.acacia'
    }) as unknown as StripeLike
  }
  return defaultStripe
}

// =============================================================================
// Config
// =============================================================================

function envPercent(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : fallback
}

export function platformFeeRate(): number {
  return envPercent('VENDOR_PLATFORM_FEE_PERCENT', 7) / 100
}

export function stripeFeeRate(): number {
  return envPercent('VENDOR_STRIPE_FEE_PERCENT', 3.5) / 100
}

export function minimumPayoutUsd(): number {
  const raw = Number(process.env.VENDOR_MINIMUM_PAYOUT_USD)
  return Number.isFinite(raw) && raw >= 1 ? raw : 25
}

export interface PayoutConfig {
  platformFeeRate: number
  stripeFeeRate: number
  minimumPayoutUsd: number
}

export function payoutConfig(): PayoutConfig {
  return {
    platformFeeRate: platformFeeRate(),
    stripeFeeRate: stripeFeeRate(),
    minimumPayoutUsd: minimumPayoutUsd()
  }
}

// =============================================================================
// Calculation
// =============================================================================

export interface PayoutCalculation {
  saleAmount: number
  platformFeeRate: number
  platformFee: number
  stripeFeeRate: number
  stripeFee: number
  payoutAmount: number
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export function calculateVendorPayout(saleAmount: number): PayoutCalculation {
  const sale = round2(saleAmount)
  const pRate = platformFeeRate()
  const sRate = stripeFeeRate()
  const platformFee = round2(sale * pRate)
  const stripeFee = round2(sale * sRate)
  return {
    saleAmount: sale,
    platformFeeRate: pRate,
    platformFee,
    stripeFeeRate: sRate,
    stripeFee,
    payoutAmount: round2(sale - platformFee - stripeFee)
  }
}

// =============================================================================
// Accrual
// =============================================================================

/**
 * Sweep paid orders for this vendor's products and insert any missing ledger
 * rows as `pending`. Idempotent — safe to call on every read.
 * Returns the number of rows created.
 */
export async function accrueVendorPayouts(
  vendorId: string,
  db: PayoutDb = supabase
): Promise<number> {
  const { data: products, error: pErr } = await db
    .from('products')
    .select('id, name')
    .eq('vendor_id', vendorId)
  if (pErr) throw new Error(`Failed to load vendor products: ${pErr.message}`)

  const productIds = (products || []).map((p: any) => p.id)
  if (productIds.length === 0) return 0
  const productNames = new Map<string, string>(
    (products || []).map((p: any) => [p.id, p.name])
  )

  const { data: items, error: iErr } = await db
    .from('order_items')
    .select('id, order_id, product_id, quantity, unit_price, subtotal')
    .in('product_id', productIds)
  if (iErr) throw new Error(`Failed to load order items: ${iErr.message}`)
  if (!items || items.length === 0) return 0

  const orderIds = [...new Set(items.map((i: any) => i.order_id).filter(Boolean))]
  if (orderIds.length === 0) return 0

  // Only orders the customer actually paid for, and that weren't cancelled or
  // refunded afterwards, are owed to a vendor.
  const { data: orders, error: oErr } = await db
    .from('orders')
    .select('id, order_number, customer_email, payment_status, status, created_at')
    .in('id', orderIds)
    .eq('payment_status', 'paid')
  if (oErr) throw new Error(`Failed to load orders: ${oErr.message}`)

  const payable = new Map<string, any>()
  for (const o of orders || []) {
    if (o.status === 'cancelled' || o.status === 'refunded') continue
    payable.set(o.id, o)
  }
  if (payable.size === 0) return 0

  // Existing ledger rows keyed by order+product so re-runs are no-ops.
  const { data: existing, error: eErr } = await db
    .from('vendor_payouts')
    .select('order_id, product_id')
    .eq('vendor_id', vendorId)
    .in('order_id', [...payable.keys()])
  if (eErr) throw new Error(`Failed to load existing payouts: ${eErr.message}`)
  const seen = new Set((existing || []).map((r: any) => `${r.order_id}:${r.product_id}`))

  // Aggregate line items per (order, product) — the same product can appear on
  // several rows (size M + 2XL at different unit prices).
  type AccrualGroup = { orderId: string; productId: string; sale: number; qty: number; itemIds: string[] }
  const groups = new Map<string, AccrualGroup>()
  for (const it of items as any[]) {
    if (!it.order_id || !it.product_id) continue
    if (!payable.has(it.order_id)) continue
    const key = `${it.order_id}:${it.product_id}`
    if (seen.has(key)) continue
    const qty = Math.max(1, Number(it.quantity) || 1)
    const line = Number(it.subtotal) > 0
      ? Number(it.subtotal)
      : (Number(it.unit_price) || 0) * qty
    const g: AccrualGroup =
      groups.get(key) || { orderId: it.order_id, productId: it.product_id, sale: 0, qty: 0, itemIds: [] }
    g.sale += line
    g.qty += qty
    if (it.id) g.itemIds.push(it.id)
    groups.set(key, g)
  }
  if (groups.size === 0) return 0

  let created = 0
  for (const g of groups.values()) {
    const calc = calculateVendorPayout(g.sale)
    if (calc.payoutAmount <= 0) continue
    const order = payable.get(g.orderId)
    const row = {
      vendor_id: vendorId,
      order_id: g.orderId,
      product_id: g.productId,
      sale_amount: calc.saleAmount,
      platform_fee_rate: calc.platformFeeRate,
      platform_fee: calc.platformFee,
      stripe_fee_rate: calc.stripeFeeRate,
      stripe_fee: calc.stripeFee,
      payout_amount: calc.payoutAmount,
      amount: calc.payoutAmount, // legacy NOT NULL column on the live table
      currency: 'USD',
      status: 'pending',
      method: 'stripe_connect',
      metadata: {
        product_name: productNames.get(g.productId) || null,
        quantity: g.qty,
        order_number: order?.order_number || null,
        customer_email: order?.customer_email || null,
        order_item_ids: g.itemIds,
        order_created_at: order?.created_at || null
      }
    }
    const { error } = await db.from('vendor_payouts').insert(row)
    if (error) {
      // 23505 = a concurrent sweep already inserted this exact (order, product).
      if ((error as any).code === '23505') continue
      throw new Error(`Failed to record vendor payout: ${error.message}`)
    }
    created++
  }

  return created
}

type Logger = { info?: Function; warn?: Function; error?: Function } | undefined

/**
 * Real-time counterpart to the lazy sweep above. Resolves which vendors are
 * owed money from a single just-paid order (order_items -> products.vendor_id)
 * and accrues each of them immediately, instead of waiting for that vendor to
 * next open a payouts page. accrueVendorPayouts() itself is unchanged and
 * still sweeps that vendor's whole paid-order history (the unique index makes
 * re-sweeping already-seen rows a no-op), so this is "trigger the sweep now
 * instead of on next read" rather than a second accrual code path — the lazy
 * sweep on GET /payouts remains a correct backstop (historical orders, or if
 * this call is ever skipped).
 *
 * Never throws — a ledger hiccup must not fail the payment webhook that pays
 * the customer. Every failure is logged and swallowed, same discipline as
 * creator-margins.ts's accrueCreatorMarginsForOrder.
 */
export async function accrueVendorPayoutsForOrder(
  orderId: string,
  log?: Logger,
  db: PayoutDb = supabase
): Promise<void> {
  try {
    const { data: items, error: itemsErr } = await db
      .from('order_items')
      .select('product_id')
      .eq('order_id', orderId)
    if (itemsErr) {
      log?.error?.({ err: itemsErr, orderId }, '[vendor-payouts] failed to load order items for real-time accrual')
      return
    }

    const productIds = [...new Set((items || []).map((i: any) => i.product_id).filter(Boolean))]
    if (productIds.length === 0) return

    const { data: products, error: productsErr } = await db
      .from('products')
      .select('id, vendor_id')
      .in('id', productIds)
    if (productsErr) {
      log?.error?.({ err: productsErr, orderId }, '[vendor-payouts] failed to load products for real-time accrual')
      return
    }

    const vendorIds = [...new Set<string>((products || []).map((p: any) => p.vendor_id as string).filter(Boolean))]
    for (const vendorId of vendorIds) {
      try {
        const created = await accrueVendorPayouts(vendorId, db)
        if (created > 0) {
          log?.info?.({ orderId, vendorId, created }, '[vendor-payouts] accrued ledger rows from paid-order webhook')
        }
      } catch (err: any) {
        log?.error?.({ err, orderId, vendorId }, '[vendor-payouts] real-time accrual failed for vendor — lazy sweep remains the backstop')
      }
    }
  } catch (err: any) {
    log?.error?.({ err, orderId }, '[vendor-payouts] accrueVendorPayoutsForOrder failed (non-fatal)')
  }
}

// =============================================================================
// Reads
// =============================================================================

export interface LedgerFilters {
  status?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

export async function listVendorPayouts(
  vendorId: string,
  filters: LedgerFilters = {},
  db: PayoutDb = supabase
): Promise<any[]> {
  let query = db
    .from('vendor_payouts')
    .select('*')
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false })

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.startDate) query = query.gte('created_at', filters.startDate)
  if (filters.endDate) query = query.lte('created_at', filters.endDate)

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500)
  const offset = Math.max(Number(filters.offset) || 0, 0)
  query = query.range(offset, offset + limit - 1)

  const { data, error } = await query
  if (error) throw new Error(`Failed to load payouts: ${error.message}`)
  return data || []
}

export interface PayoutSummary {
  totalPayouts: number
  totalAmount: number
  totalFees: number
  pendingAmount: number
  processingAmount: number
  paidAmount: number
  availableAmount: number
  averagePayout: number
  periodComparison: { change: number; isPositive: boolean } | null
  config: PayoutConfig
}

/** Rows a payout can actually draw from. */
const CLAIMABLE = 'pending'

export async function summarizeVendorPayouts(
  vendorId: string,
  db: PayoutDb = supabase
): Promise<PayoutSummary> {
  const { data, error } = await db
    .from('vendor_payouts')
    .select('payout_amount, platform_fee, stripe_fee, status, created_at')
    .eq('vendor_id', vendorId)
  if (error) throw new Error(`Failed to summarize payouts: ${error.message}`)

  const rows = data || []
  const num = (v: any) => Number(v) || 0
  const sum = (list: any[], key: string) => round2(list.reduce((t, r) => t + num(r[key]), 0))

  const paid = rows.filter((r: any) => r.status === 'paid')
  const pending = rows.filter((r: any) => r.status === CLAIMABLE)
  const processing = rows.filter((r: any) => r.status === 'processing')

  const totalAmount = sum(rows, 'payout_amount')
  const totalFees = round2(sum(rows, 'platform_fee') + sum(rows, 'stripe_fee'))

  // Real month-over-month comparison on earnings accrued, not a hardcoded 15.2%.
  const now = new Date()
  const thisPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  let thisPeriod = 0
  let lastPeriod = 0
  for (const r of rows as any[]) {
    const created = r.created_at ? new Date(r.created_at) : null
    if (!created || Number.isNaN(created.getTime())) continue
    if (created >= thisPeriodStart) thisPeriod += num(r.payout_amount)
    else if (created >= lastPeriodStart) lastPeriod += num(r.payout_amount)
  }
  const periodComparison = lastPeriod > 0
    ? { change: round2(((thisPeriod - lastPeriod) / lastPeriod) * 100), isPositive: thisPeriod >= lastPeriod }
    : thisPeriod > 0
      ? { change: 100, isPositive: true }
      : null

  const pendingAmount = sum(pending, 'payout_amount')

  return {
    totalPayouts: rows.length,
    totalAmount,
    totalFees,
    pendingAmount,
    processingAmount: sum(processing, 'payout_amount'),
    paidAmount: sum(paid, 'payout_amount'),
    availableAmount: pendingAmount,
    averagePayout: rows.length > 0 ? round2(totalAmount / rows.length) : 0,
    periodComparison,
    config: payoutConfig()
  }
}

export interface PayoutAnalytics {
  chartData: Array<{ date: string; amount: number; fees: number }>
  topProducts: Array<{ productId: string; productName: string; totalSales: number; totalPayouts: number }>
  monthlyTrends: { payoutGrowth: number; feeOptimization: number }
}

export async function getVendorPayoutAnalytics(
  vendorId: string,
  period: 'week' | 'month' | 'year' = 'week',
  db: PayoutDb = supabase
): Promise<PayoutAnalytics> {
  const days = period === 'year' ? 365 : period === 'month' ? 30 : 7
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const { data, error } = await db
    .from('vendor_payouts')
    .select('product_id, sale_amount, payout_amount, platform_fee, stripe_fee, created_at, metadata')
    .eq('vendor_id', vendorId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Failed to load payout analytics: ${error.message}`)

  const rows = data || []
  const byDay = new Map<string, { amount: number; fees: number }>()
  const byProduct = new Map<string, { productName: string; totalSales: number; totalPayouts: number }>()

  for (const r of rows as any[]) {
    const day = String(r.created_at || '').slice(0, 10)
    if (day) {
      const bucket = byDay.get(day) || { amount: 0, fees: 0 }
      bucket.amount += Number(r.payout_amount) || 0
      bucket.fees += (Number(r.platform_fee) || 0) + (Number(r.stripe_fee) || 0)
      byDay.set(day, bucket)
    }
    if (r.product_id) {
      const p = byProduct.get(r.product_id) || {
        productName: r.metadata?.product_name || 'Product',
        totalSales: 0,
        totalPayouts: 0
      }
      p.totalSales += Number(r.sale_amount) || 0
      p.totalPayouts += Number(r.payout_amount) || 0
      byProduct.set(r.product_id, p)
    }
  }

  const chartData = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, amount: round2(v.amount), fees: round2(v.fees) }))

  const topProducts = [...byProduct.entries()]
    .map(([productId, v]) => ({
      productId,
      productName: v.productName,
      totalSales: round2(v.totalSales),
      totalPayouts: round2(v.totalPayouts)
    }))
    .sort((a, b) => b.totalPayouts - a.totalPayouts)
    .slice(0, 5)

  // Growth = this half of the window vs the previous half. No invented numbers:
  // with nothing to compare against, growth is 0.
  const mid = new Date(Date.now() - (days / 2) * 24 * 60 * 60 * 1000)
  let recent = 0
  let earlier = 0
  for (const r of rows as any[]) {
    const created = r.created_at ? new Date(r.created_at) : null
    if (!created || Number.isNaN(created.getTime())) continue
    if (created >= mid) recent += Number(r.payout_amount) || 0
    else earlier += Number(r.payout_amount) || 0
  }
  const payoutGrowth = earlier > 0 ? round2(((recent - earlier) / earlier) * 100) : recent > 0 ? 100 : 0

  const grossSales = round2(rows.reduce((t: number, r: any) => t + (Number(r.sale_amount) || 0), 0))
  const totalFees = round2(
    rows.reduce((t: number, r: any) => t + (Number(r.platform_fee) || 0) + (Number(r.stripe_fee) || 0), 0)
  )
  const effectiveFeePercent = grossSales > 0 ? round2((totalFees / grossSales) * 100) : 0

  return {
    chartData,
    topProducts,
    monthlyTrends: { payoutGrowth, feeOptimization: effectiveFeePercent }
  }
}

// =============================================================================
// Payout processing
// =============================================================================

export interface VendorPayoutResult {
  success: boolean
  error?: string
  batchId?: string
  transferId?: string
  payoutId?: string
  amount?: number
  payoutCount?: number
  warning?: string
}

/**
 * Pay out a vendor's claimable earnings through Stripe Connect.
 *
 * Claim-then-transfer: the selected ledger rows are flipped pending→processing
 * with a `.eq('status','pending')` guard FIRST, and only the rows that update
 * actually get paid. Two concurrent requests therefore cannot pay the same row
 * twice (same claim discipline as the AI-jobs worker).
 */
export async function processVendorPayout(
  vendorId: string,
  requestedAmount?: number,
  db: PayoutDb = supabase,
  stripe: StripeLike = getStripe()
): Promise<VendorPayoutResult> {
  const { data: connectAccount, error: accountError } = await db
    .from('stripe_connect_accounts')
    .select('*')
    .eq('user_id', vendorId)
    .maybeSingle()

  if (accountError) return { success: false, error: `Failed to load Connect account: ${accountError.message}` }
  if (!connectAccount) {
    return { success: false, error: 'No Stripe Connect account found. Complete payout setup first.' }
  }
  // Two-stage gate so the vendor gets a precise next step (same wording model
  // as the ITC cashout path in services/stripe-connect.ts).
  if (!connectAccount.onboarding_complete) {
    return { success: false, error: 'Please complete Stripe Connect onboarding before requesting a payout.' }
  }
  if (!connectAccount.payouts_enabled) {
    return { success: false, error: 'Your Stripe account is still being verified. Payouts will be available once Stripe completes review.' }
  }

  // Refuse to start a second payout while one is mid-flight.
  const { data: inFlight } = await db
    .from('vendor_payouts')
    .select('id')
    .eq('vendor_id', vendorId)
    .eq('status', 'processing')
    .limit(1)
  if (inFlight && inFlight.length > 0) {
    return { success: false, error: 'You already have a payout in progress. Please wait for it to complete.' }
  }

  const { data: claimable, error: claimError } = await db
    .from('vendor_payouts')
    .select('id, payout_amount')
    .eq('vendor_id', vendorId)
    .eq('status', CLAIMABLE)
    .order('created_at', { ascending: true })
  if (claimError) return { success: false, error: `Failed to load pending payouts: ${claimError.message}` }

  const rows = claimable || []
  if (rows.length === 0) return { success: false, error: 'No earnings are available to pay out yet.' }

  // Ledger rows are paid whole — take oldest-first until the requested amount
  // is reached (no partial rows, so the ledger always reconciles to Stripe).
  const cap = Number(requestedAmount)
  const selected: any[] = []
  let total = 0
  for (const r of rows) {
    const amount = Number(r.payout_amount) || 0
    if (amount <= 0) continue
    if (Number.isFinite(cap) && cap > 0 && total + amount > cap) continue
    selected.push(r)
    total = round2(total + amount)
  }

  const minimum = minimumPayoutUsd()
  if (selected.length === 0 || total < minimum) {
    const available = round2(rows.reduce((t: number, r: any) => t + (Number(r.payout_amount) || 0), 0))
    return {
      success: false,
      error: `Minimum payout is $${minimum.toFixed(2)}. You currently have $${available.toFixed(2)} available.`
    }
  }

  const batchId = `vpo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const ids = selected.map((r) => r.id)

  // CLAIM: only rows still `pending` flip to `processing`, and only those get paid.
  const { data: claimed, error: claimUpdateError } = await db
    .from('vendor_payouts')
    .update({
      status: 'processing',
      payout_batch_id: batchId,
      updated_at: new Date().toISOString()
    })
    .in('id', ids)
    .eq('status', CLAIMABLE)
    .select('id, payout_amount')

  if (claimUpdateError) return { success: false, error: `Failed to claim payouts: ${claimUpdateError.message}` }

  const claimedRows = claimed || []
  if (claimedRows.length === 0) {
    return { success: false, error: 'Those earnings were already claimed by another payout request.' }
  }

  const claimedTotal = round2(claimedRows.reduce((t: number, r: any) => t + (Number(r.payout_amount) || 0), 0))
  const amountCents = Math.round(claimedTotal * 100)
  const claimedIds = claimedRows.map((r: any) => r.id)

  const release = async (reason: string) => {
    await db
      .from('vendor_payouts')
      .update({
        status: CLAIMABLE,
        payout_batch_id: null,
        failure_reason: reason,
        updated_at: new Date().toISOString()
      })
      .in('id', claimedIds)
  }

  if (amountCents < 100) {
    await release('Net payout below Stripe minimum of $1.00')
    return { success: false, error: 'Net payout amount is too small. Minimum payout is $1.00' }
  }
  if (claimedTotal < minimum) {
    await release(`Claimed total $${claimedTotal.toFixed(2)} fell below the $${minimum.toFixed(2)} minimum`)
    return { success: false, error: `Minimum payout is $${minimum.toFixed(2)}.` }
  }

  // 1. Platform balance → connected account.
  let transfer: any
  try {
    transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: 'usd',
      destination: connectAccount.stripe_account_id,
      metadata: {
        vendor_id: vendorId,
        payout_batch_id: batchId,
        ledger_rows: String(claimedRows.length)
      }
    })
  } catch (error: any) {
    await release(error?.message || 'Stripe transfer failed')
    return { success: false, error: error?.message || 'Stripe transfer failed' }
  }

  // 2. Connected account → vendor's bank/debit card.
  let payout: any = null
  let payoutError: string | null = null
  try {
    payout = await stripe.payouts.create(
      {
        amount: amountCents,
        currency: 'usd',
        method: connectAccount.instant_payouts_enabled ? 'instant' : 'standard',
        metadata: { payout_batch_id: batchId, transfer_id: transfer.id, vendor_id: vendorId }
      },
      { stripeAccount: connectAccount.stripe_account_id }
    )
  } catch (error: any) {
    // The transfer already succeeded — the money has left the platform and is
    // sitting in the vendor's connected account. Releasing the rows back to
    // `pending` here would let the same earnings be transferred a second time,
    // so they stay `paid` with the payout failure recorded for follow-up.
    payoutError = error?.message || 'Stripe payout failed'
    console.error('[vendor-payouts] transfer succeeded but payout failed:', payoutError)
  }

  const now = new Date().toISOString()
  await db
    .from('vendor_payouts')
    .update({
      status: 'paid',
      stripe_transfer_id: transfer.id,
      stripe_payout_id: payout?.id || null,
      failure_reason: payoutError,
      processed_at: now,
      payout_date: now,
      updated_at: now
    })
    .in('id', claimedIds)

  return {
    success: true,
    batchId,
    transferId: transfer.id,
    payoutId: payout?.id,
    amount: claimedTotal,
    payoutCount: claimedRows.length,
    warning: payoutError
      ? 'Funds were transferred to your Stripe account, but the bank payout could not be started automatically. Stripe support or an admin will complete it.'
      : undefined
  }
}

// =============================================================================
// Webhook reconciliation — payout.failed / transfer.reversed
// =============================================================================
//
// processVendorPayout() above marks ledger rows `paid` as soon as the Stripe
// transfer + payout calls both succeed. That's optimistic: Stripe delivers the
// definitive outcome asynchronously, and a vendor's bank can reject a payout
// days later — with nothing listening for that, the row stays `paid` forever
// while the vendor's money sits nowhere anyone can see.
//
// The trap (already called out on processVendorPayout's `release()` above):
// once transfers.create() succeeds, the earnings have LEFT the platform
// balance and are sitting in the vendor's *connected* Stripe account. A failed
// bank payout does NOT return that money to the platform, so flipping the row
// back to `pending` on payout.failed alone would let a future payout transfer
// the same earnings a second time — the vendor gets paid twice. Only a
// transfer.reversed event (Stripe pulling the money back out of the connected
// account) makes reclaiming safe, so ONLY that event returns rows to `pending`.
//
// Both handlers match Stripe objects to ledger rows via metadata.payout_batch_id
// (set on both the transfer and the payout inside processVendorPayout above)
// and use the same claim-once idempotency discipline as the rest of the
// checkout path (lib/webhook-helpers.ts claimOnce): the UPDATE's WHERE on
// `status` only matches on the first delivery of a given event, so Stripe's
// at-least-once redelivery can never double-process a batch.

export interface StripePayoutLike {
  id: string
  metadata?: Record<string, string> | null
  failure_message?: string | null
  failure_code?: string | null
}

export interface StripeTransferLike {
  id: string
  metadata?: Record<string, string> | null
}

/**
 * Stripe `payout.failed` — the bank rejected a payout whose transfer already
 * succeeded. Flags the batch's ledger rows `failed` with a reason. Does NOT
 * touch payout_batch_id — the rows stay tied to this batch until a
 * transfer.reversed confirms the money actually came back (see above).
 * A no-op (not an error) if the batch id is missing or matches nothing: most
 * payout.failed events are the unrelated ITC-cashout flow, keyed on
 * metadata.cashout_request_id instead (services/stripe-connect.ts).
 */
export async function handleVendorPayoutFailed(
  payout: StripePayoutLike,
  db: PayoutDb = supabase
): Promise<{ matched: boolean }> {
  const batchId = payout.metadata?.payout_batch_id
  if (!batchId) return { matched: false }

  const reason = payout.failure_message || payout.failure_code || 'Stripe payout failed'
  const claim = await claimOnce(
    db
      .from('vendor_payouts')
      .update({ status: 'failed', failure_reason: reason, updated_at: new Date().toISOString() })
      .eq('payout_batch_id', batchId)
      .eq('status', 'paid')
      .select('id')
  )
  if (claim.error) {
    throw new Error(`Failed to record payout.failed for batch ${batchId}: ${(claim.error as any).message}`)
  }
  return { matched: claim.claimed }
}

/**
 * Stripe `transfer.reversed` — Stripe pulled the transferred amount back out
 * of the vendor's connected account, so the platform has the earnings again.
 * That's the one signal that makes reclaiming safe: matched rows — whether
 * still `paid` (the reversal arrived before payout.failed) or already
 * `failed` — go back to `pending` so a future payout run can pay them for
 * real. A no-op if the batch id is missing, matches nothing, or every
 * matched row is already `pending` (redelivery of an event already applied).
 */
export async function handleVendorTransferReversed(
  transfer: StripeTransferLike,
  db: PayoutDb = supabase
): Promise<{ matched: boolean }> {
  const batchId = transfer.metadata?.payout_batch_id
  if (!batchId) return { matched: false }

  const claim = await claimOnce(
    db
      .from('vendor_payouts')
      .update({
        status: CLAIMABLE,
        payout_batch_id: null,
        failure_reason: 'Stripe transfer reversed — earnings returned to the payable queue',
        updated_at: new Date().toISOString()
      })
      .eq('payout_batch_id', batchId)
      .in('status', ['paid', 'failed'])
      .select('id')
  )
  if (claim.error) {
    throw new Error(`Failed to record transfer.reversed for batch ${batchId}: ${(claim.error as any).message}`)
  }
  return { matched: claim.claimed }
}
