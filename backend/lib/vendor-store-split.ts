// Who gets what from one vendor-storefront order (David 2026-10-26, Crystal's store).
//
//   * The seller's own product (she makes and ships it): ITP keeps fee_percent of the sale.
//   * An ITP product she resells (ITP makes and ships it): ITP keeps the cost David set for
//     her (itp_cost_cents, plus the plus-size upcharge on a shirt); she keeps the rest.
//   * Shipping: her flat rate goes to her when the order has her items, ITP's flat rate goes
//     to ITP when it has ITP items (two packages, two shipping charges).
//
// ITP's share becomes the Checkout's application_fee_amount on a destination charge, so
// Stripe pays the seller the remainder on its own. Stripe's processing fee on a destination
// charge comes out of ITP's balance, not hers. Dependency-free so the test imports it plainly.

export type SplitLineKind = 'own' | 'itp'

export type SplitLine = {
  kind: SplitLineKind
  /** What the buyer pays for one unit, in cents. */
  unitCents: number
  /** What ITP keeps for one unit of an ITP product (0 for her own products). */
  itpCostCents: number
  quantity: number
}

export type SplitRules = {
  feePercent: number
  ownShippingCents: number
  itpShippingCents: number
}

export type OrderSplit = {
  subtotalCents: number
  ownShippingCents: number
  itpShippingCents: number
  shippingCents: number
  totalCents: number
  /** ITP's share: the application fee. */
  itpShareCents: number
  /** What Stripe transfers to the seller. */
  vendorShareCents: number
}

export function splitOrder(lines: SplitLine[], rules: SplitRules): OrderSplit {
  if (!lines.length) throw new Error('empty order')
  const fee = Math.min(50, Math.max(0, Number(rules.feePercent) || 0)) / 100

  let subtotalCents = 0
  let itpShareCents = 0
  let hasOwn = false
  let hasItp = false
  for (const l of lines) {
    const q = Math.max(1, Math.floor(l.quantity))
    const lineCents = l.unitCents * q
    subtotalCents += lineCents
    if (l.kind === 'own') {
      hasOwn = true
      itpShareCents += Math.round(lineCents * fee)
    } else {
      hasItp = true
      if (l.unitCents < l.itpCostCents) throw new Error('price below ITP cost')
      itpShareCents += l.itpCostCents * q
    }
  }

  const ownShippingCents = hasOwn ? Math.max(0, rules.ownShippingCents) : 0
  const itpShippingCents = hasItp ? Math.max(0, rules.itpShippingCents) : 0
  itpShareCents += itpShippingCents
  const shippingCents = ownShippingCents + itpShippingCents
  const totalCents = subtotalCents + shippingCents

  return {
    subtotalCents,
    ownShippingCents,
    itpShippingCents,
    shippingCents,
    totalCents,
    itpShareCents,
    vendorShareCents: totalCents - itpShareCents,
  }
}
