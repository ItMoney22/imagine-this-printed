// ---------------------------------------------------------------------------
// Print-quality gate for the design library.
//
// A library design must not go live if its artwork has too few pixels to print
// cleanly — a customer buying it would receive a blurry shirt. The bar is NOT a
// magic 1200: it is derived from the print type's own minimum DPI
// (SHEET_PRESETS[type].rules.minDPI — the same number the Imagination Station
// grades uploaded layers against in src/utils/dpi-calculator.ts) multiplied by
// the smallest placement we sell library art at.
//
// The verdict is recomputed from the recorded pixel dimensions on every check
// rather than trusting the stored metadata.image.printable boolean, for the
// same reason isBelowMinDpi() recomputes: that flag was written under whatever
// threshold was current at backfill time, and a raised minDPI must not be
// sneaked past by a stale `true`.
// ---------------------------------------------------------------------------
import { SHEET_PRESETS, DEFAULT_PRINT_TYPE, type PrintType } from '../config/imagination-presets.js'

/** Smallest placement we sell a library design at: a 4" square. */
export const MIN_PRINT_INCHES = 4

export type PrintCheckCode = 'ok' | 'too_small' | 'unmeasured'

export interface PrintCheck {
  ok: boolean
  code: PrintCheckCode
  reason: string
  short_edge_px: number | null
  required_px: number
  min_dpi: number
  min_print_inches: number
}

export interface QuarantineRecord {
  code: PrintCheckCode
  reason: string
  short_edge_px: number | null
  required_px: number
  min_dpi: number
  at: string
  by: string
  released_at?: string
  released_by?: string
  override_reason?: string
}

export const minDpiFor = (printType: PrintType = DEFAULT_PRINT_TYPE): number =>
  SHEET_PRESETS[printType]?.rules.minDPI ?? SHEET_PRESETS[DEFAULT_PRINT_TYPE].rules.minDPI

/** Pixels the short edge needs to fill MIN_PRINT_INCHES at the print type's minDPI. */
export const requiredShortEdgePx = (printType: PrintType = DEFAULT_PRINT_TYPE): number =>
  Math.ceil(minDpiFor(printType) * MIN_PRINT_INCHES)

/**
 * Verdict for one product's artwork, from metadata.image recorded at import
 * (see scripts/lib/design-media.mjs readImageStats).
 *
 * Missing dimensions BLOCK. An unmeasured image is not a safe image — same
 * call dpi-calculator.ts makes for a layer with no dpiInfo — and the fix is to
 * measure it, which is a one-command backfill.
 */
export function checkPrintability(
  metadata: Record<string, any> | null | undefined,
  printType: PrintType = DEFAULT_PRINT_TYPE
): PrintCheck {
  const minDpi = minDpiFor(printType)
  const requiredPx = requiredShortEdgePx(printType)
  const base = { required_px: requiredPx, min_dpi: minDpi, min_print_inches: MIN_PRINT_INCHES }

  const image = metadata?.image
  const width = Number(image?.width_px)
  const height = Number(image?.height_px)

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      ...base,
      ok: false,
      code: 'unmeasured',
      short_edge_px: null,
      reason: `Pixel dimensions were never recorded for this design, so its print quality is unknown. ` +
        `Run backend/scripts/backfill-design-library-media.mjs to measure it, then activate.`
    }
  }

  const shortEdge = Math.min(width, height)
  if (shortEdge < requiredPx) {
    return {
      ...base,
      ok: false,
      code: 'too_small',
      short_edge_px: shortEdge,
      reason: `Artwork is ${width}x${height}px. Its short edge (${shortEdge}px) is under the ${requiredPx}px ` +
        `needed for a ${MIN_PRINT_INCHES}" print at ${minDpi} DPI, so it would print blurry.`
    }
  }

  return { ...base, ok: true, code: 'ok', short_edge_px: shortEdge, reason: 'Meets the minimum print resolution.' }
}

/** An admin has knowingly overridden the block for this product. */
export const isReleased = (metadata: Record<string, any> | null | undefined): boolean =>
  Boolean(metadata?.quarantine?.released_at)

export interface ActivationVerdict {
  allowed: boolean
  released: boolean
  check: PrintCheck
}

export function canActivate(
  metadata: Record<string, any> | null | undefined,
  printType: PrintType = DEFAULT_PRINT_TYPE
): ActivationVerdict {
  const check = checkPrintability(metadata, printType)
  const released = isReleased(metadata)
  return { allowed: check.ok || released, released, check }
}

export interface LibraryRow {
  id: string
  name?: string | null
  metadata?: Record<string, any> | null
}

export interface BlockedRow<T extends LibraryRow = LibraryRow> {
  id: string
  name: string | null
  check: PrintCheck
  product: T
}

/** Split activation candidates into the ones that may go live and the ones that may not. */
export function partitionForActivation<T extends LibraryRow>(
  rows: T[],
  printType: PrintType = DEFAULT_PRINT_TYPE
): { allowed: T[]; blocked: BlockedRow<T>[] } {
  const allowed: T[] = []
  const blocked: BlockedRow<T>[] = []
  for (const row of rows) {
    const verdict = canActivate(row.metadata, printType)
    if (verdict.allowed) allowed.push(row)
    else blocked.push({ id: row.id, name: row.name ?? null, check: verdict.check, product: row })
  }
  return { allowed, blocked }
}

/**
 * metadata.quarantine — WHY a design is being held back, stamped on the row so
 * it is discoverable later instead of the design just quietly never going live.
 * Reversible: releaseQuarantine() stamps an override on the same record rather
 * than erasing the reason.
 */
export const quarantineRecord = (check: PrintCheck, by: string): QuarantineRecord => ({
  code: check.code,
  reason: check.reason,
  short_edge_px: check.short_edge_px,
  required_px: check.required_px,
  min_dpi: check.min_dpi,
  at: new Date().toISOString(),
  by
})

export const releaseQuarantine = (
  existing: QuarantineRecord | null | undefined,
  by: string,
  overrideReason: string
): QuarantineRecord => ({
  code: existing?.code ?? 'too_small',
  reason: existing?.reason ?? 'Quarantined before a reason was recorded.',
  short_edge_px: existing?.short_edge_px ?? null,
  required_px: existing?.required_px ?? requiredShortEdgePx(),
  min_dpi: existing?.min_dpi ?? minDpiFor(),
  at: existing?.at ?? new Date().toISOString(),
  by: existing?.by ?? by,
  released_at: new Date().toISOString(),
  released_by: by,
  override_reason: overrideReason
})
