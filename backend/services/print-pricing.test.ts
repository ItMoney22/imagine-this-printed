import { describe, it, expect } from 'vitest'

import {
  DEFAULT_PRINT_PRICING,
  PLA_DENSITY_G_PER_CM3,
  estimatePrintMinutes,
  gramsForVolume,
  loadPrintPricingConfig,
  metricsBlockers,
  packagingCostUsd,
  priceFromMetrics,
  type PrintMetrics,
} from './print-pricing.js'

// ---------------------------------------------------------------------------
// Real print-factory output. These are VERBATIM copies of the metrics.json
// files the Blender fixtures emitted — they are the anchors the whole pricing
// model is calibrated against, so they must not be "rounded for readability".
//
//   qr_plaque      tools/print-factory/examples/metrics.json
//   candle_cradle  tools/print-factory/examples/candle_cradle_{S,M,L}.metrics.json
// ---------------------------------------------------------------------------
const QR_PLAQUE: PrintMetrics = {
  ok: true,
  fixture: 'qr_plaque',
  volume_mm3: 11787.735582273808,
  grams_est: 14.6,
  tri_count: 8348,
  non_manifold_edges: 0,
  manifold: true,
  bbox_mm: { x: 65.6, y: 65.6, z: 3.0 },
  fits_build_volume: true,
  warnings: [],
}

const CRADLE_S: PrintMetrics = {
  ok: true,
  fixture: 'candle_cradle',
  volume_mm3: 186751.71595781666,
  grams_est: 231.6,
  tri_count: 2040,
  non_manifold_edges: 0,
  manifold: true,
  bbox_mm: { x: 91.0, y: 91.0, z: 200.0 },
  fits_build_volume: true,
  warnings: [],
}

const CRADLE_M: PrintMetrics = {
  ok: true,
  fixture: 'candle_cradle',
  volume_mm3: 219410.3942097778,
  grams_est: 272.1,
  tri_count: 2040,
  non_manifold_edges: 0,
  manifold: true,
  bbox_mm: { x: 104.0, y: 104.0, z: 200.0 },
  fits_build_volume: true,
  warnings: [],
}

const CRADLE_L: PrintMetrics = {
  ok: true,
  fixture: 'candle_cradle',
  volume_mm3: 258676.13636062236,
  grams_est: 320.8,
  tri_count: 2040,
  non_manifold_edges: 0,
  manifold: true,
  bbox_mm: { x: 119.0, y: 119.0, z: 200.0 },
  fits_build_volume: true,
  warnings: [],
}

// ---------------------------------------------------------------------------
// The sanity anchors. If a change to the model breaks one of these, the model
// is wrong — not the test. A 14.6g plaque that prices at $45 is a bug that
// would only ever be caught by a human noticing it in the admin queue.
// ---------------------------------------------------------------------------
describe('priceFromMetrics — sanity anchors on real fixture output', () => {
  it('prices a 14.6g QR plaque in single-digit dollars', () => {
    const { priceUsd } = priceFromMetrics(QR_PLAQUE)
    expect(priceUsd).toBeGreaterThanOrEqual(1)
    expect(priceUsd).toBeLessThan(10)
  })

  it('keeps the QR plaque above the 3d-prints QA price band floor ($8)', () => {
    // services/presentation-qa.ts PRICE_BANDS['3d-prints'] = [8, 200]. A product
    // priced under $8 is auto-flagged by the presentation gate, so the pricing
    // floor and the QA floor are deliberately the same number.
    const { priceUsd } = priceFromMetrics(QR_PLAQUE)
    expect(priceUsd).toBeGreaterThanOrEqual(8)
  })

  it('prices a 272g candle cradle between $30 and $80', () => {
    const { priceUsd } = priceFromMetrics(CRADLE_M)
    expect(priceUsd).toBeGreaterThanOrEqual(30)
    expect(priceUsd).toBeLessThanOrEqual(80)
  })

  it('prices every candle cradle size between $30 and $80', () => {
    for (const m of [CRADLE_S, CRADLE_M, CRADLE_L]) {
      const { priceUsd } = priceFromMetrics(m)
      expect(priceUsd).toBeGreaterThanOrEqual(30)
      expect(priceUsd).toBeLessThanOrEqual(80)
    }
  })

  it('stays inside the 3d-prints QA price band [8, 200] for every fixture', () => {
    for (const m of [QR_PLAQUE, CRADLE_S, CRADLE_M, CRADLE_L]) {
      const { priceUsd } = priceFromMetrics(m)
      expect(priceUsd).toBeGreaterThanOrEqual(8)
      expect(priceUsd).toBeLessThanOrEqual(200)
    }
  })

  it('prices S < M < L — a bigger cradle is never cheaper', () => {
    const s = priceFromMetrics(CRADLE_S).priceUsd
    const m = priceFromMetrics(CRADLE_M).priceUsd
    const l = priceFromMetrics(CRADLE_L).priceUsd
    expect(s).toBeLessThan(m)
    expect(m).toBeLessThan(l)
  })

  it('prices the plaque far below the cradle — 18x the mass is not 1.2x the price', () => {
    expect(priceFromMetrics(CRADLE_M).priceUsd).toBeGreaterThan(
      priceFromMetrics(QR_PLAQUE).priceUsd * 4
    )
  })
})

