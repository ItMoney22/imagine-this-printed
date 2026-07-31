// backend/services/imagination-dpi-guard.ts
//
// Server-side DPI enforcement for Imagination Station cart items (Watchtower
// task b714d855, follow-up to 2ec9eeff). The client already hard-blocks
// add-to-cart when an image layer is below the print type's minDPI (see
// src/pages/ImaginationStation.tsx handleAddToCart), but that is a UI gate
// only — a direct POST to /api/stripe/checkout-payment-intent (or a stale
// client built before the gate existed) could still create a low-DPI order.
// This module re-checks the same thing server-side, right before an order
// is created/updated.
//
// Kept dependency-free (no Supabase) so it can be unit tested directly —
// same pattern as imagination-layer-save.ts. The caller is responsible for
// resolving each print type's minDPI (a DB-backed lookup via
// imagination-products.ts) and passing it in.

const PIXELS_PER_INCH = 96;

// Matches src/utils/dpi-calculator.ts's DEFAULT_MIN_DPI — used only if a
// caller somehow fails to resolve a minDPI for a known print type.
export const DEFAULT_MIN_DPI = 300;

// Shape of a single layer as it arrives inside a cart item's
// designData.elements (see src/pages/ImaginationStation.tsx handleAddToCart,
// which sets `designData: { elements: layers, ... }`). width/height are the
// layer's PLACED size in INCHES on the sheet; metadata.originalWidth/Height
// are the SOURCE image's pixel dimensions.
export interface CartLayer {
  layer_type?: string;
  width?: number | null;
  height?: number | null;
  metadata?: {
    name?: string;
    dpiInfo?: { dpi?: number } | null;
    originalWidth?: number;
    originalHeight?: number;
  } | null;
}

// Minimal shape of a cart item this guard cares about — a real CartItem
// (src/types/index.ts) has many more fields, all ignored here.
export interface DpiGuardCartItem {
  product?: {
    metadata?: {
      printType?: string;
    } | null;
  } | null;
  designData?: {
    elements?: CartLayer[];
  } | null;
}

export interface DpiViolation {
  itemIndex: number;
  printType: string;
  layerName: string;
  dpi: number | null;
  minDPI: number;
}

const IMAGE_LAYER_TYPES = new Set(['image', 'ai_generated']);

/**
 * Resolve a layer's DPI the same way the client does (calcDpiInches in
 * ImaginationStation.tsx): prefer the already-graded metadata.dpiInfo.dpi;
 * otherwise recompute from the source image's pixel dimensions against the
 * placed size in inches (dpi = originalPx / placedInches — the PPI unit
 * conversion cancels out on both sides, so no PIXELS_PER_INCH factor is
 * needed here even though the client's helper round-trips through it).
 * Returns null when neither is available — an undeterminable DPI must be
 * treated as a violation by the caller, never a silent pass.
 */
export function resolveLayerDpi(layer: CartLayer): number | null {
  const stored = layer?.metadata?.dpiInfo?.dpi;
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored;

  const originalWidth = layer?.metadata?.originalWidth;
  const originalHeight = layer?.metadata?.originalHeight;
  const widthIn = layer?.width;
  const heightIn = layer?.height;

  if (
    typeof originalWidth === 'number' && originalWidth > 0 &&
    typeof originalHeight === 'number' && originalHeight > 0 &&
    typeof widthIn === 'number' && widthIn > 0 &&
    typeof heightIn === 'number' && heightIn > 0
  ) {
    const dpiWidth = originalWidth / widthIn;
    const dpiHeight = originalHeight / heightIn;
    return Math.round(Math.min(dpiWidth, dpiHeight));
  }

  return null;
}

// PIXELS_PER_INCH is exported for callers/tests that want to sanity-check
// the cancellation noted in resolveLayerDpi's comment; unused internally
// beyond documentation.
export { PIXELS_PER_INCH };

/**
 * Pull out the Imagination Station items from a raw cart items array (the
 * request body's `items`, as sent to /api/stripe/checkout-payment-intent).
 * An item counts as one only when it carries a recognizable print type AND
 * at least one image/ai_generated layer — plain apparel/metal/3D items and
 * text-or-shape-only sheets are left alone.
 */
export function extractImaginationCartItems(
  items: DpiGuardCartItem[] | null | undefined
): Array<{ itemIndex: number; printType: string; layers: CartLayer[] }> {
  if (!Array.isArray(items)) return [];
  const result: Array<{ itemIndex: number; printType: string; layers: CartLayer[] }> = [];

  items.forEach((item, itemIndex) => {
    const printType = item?.product?.metadata?.printType;
    const elements = item?.designData?.elements;
    if (!printType || !Array.isArray(elements) || elements.length === 0) return;

    const layers = elements.filter(l => IMAGE_LAYER_TYPES.has(l?.layer_type || ''));
    if (layers.length === 0) return;

    result.push({ itemIndex, printType, layers });
  });

  return result;
}

/**
 * Check every Imagination Station item's layers against its print type's
 * minDPI. `minDpiByPrintType` is resolved by the caller (DB-backed lookup —
 * see imagination-products.ts's getProductByType, which already knows how
 * to fall back product.minDpi -> rules.minDPI -> the 300 default). A print
 * type missing from the map falls back to DEFAULT_MIN_DPI rather than
 * skipping validation.
 */
export function findDpiViolations(
  imaginationItems: Array<{ itemIndex: number; printType: string; layers: CartLayer[] }>,
  minDpiByPrintType: Record<string, number>
): DpiViolation[] {
  const violations: DpiViolation[] = [];

  for (const { itemIndex, printType, layers } of imaginationItems) {
    const minDPI = minDpiByPrintType[printType] || DEFAULT_MIN_DPI;

    for (const layer of layers) {
      const dpi = resolveLayerDpi(layer);
      if (dpi === null || dpi < minDPI) {
        violations.push({
          itemIndex,
          printType,
          layerName: layer?.metadata?.name || 'Untitled',
          dpi,
          minDPI,
        });
      }
    }
  }

  return violations;
}
