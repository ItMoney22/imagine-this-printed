// Garment measurements for the product page's Size guide (task 63520e95, folded
// into the remodel b9656cc9). Every number is copied from the maker's spec sheet
// for the blank we print on (the "Compared to" style in backend/shared/blank-line.ts
// and src/lib/garment-tiers.ts), fetched 2026-10-07:
//   5000   https://www.blankstyle.com/files/specs/20774/SpecSheetMeasurements_5000.pdf
//   64000  https://www.blankstyle.com/files/specs/500/SpecSheetMeasurements_64000.pdf
//   3001   https://www.blankstyle.com/files/specs/492/SpecSheetMeasurements_BC3001.pdf
//   1717   https://www.blankstyle.com/files/specs/2549/SpecSheetMeasurements_1717.pdf
//   18500  https://www.blankstyle.com/files/specs/623/SpecSheetMeasurements_18500.pdf
//   5000B  https://www.pencarrie.com/catalogue/products/gd05b/specsheet (Gildan spec sheet)
// Chest = across the chest 1 inch below the armhole, laid flat. Length = high point
// of the shoulder to the hem at the back. Inches. Never type a number in by guess.

export interface SizeChart {
  sizes: string[]
  chest: string[]
  length: string[]
}

export const SIZE_CHARTS: Record<string, SizeChart> = {
  '5000': {
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    chest: ['18', '20', '22', '24', '26', '28', '30', '32'],
    length: ['28', '29', '30', '31', '32', '33', '34', '35'],
  },
  '64000': {
    sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    chest: ['16', '18', '20', '22', '24', '26', '28', '30', '32'],
    length: ['27', '28', '29', '30', '31', '32', '33', '34', '35'],
  },
  '3001': {
    sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    chest: ['16 1/2', '18', '20', '22', '24', '26', '28', '30', '32'],
    length: ['27', '28', '29', '30', '31', '32', '33', '34', '35'],
  },
  '1717': {
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    chest: ['18 1/4', '20 1/4', '22', '24', '26', '27 3/4', '29 3/4'],
    length: ['26 5/8', '28', '29 3/8', '30 3/4', '31 5/8', '32 1/2', '33 1/2'],
  },
  '18500': {
    sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    chest: ['18', '20', '22', '24', '26', '28', '30', '32', '34'],
    length: ['26', '27', '28', '29', '30', '31', '32', '33', '34'],
  },
  '5000B': {
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    chest: ['16', '17', '18', '19', '20'],
    length: ['20 1/2', '22', '23 1/2', '25', '26 1/2'],
  },
}

/** The chart for a "Compared to" style ('Compared to Gildan 5000' -> '5000'), or null if we hold none. */
export function sizeChartFor(compareTo: string | null | undefined): SizeChart | null {
  if (!compareTo) return null
  const style = Object.keys(SIZE_CHARTS)
    .sort((a, b) => b.length - a.length)
    .find((s) => new RegExp(`\\b${s}\\b`, 'i').test(compareTo))
  return style ? SIZE_CHARTS[style] : null
}

/** Keep only the sizes this listing sells, in the chart's order. */
export function chartRows(chart: SizeChart, offered?: string[]): { size: string; chest: string; length: string }[] {
  const keep = offered && offered.length ? new Set(offered.map((s) => s.toUpperCase())) : null
  return chart.sizes
    .map((size, i) => ({ size, chest: chart.chest[i], length: chart.length[i] }))
    .filter((r) => !keep || keep.has(r.size.toUpperCase()))
}
