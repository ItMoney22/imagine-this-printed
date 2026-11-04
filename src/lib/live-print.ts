// Live printer cam (Watchtower task 528180f9): the small rules the checkout box
// and the order pages share.

/**
 * Checkout "family can watch" box (task 55d6ae95, Nine's option A). OFF because no
 * family link exists yet: only the signed-in order owner can see the live view, and
 * the private link waits on card 0beb95db. Flip to true to bring the box back; the
 * plumbing (liveOptIn sent to the order, saved in order metadata) is untouched.
 * Turn it on only once a real private family link ships.
 */
export const FAMILY_WATCH_BOX_ENABLED = false

export const LIVE_OPT_IN_LABEL = 'Let my family watch my Mini-Me print live on a private link'

/** How often an open order page asks for the newest view. Watchtower pushes about every 45 s. */
export const LIVE_POLL_MS = 30_000

// A customer's own print rides the cart as `3d-print-<modelId>`
// (backend/routes/3d-models.ts POST /:id/order), and that is the line a Mini-Me
// is sold on. A shirt or a catalog toy never shows the box.
const OWN_PRINT_PREFIX = '3d-print-'

export function cartHasOwnPrint(items: { product?: { id?: unknown } | null }[]): boolean {
  return items.some(item => String(item.product?.id ?? '').startsWith(OWN_PRINT_PREFIX))
}

const PAST_THE_PRINTER = new Set(['shipped', 'delivered', 'cancelled', 'refunded'])

/** False once an order is past the printer: nothing new is coming, so one read is enough. */
export function orderMayStillPrint(status: string): boolean {
  return !PAST_THE_PRINTER.has(status)
}