describe('priceFromMetrics — breakdown', () => {
  it('sums the cost components exactly into costUsd', () => {
    const b = priceFromMetrics(CRADLE_M)
    const sum = b.filamentUsd + b.machineUsd + b.scrapUsd + b.labourUsd + b.packagingUsd
    expect(b.costUsd).toBeCloseTo(sum, 6)
  })

  it('applies the margin multiplier to the full cost', () => {
    // Both figures are reported rounded to whole cents, so the product of two
    // rounded numbers can differ from the rounded product by up to ~1c. Assert
    // to the cent, not to floating-point identity.
    const b = priceFromMetrics(CRADLE_M)
    expect(b.rawPriceUsd).toBeCloseTo(b.costUsd * b.marginMultiplier, 1)
  })

  it('charm-rounds every price to .99', () => {
    for (const m of [QR_PLAQUE, CRADLE_S, CRADLE_M, CRADLE_L]) {
      const { priceUsd } = priceFromMetrics(m)
      expect(Math.round((priceUsd % 1) * 100)).toBe(99)
    }
  })

  it('never charm-rounds a price DOWN below the raw price', () => {
    // Math.ceil(x) - 0.01 silently undercuts an exact-integer raw price
    // ($9.00 -> $8.99). Guard the boundary explicitly.
    const exactlyNine = priceFromMetrics(QR_PLAQUE, {
      ...DEFAULT_PRINT_PRICING,
      minPriceUsd: 9,
      marginMultiplier: 0.000001,
    })
    expect(exactlyNine.rawPriceUsd).toBeLessThan(9)
    expect(exactlyNine.priceUsd).toBeGreaterThanOrEqual(9)
  })

  it('reports the mass it actually charged for', () => {
    expect(priceFromMetrics(CRADLE_M).grams).toBeCloseTo(272.1, 4)
  })

  it('derives grams from volume when metrics carry no grams_est', () => {
    const noGrams = { ...CRADLE_M, grams_est: undefined as unknown as number }
    expect(priceFromMetrics(noGrams).grams).toBeCloseTo(gramsForVolume(CRADLE_M.volume_mm3), 4)
  })

  it('applies the minimum price floor to a near-zero model', () => {
    const speck: PrintMetrics = {
      ...QR_PLAQUE,
      volume_mm3: 50,
      grams_est: 0.06,
      bbox_mm: { x: 5, y: 5, z: 2 },
    }
    const b = priceFromMetrics(speck)
    expect(b.rawPriceUsd).toBeLessThan(DEFAULT_PRINT_PRICING.minPriceUsd)
    expect(b.floorApplied).toBe(true)
    expect(b.priceUsd).toBeGreaterThanOrEqual(DEFAULT_PRINT_PRICING.minPriceUsd)
  })

  it('does not claim the floor was applied on a normally-priced part', () => {
    expect(priceFromMetrics(CRADLE_M).floorApplied).toBe(false)
  })

  it('rejects negative volume rather than pricing an inverted mesh', () => {
    expect(() => priceFromMetrics({ ...QR_PLAQUE, volume_mm3: -1 })).toThrow(/volume/i)
  })
})

describe('estimatePrintMinutes', () => {
  it('is volume-bound for a bulky part', () => {
    // 219410mm3 / (5mm3/s * 60) = 731.4 min, + 3 min setup.
    expect(estimatePrintMinutes(CRADLE_M.volume_mm3, CRADLE_M.bbox_mm)).toBe(735)
  })

  it('is monotonic in volume', () => {
    const a = estimatePrintMinutes(100_000, { x: 50, y: 50, z: 50 })
    const b = estimatePrintMinutes(200_000, { x: 50, y: 50, z: 50 })
    expect(b).toBeGreaterThan(a)
  })

  it('applies a per-layer floor so a tall hollow shell is not priced as free time', () => {
    // A 300mm-tall part with almost no material: pure volume math says seconds.
    // Layer count (1500 layers at 0.2mm) says at least 200 minutes.
    const tallAndEmpty = estimatePrintMinutes(500, { x: 20, y: 20, z: 300 })
    const volumeOnly = 500 / (DEFAULT_PRINT_PRICING.effectiveFlowMm3PerS * 60)
    expect(tallAndEmpty).toBeGreaterThan(volumeOnly * 10)
    expect(tallAndEmpty).toBeGreaterThanOrEqual(200)
  })

  it('always charges at least the setup minutes', () => {
    expect(estimatePrintMinutes(1, { x: 1, y: 1, z: 0.2 })).toBeGreaterThanOrEqual(
      DEFAULT_PRINT_PRICING.setupMinutes
    )
  })

  it('rejects a zero-height bounding box', () => {
    expect(() => estimatePrintMinutes(1000, { x: 10, y: 10, z: 0 })).toThrow(/bounding box/i)
  })
})

