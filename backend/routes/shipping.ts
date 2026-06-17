import { Router } from 'express'
import type { Request, Response } from 'express'

const router = Router()

// Warehouse location for distance calculation
const WAREHOUSE_LOCATION = {
  address: '640 Goodyear Ave, Rockmart, GA 30153',
  lat: 34.0027,
  lng: -85.0450
}

// Local delivery tiers
const DELIVERY_TIERS = [
  { maxMiles: 10, fee: 10.00, label: 'Local Delivery (within 10 miles)' },
  { maxMiles: 20, fee: 15.00, label: 'Local Delivery (10-20 miles)' }
]

// Hidden handling markup applied on top of every carrier rate (kept per product
// decision 2026-06-15). Applied to *accurate*, real-weight rates now that the
// parcel weight is computed from the cart instead of being hardcoded to 1 lb.
const SHIPPING_MARKUP = 0.05

// Warehouse ship-from used when quoting carrier rates.
const WAREHOUSE_ADDRESS_FROM = {
  name: 'Imagine This Printed',
  street1: '640 Goodyear Ave',
  city: 'Rockmart',
  state: 'GA',
  zip: '30153',
  country: 'US',
  phone: '(770) 000-0000',
  email: 'shipping@imaginethisprinted.com'
}

interface DistanceResponse {
  eligible: boolean
  distanceMiles: number | null
  deliveryFee: number | null
  tierLabel: string | null
  error?: string
}

interface CarrierRate {
  id: string
  name: string
  provider: string
  amount: number
  currency: string
  estimatedDays: number
  type: 'shipping'
}

const round2 = (n: number) => Math.round(n * 100) / 100
const withMarkup = (base: number) => round2(base * (1 + SHIPPING_MARKUP))

/**
 * Weight-aware USPS + UPS estimates, used when SHIPPO_API_TOKEN is not set or
 * Shippo returns no usable rates. Far better than the old flat FedEx mock —
 * these scale with parcel weight and only ever surface USPS/UPS so the customer
 * sees the carriers they expect. Markup is baked in via withMarkup().
 */
function estimateCarrierRates(weightLb: number): CarrierRate[] {
  const w = Math.max(0.1, weightLb)
  return [
    { id: 'usps-ground-est', name: 'USPS Ground Advantage', provider: 'USPS', amount: withMarkup(6.49 + 0.55 * w), currency: 'USD', estimatedDays: 5, type: 'shipping' },
    { id: 'usps-priority-est', name: 'USPS Priority Mail', provider: 'USPS', amount: withMarkup(9.49 + 0.85 * w), currency: 'USD', estimatedDays: 3, type: 'shipping' },
    { id: 'ups-ground-est', name: 'UPS Ground', provider: 'UPS', amount: withMarkup(11.49 + 0.65 * w), currency: 'USD', estimatedDays: 5, type: 'shipping' },
    { id: 'ups-2day-est', name: 'UPS 2nd Day Air', provider: 'UPS', amount: withMarkup(19.99 + 1.2 * w), currency: 'USD', estimatedDays: 2, type: 'shipping' },
    { id: 'ups-nextday-est', name: 'UPS Next Day Air Saver', provider: 'UPS', amount: withMarkup(34.99 + 2.0 * w), currency: 'USD', estimatedDays: 1, type: 'shipping' }
  ]
}

/**
 * Calculate live carrier rates from the cart.
 *
 * POST /api/shipping/rates
 * Body: { addressTo: { street1/address1, city, state, zip, country }, items: [{ weight, quantity }], subtotal }
 *
 * Uses SHIPPO_API_TOKEN (server-side) to fetch live USPS + UPS rates with a
 * parcel weight computed from the actual cart. Falls back to weight-aware
 * USPS/UPS estimates when the token is missing or Shippo returns nothing.
 */
