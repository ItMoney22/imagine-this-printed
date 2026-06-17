import type { ShippingAddress } from '../types'

export interface ShippingRate {
  id: string
  name: string
  provider: string
  amount: number
  currency: string
  estimatedDays: number
  selected?: boolean
  type?: 'shipping' | 'pickup' | 'delivery'
  description?: string
  disabled?: boolean
  disabledReason?: string
  // Pickup/delivery options can be upgraded to next-business-day for a flat fee.
  rushEligible?: boolean
}

export interface ShippingCalculation {
  rates: ShippingRate[]
  selectedRate?: ShippingRate
  freeShippingThreshold: number
  isFreeShipping: boolean
}

// Warehouse location for local pickup/delivery
export const WAREHOUSE_ADDRESS = {
  address: '640 Goodyear Ave',
  city: 'Rockmart',
  state: 'GA',
  zip: '30153',
  coordinates: { lat: 34.0027, lng: -85.0450 } // Approximate coordinates
}

// Local delivery settings (tiered pricing).
// NOTE: If these tiers change, also update the published prices in
// src/pages/ShippingPolicy.tsx (Section 2 table) — that page is a legal
// snapshot and intentionally hardcoded, not pulled from this constant.
export const LOCAL_DELIVERY_TIERS = [
  { maxMiles: 10, fee: 10.00, label: 'Local Delivery (within 10 miles)' },
  { maxMiles: 20, fee: 15.00, label: 'Local Delivery (10-20 miles)' }
]
export const MAX_DELIVERY_RADIUS_MILES = 20
// Warehouse is in Rockmart, GA — Eastern Time. Including the timezone so the
// pickup-hours copy doesn't lie to West Coast customers reading "8 PM".
export const PICKUP_HOURS = '10:00 AM - 8:00 PM ET'

// Standard turnaround for pickup AND local delivery (business days).
export const STANDARD_FULFILLMENT_DAYS = 3

// Rush upgrade: next-business-day pickup or delivery for a flat fee, only
// available when the order is placed before the cutoff in warehouse time.
export const RUSH_FEE = 7.99
export const RUSH_CUTOFF_HOUR = 14 // 2 PM
export const RUSH_TIMEZONE = 'America/New_York'

// Shipping markup (5% hidden markup on shipping rates). Carrier rates now come
// from the backend (/api/shipping/rates) with the markup already applied, so
// this constant is only used for the client-side fallback estimates below.
const SHIPPING_MARKUP = 0.05

/**
 * Current hour in the warehouse timezone (0-23), DST-aware. Used to decide
 * whether next-business-day rush is still available today.
 */
function warehouseHourNow(): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: RUSH_TIMEZONE,
      hour: 'numeric',
      hour12: false
    }).formatToParts(new Date())
    const hourPart = parts.find(p => p.type === 'hour')?.value
    // Intl can return "24" for midnight in hour12:false — normalize to 0.
    const hour = hourPart ? parseInt(hourPart, 10) % 24 : new Date().getHours()
    return Number.isNaN(hour) ? new Date().getHours() : hour
  } catch {
    return new Date().getHours()
  }
}

/** True when a next-business-day rush can still be promised for today's orders. */
export function isRushAvailable(): boolean {
  return warehouseHourNow() < RUSH_CUTOFF_HOUR
}

/** Customer-facing reason shown when rush is unavailable. */
export function getRushUnavailableReason(): string {
  return 'Order before 2 PM ET for next-business-day rush'
}

export class ShippingCalculator {
  private freeShippingThreshold = 50.00

