/**
 * Print pricing — turn measured print-factory geometry into a retail price.
 *
 * Pure arithmetic. No Supabase, no GCS, no env read at import time: every
 * function takes its config explicitly so the numbers are testable and a price
 * can be recomputed offline from a metrics.json alone.
 *
 * WHY THIS EXISTS
 * ---------------
 * tools/print-factory emits `model.stl` + `metrics.json` (real measured volume,
 * mass, bbox, manifoldness). Until now nothing consumed those numbers, so a
 * finished mesh had no price and could not become a catalog product. Everything
 * 3D-printed on ITP was priced from a hand-typed tier table
 * (routes/3d-models.ts PRINT_PRICING.base_price = 25, services/tripo3d.ts
 * SIZE_TIERS.printPriceUsd 5.99/11.99/18.99/29.99) that has no idea how much
 * plastic the part actually uses.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠  PRINT TIME IS AN ESTIMATE, NOT A MEASUREMENT.  ⚠
 *
 *  metrics.json is produced by Blender. NOTHING HAS BEEN SLICED. There is no
 *  G-code, no real layer plan, no travel moves, no support material, no
 *  bridging or cooling slowdowns in these numbers.
 *
 *  `estimatePrintMinutes()` below is a two-term approximation and it is the
 *  single largest source of error in this whole module — on a big part it is
 *  ~60% of cost. It is deliberately exported on its own so that when the
 *  slicer step lands (print-factory Phase 3), the fix is to replace ONE
 *  function with `metrics.slicer.print_minutes` and nothing else changes.
 *
 *  Do not treat any price out of this file as a quote for a customer job
 *  until real slicer output is feeding it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// The metrics.json contract, as emitted by tools/print-factory (prep.py +
// printfactory/metrics.py). Optional fields are ones older fixtures may omit.
// ---------------------------------------------------------------------------
export interface BBoxMm {
  x: number
  y: number
  z: number
}

export interface PrintMetrics {
  /** Fixture-level verdict. false = the run itself failed. */
  ok: boolean
  /** Fixture name, e.g. 'qr_plaque' | 'candle_cradle'. */
  fixture?: string
  /** Fixture parameters, when the fixture is parametric. */
  params?: Record<string, unknown>
  /** Solid volume of the mesh in mm^3 — for a hollowed shell this is the shell. */
  volume_mm3: number
  /** Filament mass in grams, as computed by printfactory.metrics.grams_for_volume. */
  grams_est: number
  tri_count?: number
  non_manifold_edges?: number
  manifold: boolean
  bbox_mm: BBoxMm
  fits_build_volume?: boolean
  warnings: string[]
}

/**
 * PLA density, g/cm^3. Verbatim from
 * tools/print-factory/printfactory/metrics.py `PLA_DENSITY = 1.24`. Kept in
 * sync so a price recomputed here from volume matches the grams the fixture
 * itself reported.
 */
export const PLA_DENSITY_G_PER_CM3 = 1.24

export interface PrintPricingConfig {
  // -- material ------------------------------------------------------------
  /**
   * Filament cost, USD per kg. Default 20 — the going rate for a 1kg spool of
   * name-brand PLA (Bambu / Polymaker / Overture list $18-25 in 2026; cheap
   * generic runs ~$14). Override per-spool via PRINT_FILAMENT_USD_PER_KG when
   * a job runs on silk, matte, or CF-filled stock, which cost noticeably more.
   */
  filamentUsdPerKg: number

  // -- machine -------------------------------------------------------------
  /**
   * Printer cost, USD per print-hour. Default 1.10, built from:
   *   $0.45/hr  machine amortisation — a ~$1,600 printer + ~$700 of lifetime
   *             maintenance (hotends, plates, belts, boards) over ~5,000
   *             billable print-hours.
   *   $0.05/hr  electricity — ~350W average draw at ~$0.15/kWh.
   *   $0.60/hr  consumables + occupancy — nozzles, build plates, adhesive, and
   *             the fact that an occupied printer cannot take another job.
   * This is amortisation, not a shop rate — nobody stands next to the machine
   * while it runs. Human time is priced separately below.
   */
  machineUsdPerHour: number

