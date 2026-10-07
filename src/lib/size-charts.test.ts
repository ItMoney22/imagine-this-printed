import { describe, expect, it } from 'vitest'
import { SIZE_CHARTS, chartRows, sizeChartFor } from './size-charts'
import { GARMENT_TIERS, HOODIE_TIERS } from './garment-tiers'

describe('size charts', () => {
  it('has a chart for every blank the product page sells', () => {
    for (const tier of [...GARMENT_TIERS, ...HOODIE_TIERS]) {
      expect(sizeChartFor(tier.compareTo), tier.compareTo).not.toBeNull()
    }
  })

  it('never confuses the youth 5000B with the adult 5000', () => {
    expect(sizeChartFor('Compared to Gildan 5000B')).toBe(SIZE_CHARTS['5000B'])
    expect(sizeChartFor('Compared to Gildan 5000')).toBe(SIZE_CHARTS['5000'])
  })

  it('keeps every column the same length', () => {
    for (const [style, c] of Object.entries(SIZE_CHARTS)) {
      expect(c.chest.length, style).toBe(c.sizes.length)
      expect(c.length.length, style).toBe(c.sizes.length)
    }
  })

  it('shows only the sizes a listing offers, in chart order', () => {
    const rows = chartRows(SIZE_CHARTS['5000'], ['XL', 's', 'M'])
    expect(rows.map((r) => r.size)).toEqual(['S', 'M', 'XL'])
    expect(rows[0]).toEqual({ size: 'S', chest: '18', length: '28' })
  })
})
