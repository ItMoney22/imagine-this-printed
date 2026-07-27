/**
 * Order refunds — reversal of the side effects a PAID order applied.
 *
 * The paid path (routes/stripe.ts handleCheckoutOrderPayment) applies four
 * money-moving side effects. This module undoes the three that a refund must
 * claw back:
 *
 *   1. ITC store credit  — the wallet was debited by orders.metadata
 *      .itc_credit_amount and an itc_transactions row (type 'purchase_payment',
 *      reference = orderId) was written. Reversal re-credits the wallet.
 *   2. Blank inventory   — decrementBlanksForOrder() wrote one
 *      blank_inventory_movements row per blank (reason 'sale', negative delta)
 *      and decremented blank_inventory.qty_on_hand. Reversal restocks it.
 *   3. Creator margins   — accrueCreatorMarginsForOrder() inserted
 *      user_product_royalties rows and credited the creator's ITC wallet.
 *      Reversal debits the creator back and marks the royalty row reversed.
 *
 * NOT reversed here (deliberate, see the handoff for Watchtower task
 * c1b0182f): order_rewards loyalty ITC, the referral first-purchase bonus, and
 * coupon_usage. Those are awarded through the award_order_rewards RPC and
 * services/referral-service.ts, whose write shapes this module cannot safely
 * infer; clawing them back is filed as its own task rather than guessed at.
 *
 * ─── Idempotency ──────────────────────────────────────────────────────────
 * The CALLER owns the outer gate: both the admin endpoint and the
 * charge.refunded webhook flip orders.status to 'refunded' with the atomic
 * claimOnce() pattern and only the winner calls reverseOrderSideEffects().
 * Every reversal below ALSO carries its own guard (a marker ledger row / a
 * marker movement row / the DB's own unique index), so a manual re-run or a
 * crash between steps can never double-apply.
 *
 * ─── Failure policy ───────────────────────────────────────────────────────
 * Nothing here throws. The money already moved at Stripe; a failed inventory
 * restock must not turn into a 500 that makes an admin retry the refund. Every
 * step reports {ok, skipped, reason} and the aggregate report is persisted on
 * orders.metadata.refund_reversal + audit_logs so a human can finish by hand.
 * `report.ok === false` means at least one step needs manual attention.
 */

import { supabase as realSupabase } from '../lib/supabase.js'
import { addBalance } from '../lib/webhook-helpers.js'

/** Minimal structural type of the Supabase client bits this module uses. */
export type RefundDb = {
  from: (table: string) => any
  rpc: (fn: string, args: any) => any
}

// Matches the logger shape services/creator-margins.ts accepts, so both can
// take `req.log` (pino) or nothing at all.
type Logger = { info?: Function; warn?: Function; error?: Function } | undefined

/** Readable message out of a Supabase/PostgREST error, a thrown Error, or junk. */
function errMessage(err: unknown): string {
  if (!err) return 'unknown error'
  if (typeof err === 'string') return err
  const e = err as { message?: unknown; code?: unknown }
  return String(e.message ?? e.code ?? err)
}

/** Postgres SQLSTATE / PostgREST code off an error object, or '' when absent. */
function errCode(err: unknown): string {
  const e = err as { code?: unknown } | null | undefined
  return e?.code == null ? '' : String(e.code)
}

interface MovementRow {
  id: string
  blank_id: string
  delta: number
  reason: string
  note: string | null
}

interface RoyaltyRow {
  id: string
  user_id: string | null
  product_id: string | null
  itc_amount: number | null
  amount_cents: number | null
  status: string | null
  metadata: Record<string, unknown> | null
}

export interface StepResult {
  ok: boolean
  /** True when there was nothing to reverse, or it was already reversed. */
  skipped: boolean
  reason?: string
  details?: Record<string, any>
}

export interface ReversalReport {
  ok: boolean
  itcStoreCredit: StepResult
  inventory: StepResult
  creatorMargins: StepResult
  reversedAt: string
}