  /**
   * Scrap / failure allowance, as a multiplier on (material + machine).
   * Default 1.08 = an 8% failure rate. A failed print burns both the plastic
   * and the machine hours, so it is applied to those two only — a warped part
   * never reaches packing, so it never consumes labour or a box.
   */
  scrapAllowance: number

  // -- human ---------------------------------------------------------------
  /**
   * Hands-on shop rate, USD per hour. Default 18 — loaded cost of the person
   * pulling parts and packing boxes, not a designer/engineer rate.
   */
  labourUsdPerHour: number

  /**
   * Hands-on minutes per finished job. Default 6: plate removal, brim/support
   * cleanup, a quick QC look, bag and box. FLAT per job, not per gram — pulling
   * a 300g cradle off the plate takes about as long as pulling a 15g plaque.
   * Multi-part assemblies and embedded-insert jobs (see the `insert_pause`
   * workflow in routes/print-bridge.ts) cost more and should override this.
   */
  labourMinutesPerJob: number

  // -- packaging -----------------------------------------------------------
  /** Padded mailer + bubble wrap for a small part. */
  packagingSmallUsd: number
  /** Small corrugated box + void fill. */
  packagingMediumUsd: number
  /** Large corrugated box + void fill. */
  packagingLargeUsd: number
  /** Longest bbox dimension (mm) that still ships in a mailer. */
  packagingSmallMaxMm: number
  /** Longest bbox dimension (mm) that still ships in a small box. */
  packagingMediumMaxMm: number

  // -- price ---------------------------------------------------------------
  /**
   * Retail multiplier on total cost. Default 2.5 — mid-range for a print
   * service (2x is bare survival, 3x is boutique). It has to absorb payment
   * processing (~3%), platform/marketplace fees, returns, and the design time
   * that produced the fixture in the first place, none of which are line items
   * above.
   */
  marginMultiplier: number

  /**
   * Price floor, USD. Default 8.00 — deliberately the same number as the low
   * end of PRICE_BANDS['3d-prints'] = [8, 200] in services/presentation-qa.ts,
   * so a product priced by this module never trips its own QA gate. Below this
   * the shipping, payment fees, and handling eat the entire order anyway.
   */
  minPriceUsd: number

  // -- print time estimate (see the loud warning at the top of this file) ---
  /**
   * Effective volumetric throughput, mm^3/s, AVERAGED OVER A WHOLE JOB.
   * Default 5.0. A 0.4mm nozzle can peak near 12-25 mm^3/s on a modern
   * high-flow hotend, but a real job spends most of its time on perimeters,
   * travel, acceleration, and cooling waits. 5 mm^3/s is the honest job
   * average, not the headline flow rate.
   */
  effectiveFlowMm3PerS: number

  /** Layer height, mm. Default 0.2 — the standard quality profile. */
  layerHeightMm: number

  /**
   * Floor on seconds per layer. Default 8. Without this, a tall thin-walled
   * shell (exactly what a candle cradle is) prices as almost free time, because
   * volume math alone ignores that the nozzle must still visit every one of its
   * ~1,000 layers. This term is what makes the estimate height-aware.
   */
  minSecondsPerLayer: number

  /** Fixed per-job overhead, minutes: heat-up, bed level, purge, cool-down. */
  setupMinutes: number
}

export const DEFAULT_PRINT_PRICING: PrintPricingConfig = {
  filamentUsdPerKg: 20,
  machineUsdPerHour: 1.1,
  scrapAllowance: 1.08,
  labourUsdPerHour: 18,
  labourMinutesPerJob: 6,
  packagingSmallUsd: 0.75,
  packagingMediumUsd: 2.5,
  packagingLargeUsd: 4.5,
  packagingSmallMaxMm: 100,
  packagingMediumMaxMm: 250,
  marginMultiplier: 2.5,
  minPriceUsd: 8,
  effectiveFlowMm3PerS: 5,
  layerHeightMm: 0.2,
  minSecondsPerLayer: 8,
  setupMinutes: 3,
}