router.post('/rates', async (req: Request, res: Response) => {
  try {
    const { addressTo, items } = req.body || {}

    // Total parcel weight from the cart (default 0.5 lb/item to match the old
    // client behavior). This is the fix for "prices seem off": weight is no
    // longer pinned at 1 lb.
    const weightLb = Array.isArray(items)
      ? items.reduce((sum: number, it: any) => sum + ((Number(it?.weight) || 0.5) * (Number(it?.quantity) || 1)), 0)
      : 1

    const token = process.env.SHIPPO_API_TOKEN
    const destZip = addressTo?.zip || addressTo?.postal_code

    if (token && destZip) {
      try {
        const shipmentData = {
          address_from: WAREHOUSE_ADDRESS_FROM,
          address_to: {
            name: addressTo.name || 'Customer',
            street1: addressTo.street1 || addressTo.address1 || '',
            street2: addressTo.street2 || addressTo.address2 || '',
            city: addressTo.city || '',
            state: addressTo.state || '',
            zip: destZip,
            country: addressTo.country || 'US',
            phone: addressTo.phone || '',
            email: addressTo.email || ''
          },
          parcels: [{
            length: '10', width: '8', height: '4', distance_unit: 'in',
            weight: Math.max(0.1, weightLb).toFixed(2), mass_unit: 'lb'
          }],
          async: false
        }

        const shippoRes = await fetch('https://api.goshippo.com/shipments/', {
          method: 'POST',
          headers: {
            'Authorization': `ShippoToken ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(shipmentData)
        })

        if (shippoRes.ok) {
          const shipment = await shippoRes.json() as { rates?: any[] }
          const rates: CarrierRate[] = (shipment.rates || [])
            .filter((rate: any) => {
              const svc = rate?.servicelevel?.token?.toLowerCase() || ''
              const provider = rate?.provider?.toLowerCase() || ''
              return (provider === 'usps' && (svc.includes('priority') || svc.includes('express') || svc.includes('ground'))) ||
                     (provider === 'ups' && (svc.includes('ground') || svc.includes('2nd') || svc.includes('next') || svc.includes('saver')))
            })
            .map((rate: any) => ({
              id: rate.object_id,
              name: rate.servicelevel?.name || `${rate.provider} ${rate.servicelevel?.token || ''}`.trim(),
              provider: rate.provider,
              amount: withMarkup(parseFloat(rate.amount)),
              currency: rate.currency || 'USD',
              estimatedDays: rate.estimated_days || 5,
              type: 'shipping' as const
            }))

          if (rates.length > 0) {
            return res.json({ rates, source: 'shippo', weightLb: round2(weightLb) })
          }
          console.warn('[shipping] Shippo returned no USPS/UPS rates, using estimates')
        } else {
          console.error('[shipping] Shippo /shipments error:', shippoRes.status, shippoRes.statusText)
        }
      } catch (err) {
        console.error('[shipping] Shippo rate request failed, using estimates:', err)
      }
    } else if (!token) {
      console.warn('[shipping] SHIPPO_API_TOKEN not set — serving weight-aware estimates')
    }

    // Fallback: weight-aware USPS + UPS estimates
    return res.json({ rates: estimateCarrierRates(weightLb), source: 'estimate', weightLb: round2(weightLb) })
  } catch (error: any) {
    console.error('[shipping] /rates error:', error)
    return res.status(500).json({ rates: estimateCarrierRates(1), source: 'error', error: 'Failed to calculate rates' })
  }
})

/**
 * Calculate distance from customer address to warehouse using Google Maps Distance Matrix API
 *
 * POST /api/shipping/calculate-distance
 * Body: { address: string } - Full customer address
 *
 * Requires GOOGLE_MAPS_API_KEY environment variable
 */
router.post('/calculate-distance', async (req: Request, res: Response) => {
  try {
    const { address } = req.body

    if (!address) {
      return res.status(400).json({
        eligible: false,
        error: 'Address is required'
      })
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY
    if (!apiKey) {
      console.error('[shipping] GOOGLE_MAPS_API_KEY not configured')
      // Fallback to ZIP-based check if no API key
      return res.json({
        eligible: false,
        distanceMiles: null,
        deliveryFee: null,
        tierLabel: null,
        error: 'Distance calculation not available'
      })
    }

    // Call Google Maps Distance Matrix API
    const origin = encodeURIComponent(WAREHOUSE_LOCATION.address)
    const destination = encodeURIComponent(address)

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&units=imperial&key=${apiKey}`

    // Don't log the full destination address — it's PII (street + name + zip
    // can identify a household). Log just the destination ZIP for ops
    // visibility; full address is only sent to Google Maps over TLS.
    const destZip = address.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ?? '(no zip)'
    console.log('[shipping] Calculating distance from warehouse to ZIP', destZip)

    const response = await fetch(url)
    const data = await response.json() as {
      status: string
      error_message?: string
      rows?: Array<{
        elements?: Array<{
          status: string
          distance?: { value: number; text: string }
          duration?: { value: number; text: string }
        }>
      }>
    }

    if (data.status !== 'OK') {
      console.error('[shipping] Google Maps API error:', data.status, data.error_message)
      return res.json({
        eligible: false,
        distanceMiles: null,
        deliveryFee: null,
        tierLabel: null,
        error: `Google Maps API error: ${data.status}`
      })
    }

    const element = data.rows?.[0]?.elements?.[0]

    if (!element || element.status !== 'OK' || !element.distance) {
      console.error('[shipping] Could not calculate distance:', element?.status)
      return res.json({
        eligible: false,
        distanceMiles: null,
        deliveryFee: null,
        tierLabel: null,
        error: 'Could not calculate distance to address'
      })
    }

    // Distance is returned in meters, convert to miles
    const distanceMeters = element.distance.value
    const distanceMiles = distanceMeters / 1609.344 // meters to miles

    console.log('[shipping] Distance calculated:', distanceMiles.toFixed(2), 'miles')

    // Determine delivery tier
    let deliveryFee: number | null = null
    let tierLabel: string | null = null
    let eligible = false

    for (const tier of DELIVERY_TIERS) {
      if (distanceMiles <= tier.maxMiles) {
        eligible = true
        deliveryFee = tier.fee
        tierLabel = tier.label
        break
      }
    }

    const result: DistanceResponse = {
      eligible,
      distanceMiles: Math.round(distanceMiles * 10) / 10, // Round to 1 decimal
      deliveryFee,
      tierLabel
    }

    console.log('[shipping] Delivery result:', result)
    return res.json(result)

  } catch (error: any) {
    console.error('[shipping] Distance calculation error:', error)
    return res.status(500).json({
      eligible: false,
      distanceMiles: null,
      deliveryFee: null,
      tierLabel: null,
      error: 'Failed to calculate distance'
    })
  }
})

/**
 * Get delivery tiers configuration
 * GET /api/shipping/delivery-tiers
 */
router.get('/delivery-tiers', (req: Request, res: Response) => {
  res.json({
    warehouseAddress: WAREHOUSE_LOCATION.address,
    tiers: DELIVERY_TIERS
  })
})

export default router