  async calculateShipping(
    items: any[],
    toAddress: ShippingAddress,
    subtotal: number
  ): Promise<ShippingCalculation> {
    const isFreeShipping = subtotal >= this.freeShippingThreshold

    // Build local (pickup + delivery) options and fetch carrier rates in
    // parallel. Free shipping no longer short-circuits — the customer still
    // sees pickup, delivery, rush, and paid expedited upgrades; we just zero
    // out the cheapest standard carrier rate when they qualify.
    const localRates: ShippingRate[] = [
      {
        id: 'local-pickup',
        name: 'Free Local Pickup',
        provider: 'In-Store',
        amount: 0,
        currency: 'USD',
        estimatedDays: STANDARD_FULFILLMENT_DAYS,
        type: 'pickup',
        rushEligible: true,
        description: `${WAREHOUSE_ADDRESS.address}, ${WAREHOUSE_ADDRESS.city}, ${WAREHOUSE_ADDRESS.state} ${WAREHOUSE_ADDRESS.zip} • Hours: ${PICKUP_HOURS}`
      }
    ]

    const [deliveryInfo, carrierRates] = await Promise.all([
      this.calculateLocalDelivery(toAddress),
      this.fetchCarrierRates(items, toAddress)
    ])

    // Always show local delivery — but disable it if the address is too far.
    if (deliveryInfo.eligible && deliveryInfo.deliveryFee !== null) {
      localRates.push({
        id: 'local-delivery',
        name: deliveryInfo.tierLabel || 'Local Delivery',
        provider: 'Direct',
        amount: deliveryInfo.deliveryFee,
        currency: 'USD',
        estimatedDays: STANDARD_FULFILLMENT_DAYS,
        type: 'delivery',
        rushEligible: true,
        description: deliveryInfo.distanceMiles
          ? `${deliveryInfo.distanceMiles.toFixed(1)} miles from our warehouse`
          : `Delivered within ${MAX_DELIVERY_RADIUS_MILES} mile radius of our warehouse`
      })
    } else {
      const distanceText = deliveryInfo.distanceMiles
        ? `${deliveryInfo.distanceMiles.toFixed(0)} miles away`
        : 'outside our delivery area'
      localRates.push({
        id: 'local-delivery',
        name: 'Local Delivery',
        provider: 'Direct',
        amount: LOCAL_DELIVERY_TIERS[0].fee,
        currency: 'USD',
        estimatedDays: STANDARD_FULFILLMENT_DAYS,
        type: 'delivery',
        description: `Available within ${MAX_DELIVERY_RADIUS_MILES} miles of Rockmart, GA`,
        disabled: true,
        disabledReason: `Sorry, your address is ${distanceText}. Local delivery is only available within ${MAX_DELIVERY_RADIUS_MILES} miles of our warehouse.`
      })
    }

    const shippingRates = carrierRates ?? this.clientFallbackCarrierRates()
    return this.finalize(localRates, shippingRates, isFreeShipping)
  }

