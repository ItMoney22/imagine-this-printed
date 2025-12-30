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

interface DistanceResponse {
  eligible: boolean
  distanceMiles: number | null
  deliveryFee: number | null
  tierLabel: string | null
  error?: string
}

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

    console.log('[shipping] Calculating distance from warehouse to:', address)

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
