// backend/config/imagination-pricing.ts

import type { PrintType } from './imagination-presets';

export interface PrintTypePricing {
  base: number;          // Base cost
  usd: number;           // USD price (base + $1 markup)
  itc: number;           // ITC price (same as base, no markup)
}

export type PaymentMethod = 'usd' | 'itc';

/**
 * Imagination Station Pricing Table
 *
 * Logic:
 * - If payment method = USD → add $1 to base
 * - If payment method = ITC → use base price (no markup)
 */
export const IMAGINATION_PRICING: Record<PrintType, PrintTypePricing> = {
  dtf: {
    base: 14,
    usd: 15.00,
    itc: 14.00,
  },
  sublimation: {
    base: 8,
    usd: 9.00,
    itc: 8.00,
  },
  uv_dtf: {
    base: 12,
    usd: 13.00,
    itc: 12.00,
  },
};

/**
 * Get price for a print type based on payment method
 * @param printType - The print type (dtf, sublimation, uv_dtf)
 * @param paymentMethod - The payment method (usd or itc)
 * @returns The price for the given print type and payment method
 */
export function getPrintPrice(printType: PrintType, paymentMethod: PaymentMethod = 'usd'): number {
  const pricing = IMAGINATION_PRICING[printType];
  return paymentMethod === 'itc' ? pricing.itc : pricing.usd;
}

/**
 * Get both USD and ITC prices for a print type
 * @param printType - The print type (dtf, sublimation, uv_dtf)
 * @returns Object with both usd and itc prices
 */
export function getBothPrices(printType: PrintType): { usd: number; itc: number } {
  const pricing = IMAGINATION_PRICING[printType];
  return {
    usd: pricing.usd,
    itc: pricing.itc,
  };
}

/**
 * Calculate savings when using ITC vs USD
 * @param printType - The print type
 * @returns The savings amount ($1 for all types)
 */
export function getITCSavings(printType: PrintType): number {
  const pricing = IMAGINATION_PRICING[printType];
  return pricing.usd - pricing.itc;
}

/**
 * Validate that user has sufficient ITC balance for a purchase
 * @param printType - The print type
 * @param userBalance - User's current ITC balance
 * @returns True if user has enough ITC, false otherwise
 */
export function hasSufficientITC(printType: PrintType, userBalance: number): boolean {
  const pricing = IMAGINATION_PRICING[printType];
  return userBalance >= pricing.itc;
}
