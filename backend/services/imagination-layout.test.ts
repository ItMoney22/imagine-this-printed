// Tests for the DTF gang-sheet layout engine (Watchtower tasks f6c1b2a0 and
// a6f50dca): Smart Fill collision detection + coverage math, and Auto-Nest's
// unplaced-layer reporting, safe margin, and efficiency clamp.
//
// These bugs cost physical material — overlapping art on a real DTF sheet,
// a misquoted price from a wrong coverage number, or art printed into the
// trim zone — so every case here is a concrete numeric example, not just a
// shape check.

import { describe, it, expect } from 'vitest'
import { autoNest, smartFill } from './imagination-layout.js'

describe('smartFill collision detection', () => {
  it('does not place a duplicate on top of an existing layer at its real position', () => {
    // Sheet: 4in x 4in. One existing 1in x 1in layer sitting dead-center at
    // (1.5, 1.5)-(2.5, 2.5) — nowhere near the origin. Template to duplicate
    // is a second, tiny 0.5in x 0.5in layer near the top-left, so the grid
    // has room to try covering the center.
    const layers = [
      { id: 'center-design', width: 1, height: 1, position_x: 1.5, position_y: 1.5, rotation: 0 },
      { id: 'template-src', width: 0.5, height: 0.5, position_x: 0.1, position_y: 0.1, rotation: 0, isTemplateCandidate: true }
    ]
    const result = smartFill(4, 4, layers, 0.1)

    // Every grid cell smartFill decided to fill must NOT overlap the
    // existing center-design's real footprint (1.5-2.5 in both axes).
    for (const dup of result.duplicates) {
      const dupRight = dup.x + 0.5
      const dupBottom = dup.y + 0.5
      const overlapsCenter = !(dupRight <= 1.5 || dup.x >= 2.5 || dupBottom <= 1.5 || dup.y >= 2.5)
      expect(overlapsCenter).toBe(false)
    }
    // Sanity: it actually found somewhere to place at least one duplicate.
    expect(result.duplicates.length).toBeGreaterThan(0)
  })

  it('regression: previously treated every layer as anchored at the origin', () => {
    // A single existing layer far from the origin. With the OLD bug, the
    // collision check compared candidate cells against {0,0,width,height}
    // for this layer (i.e. treated it as sitting at the origin), so cells
    // actually covering the layer's real position were wrongly marked free.
    // Layer footprint: (1.5,1.5)-(2.5,2.5). Candidate cell 0: template placed
    // at (padding,padding) = (0.1,0.1), size 1x1 -> (0.1,0.1)-(1.1,1.1). That
    // one legitimately doesn't overlap. But the grid also reaches a cell at
    // roughly (1.6, 1.6) given itemWidth 1.2 (1 + 0.1*2) — col=1,row=1 ->
    // x = 0.1 + 1*1.2 = 1.3, y = 1.3 -> (1.3,1.3)-(2.3,2.3), which DOES
    // overlap (1.5,1.5)-(2.5,2.5). The fixed collision test must exclude it.
    const layers = [
      { id: 'existing', width: 1, height: 1, position_x: 1.5, position_y: 1.5, rotation: 0 }
    ]
    const result = smartFill(4, 4, layers, 0.1)

    const collidesWithExisting = result.duplicates.some(dup => {
      const right = dup.x + 1
      const bottom = dup.y + 1
      return !(right <= 1.5 || dup.x >= 2.5 || bottom <= 1.5 || dup.y >= 2.5)
    })
    expect(collidesWithExisting).toBe(false)
  })

  it('coverage reflects each existing layer\'s real area, not template-sized assumptions', () => {
    // Sheet 10in x 10in = 100 sq in. One existing layer is much bigger than
    // the template: 4in x 2in = 8 sq in, positioned so nothing else can be
    // packed around it easily. Template is the tiny second layer, 1in x 1in.
    const layers = [
      { id: 'big-hero', width: 4, height: 2, position_x: 0, position_y: 0, rotation: 0 },
      { id: 'small-template', width: 1, height: 1, position_x: 8.5, position_y: 8.5, rotation: 0 }
    ]
    const result = smartFill(10, 10, layers, 0.25)

    // Hand-computed: existingArea = (4*2) + (1*1) = 9 sq in. Old formula
    // would have used (layers.length + duplicates.length) * templateArea =
    // (2 + N) * 1 — for N=0 that's 2%, wildly undercounting the 8 sq in hero
    // layer. New formula must be >= 9% before any duplicates are even added.
    const existingOnlyPct = Math.round((9 / 100) * 100) // 9
    expect(result.coverage).toBeGreaterThanOrEqual(existingOnlyPct)
    expect(result.coverage).toBeLessThanOrEqual(100)
  })

  it('only duplicates a layer marked as a template candidate, but avoids ALL layers for collisions', () => {
    // Two layers on the sheet; only "selected" is a template candidate. The
    // non-candidate ("bystander") must still block placement over its space.
    const layers = [
      { id: 'selected', width: 0.5, height: 0.5, position_x: 3, position_y: 3, rotation: 0, isTemplateCandidate: true },
      { id: 'bystander', width: 1, height: 1, position_x: 0, position_y: 0, rotation: 0, isTemplateCandidate: false }
    ]
    const result = smartFill(4, 4, layers, 0.1)

    // Template must be the selected layer's size (0.5x0.5), not the smaller
    // math working out differently — every duplicate must be sourced from it.
    expect(result.duplicates.every(d => d.sourceId === 'selected')).toBe(true)
    // No duplicate may land inside the bystander's real 1x1 footprint at the origin.
    const hitsBystander = result.duplicates.some(dup => {
      const right = dup.x + 0.5
      const bottom = dup.y + 0.5
      return !(right <= 0 || dup.x >= 1 || bottom <= 0 || dup.y >= 1)
    })
    expect(hitsBystander).toBe(false)
  })
})