/**
 * Every knob is env-overridable so a filament price change or a margin change
 * is an env edit, not a deploy — same principle as the QA price bands in
 * services/presentation-qa.ts. Junk and non-positive values fall back to the
 * default rather than poisoning the arithmetic with NaN or a negative price.
 */
export function loadPrintPricingConfig(
  env: Record<string, string | undefined> = process.env
): PrintPricingConfig {
  const num = (key: string, fallback: number): number => {
    const raw = env[key]
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  return {
    filamentUsdPerKg: num('PRINT_FILAMENT_USD_PER_KG', DEFAULT_PRINT_PRICING.filamentUsdPerKg),
    machineUsdPerHour: num('PRINT_MACHINE_USD_PER_HOUR', DEFAULT_PRINT_PRICING.machineUsdPerHour),
    scrapAllowance: num('PRINT_SCRAP_ALLOWANCE', DEFAULT_PRINT_PRICING.scrapAllowance),
    labourUsdPerHour: num('PRINT_LABOUR_USD_PER_HOUR', DEFAULT_PRINT_PRICING.labourUsdPerHour),
    labourMinutesPerJob: num('PRINT_LABOUR_MINUTES_PER_JOB', DEFAULT_PRINT_PRICING.labourMinutesPerJob),
    packagingSmallUsd: num('PRINT_PACKAGING_SMALL_USD', DEFAULT_PRINT_PRICING.packagingSmallUsd),
    packagingMediumUsd: num('PRINT_PACKAGING_MEDIUM_USD', DEFAULT_PRINT_PRICING.packagingMediumUsd),
    packagingLargeUsd: num('PRINT_PACKAGING_LARGE_USD', DEFAULT_PRINT_PRICING.packagingLargeUsd),
    packagingSmallMaxMm: num('PRINT_PACKAGING_SMALL_MAX_MM', DEFAULT_PRINT_PRICING.packagingSmallMaxMm),
    packagingMediumMaxMm: num('PRINT_PACKAGING_MEDIUM_MAX_MM', DEFAULT_PRINT_PRICING.packagingMediumMaxMm),
    marginMultiplier: num('PRINT_MARGIN_MULTIPLIER', DEFAULT_PRINT_PRICING.marginMultiplier),
    minPriceUsd: num('PRINT_MIN_PRICE_USD', DEFAULT_PRINT_PRICING.minPriceUsd),
    effectiveFlowMm3PerS: num('PRINT_EFFECTIVE_FLOW_MM3_PER_S', DEFAULT_PRINT_PRICING.effectiveFlowMm3PerS),
    layerHeightMm: num('PRINT_LAYER_HEIGHT_MM', DEFAULT_PRINT_PRICING.layerHeightMm),
    minSecondsPerLayer: num('PRINT_MIN_SECONDS_PER_LAYER', DEFAULT_PRINT_PRICING.minSecondsPerLayer),
    setupMinutes: num('PRINT_SETUP_MINUTES', DEFAULT_PRINT_PRICING.setupMinutes),
  }
}

/** Filament mass for a solid volume — mirrors printfactory.metrics.grams_for_volume. */
export function gramsForVolume(volumeMm3: number, density = PLA_DENSITY_G_PER_CM3): number {
  if (!Number.isFinite(volumeMm3) || volumeMm3 < 0) {
    throw new Error(`negative or non-finite volume ${volumeMm3}: mesh normals are inverted`)
  }
  return (volumeMm3 / 1000) * density
}

/**
 * ESTIMATED print time in whole minutes. SWAP THIS OUT for real slicer output.
 *
 * Two terms, take the larger, then add setup:
 *
 *   volume-bound  = volume_mm3 / (effectiveFlow * 60)
 *                   How long it takes to extrude the plastic. Dominates chunky,
 *                   solid parts.
 *   height-bound  = ceil(z / layerHeight) * minSecondsPerLayer / 60
 *                   How long it takes to visit every layer. Dominates tall,
 *                   thin-walled parts — a 200mm candle cradle at 2.4mm walls is
 *                   1,000 layers of mostly air.
 *
 * A real slicer would blend these continuously. max() is the crude version, and
 * it is crude in the safe direction: it never underestimates either bound.
 */
export function estimatePrintMinutes(
  volumeMm3: number,
  bboxMm: BBoxMm,
  config: PrintPricingConfig = DEFAULT_PRINT_PRICING
): number {
  if (!Number.isFinite(volumeMm3) || volumeMm3 < 0) {
    throw new Error(`negative or non-finite volume ${volumeMm3}: mesh normals are inverted`)
  }
  if (!bboxMm || !Number.isFinite(bboxMm.z) || bboxMm.z <= 0) {
    throw new Error('bounding box has a zero or non-finite height — this is not a printable solid')
  }

  const volumeMinutes = volumeMm3 / (config.effectiveFlowMm3PerS * 60)
  const layers = Math.ceil(bboxMm.z / config.layerHeightMm)
  const layerMinutes = (layers * config.minSecondsPerLayer) / 60

  return Math.ceil(Math.max(volumeMinutes, layerMinutes) + config.setupMinutes)
}

/** Which box the part ships in, keyed on its longest bounding-box dimension. */
export function packagingCostUsd(
  bboxMm: BBoxMm,
  config: PrintPricingConfig = DEFAULT_PRINT_PRICING
): number {
  const longest = Math.max(bboxMm.x, bboxMm.y, bboxMm.z)
  if (longest <= config.packagingSmallMaxMm) return config.packagingSmallUsd
  if (longest <= config.packagingMediumMaxMm) return config.packagingMediumUsd
  return config.packagingLargeUsd
}

export interface PrintPriceBreakdown {
  /** Filament mass actually charged for, grams. */
  grams: number
  /** ESTIMATED print time, minutes — see the warning at the top of this file. */
  printMinutes: number
  printMinutesAreEstimated: true

  filamentUsd: number
  machineUsd: number
  /** Failure allowance on (filament + machine). */
  scrapUsd: number
  labourUsd: number
  packagingUsd: number

  /** Sum of the five components above. */
  costUsd: number
  marginMultiplier: number
  /** costUsd * marginMultiplier, before the floor and charm rounding. */
  rawPriceUsd: number
  /** True when rawPriceUsd was below minPriceUsd and the floor lifted it. */
  floorApplied: boolean
  /** The number to put in products.price. Charm-rounded to .99. */
  priceUsd: number
}

/** Round UP to the next X.99. Never returns less than `value`. */
function charmRound(value: number): number {
  return Math.round((Math.ceil(value + 0.01) - 0.01) * 100) / 100
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * The whole pricing model in one place.
 *
 *   filament  = grams * (usdPerKg / 1000)
 *   machine   = estimatedHours * usdPerHour
 *   scrap     = (filament + machine) * (scrapAllowance - 1)
 *   labour    = labourMinutes/60 * usdPerHour        [flat per job]
 *   packaging = box tier from the bounding box       [flat per job]
 *   price     = charmRound(max(sum * margin, floor))
 */
export function priceFromMetrics(
  metrics: PrintMetrics,
  config: PrintPricingConfig = DEFAULT_PRINT_PRICING
): PrintPriceBreakdown {
  const volumeMm3 = Number(metrics.volume_mm3)
  if (!Number.isFinite(volumeMm3) || volumeMm3 < 0) {
    throw new Error(`cannot price a mesh with volume ${metrics.volume_mm3}`)
  }

  // Trust the fixture's own grams_est when it has one (it may account for
  // hollowing or a non-PLA density the bare volume does not); fall back to the
  // same density arithmetic the fixture would have used.
  const grams =
    Number.isFinite(Number(metrics.grams_est)) && Number(metrics.grams_est) > 0
      ? Number(metrics.grams_est)
      : gramsForVolume(volumeMm3)

  const printMinutes = estimatePrintMinutes(volumeMm3, metrics.bbox_mm, config)

  const filamentUsd = grams * (config.filamentUsdPerKg / 1000)
  const machineUsd = (printMinutes / 60) * config.machineUsdPerHour
  const scrapUsd = (filamentUsd + machineUsd) * (config.scrapAllowance - 1)
  const labourUsd = (config.labourMinutesPerJob / 60) * config.labourUsdPerHour
  const packagingUsd = packagingCostUsd(metrics.bbox_mm, config)

  const costUsd = filamentUsd + machineUsd + scrapUsd + labourUsd + packagingUsd
  const rawPriceUsd = costUsd * config.marginMultiplier
  const floorApplied = rawPriceUsd < config.minPriceUsd
  const priceUsd = charmRound(Math.max(rawPriceUsd, config.minPriceUsd))

  return {
    grams,
    printMinutes,
    printMinutesAreEstimated: true,
    filamentUsd: round2(filamentUsd),
    machineUsd: round2(machineUsd),
    scrapUsd: round2(scrapUsd),
    labourUsd: round2(labourUsd),
    packagingUsd: round2(packagingUsd),
    costUsd: round2(costUsd),
    marginMultiplier: config.marginMultiplier,
    rawPriceUsd: round2(rawPriceUsd),
    floorApplied,
    priceUsd,
  }
}

// ---------------------------------------------------------------------------
// The publish gate.
//
// print-factory already decides whether a mesh is printable and writes that
// verdict into metrics.json. Publishing is the first thing downstream that
// reads it, so this is where "the fixture said no" has to actually stop
// something. A model that failed its own gate must never become a product.
// ---------------------------------------------------------------------------
export function metricsBlockers(metrics: PrintMetrics): string[] {
  const reasons: string[] = []

  if (!metrics || typeof metrics !== 'object') {
    return ['metrics.json did not parse into an object']
  }

  if (metrics.ok !== true) {
    reasons.push(`metrics.ok is ${JSON.stringify(metrics.ok)} — the print-factory run itself did not succeed`)
  }
  if (metrics.manifold !== true) {
    reasons.push(
      `metrics.manifold is ${JSON.stringify(metrics.manifold)} — a non-manifold mesh is not a watertight solid` +
        (typeof metrics.non_manifold_edges === 'number'
          ? ` (${metrics.non_manifold_edges} non-manifold edges)`
          : '')
    )
  }
  if (!Array.isArray(metrics.warnings)) {
    reasons.push('metrics.warnings is missing or not an array')
  } else if (metrics.warnings.length > 0) {
    for (const w of metrics.warnings) reasons.push(`print-factory warning: ${w}`)
  }
  if (metrics.fits_build_volume === false) {
    reasons.push('metrics.fits_build_volume is false — the part does not fit the printer build volume')
  }

  // Degenerate geometry. printfactory.metrics.degenerate_reasons() catches this
  // upstream, but a mesh destroyed by a boolean can still report ok:true with an
  // empty warnings array on older fixture output — so re-check it here.
  if (!Number.isFinite(Number(metrics.volume_mm3)) || Number(metrics.volume_mm3) <= 0) {
    reasons.push(`metrics.volume_mm3 is ${JSON.stringify(metrics.volume_mm3)} — there is no solid to print`)
  }
  if (typeof metrics.tri_count === 'number' && metrics.tri_count <= 0) {
    reasons.push('metrics.tri_count is 0 — the mesh has no geometry')
  }
  const bbox = metrics.bbox_mm
  if (
    !bbox ||
    ![bbox.x, bbox.y, bbox.z].every((d) => Number.isFinite(Number(d)) && Number(d) > 0)
  ) {
    reasons.push(`metrics.bbox_mm has a zero or missing dimension: ${JSON.stringify(bbox)}`)
  }

  return reasons
}
