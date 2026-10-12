/**
 * Idempotent ITC purchase credit for the Stripe payment_intent.succeeded webhook.
 *
 * claimOnce() (webhook-helpers.ts) is an UPDATE ... WHERE guard != value.
 * That works for invoices and cashouts because a row already exists to flip.
 * An ITC purchase has no such row — the ledger insert IS the first write — so
 * a SELECT-then-INSERT (the old handleITCPurchase check) lets two deliveries
 * both see "no row" and both credit the wallet.
 *
 * The reservation is claim_itc_purchase() (see
 * supabase/migrations/20260922183000_itc_purchase_claim_once.sql): one
 * transaction that locks the wallet, inserts the purchase row, and does
 * nothing when the payment-intent reference is already taken. claimOnce()
 * interprets that result so a duplicate takes the same early return as
 * invoice.paid / payout.failed: no throw, no second credit.
 */

import { addBalance, claimOnce } from './webhook-helpers.js'

export interface ItcPurchaseInput {
  userId: string
  paymentIntentId: string
  itcAmount: number
  /** Package price in USD. Stored on the ledger row; not used to compute ITC. */
  usdAmount: number
}

export interface ItcPurchaseResult {
  /** 'duplicate' means this delivery lost the claim. Caller returns 200 and stops. */
  outcome: 'credited' | 'duplicate'
  newBalance: number | null
  transactionId: string | null
}

interface RpcRow {
  claimed?: boolean
  new_balance?: number | string | null
  transaction_id?: string | null
}

export interface ItcPurchaseDb {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>
}

function firstRpcRow(data: unknown): RpcRow | null {
  if (Array.isArray(data)) {
    const row = data[0]
    return row && typeof row === 'object' ? (row as RpcRow) : null
  }
  if (data && typeof data === 'object') return data as RpcRow
  return null
}

/**
 * Claim `paymentIntentId` and credit `itcAmount` at most once.
 *
 * Throws when the claim itself fails (missing wallet, database error). The
 * webhook route turns that into 500 so Stripe retries. A lost race returns
 * `outcome: 'duplicate'` and does not throw — the winning delivery already
 * credited, and Stripe must get 200 for the redelivery.
 */
export async function creditItcPurchaseOnce(
  db: ItcPurchaseDb,
  input: ItcPurchaseInput
): Promise<ItcPurchaseResult> {
  const { userId, paymentIntentId, itcAmount, usdAmount } = input

  if (!userId || !paymentIntentId) {
    throw new Error('Missing required metadata')
  }
  if (!Number.isFinite(itcAmount) || itcAmount <= 0) {
    throw new Error('Invalid ITC purchase amount')
  }

  const usd = Number.isFinite(usdAmount) ? usdAmount : null
  const reason = usd === null
    ? `Purchased ${itcAmount} ITC`
    : `Purchased ${itcAmount} ITC for $${usd.toFixed(2)}`

  const rpc = await db.rpc('claim_itc_purchase', {
    p_user_id: userId,
    p_reference: paymentIntentId,
    p_amount: itcAmount,
    p_metadata: {
      usd_value: usd,
      reason,
      claim_state: 'credited'
    }
  })

  const row = firstRpcRow(rpc.data)
  const won = !rpc.error && row?.claimed === true && typeof row.transaction_id === 'string' && row.transaction_id.length > 0

  // Same decision table as invoice.paid: error → caller throws (Stripe retries),
  // empty → already claimed (return 200), one row → this delivery won.
  const claim = await claimOnce<{ id: string; new_balance: number | string | null }>(
    Promise.resolve({
      data: won ? [{ id: row!.transaction_id as string, new_balance: row!.new_balance ?? null }] : [],
      error: rpc.error ?? null
    })
  )

  if (claim.error) {
    throw Object.assign(new Error('Failed to claim ITC purchase'), { cause: claim.error })
  }
  if (!claim.claimed || !claim.row) {
    return { outcome: 'duplicate', newBalance: null, transactionId: null }
  }
  if (claim.row.new_balance === null || claim.row.new_balance === undefined) {
    throw new Error('Failed to claim ITC purchase')
  }

  return {
    outcome: 'credited',
    newBalance: addBalance(claim.row.new_balance, 0),
    transactionId: claim.row.id
  }
}