describe('autoNest unplaced layers', () => {
  it('returns a layer that cannot possibly fit in the unplaced list, not stacked at the origin', () => {
    // Sheet is 2in x 2in. One layer is 5in x 5in — cannot fit under any
    // rotation. It must come back in `unplaced`, and NOT appear in `positions`.
    const layers = [{ id: 'too-big', width: 5, height: 5 }]
    const result = autoNest(2, 2, layers, 0.1)

    expect(result.unplaced).toContain('too-big')
    expect(result.positions.find(p => p.id === 'too-big')).toBeUndefined()
  })

  it('leaves earlier-placed layers intact when a later layer cannot fit', () => {
    // Sheet 3in x 3in. First layer 1in x 1in fits easily. Second layer 10in x
    // 10in cannot fit at all.
    const layers = [
      { id: 'fits', width: 1, height: 1 },
      { id: 'too-big', width: 10, height: 10 }
    ]
    const result = autoNest(3, 3, layers, 0.1)

    expect(result.positions.find(p => p.id === 'fits')).toBeDefined()
    expect(result.unplaced).toEqual(['too-big'])
  })

  it('never places a layer inside the 0.25in safe margin, even with a smaller padding', () => {
    // Padding is deliberately smaller (0.05in) than the safe margin (0.25in).
    // Every placed layer's left/top edge must still be >= 0.25in from the
    // sheet edges, and its right/bottom edge must be <= sheetSize - 0.25in.
    const layers = [{ id: 'a', width: 1, height: 1 }]
    const result = autoNest(4, 4, layers, 0.05)

    const pos = result.positions.find(p => p.id === 'a')!
    expect(pos.x).toBeGreaterThanOrEqual(0.25)
    expect(pos.y).toBeGreaterThanOrEqual(0.25)
    const w = pos.rotation === 90 ? 1 : 1
    const h = pos.rotation === 90 ? 1 : 1
    expect(pos.x + w).toBeLessThanOrEqual(4 - 0.25 + 1e-9)
    expect(pos.y + h).toBeLessThanOrEqual(4 - 0.25 + 1e-9)
  })

  it('computes efficiency from a hand-computed value and never exceeds 100%', () => {
    // Sheet 10in x 10in = 100 sq in. Two 2in x 2in layers = 4 sq in each = 8
    // sq in placed. Hand-computed efficiency = round(8/100 * 100) = 8%.
    const layers = [
      { id: 'a', width: 2, height: 2 },
      { id: 'b', width: 2, height: 2 }
    ]
    const result = autoNest(10, 10, layers, 0.25)

    expect(result.unplaced).toEqual([])
    expect(result.efficiency).toBe(8)
    expect(result.efficiency).toBeLessThanOrEqual(100)
  })

  it('excludes unplaced layers from the efficiency calculation', () => {
    // Sheet 2in x 2in = 4 sq in. One layer fits (1x1 = 1 sq in); one 10x10
    // layer cannot. Efficiency must be based on the 1 sq in actually placed
    // (25%), not inflated by the unplaced layer's phantom 100 sq in.
    const layers = [
      { id: 'fits', width: 1, height: 1 },
      { id: 'too-big', width: 10, height: 10 }
    ]
    const result = autoNest(2, 2, layers, 0.1)

    expect(result.efficiency).toBe(25)
  })
})
