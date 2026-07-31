// src/utils/dpi-calculator.ts
// DPI calculation and quality assessment for print images
// Thresholds are driven by each print type's minDPI (see backend/config/imagination-presets.ts
// SHEET_PRESETS[type].rules.minDPI), not hard-coded 300/150/100.

const PIXELS_PER_INCH = 96;

/** Fallback when a print type / preset isn't available yet */
export const DEFAULT_MIN_DPI = 300;

// Legacy absolute constants — kept for any external references, no longer used
// directly by the grading logic below (see getDpiThresholds / gradeDpi).
export const DPI_EXCELLENT = 300;
export const DPI_GOOD = 150;
export const DPI_WARNING = 100;

// DPI quality levels, relative to the print type's minDPI:
// - good:    dpi >= 1.0 * minDPI
// - warning: 0.5 * minDPI <= dpi < 1.0 * minDPI
// - danger:  dpi < 0.5 * minDPI
// 'excellent' is retained for backward-compat with previously stored metadata
// and is treated the same as 'good'.
export type DpiQuality = 'excellent' | 'good' | 'warning' | 'danger';

export interface DpiInfo {
  dpi: number;
  quality: DpiQuality;
  originalWidth: number;
  originalHeight: number;
  canvasSizeInches: { width: number; height: number };
  /** Print-type minDPI used when this grade was computed */
  minDPI?: number;
}

export interface DpiThresholds {
  minDPI: number;
  /** dpi >= goodAt -> 'good' */
  goodAt: number;
  /** dpi >= warningAt && dpi < goodAt -> 'warning'; below warningAt -> 'danger' */
  warningAt: number;
}

/**
 * Derive quality cutoffs from a print type's minimum required DPI.
 * good = at/above minDPI; warning = 50-99% of minDPI; danger = below 50%.
 */
export const getDpiThresholds = (minDPI: number = DEFAULT_MIN_DPI): DpiThresholds => {
  const safeMin = Number.isFinite(minDPI) && minDPI > 0 ? minDPI : DEFAULT_MIN_DPI;
  return {
    minDPI: safeMin,
    goodAt: safeMin,
    warningAt: safeMin * 0.5,
  };
};

/**
 * Grade a DPI value relative to the print type's minDPI.
 */
export const gradeDpi = (dpi: number, minDPI: number = DEFAULT_MIN_DPI): DpiQuality => {
  const { goodAt, warningAt } = getDpiThresholds(minDPI);
  if (dpi >= goodAt) return 'good';
  if (dpi >= warningAt) return 'warning';
  return 'danger';
};

/**
 * Calculate DPI based on original image pixels and canvas size.
 * Quality is graded relative to the print type's minDPI.
 *
 * @param originalPixelWidth - Original image width in pixels
 * @param originalPixelHeight - Original image height in pixels
 * @param canvasPixelWidth - Current canvas width in pixels
 * @param canvasPixelHeight - Current canvas height in pixels
 * @param minDPI - Print type minimum DPI (from imagination presets). Defaults to 300.
 * @returns DPI information including quality assessment
 */
export const calculateDpi = (
  originalPixelWidth: number,
  originalPixelHeight: number,
  canvasPixelWidth: number,
  canvasPixelHeight: number,
  minDPI: number = DEFAULT_MIN_DPI
): DpiInfo => {
  // Calculate canvas size in inches
  const canvasWidthInches = canvasPixelWidth / PIXELS_PER_INCH;
  const canvasHeightInches = canvasPixelHeight / PIXELS_PER_INCH;

  // Calculate DPI for both dimensions and use the lower one (worst case)
  const dpiWidth = originalPixelWidth / canvasWidthInches;
  const dpiHeight = originalPixelHeight / canvasHeightInches;
  const dpi = Math.min(dpiWidth, dpiHeight);
  const roundedDpi = Math.round(dpi);

  const safeMin = Number.isFinite(minDPI) && minDPI > 0 ? minDPI : DEFAULT_MIN_DPI;
  const quality = gradeDpi(roundedDpi, safeMin);

  return {
    dpi: roundedDpi,
    quality,
    originalWidth: originalPixelWidth,
    originalHeight: originalPixelHeight,
    canvasSizeInches: {
      width: parseFloat(canvasWidthInches.toFixed(2)),
      height: parseFloat(canvasHeightInches.toFixed(2)),
    },
    minDPI: safeMin,
  };
};

