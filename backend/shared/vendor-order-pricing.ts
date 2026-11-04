// What ITP is owed on an order a vendor site already took payment for
// (POST /api/storefront/orders, task d2e4d280: ZenTress Head Spa's merch).
//
// The vendor site charges the buyer on its own Stripe platform: a destination
// charge to the spa's connected account, with ITP's share as the application
// fee. ITP never sees the card. So the order arrives PAID, and the one number
// ITP has to trust is its own share. It re-prices every line here and refuses
// an order whose claimed share differs by a cent (the same rule as Merch
// Studio's expectedCostUsd at publish).
//
//   shirt     $10 blank + $5 back print + the plus-size upcharge (2XL/3XL $2.50,
//             catalog-capability.ts, the same rule the ITP store charges).
//             A spa buying its own shirts pays at least the $12 floor
//             (David's Darrell ruling, b011ec6e).
//   mug       $8.
//   qr-stand  $17.95, the client price (shared/qr-stand.ts).
//   fee       on a STORE line (the spa resells to its guests) ITP also keeps
//             STOREFRONT_CREATOR_FEE_PERCENT (3) of the retail line, the same
//             fee share a Merch Studio creator pays. Never on the stand: $17.95
//             is already ITP's price.
//   shipping  ITP ships, so the shipping the buyer paid is ITP's.
//
// Dependency-free apart from the two shared price modules, so tests import it plainly.
import { plusSizeUpchargeCents } from './catalog-capability.js'
import { QR_STAND } from './qr-stand.js'

export type VendorLineKind = 'shirt' | 'mug' | 'qr-stand'
export type VendorOrderType = 'store' | 'spa'

export interface VendorLine {
  kind: VendorLineKind
  quantity: number
  size?: string | null
  backPrint?: boolean
  /** What the buyer paid for one unit (store orders). */
  retailCents?: number | null
}

export interface VendorPricingRules {
  shirtBaseCents: number
  backPrintCents: number
  mugBaseCents: number
  shirtFloorCents: number
  feePercent: number
}

function centsFromEnv(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : fallback
}

export function vendorPricingRules(): VendorPricingRules {
  const fee = Number(process.env.STOREFRONT_CREATOR_FEE_PERCENT)
  return {
    // Same env names (and defaults) as routes/storefront.ts and Darrell's merch config.
    shirtBaseCents: centsFromEnv('STOREFRONT_BASE_COST_USD', 1000),
    backPrintCents: (() => {
      const v = Number(process.env.STOREFRONT_BACK_PRINT_UPCHARGE_USD)
      return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : 500
    })(),
    mugBaseCents: centsFromEnv('STOREFRONT_MUG_BASE_COST_USD', 800),
    shirtFloorCents: 1200,
    feePercent: Number.isFinite(fee) && fee >= 0 && fee <= 50 ? fee : 3,
  }
}

/** What ITP charges for one unit of a line, before any fee. */
export function itpUnitCents(line: VendorLine, type: VendorOrderType, rules: VendorPricingRules): number {
  if (line.kind === 'qr-stand') return QR_STAND.priceCents
  if (line.kind === 'mug') return rules.mugBaseCents
  const cost = rules.shirtBaseCents + (line.backPrint ? rules.backPrintCents : 0) + plusSizeUpchargeCents(line.size)
  return type === 'spa' ? Math.max(rules.shirtFloorCents, cost) : cost
}

/** ITP's fee on one store line: a percent of the retail line, never on the stand. */
export function itpFeeCents(line: VendorLine, type: VendorOrderType, rules: VendorPricingRules): number {
  if (type !== 'store' || line.kind === 'qr-stand') return 0
  const q = Math.max(1, Math.floor(line.quantity))
  return Math.round(((line.retailCents ?? 0) * q * rules.feePercent) / 100)
}

export interface PricedVendorLine {
  unitCents: number
  lineCents: number
  feeCents: number
}

export interface VendorOrderPricing {
  lines: PricedVendorLine[]
  /** ITP's price for the lines, without fee or shipping. */
  itemsCents: number
  feeCents: number
  shippingCents: number
  /** Everything ITP is owed: lines + fee + shipping. */
  itpShareCents: number
}

export class VendorPricingError extends Error {}

export function priceVendorOrder(
  lines: VendorLine[],
  type: VendorOrderType,
  shippingCents: number,
  rules: VendorPricingRules = vendorPricingRules()
): VendorOrderPricing {
  if (!lines.length) throw new VendorPricingError('no lines')
  const priced = lines.map((line) => {
    const q = Math.max(1, Math.floor(line.quantity))
    const unitCents = itpUnitCents(line, type, rules)
    if (type === 'store' && line.kind !== 'qr-stand') {
      const retail = Number(line.retailCents)
      if (!Number.isInteger(retail) || retail <= 0) throw new VendorPricingError('a store line needs its retail price')
      if (retail * q < unitCents * q + itpFeeCents(line, type, rules)) {
        throw new VendorPricingError('retail price below ITP cost')
      }
    }
    return { unitCents, lineCents: unitCents * q, feeCents: itpFeeCents(line, type, rules) }
  })
  const itemsCents = priced.reduce((s, l) => s + l.lineCents, 0)
  const feeCents = priced.reduce((s, l) => s + l.feeCents, 0)
  const ship = Math.max(0, Math.round(shippingCents) || 0)
  return { lines: priced, itemsCents, feeCents, shippingCents: ship, itpShareCents: itemsCents + feeCents + ship }
}
