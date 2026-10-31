// Who gets what from one vendor-storefront order (David 2026-10-26, Crystal's store).
//
//   * The seller's own product (she makes and ships it): ITP keeps fee_percent of the sale.
//   * An ITP product she resells (ITP makes and ships it): ITP keeps the cost David set for
//     her (itp_cost_cents, plus the plus-size upcharge on a shirt); she keeps the rest.
//   * Shipping (David 2026-10-26: "use ITP's same GoShippo flow ... ITP keeps its usual cut of shipping"): her items
//     and ITP's ship as two packages, each priced with a real Shippo rate at checkout plus ITP's usual 5% cut
//     (services/shippo.ts). Her package's shipping sits on her side of the split: it pays for the prepaid label she
//     prints from her store manager (bought on ITP's Shippo account, so the label money stays with ITP) and ITP's cut.
//     ITP's package's shipping sits on ITP's side: ITP's label plus the same cut. Neither is part of her payout: she
//     ships on the label instead of buying postage.
//
//   * Her discount code (David 2026-10-26: "whatever she does cuts at her own cost"): it comes
//     off the items, whole cart, before the split; never off shipping. ITP's share is worked out
//     on the full prices first and the discount never touches it, so it only lowers her share.
//     A code that would take the order under ITP's share is refused (DiscountTooDeepError).
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
  /** What the buyer pays to ship her package (when the order has her items). */
  ownShippingCents: number
  /** What the buyer pays to ship ITP's package (when the order has ITP items). */
  itpShippingCents: number
  /** The carrier's rate inside ownShippingCents: what her label costs. The rest is ITP's cut. Defaults to the charge. */
  ownLabelCents?: number
  /** The carrier's rate inside itpShippingCents. Defaults to the charge. */
  itpLabelCents?: number
}

/** Her code: percent off (amount 1..100) or dollars off (amount in cents), of the items. */
export type SplitDiscount = { kind: 'percent' | 'amount'; amount: number }

export type OrderSplit = {
  /** The items at full price. */
  subtotalCents: number
  /** What her code takes off the items (0 without one). */
  discountCents: number
  /** Her side: what her package's shipping charged, the label it pays for, and ITP's cut of it. */
  ownShippingCents: number
  ownLabelCents: number
  ownShippingCutCents: number
  /** ITP's side: the same for ITP's package. */
  itpShippingCents: number
  itpLabelCents: number
  itpShippingCutCents: number
  shippingCents: number
  /** What the buyer pays: items less the discount, plus shipping. */
  totalCents: number
  /** ITP's share: the application fee. Worked out on full prices, the same with or without a code. */
  itpShareCents: number
  /** What Stripe transfers to the seller. The discount comes out of this. */
  vendorShareCents: number
}

/** A code that would leave less than ITP's share to pay: the seller can only discount her own money. */
export class DiscountTooDeepError extends Error {
  constructor() {
    super('discount below ITP share')
    this.name = 'DiscountTooDeepError'
  }
}

/** How much a code takes off a cart's items: never more than the items, never off shipping. */
export function discountCentsFor(discount: SplitDiscount | null | undefined, subtotalCents: number): number {
  if (!discount || !(discount.amount > 0)) return 0
  const off = discount.kind === 'percent'
    ? Math.round((subtotalCents * Math.min(100, discount.amount)) / 100)
    : Math.round(discount.amount)
  return Math.max(0, Math.min(subtotalCents, off))
}

export function splitOrder(lines: SplitLine[], rules: SplitRules, discount?: SplitDiscount | null): OrderSplit {
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
  const labelOf = (charge: number, label: number | undefined) => Math.min(charge, Math.max(0, label ?? charge))
  const ownLabelCents = labelOf(ownShippingCents, rules.ownLabelCents)
  const itpLabelCents = labelOf(itpShippingCents, rules.itpLabelCents)
  // Both packages' shipping is ITP's to hold: ITP's Shippo account buys both labels (hers when she presses Print
  // label) and keeps its cut of each.
  itpShareCents += itpShippingCents + ownShippingCents
  const shippingCents = ownShippingCents + itpShippingCents
  // ITP's share is final above, on full prices. The discount only comes off what she keeps.
  const discountCents = discountCentsFor(discount, subtotalCents)
  const totalCents = subtotalCents - discountCents + shippingCents
  if (totalCents < itpShareCents) throw new DiscountTooDeepError()

  return {
    subtotalCents,
    discountCents,
    ownShippingCents,
    ownLabelCents,
    ownShippingCutCents: ownShippingCents - ownLabelCents,
    itpShippingCents,
    itpLabelCents,
    itpShippingCutCents: itpShippingCents - itpLabelCents,
    shippingCents,
    totalCents,
    itpShareCents,
    vendorShareCents: totalCents - itpShareCents,
  }
}