  /**
   * Fetch live USPS + UPS carrier rates from the backend, which holds the
   * Shippo token and computes the parcel weight from the cart. Returns null on
   * failure so the caller can use the client-side estimate fallback.
   */
  private async fetchCarrierRates(items: any[], toAddress: ShippingAddress): Promise<ShippingRate[] | null> {
    try {
      const apiBase = import.meta.env.VITE_API_BASE || ''
      const payload = {
        addressTo: {
          name: toAddress.name,
          street1: toAddress.address1,
          street2: toAddress.address2,
          city: toAddress.city,
          state: toAddress.state,
          zip: toAddress.zip,
          country: toAddress.country || 'US',
          email: toAddress.email
        },
        items: (items || []).map((it) => ({
          weight: it?.product?.weight ?? 0.5,
          quantity: it?.quantity ?? 1
        }))
      }

      const response = await fetch(`${apiBase}/api/shipping/rates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        console.warn('[shipping] /rates returned', response.status, '— using client fallback')
        return null
      }

      const data = await response.json() as { rates?: Array<Partial<ShippingRate>> }
      if (!Array.isArray(data?.rates) || data.rates.length === 0) return null

      return data.rates.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        provider: String(r.provider),
        amount: Number(r.amount),
        currency: r.currency || 'USD',
        estimatedDays: r.estimatedDays || 5,
        type: 'shipping' as const
      }))
    } catch (error) {
      console.error('[shipping] Failed to fetch carrier rates:', error)
      return null
    }
  }

  /**
   * Client-side estimate used only when the backend rate endpoint is
   * unreachable. Mirrors the backend estimate shape (USPS + UPS, markup baked
   * in) so the UI never falls back to FedEx-only mocks.
   */
  private clientFallbackCarrierRates(): ShippingRate[] {
    const markup = (base: number) => Math.round(base * (1 + SHIPPING_MARKUP) * 100) / 100
    return [
      { id: 'usps-ground', name: 'USPS Ground Advantage', provider: 'USPS', amount: markup(6.99), currency: 'USD', estimatedDays: 5, type: 'shipping' },
      { id: 'usps-priority', name: 'USPS Priority Mail', provider: 'USPS', amount: markup(9.99), currency: 'USD', estimatedDays: 3, type: 'shipping' },
      { id: 'ups-ground', name: 'UPS Ground', provider: 'UPS', amount: markup(11.99), currency: 'USD', estimatedDays: 5, type: 'shipping' },
      { id: 'ups-2day', name: 'UPS 2nd Day Air', provider: 'UPS', amount: markup(19.99), currency: 'USD', estimatedDays: 2, type: 'shipping' },
      { id: 'ups-saver', name: 'UPS Next Day Air Saver', provider: 'UPS', amount: markup(34.99), currency: 'USD', estimatedDays: 1, type: 'shipping' }
    ]
  }

  /**
   * Combine local + carrier rates, apply the free-shipping incentive (zero the
   * cheapest standard carrier rate), sort, and pick a sensible default.
   */
  private finalize(localRates: ShippingRate[], carrierRates: ShippingRate[], isFreeShipping: boolean): ShippingCalculation {
    const rates: ShippingRate[] = [...localRates, ...carrierRates]

    if (isFreeShipping) {
      // Make the cheapest standard ground option free instead of hiding all
      // the other choices. Customers keep pickup, delivery, rush, and the
      // ability to pay to upgrade to a faster carrier.
      const shippingRates = rates.filter(r => r.type === 'shipping' && !r.disabled)
      if (shippingRates.length > 0) {
        const cheapest = shippingRates.reduce((min, r) => (r.amount < min.amount ? r : min), shippingRates[0])
        cheapest.amount = 0
        cheapest.name = 'Free Standard Shipping'
        cheapest.estimatedDays = Math.max(cheapest.estimatedDays, 5)
      }
    }

    // Sort by price (cheapest first); disabled rates always sink to the bottom.
    rates.sort((a, b) => {
      if (a.disabled && !b.disabled) return 1
      if (!a.disabled && b.disabled) return -1
      return a.amount - b.amount
    })

    const firstEnabledIndex = rates.findIndex(r => !r.disabled)
    let selectedRate: ShippingRate | undefined
    if (firstEnabledIndex >= 0) {
      rates[firstEnabledIndex].selected = true
      selectedRate = rates[firstEnabledIndex]
    }

    return {
      rates,
      selectedRate,
      freeShippingThreshold: this.freeShippingThreshold,
      isFreeShipping
    }
  }

  // Calculate local delivery fee using Google Maps Distance Matrix API
  private async calculateLocalDelivery(address: ShippingAddress): Promise<{
    eligible: boolean
    distanceMiles: number | null
    deliveryFee: number | null
    tierLabel: string | null
  }> {
    try {
      // Build full address string
      const fullAddress = [
        address.address1,
        address.address2,
        address.city,
        address.state,
        address.zip,
        address.country || 'US'
      ].filter(Boolean).join(', ')

      // Call backend API for distance calculation
      const apiBase = import.meta.env.VITE_API_BASE || ''
      const response = await fetch(`${apiBase}/api/shipping/calculate-distance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: fullAddress })
      })

      if (!response.ok) {
        console.warn('[shipping] Distance API error, falling back to ZIP check')
        return this.fallbackZipCheck(address)
      }

      const data = await response.json()
      return {
        eligible: data.eligible,
        distanceMiles: data.distanceMiles,
        deliveryFee: data.deliveryFee,
        tierLabel: data.tierLabel
      }
    } catch (error) {
      console.warn('[shipping] Distance calculation failed, using fallback:', error)
      return this.fallbackZipCheck(address)
    }
  }

  // Fallback ZIP code check when Google Maps API is unavailable
  private fallbackZipCheck(address: ShippingAddress): {
    eligible: boolean
    distanceMiles: number | null
    deliveryFee: number | null
    tierLabel: string | null
  } {
    const georgiaLocalZips = [
      '30153', '30125', '30137', '30120', '30127', '30157', // Rockmart area
      '30132', '30141', '30139', '30103', '30104', '30145', // Nearby
      '30101', '30102', '30107', '30108', '30110', '30114', // Extended area
      '30116', '30117', '30118', '30119', '30121', '30122',
      '30126', '30129', '30133', '30134', '30135', '30140',
      '30142', '30143', '30144', '30147', '30149', '30150',
      '30152', '30154', '30156', '30161', '30165', '30168',
      '30171', '30173', '30178', '30179', '30180', '30182',
      '30184', '30187', '30188', '30189'
    ]

    if (address.state?.toUpperCase() !== 'GA') {
      return { eligible: false, distanceMiles: null, deliveryFee: null, tierLabel: null }
    }

    const zip = address.zip?.substring(0, 5)
    const isLocal = georgiaLocalZips.includes(zip || '')

    if (isLocal) {
      // Default to first tier when using fallback
      return {
        eligible: true,
        distanceMiles: null,
        deliveryFee: LOCAL_DELIVERY_TIERS[0].fee,
        tierLabel: 'Local Delivery'
      }
    }

    return { eligible: false, distanceMiles: null, deliveryFee: null, tierLabel: null }
  }

  calculateFreeShippingProgress(cartTotal: number): {
    amountNeeded: number
    percentage: number
    qualified: boolean
  } {
    const amountNeeded = Math.max(0, this.freeShippingThreshold - cartTotal)
    const percentage = Math.min(100, (cartTotal / this.freeShippingThreshold) * 100)
    const qualified = cartTotal >= this.freeShippingThreshold

    return {
      amountNeeded,
      percentage,
      qualified
    }
  }

  updateFreeShippingThreshold(newThreshold: number) {
    this.freeShippingThreshold = newThreshold
  }
}

export const shippingCalculator = new ShippingCalculator()
