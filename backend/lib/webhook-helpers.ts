/**
 * Shared helpers for Stripe webhook handling (routes/stripe.ts POST /webhook).
 *
 * addBalance() fixes the "100 ITC + 500 becomes 100500" class of bug: Supabase
 * returns Postgres NUMERIC/DECIMAL columns (e.g. user_wallets.itc_balance) as
 * strings over its JS client, so `currentBalance + delta` silently string-
 * concatenates instead of adding when currentBalance hasn't been parsed.
 *
 * claimOnce() wraps the atomic "UPDATE ... WHERE <col> != <value> ... SELECT"
 * idempotency pattern already used for checkout orders (routes/stripe.ts,
 * handleCheckoutOrderPayment): a Stripe webhook redelivery re-runs the same
 * UPDATE, finds the row no longer matches the WHERE clause, and the caller
 * skips side effects (crediting a wallet, refunding ITC, etc.) instead of
 * applying them twice.
 */

/** Adds `delta` to a balance that may arrive as a string, number, null, or undefined. */
export function addBalance(current: unknown, delta: number): number {
  const currentNum = typeof current === 'number' ? current : parseFloat(String(current ?? '0'))
  return (Number.isFinite(currentNum) ? currentNum : 0) + delta
}

export interface ClaimOutcome<T> {
  /** True if this call's UPDATE matched a row — i.e. it won the claim and should proceed. */
  claimed: boolean
  /** The claimed row (first result), if any. */
  row: T | null
  error: unknown | null
}

/**
 * Awaits a Supabase `.update(...).eq(...).neq(...).select(...)` builder and
 * reports whether this invocation claimed the row. An empty result (no error,
 * zero rows) means an earlier delivery already claimed it — the row's guard
 * column no longer matches the `.neq()` filter.
 */
export async function claimOnce<T = { id: string }>(
  builder: PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<ClaimOutcome<T>> {
  const { data, error } = await builder
  if (error) return { claimed: false, row: null, error }
  if (!data || data.length === 0) return { claimed: false, row: null, error: null }
  return { claimed: true, row: data[0], error: null }
}
