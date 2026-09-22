// Parser tests for the supplier cost sync, run against a REAL slice of the
// live Jiffy PDP captured 2026-09-22 (__fixtures__/jiffy-g500-red.html).
//
// The point of pinning a real fixture rather than hand-written HTML: the whole
// feature rests on `data-amount` being the wholesale price. If Jiffy reshapes
// that markup, this test fails and the sync stops writing nonsense instead of
// quietly repricing the catalogue off zeros.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSizeGrid, parseColorNames } from './sync-jiffy-costs.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const html = fs.readFileSync(path.join(here, '__fixtures__', 'jiffy-g500-red.html'), 'utf-8')

describe('parseSizeGrid', () => {
  const grid = parseSizeGrid(html)

  it('reads the whole size band for the active colour', () => {
    expect(grid.map(g => g.size)).toEqual(['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'])
    expect(new Set(grid.map(g => g.color))).toEqual(new Set(['Red']))
    expect(new Set(grid.map(g => g.catalog))).toEqual(new Set(['G500']))
  })

  it('reads the wholesale amount, not the struck-through MSRP', () => {
    const by = Object.fromEntries(grid.map(g => [g.size, g.amount]))
    // These are David's signed-in account costs from blank-line.ts, to the
    // cent, off an anonymous page fetch — the fact that proves no login is
    // needed to sync.
    expect(by).toEqual({ S: 2.99, M: 2.99, L: 2.99, XL: 2.99, '2XL': 6.93, '3XL': 8.6, '4XL': 9.53, '5XL': 9.53 })
  })

  it('captures the MSRP separately so the two can never be confused', () => {
    const base = grid.find(g => g.size === 'S')!
    expect(base.list).toBe(5.72)
    expect(base.list).toBeGreaterThan(base.amount)
  })

  it('keeps the SKU so a cost row is traceable back to the mill', () => {
    expect(grid.find(g => g.size === 'M')!.sku).toBe('B11007524')
  })

  it('returns nothing for markup that carries no grid', () => {
    expect(parseSizeGrid('<html><body>no grid here</body></html>')).toEqual([])
  })
})

describe('parseColorNames', () => {
  it('lists the colours the mill offers', () => {
    const names = parseColorNames(html)
    expect(names.length).toBeGreaterThan(3)
    expect(names).toContain('Black')
  })
})