// Ledger `type` markers. itc_transactions.type is a free-text column live (no
// CHECK), so these are additive and safe; they double as the idempotency keys.
const ITC_CREDIT_REVERSAL_TYPE = 'purchase_payment_refund'
const ROYALTY_REVERSAL_TYPE = 'royalty_reversal'

// Marker written on the compensating inventory movement when the atomic
// reverse_blank_sale RPC is unavailable (migration not yet applied). Used both
// as the human-readable note and as this path's idempotency probe.
function refundMovementNote(orderId: string): string {
  return `Refund reversal for order ${orderId}`
}

/**
 * Re-credit the ITC store credit that was spent on this order.
 *
 * Guard: an existing itc_transactions row of type 'purchase_payment_refund'
 * for this order means the reversal already ran.
 */
export async function reverseItcStoreCredit(
  orderId: string,
  log?: Logger,
  db: RefundDb = realSupabase as unknown as RefundDb
): Promise<StepResult> {
  try {
    const { data: alreadyReversed, error: guardErr } = await db
      .from('itc_transactions')
      .select('id')
      .eq('type', ITC_CREDIT_REVERSAL_TYPE)
      .eq('reference', orderId)
      .maybeSingle()
    if (guardErr) {
      return { ok: false, skipped: false, reason: `guard query failed: ${errMessage(guardErr)}` }
    }
    if (alreadyReversed) {
      return { ok: true, skipped: true, reason: 'already reversed' }
    }

    // The spend row written by handleCheckoutOrderPayment. Its `amount` is
    // negative (a debit) — the refund credits back its absolute value.
    const { data: spend, error: spendErr } = await db
      .from('itc_transactions')
      .select('id, user_id, amount, metadata')
      .eq('type', 'purchase_payment')
      .eq('reference', orderId)
      .maybeSingle()
    if (spendErr) {
      return { ok: false, skipped: false, reason: `spend lookup failed: ${errMessage(spendErr)}` }
    }
    if (!spend) {
      return { ok: true, skipped: true, reason: 'no ITC store credit was applied to this order' }
    }

    const itcAmount = Math.abs(Number(spend.amount) || 0)
    if (itcAmount <= 0) {
      return { ok: true, skipped: true, reason: 'store-credit spend row has zero amount' }
    }
    const userId = spend.user_id
    if (!userId) {
      return { ok: false, skipped: false, reason: 'store-credit spend row has no user_id' }
    }

    const { data: wallet, error: walletErr } = await db
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()
    if (walletErr || !wallet) {
      return { ok: false, skipped: false, reason: `wallet not found for user ${userId}` }
    }

    // addBalance(): user_wallets.itc_balance is NUMERIC and arrives as a
    // string over the JS client — raw `+` would string-concatenate.
    const newBalance = addBalance(wallet.itc_balance, itcAmount)
    const { error: updateErr } = await db
      .from('user_wallets')
      .update({ itc_balance: newBalance, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
    if (updateErr) {
      return { ok: false, skipped: false, reason: `wallet credit failed: ${errMessage(updateErr)}` }
    }

    // Ledger row doubles as this step's idempotency marker — written AFTER the
    // balance moves, so a crash in between leaves the reversal re-runnable
    // (the wallet would be credited twice only if the crash happened between
    // these two statements, which the caller's audit report surfaces).
    const { error: ledgerErr } = await db.from('itc_transactions').insert({
      user_id: userId,
      type: ITC_CREDIT_REVERSAL_TYPE,
      amount: itcAmount,
      balance_after: newBalance,
      reference: orderId,
      metadata: {
        description: `Store credit returned — order ${orderId} refunded`,
        reversed_transaction_id: spend.id,
        usd_value: Number(spend.metadata?.usd_value) || 0
      },
      created_at: new Date().toISOString()
    })
    if (ledgerErr) {
      log?.error?.({ err: ledgerErr, orderId, userId }, '[order-refunds] ITC reversal ledger insert failed (wallet WAS credited)')
      return {
        ok: false,
        skipped: false,
        reason: 'wallet credited but ledger insert failed — reversal is NOT idempotency-protected',
        details: { userId, itcAmount, newBalance }
      }
    }

    log?.info?.({ orderId, userId, itcAmount, newBalance }, '[order-refunds] ITC store credit returned')
    return { ok: true, skipped: false, details: { userId, itcAmount, newBalance } }
  } catch (err: unknown) {
    return { ok: false, skipped: false, reason: `unexpected error: ${errMessage(err)}` }
  }
}

/**
 * Restock the blank-shirt inventory this order consumed.
 *
 * Preferred path is the atomic, idempotent reverse_blank_sale RPC added in
 * supabase/migrations/20260727_refunds_and_disputes.sql. Until that migration
 * is applied to a given database the RPC does not exist (PostgREST PGRST202 /
 * Postgres 42883), so this falls back to a read-modify-write guarded by a
 * marker movement row. The fallback is correct but not atomic against a
 * concurrent stock receipt — which is exactly why the RPC exists.
 */
export async function reverseBlankInventory(
  orderId: string,
  log?: Logger,
  db: RefundDb = realSupabase as unknown as RefundDb
): Promise<StepResult> {
  try {
    const { data: movements, error: movErr } = await db
      .from('blank_inventory_movements')
      .select('id, blank_id, delta, reason, note')
      .eq('order_id', orderId)
    if (movErr) {
      return { ok: false, skipped: false, reason: `movement lookup failed: ${errMessage(movErr)}` }
    }

    const rows = (movements || []) as MovementRow[]
    const sales = rows.filter(m => m.reason === 'sale')
    if (sales.length === 0) {
      return { ok: true, skipped: true, reason: 'no blank inventory was decremented for this order' }
    }

    const note = refundMovementNote(orderId)
    // Blanks already restocked, by either path: the RPC writes reason
    // 'refund'; the fallback writes reason 'adjustment' carrying the marker
    // note. Both are keyed per blank so a partially-completed run resumes.
    const alreadyDone = new Set<string>(
      rows
        .filter(m => m.reason === 'refund' || (m.reason === 'adjustment' && m.note === note))
        .map(m => String(m.blank_id))
    )

    const restocked: Array<{ blankId: string; qty: number; via: string }> = []
    const failures: Array<{ blankId: string; reason: string }> = []
    let rpcMissing = false

    for (const sale of sales) {
      const blankId = String(sale.blank_id)
      // Sale deltas are negative; restock the absolute quantity.
      const qty = Math.abs(Number(sale.delta) || 0)
      if (qty <= 0) continue
      if (alreadyDone.has(blankId)) continue

      if (!rpcMissing) {
        const { data: didReverse, error: rpcErr } = await db.rpc('reverse_blank_sale', {
          p_blank_id: blankId,
          p_order_id: orderId,
          p_qty: qty
        })
        if (!rpcErr) {
          if (didReverse) restocked.push({ blankId, qty, via: 'rpc' })
          continue
        }
        // 42883 = undefined_function (direct PG), PGRST202 = PostgREST could
        // not find the RPC in its schema cache. Anything else is a real error.
        const code = errCode(rpcErr)
        const message = errMessage(rpcErr)
        const missing = code === '42883' || code === 'PGRST202' || /could not find the function|does not exist/i.test(message)
        if (!missing) {
          failures.push({ blankId, reason: message || code })
          continue
        }
        rpcMissing = true
        log?.warn?.(
          { orderId },
          '[order-refunds] reverse_blank_sale RPC not found — falling back to non-atomic restock (apply supabase/migrations/20260727_refunds_and_disputes.sql)'
        )
      }

      // Fallback: read-modify-write + marker movement.
      const { data: blank, error: blankErr } = await db
        .from('blank_inventory')
        .select('qty_on_hand, cost_per_unit')
        .eq('id', blankId)
        .single()
      if (blankErr || !blank) {
        failures.push({ blankId, reason: `blank row not found: ${blankErr ? errMessage(blankErr) : 'missing'}` })
        continue
      }
      // Marker FIRST: if the qty update then fails, the next run sees the
      // marker and skips — under-restocking (visible in the ledger) beats
      // double-restocking (silent phantom stock).
      const { error: insertErr } = await db.from('blank_inventory_movements').insert({
        blank_id: blankId,
        delta: qty,
        reason: 'adjustment',
        order_id: orderId,
        unit_cost: blank.cost_per_unit ?? null,
        note
      })
      if (insertErr) {
        failures.push({ blankId, reason: `movement insert failed: ${errMessage(insertErr)}` })
        continue
      }
      const { error: qtyErr } = await db
        .from('blank_inventory')
        .update({ qty_on_hand: (Number(blank.qty_on_hand) || 0) + qty, updated_at: new Date().toISOString() })
        .eq('id', blankId)
      if (qtyErr) {
        failures.push({ blankId, reason: `qty update failed: ${errMessage(qtyErr)}` })
        continue
      }
      restocked.push({ blankId, qty, via: 'fallback' })
    }

    if (failures.length > 0) {
      log?.error?.({ orderId, failures }, '[order-refunds] blank inventory restock partially failed')
      return {
        ok: false,
        skipped: false,
        reason: `${failures.length} blank(s) could not be restocked`,
        details: { restocked, failures }
      }
    }
    if (restocked.length === 0) {
      return { ok: true, skipped: true, reason: 'inventory already restocked for this order' }
    }
    log?.info?.({ orderId, restocked }, '[order-refunds] blank inventory restocked')
    return { ok: true, skipped: false, details: { restocked } }
  } catch (err: unknown) {
    return { ok: false, skipped: false, reason: `unexpected error: ${errMessage(err)}` }
  }
}

/**
 * Claw back the creator margin / royalty accrued for this order.
 *
 * Guard: itc_transactions rows of type 'royalty_reversal' for this order carry
 * metadata.product_id, so a partially-completed run resumes per product.
 *
 * A creator who already cashed out can have a balance below what we need to
 * claw back. The wallet floors at 0 (matching every other ITC debit in this
 * codebase) and the shortfall is recorded on the reversal ledger row and in
 * the returned report as `shortfallItc`, so unrecovered creator debt is
 * visible rather than silently written off or turned into a negative balance.
 */
export async function reverseCreatorMargins(
  orderId: string,
  log?: Logger,
  db: RefundDb = realSupabase as unknown as RefundDb
): Promise<StepResult> {
  try {
    const { data: royalties, error: royaltyErr } = await db
      .from('user_product_royalties')
      .select('id, user_id, product_id, itc_amount, amount_cents, status, metadata')
      .eq('order_id', orderId)
    if (royaltyErr) {
      return { ok: false, skipped: false, reason: `royalty lookup failed: ${errMessage(royaltyErr)}` }
    }
    const rows = (royalties || []) as RoyaltyRow[]
    if (rows.length === 0) {
      return { ok: true, skipped: true, reason: 'no creator margin accrued for this order' }
    }

    const { data: priorReversals, error: priorErr } = await db
      .from('itc_transactions')
      .select('metadata')
      .eq('type', ROYALTY_REVERSAL_TYPE)
      .eq('reference', orderId)
    if (priorErr) {
      return { ok: false, skipped: false, reason: `reversal guard query failed: ${errMessage(priorErr)}` }
    }
    const alreadyReversed = new Set<string>(
      (priorReversals || []).map((t: { metadata?: Record<string, unknown> | null }) => String(t.metadata?.product_id ?? ''))
    )

    const reversed: Array<{ productId: string; creatorId: string | null; itcAmount: number; shortfallItc: number }> = []
    const failures: Array<{ productId: string; reason: string }> = []

    for (const royalty of rows) {
      const productId = String(royalty.product_id ?? '')
      if (alreadyReversed.has(productId)) continue
      // 'pending' means the accrual row exists but the wallet credit never
      // landed — nothing to debit, just mark the row.
      const wasCredited = royalty.status === 'credited'
      const itcAmount = Math.max(0, Number(royalty.itc_amount) || 0)
      const creatorId = royalty.user_id

      let debited = 0
      let shortfall = 0
      let newBalance: number | null = null

      if (wasCredited && itcAmount > 0 && creatorId) {
        const { data: wallet, error: walletErr } = await db
          .from('user_wallets')
          .select('itc_balance')
          .eq('user_id', creatorId)
          .single()
        if (walletErr || !wallet) {
          failures.push({ productId, reason: `creator wallet not found (${String(creatorId)})` })
          continue
        }
        const current = addBalance(wallet.itc_balance, 0)
        debited = Math.min(current, itcAmount)
        shortfall = itcAmount - debited
        newBalance = current - debited

        const { error: debitErr } = await db
          .from('user_wallets')
          .update({ itc_balance: newBalance, updated_at: new Date().toISOString() })
          .eq('user_id', creatorId)
        if (debitErr) {
          failures.push({ productId, reason: `wallet debit failed: ${errMessage(debitErr)}` })
          continue
        }

        const { error: ledgerErr } = await db.from('itc_transactions').insert({
          user_id: creatorId,
          type: ROYALTY_REVERSAL_TYPE,
          amount: -debited,
          balance_after: newBalance,
          reference: orderId,
          metadata: {
            product_id: productId,
            royalty_id: royalty.id,
            description: `Creator earnings reversed — order ${orderId} refunded`,
            accrued_itc: itcAmount,
            shortfall_itc: shortfall
          },
          created_at: new Date().toISOString()
        })
        if (ledgerErr) {
          failures.push({ productId, reason: `reversal ledger insert failed: ${errMessage(ledgerErr)}` })
          continue
        }
      }

      // Mark the accrual row. 'reversed' is added to the status CHECK by
      // supabase/migrations/20260727_refunds_and_disputes.sql; against a
      // database that hasn't applied it yet Postgres rejects the value with
      // 23514, so fall back to 'failed' + a metadata marker so the row is
      // never left claiming the creator was paid.
      const reversalMeta = {
        ...(royalty.metadata && typeof royalty.metadata === 'object' ? royalty.metadata : {}),
        refund_reversed_at: new Date().toISOString(),
        refund_reversed_itc: debited,
        refund_shortfall_itc: shortfall
      }
      const { error: statusErr } = await db
        .from('user_product_royalties')
        .update({ status: 'reversed', metadata: reversalMeta })
        .eq('id', royalty.id)
      if (statusErr) {
        const code = errCode(statusErr)
        if (code === '23514') {
          await db
            .from('user_product_royalties')
            .update({ status: 'failed', metadata: { ...reversalMeta, reversal_status: 'reversed' } })
            .eq('id', royalty.id)
        } else {
          log?.warn?.({ err: statusErr, orderId, royaltyId: royalty.id }, '[order-refunds] royalty status update failed (wallet WAS debited)')
        }
      }

      reversed.push({ productId, creatorId, itcAmount: debited, shortfallItc: shortfall })
    }

    if (failures.length > 0) {
      log?.error?.({ orderId, failures }, '[order-refunds] creator margin reversal partially failed')
      return { ok: false, skipped: false, reason: `${failures.length} creator accrual(s) could not be reversed`, details: { reversed, failures } }
    }
    if (reversed.length === 0) {
      return { ok: true, skipped: true, reason: 'creator margins already reversed for this order' }
    }
    const totalShortfall = reversed.reduce((s, r) => s + r.shortfallItc, 0)
    if (totalShortfall > 0) {
      log?.warn?.({ orderId, totalShortfall }, '[order-refunds] creator margin clawback short — creator balance was below the accrual')
    }
    log?.info?.({ orderId, reversed }, '[order-refunds] creator margins reversed')
    return { ok: true, skipped: false, details: { reversed, totalShortfallItc: totalShortfall } }
  } catch (err: unknown) {
    return { ok: false, skipped: false, reason: `unexpected error: ${errMessage(err)}` }
  }
}

/**
 * Run all three reversals for a fully-refunded order. Never throws.
 * Steps run sequentially so the report reads in a stable order and a wallet
 * write can't race its own ledger insert.
 */
export async function reverseOrderSideEffects(
  orderId: string,
  log?: Logger,
  db: RefundDb = realSupabase as unknown as RefundDb
): Promise<ReversalReport> {
  const itcStoreCredit = await reverseItcStoreCredit(orderId, log, db)
  const inventory = await reverseBlankInventory(orderId, log, db)
  const creatorMargins = await reverseCreatorMargins(orderId, log, db)

  const report: ReversalReport = {
    ok: itcStoreCredit.ok && inventory.ok && creatorMargins.ok,
    itcStoreCredit,
    inventory,
    creatorMargins,
    reversedAt: new Date().toISOString()
  }

  if (!report.ok) {
    log?.error?.({ orderId, report }, '[order-refunds] ⚠️ one or more side-effect reversals FAILED — manual follow-up required')
  } else {
    log?.info?.({ orderId }, '[order-refunds] ✅ all side effects reversed')
  }
  return report
}

/**
 * Persist the reversal outcome (and, when given, the refund record) onto
 * orders.metadata without clobbering unrelated keys, and drop an audit_logs
 * row. Fail-soft: bookkeeping must never break a refund that already settled.
 */
export async function recordRefundOnOrder(params: {
  orderId: string
  refund?: Record<string, any>
  report?: ReversalReport
  actorUserId?: string | null
  action?: string
  log?: Logger
  db?: RefundDb
}): Promise<void> {
  const { orderId, refund, report, actorUserId = null, action = 'order_refunded', log } = params
  const db: RefundDb = params.db ?? (realSupabase as unknown as RefundDb)
  try {
    const { data: order } = await db.from('orders').select('metadata').eq('id', orderId).single()
    const existing = order?.metadata && typeof order.metadata === 'object' ? order.metadata : {}
    const priorRefunds: Array<Record<string, unknown>> = Array.isArray(existing.refunds) ? existing.refunds : []

    // De-dupe by Stripe refund id: the admin endpoint records the refund it
    // created, then charge.refunded arrives describing the same one.
    const nextRefunds = refund
      ? priorRefunds.some(r => r?.stripe_refund_id && r.stripe_refund_id === refund.stripe_refund_id)
        ? priorRefunds
        : [...priorRefunds, refund]
      : priorRefunds

    const metadata: Record<string, any> = { ...existing, refunds: nextRefunds }
    if (report) metadata.refund_reversal = report

    const { error } = await db
      .from('orders')
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', orderId)
    if (error) log?.error?.({ err: error, orderId }, '[order-refunds] failed to persist refund metadata')
  } catch (err: unknown) {
    log?.error?.({ err, orderId }, '[order-refunds] failed to persist refund metadata')
  }

  try {
    await db.from('audit_logs').insert({
      user_id: actorUserId,
      action,
      entity: 'order',
      entity_id: orderId,
      changes: refund ?? null,
      metadata: report ?? null,
      created_at: new Date().toISOString()
    })
  } catch (err: unknown) {
    log?.error?.({ err, orderId }, '[order-refunds] failed to write refund audit log')
  }
}

/** Cents already refunded against this order, per orders.metadata.refunds. */
export function refundedCentsFromMetadata(metadata: any): number {
  const refunds = Array.isArray(metadata?.refunds) ? metadata.refunds : []
  return refunds.reduce((sum: number, r: { amount_cents?: unknown }) => sum + (Number(r?.amount_cents) || 0), 0)
}
