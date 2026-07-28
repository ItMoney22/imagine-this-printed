// Tests for the Imagination Sheet DPI math (Watchtower task
// 89770a13-44ea-46f8-90c5-12f2ce47d393: recompute DPI from natural image
// dimensions, enforce on load/transform) and the print-type-minDPI grading
// this builds on (dr-dill's "drive DPI thresholds from print type's minDPI"
// work, unmerged at the time of writing — see handoff).
//
// These numbers gate whether a paying customer's design is allowed into a
// print order, so every threshold boundary is a concrete numeric example,
// not just a shape check.

import { describe, it, expect } from 'vitest'
import {
  calculateDpi,
  gradeDpi,
  getDpiThresholds,
  isBelowMinDpi,
  resolveDpiInfo,
  DEFAULT_MIN_DPI,
  type DpiInfo,
} from './dpi-calculator'

const PIXELS_PER_INCH = 96

describe('getDpiThresholds / gradeDpi — relative to print-type minDPI, not hardcoded 300/150/100', () => {
  it('DTF/UV-DTF/sublimation minDPI=300: good at/above 300, warning 150-299, danger below 150', () => {
    const t = getDpiThresholds(300)
    expect(t).toEqual({ minDPI: 300, goodAt: 300, warningAt: 150 })

    expect(gradeDpi(300, 300)).toBe('good')
    expect(gradeDpi(450, 300)).toBe('good')
    expect(gradeDpi(299, 300)).toBe('warning')
    expect(gradeDpi(150, 300)).toBe('warning')
    expect(gradeDpi(149, 300)).toBe('danger')
    expect(gradeDpi(0, 300)).toBe('danger')
  })

  it('a lower print-type minDPI shifts the grade for the exact same physical image', () => {
    // The same 200 DPI image is a hard "danger" against a 300 DPI minimum but
    // a comfortable "good" against a 150 DPI minimum — the grade must track
    // the print type's real requirement, never a fixed absolute number.
    expect(gradeDpi(200, 300)).toBe('warning')
    expect(gradeDpi(200, 150)).toBe('good')
  })

  it('falls back to DEFAULT_MIN_DPI (300) for a missing/invalid minDPI', () => {
    expect(getDpiThresholds(0).minDPI).toBe(DEFAULT_MIN_DPI)
    expect(getDpiThresholds(-5).minDPI).toBe(DEFAULT_MIN_DPI)
    expect(getDpiThresholds(NaN).minDPI).toBe(DEFAULT_MIN_DPI)
    expect(gradeDpi(150, 0)).toBe('warning') // graded against the 300 fallback
  })
})

describe('calculateDpi — the actual 22.5x60in DTF sheet math', () => {
  it('computes DPI from natural pixel dimensions vs. rendered canvas size, worst-of-both-axes', () => {
    // A 4in x 4in print area at 300 DPI needs a 1200x1200px source.
    const canvasPx = 4 * PIXELS_PER_INCH
    const info = calculateDpi(1200, 1200, canvasPx, canvasPx, 300)
    expect(info.dpi).toBe(300)
    expect(info.quality).toBe('good')
    expect(info.minDPI).toBe(300)
  })

  it('uses the LOWER of the two axis DPIs (worst case) when aspect ratios differ', () => {
    // 1200x600 source stretched to fill a 4in x 4in square: width axis hits
    // 300 DPI, height axis only hits 150 DPI (600px / 4in) — must report 150.
    const canvasPx = 4 * PIXELS_PER_INCH
    const info = calculateDpi(1200, 600, canvasPx, canvasPx, 300)
    expect(info.dpi).toBe(150)
    expect(info.quality).toBe('warning')
  })

  it('a 400px logo stretched to 20in reports a hard danger grade, not a stale "good"', () => {
    // This is the exact scenario from the audit: a small source image scaled
    // up large on the canvas must show a failing grade.
    const canvasPx = 20 * PIXELS_PER_INCH
    const info = calculateDpi(400, 400, canvasPx, canvasPx, 300)
    expect(info.dpi).toBeLessThan(150)
    expect(info.quality).toBe('danger')
  })
})

describe('isBelowMinDpi — undeterminable DPI must block, never silently pass', () => {
  it('blocks when dpiInfo is missing entirely (image failed to load / never graded)', () => {
    expect(isBelowMinDpi(undefined, 300)).toBe(true)
    expect(isBelowMinDpi(null, 300)).toBe(true)
  })

  it('does not block a genuinely good DPI', () => {
    const info: DpiInfo = { dpi: 300, quality: 'good', originalWidth: 1200, originalHeight: 1200, canvasSizeInches: { width: 4, height: 4 }, minDPI: 300 }
    expect(isBelowMinDpi(info, 300)).toBe(false)
  })

  it('blocks anything under the minDPI, including the old "warning" tier (no more confirm-through)', () => {
    const info: DpiInfo = { dpi: 200, quality: 'warning', originalWidth: 800, originalHeight: 800, canvasSizeInches: { width: 4, height: 4 }, minDPI: 300 }
    expect(isBelowMinDpi(info, 300)).toBe(true)
  })

  it('re-derives from the numeric dpi against the CURRENT minDPI, ignoring a stale stored quality tag', () => {
    // Old data graded under a hardcoded 150 threshold as "good" is still
    // below a 300 DPI print type's real minimum.
    const stale: DpiInfo = { dpi: 200, quality: 'good', originalWidth: 800, originalHeight: 800, canvasSizeInches: { width: 4, height: 4 } }
    expect(isBelowMinDpi(stale, 300)).toBe(true)
  })
})

describe('resolveDpiInfo — re-grades stored dpiInfo against the current minDPI', () => {
  it('corrects a quality tag computed under an old/different minDPI', () => {
    const stale: DpiInfo = { dpi: 200, quality: 'good', originalWidth: 800, originalHeight: 800, canvasSizeInches: { width: 4, height: 4 }, minDPI: 150 }
    const resolved = resolveDpiInfo(stale, 300)
    expect(resolved?.quality).toBe('warning')
    expect(resolved?.minDPI).toBe(300)
    expect(resolved?.dpi).toBe(200) // numeric dpi itself is untouched
  })

  it('returns the same object reference when nothing actually changed (avoids needless re-renders)', () => {
    const info: DpiInfo = { dpi: 300, quality: 'good', originalWidth: 1200, originalHeight: 1200, canvasSizeInches: { width: 4, height: 4 }, minDPI: 300 }
    expect(resolveDpiInfo(info, 300)).toBe(info)
  })

  it('passes through null/undefined unchanged', () => {
    expect(resolveDpiInfo(null, 300)).toBeNull()
    expect(resolveDpiInfo(undefined, 300)).toBeNull()
  })
})