/**
 * Get display properties for DPI quality level.
 * Descriptions are phrased relative to the print type's minDPI when provided.
 */
export const getDpiQualityDisplay = (quality: DpiQuality, minDPI: number = DEFAULT_MIN_DPI) => {
  const { goodAt, warningAt } = getDpiThresholds(minDPI);
  const goodLabel = Math.round(goodAt);
  const warnFloor = Math.round(warningAt);

  switch (quality) {
    case 'excellent':
    case 'good':
      return {
        color: 'text-green-500',
        bgColor: 'bg-green-500/10',
        borderColor: 'border-green-500/40',
        indicatorColor: 'bg-green-500',
        label: 'Good',
        icon: '✓',
        description: `Meets print quality (${goodLabel}+ DPI required)`,
      };
    case 'warning':
      return {
        color: 'text-amber-500',
        bgColor: 'bg-amber-500/10',
        borderColor: 'border-amber-500/40',
        indicatorColor: 'bg-amber-500',
        label: 'Below Minimum',
        icon: '⚠',
        description: `Below required ${goodLabel} DPI (${warnFloor}–${goodLabel - 1} DPI). Shrink, re-upload, or upscale before ordering.`,
      };
    case 'danger':
      return {
        color: 'text-red-500',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/40',
        indicatorColor: 'bg-red-500',
        label: 'Poor Quality',
        icon: '✕',
        description: `Far below required ${goodLabel} DPI (under ${warnFloor} DPI). Will not print well.`,
      };
  }
};

/**
 * True when a layer's DPI fails the print type's minimum (quality warning or
 * danger), OR when DPI could not be determined at all (missing dpiInfo) — an
 * undeterminable DPI must block, not silently pass. Uses the numeric dpi +
 * current minDPI so stale quality tags computed under an old threshold can't
 * sneak by.
 */
export const isBelowMinDpi = (
  dpiInfo: DpiInfo | null | undefined,
  minDPI: number = DEFAULT_MIN_DPI
): boolean => {
  if (!dpiInfo) return true;
  const threshold = Number.isFinite(minDPI) && minDPI > 0 ? minDPI : DEFAULT_MIN_DPI;
  if (typeof dpiInfo.dpi === 'number' && Number.isFinite(dpiInfo.dpi)) {
    return dpiInfo.dpi < threshold;
  }
  // Fallback to stored quality grade (treat excellent as good) if dpi itself is unreadable
  return dpiInfo.quality === 'warning' || dpiInfo.quality === 'danger';
};

/**
 * Re-grade stored dpiInfo against the current print-type minDPI.
 * Fixes layers saved under the old hard-coded 300/150/100 thresholds.
 */
export const resolveDpiInfo = (
  dpiInfo: DpiInfo | null | undefined,
  minDPI: number = DEFAULT_MIN_DPI
): DpiInfo | null => {
  if (!dpiInfo) return null;
  if (typeof dpiInfo.dpi !== 'number') return dpiInfo;
  const safeMin = Number.isFinite(minDPI) && minDPI > 0 ? minDPI : DEFAULT_MIN_DPI;
  const quality = gradeDpi(dpiInfo.dpi, safeMin);
  if (quality === dpiInfo.quality && dpiInfo.minDPI === safeMin) return dpiInfo;
  return { ...dpiInfo, quality, minDPI: safeMin };
};

/**
 * Get DPI information from layer metadata
 * @param metadata - Layer metadata object
 * @returns DpiInfo or null if not available
 */
export const getDpiFromMetadata = (metadata: Record<string, any> | null): DpiInfo | null => {
  if (!metadata?.dpiInfo) return null;
  return metadata.dpiInfo as DpiInfo;
};

/**
 * Format DPI value for display
 * @param dpi - DPI value
 * @returns Formatted string
 */
export const formatDpi = (dpi: number): string => {
  return `${dpi} DPI`;
};
