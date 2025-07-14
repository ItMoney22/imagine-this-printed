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
}

export interface ShippingCalculation {
  rates: ShippingRate[]
  selectedRate?: ShippingRate
  freeShippingThreshold: number
  isFreeShipping: boolean
}

export class ShippingCalculator {
  private shippoApi: ShippoAPI
  private freeShippingThreshold = 50.00

  constructor() {
    this.shippoApi = new ShippoAPI()
  }

  async calculateShipping(
    items: any[],
    toAddress: ShippingAddress,
    fromAddress?: ShippingAddress
  ): Promise<ShippingCalculation> {
    const subtotal = items.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)
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

    try {
      const shipment = await this.shippoApi.createShipment(shipFrom, toAddress, [parcel])
      
      const rates: ShippingRate[] = shipment.rates.map((rate: any) => ({
        id: rate.object_id,
        name: rate.servicelevel.name,
        provider: rate.provider,
        amount: parseFloat(rate.amount),
        currency: rate.currency,
        estimatedDays: rate.estimated_days || 5
      }))

      // Sort by price (cheapest first)
      rates.sort((a, b) => a.amount - b.amount)

      // Select the cheapest rate by default
      const selectedRate = rates.length > 0 ? { ...rates[0], selected: true } : undefined
      if (selectedRate) {
        rates[0].selected = true
      }

      return {
        rates,
        selectedRate,
        freeShippingThreshold: this.freeShippingThreshold,
        isFreeShipping: false
      }
    } catch (error) {
      console.error('Shipping calculation error:', error)
      
      // Fallback to standard rates if API fails
      const fallbackRates: ShippingRate[] = [
        {
          id: 'standard',
          name: 'Standard',
          provider: 'USPS',
          amount: 9.99,
          currency: 'USD',
          estimatedDays: 5,
          selected: true
        },
        {
          id: 'express',
          name: 'Express',
          provider: 'FedEx',
          amount: 24.99,
          currency: 'USD',
          estimatedDays: 2
        }
      ]

      return {
        rates: fallbackRates,
        selectedRate: fallbackRates[0],
        freeShippingThreshold: this.freeShippingThreshold,
        isFreeShipping: false
      }
    }
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