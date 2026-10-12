// Garment size charts, one copy for the product details card (services/step-flow/details-card.ts) and the
// customer help page (src/lib/help-facts.ts). Moved here from details-card.ts, unchanged, task 5878a61f.
import type { GarmentId } from './catalog-capability.js'

export interface SizeChartRow { size: string; widthIn: number; lengthIn: number }

/**
 * Size charts, inches — the adult band followed by the youth band, matching
 * exactly what `sizesForGarment` lets a buyer order on that listing. Body
 * width = garment laid flat, measured pit to
 * pit (double for full chest circumference); body length = from the high
 * point of the shoulder to the hem.
 *
 * SOURCE: Gildan's published spec sheets for style 5000 (Heavy Cotton Tee),
 * style 18500 (Heavy Blend Hoodie) and style 5000B (Heavy Cotton Youth Tee) —
 * https://www.gildan.com, "size chart" tab per style. Values below are the
 * standard adult-unisex (and, for 5000B, youth) numbers from those sheets
 * (rounded to the nearest quarter inch), not a live fetch — update here if
 * Gildan revises a spec sheet.
 */
export const SIZE_CHARTS: Record<GarmentId, SizeChartRow[]> = {
  tshirt: [
    { size: 'S', widthIn: 18, lengthIn: 28 },
    { size: 'M', widthIn: 20, lengthIn: 29 },
    { size: 'L', widthIn: 22, lengthIn: 30 },
    { size: 'XL', widthIn: 24, lengthIn: 31 },
    { size: '2XL', widthIn: 26, lengthIn: 32 },
    { size: '3XL', widthIn: 28, lengthIn: 33 },
    // Gildan 5000B youth tee — sold on this same adult listing.
    { size: 'YXS', widthIn: 16, lengthIn: 20.5 },
    { size: 'YS', widthIn: 17, lengthIn: 22 },
    { size: 'YM', widthIn: 18, lengthIn: 23.5 },
    { size: 'YL', widthIn: 19, lengthIn: 25 },
    { size: 'YXL', widthIn: 20, lengthIn: 26.5 },
  ],
  hoodie: [
    { size: 'S', widthIn: 20, lengthIn: 27 },
    { size: 'M', widthIn: 22, lengthIn: 28 },
    { size: 'L', widthIn: 24, lengthIn: 29 },
    { size: 'XL', widthIn: 26, lengthIn: 30 },
    { size: '2XL', widthIn: 28, lengthIn: 31 },
    { size: '3XL', widthIn: 30, lengthIn: 32 },
    // Gildan 18500B youth hoodie — the same listing sells it (David
    // 2026-09-07), so the chart has to carry it or the card advertises sizes
    // it doesn't measure.
    { size: 'YXS', widthIn: 16, lengthIn: 20 },
    { size: 'YS', widthIn: 17, lengthIn: 22 },
    { size: 'YM', widthIn: 18, lengthIn: 23.5 },
    { size: 'YL', widthIn: 19, lengthIn: 25 },
    { size: 'YXL', widthIn: 20, lengthIn: 26.5 },
  ],
  // Gildan 5000B youth range. A youth listing's size table is the ONLY thing
  // on the card that tells a buyer this is a kids' shirt in numbers rather
  // than in a photograph, so it ships with the garment, not as an afterthought.
  'youth-tshirt': [
    { size: 'YXS', widthIn: 16, lengthIn: 20.5 },
    { size: 'YS', widthIn: 17, lengthIn: 22 },
    { size: 'YM', widthIn: 18, lengthIn: 23.5 },
    { size: 'YL', widthIn: 19, lengthIn: 25 },
    { size: 'YXL', widthIn: 20, lengthIn: 26.5 },
  ],
}
