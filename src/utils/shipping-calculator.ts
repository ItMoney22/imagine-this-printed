import { ShippoAPI } from './shippo'
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

// Local delivery settings (tiered pricing)
export const LOCAL_DELIVERY_TIERS = [
  { maxMiles: 10, fee: 10.00, label: 'Local Delivery (within 10 miles)' },
  { maxMiles: 20, fee: 15.00, label: 'Local Delivery (10-20 miles)' }
]
export const MAX_DELIVERY_RADIUS_MILES = 20
export const PICKUP_HOURS = '10:00 AM - 8:00 PM'

// Shipping markup (5% hidden markup on shipping rates)
const SHIPPING_MARKUP = 0.05

export class ShippingCalculator {
  private shippoApi: ShippoAPI
  private freeShippingThreshold = 50.00

  constructor() {
    this.shippoApi = new ShippoAPI()
  }

  async calculateShipping(
    items: any[],
    toAddress: ShippingAddress,
    subtotal: number,
    fromAddress?: ShippingAddress
  ): Promise<ShippingCalculation> {
    // const subtotal = items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)
    const isFreeShipping = subtotal >= this.freeShippingThreshold

    if (isFreeShipping) {
      return {
        rates: [{
          id: 'free',
          name: 'Free Shipping',
          provider: 'Standard',
          amount: 0,
          currency: 'USD',
          estimatedDays: 5,
          selected: true
        }],
        selectedRate: {
          id: 'free',
          name: 'Free Shipping',
          provider: 'Standard',
          amount: 0,
          currency: 'USD',
          estimatedDays: 5,
          selected: true
        },
        freeShippingThreshold: this.freeShippingThreshold,
        isFreeShipping: true
      }
    }

    // Default business address (this should be configurable)
    const defaultFromAddress: ShippingAddress = {
      name: 'Imagine This Printed',
      address1: '123 Business Ave',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90210',
      country: 'US',
      phone: '(555) 123-4567',
      email: 'shipping@imaginethisprinted.com'
    }

    const shipFrom = fromAddress || defaultFromAddress

    // Calculate total weight and dimensions (simplified)
    const totalWeight = items.reduce((sum, item) => {
      const weight = item.product.weight || 0.5 // Default 0.5 lbs per item
      return sum + (weight * item.quantity)
    }, 0)

    // Default parcel dimensions (should be calculated based on items)
    const parcel = {
      length: '10',
      width: '8',
      height: '4',
      distance_unit: 'in',
      weight: totalWeight.toString(),
      mass_unit: 'lb'
    }

    // Build local options first
    const localRates: ShippingRate[] = []

    // Always add free local pickup option
    localRates.push({
      id: 'local-pickup',
      name: 'Free Local Pickup',
      provider: 'In-Store',
      amount: 0,
      currency: 'USD',
      estimatedDays: 1,
      type: 'pickup',
      description: `${WAREHOUSE_ADDRESS.address}, ${WAREHOUSE_ADDRESS.city}, ${WAREHOUSE_ADDRESS.state} ${WAREHOUSE_ADDRESS.zip} • Hours: ${PICKUP_HOURS}`
    })

    // Check if address qualifies for local delivery using distance calculation
    const deliveryInfo = await this.calculateLocalDelivery(toAddress)
    if (deliveryInfo.eligible && deliveryInfo.deliveryFee !== null) {
      localRates.push({
        id: 'local-delivery',
        name: deliveryInfo.tierLabel || 'Local Delivery',
        provider: 'Direct',
        amount: deliveryInfo.deliveryFee,
        currency: 'USD',
        estimatedDays: 2,
        type: 'delivery',
        description: deliveryInfo.distanceMiles
          ? `${deliveryInfo.distanceMiles.toFixed(1)} miles from our warehouse`
          : `Delivered within ${MAX_DELIVERY_RADIUS_MILES} mile radius of our warehouse`
      })
    }

    try {
      const shipment = await this.shippoApi.createShipment(shipFrom, toAddress, [parcel])

      // Filter for specific carriers and services we want
      const desiredServices = [
        'usps_priority', 'usps_priority_express', 'usps_ground_advantage',
        'ups_ground', 'ups_2nd_day_air', 'ups_2nd_day_air_am', 'ups_next_day_air_saver', 'ups_next_day_air'
      ]

      const rates: ShippingRate[] = shipment.rates
        .filter((rate: any) => {
          const serviceToken = rate.servicelevel?.token?.toLowerCase() || ''
          const provider = rate.provider?.toLowerCase() || ''
          // Include USPS Priority/Express and UPS 2nd Day/Saver/Air
          return (provider === 'usps' && (serviceToken.includes('priority') || serviceToken.includes('express') || serviceToken.includes('ground'))) ||
                 (provider === 'ups' && (serviceToken.includes('ground') || serviceToken.includes('2nd') || serviceToken.includes('next') || serviceToken.includes('saver')))
        })
        .map((rate: any) => {
          // Apply 5% markup (hidden from customer)
          const baseAmount = parseFloat(rate.amount)
          const markedUpAmount = Math.round((baseAmount * (1 + SHIPPING_MARKUP)) * 100) / 100

          return {
            id: rate.object_id,
            name: rate.servicelevel.name,
            provider: rate.provider,
            amount: markedUpAmount,
            currency: rate.currency,
            estimatedDays: rate.estimated_days || 5,
            type: 'shipping' as const
          }
        })

      // Combine local options with shipping rates
      const allRates = [...localRates, ...rates]

      // Sort by price (cheapest first)
      allRates.sort((a, b) => a.amount - b.amount)

      // Select the cheapest rate by default (should be free pickup)
      const selectedRate = allRates.length > 0 ? { ...allRates[0], selected: true } : undefined
      if (selectedRate) {
        allRates[0].selected = true
      }

      return {
        rates: allRates,
        selectedRate,
        freeShippingThreshold: this.freeShippingThreshold,
        isFreeShipping: false
      }
    } catch (error) {
      console.error('Shipping calculation error:', error)

      // Fallback to standard rates if API fails (still include local options)
      const fallbackRates: ShippingRate[] = [
        ...localRates,
        {
          id: 'standard',
          name: 'USPS Priority Mail',
          provider: 'USPS',
          amount: 9.99,
          currency: 'USD',
          estimatedDays: 3,
          type: 'shipping'
        },
        {
          id: 'express',
          name: 'USPS Priority Express',
          provider: 'USPS',
          amount: 24.99,
          currency: 'USD',
          estimatedDays: 2,
          type: 'shipping'
        },
        {
          id: 'ups-2day',
          name: 'UPS 2nd Day Air',
          provider: 'UPS',
          amount: 19.99,
          currency: 'USD',
          estimatedDays: 2,
          type: 'shipping'
        },
        {
          id: 'ups-saver',
          name: 'UPS Next Day Air Saver',
          provider: 'UPS',
          amount: 34.99,
          currency: 'USD',
          estimatedDays: 1,
          type: 'shipping'
        }
      ]

      // Sort by amount
      fallbackRates.sort((a, b) => a.amount - b.amount)
      fallbackRates[0].selected = true

      return {
        rates: fallbackRates,
        selectedRate: fallbackRates[0],
        freeShippingThreshold: this.freeShippingThreshold,
        isFreeShipping: false
      }
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
