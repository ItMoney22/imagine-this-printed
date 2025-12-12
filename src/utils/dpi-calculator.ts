// src/utils/dpi-calculator.ts
// DPI calculation and quality assessment for print images

const PIXELS_PER_INCH = 96;

// DPI quality thresholds
export const DPI_EXCELLENT = 300;
export const DPI_GOOD = 150;
export const DPI_WARNING = 100;

// DPI quality levels
export type DpiQuality = 'excellent' | 'good' | 'warning' | 'danger';

export interface DpiInfo {
  dpi: number;
  quality: DpiQuality;
  originalWidth: number;
  originalHeight: number;
  canvasSizeInches: { width: number; height: number };
}

/**
 * Calculate DPI based on original image pixels and canvas size
 * @param originalPixelWidth - Original image width in pixels
 * @param originalPixelHeight - Original image height in pixels
 * @param canvasPixelWidth - Current canvas width in pixels
 * @param canvasPixelHeight - Current canvas height in pixels
 * @returns DPI information including quality assessment
 */
export const calculateDpi = (
  originalPixelWidth: number,
  originalPixelHeight: number,
  canvasPixelWidth: number,
  canvasPixelHeight: number
): DpiInfo => {
  // Calculate canvas size in inches
  const canvasWidthInches = canvasPixelWidth / PIXELS_PER_INCH;
  const canvasHeightInches = canvasPixelHeight / PIXELS_PER_INCH;

  // Calculate DPI for both dimensions and use the lower one (worst case)
  const dpiWidth = originalPixelWidth / canvasWidthInches;
  const dpiHeight = originalPixelHeight / canvasHeightInches;
  const dpi = Math.min(dpiWidth, dpiHeight);

  // Determine quality level
  let quality: DpiQuality;
  if (dpi >= DPI_EXCELLENT) {
    quality = 'excellent';
  } else if (dpi >= DPI_GOOD) {
    quality = 'good';
  } else if (dpi >= DPI_WARNING) {
    quality = 'warning';
  } else {
    quality = 'danger';
  }

  return {
    dpi: Math.round(dpi),
    quality,
    originalWidth: originalPixelWidth,
    originalHeight: originalPixelHeight,
    canvasSizeInches: {
      width: parseFloat(canvasWidthInches.toFixed(2)),
      height: parseFloat(canvasHeightInches.toFixed(2)),
    },
  };
};

/**
 * Get display properties for DPI quality level
 * @param quality - DPI quality level
 * @returns Color classes and labels for UI display
 */
export const getDpiQualityDisplay = (quality: DpiQuality) => {
  switch (quality) {
    case 'excellent':
      return {
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-300',
        indicatorColor: 'bg-green-500',
        label: 'Excellent',
        icon: '✓',
        description: 'Perfect for printing at 300+ DPI',
      };
    case 'good':
      return {
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-300',
        indicatorColor: 'bg-green-500',
        label: 'Good',
        icon: '✓',
        description: 'Good quality for printing (150+ DPI)',
      };
    case 'warning':
      return {
        color: 'text-amber-600',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-300',
        indicatorColor: 'bg-amber-500',
        label: 'Low Quality',
        icon: '⚠',
        description: 'May appear pixelated when printed (100-150 DPI)',
      };
    case 'danger':
      return {
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-300',
        indicatorColor: 'bg-red-500',
        label: 'Poor Quality',
        icon: '✕',
        description: 'Will look bad when printed (below 100 DPI)',
      };
  }
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
