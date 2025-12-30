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

// Local delivery settings
export const LOCAL_DELIVERY_FEE = 10.00
export const LOCAL_DELIVERY_RADIUS_MILES = 15
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

    // Check if address qualifies for local delivery (within 15 miles of warehouse)
    const isLocalDeliveryEligible = this.isWithinDeliveryRadius(toAddress)
    if (isLocalDeliveryEligible) {
      localRates.push({
        id: 'local-delivery',
        name: 'Local Delivery',
        provider: 'Direct',
        amount: LOCAL_DELIVERY_FEE,
        currency: 'USD',
        estimatedDays: 2,
        type: 'delivery',
        description: `Delivered within ${LOCAL_DELIVERY_RADIUS_MILES} mile radius of our warehouse`
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

  // Check if address is within local delivery radius
  private isWithinDeliveryRadius(address: ShippingAddress): boolean {
    // Simple check - if the address is in Georgia, we'll check the zip code
    // More sophisticated implementations would use actual distance calculation
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
      return false
    }

    const zip = address.zip?.substring(0, 5)
    return georgiaLocalZips.includes(zip || '')
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
