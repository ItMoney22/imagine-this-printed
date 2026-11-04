// Re-queue a fixed order line to the print bridge (task 4ef9db82, 2026-11-01).
//
// The bridge's GET /queue walks orders.paid_at after the factory's cursor, so
// a line fixed AFTER its order was pulled (an Etsy pet ornament held for a bad
// photo, then re-run by the team with --photo --apply) would never be sent
// again. A re-queue stamp on the line fixes that:
//
//   order_items.metadata.print_requeued_at = <ISO time>   (written by the fixer)
//
// GET /queue sends every paid order's stamped lines on every pull, whatever the
// cursor (and never moves the cursor for them), for REQUEUE_WINDOW_MS after the
// stamp. The factory's pull dedupes on (itpOrderId, lineItemId), so a line sent
// again is a no-op on its side; a fixed pet line has a new lineItemId (its own
// print-spec folder), so it lands as a new order in review, with its parts.
//
// Cleared by POST /status when the order reports a printing-or-later status: the
// stamp is moved to metadata.print_requeue_cleared, so the row keeps the story.
// The window is the backstop if no print status ever comes back.
//
// Stamp vs a pull-by-order route: the factory polls /queue every 5 minutes and
// already handles every line shape there; a stamp needs no change on the
// Watchtower side and no schema change (order_items.metadata is jsonb).

/** The field. Present (an ISO time) = waiting to be sent again. */
export const PRINT_REQUEUE_KEY = 'print_requeued_at'

/** How long a stamp keeps being sent with no print status back. */
export const REQUEUE_WINDOW_MS = 7 * 24 * 60 * 60_000

/** Customer statuses (POST /status) that mean the order is on, or past, the printer. */
export const REQUEUE_CLEAR_STATUSES: ReadonlySet<string> = new Set(['printing', 'insert_pause', 'ready_for_packing', 'shipped_soon'])

/** Oldest stamp still sent, as the ISO string the stamps are compared with. */
export function requeueCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - REQUEUE_WINDOW_MS).toISOString()
}

/** Is this line's metadata waiting to be sent again? */
export function isRequeuePending(meta: unknown, now: Date = new Date()): boolean {
  const at = (meta as Record<string, unknown> | null | undefined)?.[PRINT_REQUEUE_KEY]
  if (typeof at !== 'string') return false
  const t = Date.parse(at)
  return Number.isFinite(t) && t >= now.getTime() - REQUEUE_WINDOW_MS
}

/**
 * The order is printing: stop sending its stamped lines. Every stamped line on
 * the order is cleared (the bridge's status is per order, not per line). Returns
 * how many were cleared. Throws on a read or write error; callers treat it as
 * non-fatal.
 */
export async function clearPrintRequeue(
  db: { from: (table: string) => any },
  orderId: string,
  status: string,
  now: Date = new Date()
): Promise<number> {
  const { data: rows, error } = await db.from('order_items').select('id, metadata').eq('order_id', orderId)
  if (error) throw new Error(`order_items unreadable for order ${orderId}: ${error.message}`)
  let cleared = 0
  for (const row of rows || []) {
    const meta = (row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>
    if (typeof meta[PRINT_REQUEUE_KEY] !== 'string') continue
    const { [PRINT_REQUEUE_KEY]: requeuedAt, ...rest } = meta
    const next = { ...rest, print_requeue_cleared: { requeuedAt, clearedAt: now.toISOString(), status } }
    const { error: upErr } = await db.from('order_items').update({ metadata: next }).eq('id', row.id)
    if (upErr) throw new Error(`order_items update failed for row ${row.id}: ${upErr.message}`)
    cleared++
  }
  return cleared
}