describe('packagingCostUsd', () => {
  it('mails a 65mm plaque in the small envelope', () => {
    expect(packagingCostUsd({ x: 65.6, y: 65.6, z: 3 })).toBe(DEFAULT_PRINT_PRICING.packagingSmallUsd)
  })

  it('boxes a 200mm cradle in the medium box', () => {
    expect(packagingCostUsd({ x: 104, y: 104, z: 200 })).toBe(DEFAULT_PRINT_PRICING.packagingMediumUsd)
  })

  it('escalates to the large box past the medium threshold', () => {
    expect(packagingCostUsd({ x: 40, y: 40, z: 300 })).toBe(DEFAULT_PRINT_PRICING.packagingLargeUsd)
  })
})

describe('gramsForVolume', () => {
  it('matches the print-factory PLA density', () => {
    expect(gramsForVolume(1000)).toBeCloseTo(PLA_DENSITY_G_PER_CM3, 6)
  })

  it('agrees with the fixture grams_est to within rounding', () => {
    expect(gramsForVolume(CRADLE_M.volume_mm3)).toBeCloseTo(272.1, 1)
    expect(gramsForVolume(QR_PLAQUE.volume_mm3)).toBeCloseTo(14.6, 1)
  })
})

describe('loadPrintPricingConfig', () => {
  it('falls back to the documented defaults on an empty env', () => {
    expect(loadPrintPricingConfig({})).toEqual(DEFAULT_PRINT_PRICING)
  })

  it('lets ops move the filament price without a deploy', () => {
    const cfg = loadPrintPricingConfig({ PRINT_FILAMENT_USD_PER_KG: '40' })
    expect(cfg.filamentUsdPerKg).toBe(40)
    expect(priceFromMetrics(CRADLE_M, cfg).priceUsd).toBeGreaterThan(
      priceFromMetrics(CRADLE_M).priceUsd
    )
  })

  it('ignores junk env values rather than pricing at NaN', () => {
    const cfg = loadPrintPricingConfig({ PRINT_MARGIN_MULTIPLIER: 'cheap', PRINT_FILAMENT_USD_PER_KG: '-5' })
    expect(cfg.marginMultiplier).toBe(DEFAULT_PRINT_PRICING.marginMultiplier)
    expect(cfg.filamentUsdPerKg).toBe(DEFAULT_PRINT_PRICING.filamentUsdPerKg)
  })
})

// ---------------------------------------------------------------------------
// The publish gate. A model that failed its own print-factory checks must never
// become a sellable product — the whole point of emitting metrics.json is that
// something downstream reads it.
// ---------------------------------------------------------------------------
describe('metricsBlockers', () => {
  it('passes clean fixture output', () => {
    expect(metricsBlockers(QR_PLAQUE)).toEqual([])
    expect(metricsBlockers(CRADLE_M)).toEqual([])
  })

  it('blocks ok:false', () => {
    expect(metricsBlockers({ ...QR_PLAQUE, ok: false }).join(' ')).toMatch(/ok.*false/i)
  })

  it('blocks a non-manifold mesh', () => {
    expect(metricsBlockers({ ...QR_PLAQUE, manifold: false }).join(' ')).toMatch(/manifold/i)
  })

  it('blocks on ANY warning and repeats the warning text', () => {
    const reasons = metricsBlockers({ ...QR_PLAQUE, warnings: ['tip risk: height/base 2.9 > 2.5'] })
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.join(' ')).toContain('tip risk: height/base 2.9 > 2.5')
  })

  it('blocks a model that does not fit the build volume', () => {
    expect(metricsBlockers({ ...QR_PLAQUE, fits_build_volume: false }).join(' ')).toMatch(/build volume/i)
  })

  it('blocks a zero/degenerate mesh even if it claims ok', () => {
    const destroyed: PrintMetrics = {
      ...QR_PLAQUE,
      volume_mm3: 0,
      grams_est: 0,
      tri_count: 0,
      bbox_mm: { x: 0, y: 0, z: 0 },
    }
    expect(metricsBlockers(destroyed).length).toBeGreaterThan(0)
  })

  it('blocks a metrics file missing the fields pricing depends on', () => {
    expect(metricsBlockers({} as unknown as PrintMetrics).length).toBeGreaterThan(0)
    expect(metricsBlockers(null as unknown as PrintMetrics).length).toBeGreaterThan(0)
  })

  it('collects every reason instead of stopping at the first', () => {
    const reasons = metricsBlockers({ ...QR_PLAQUE, ok: false, manifold: false, warnings: ['thin wall'] })
    expect(reasons.length).toBeGreaterThanOrEqual(3)
  })
})
