/**
 * Canonical apparel color presets used across the platform.
 *
 * Source of truth for both the admin product builder color picker AND the
 * customer Quick Add color picker. Adding a new color here makes it pickable
 * everywhere with a human-readable name (instead of a bare hex code).
 */

export interface ColorPreset {
  name: string
  hex: string
}

export const COLOR_PRESETS: ColorPreset[] = [
  { name: 'Black', hex: '#000000' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Navy', hex: '#1E3A5F' },
  { name: 'Red', hex: '#DC2626' },
  { name: 'Royal Blue', hex: '#2563EB' },
  { name: 'Forest Green', hex: '#166534' },
  { name: 'Heather Grey', hex: '#9CA3AF' },
  { name: 'Pink', hex: '#EC4899' },
  { name: 'Orange', hex: '#EA580C' },
  { name: 'Yellow', hex: '#EAB308' },
]

/**
 * Look up a friendly color name from a hex string (case-insensitive).
 * Returns the hex unchanged if it's not in the preset list — that's the right
 * fallback for user-defined custom colors so the user still sees something.
 */
export function getColorName(hex: string | undefined | null): string {
  if (!hex) return ''
  const match = COLOR_PRESETS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())
  return match?.name ?? hex
}

/**
 * Pure-light colors that need dark text/icons for contrast (white, yellow).
 * Used by checkmark overlays so they stay visible on light swatches.
 */
export function isLightSwatch(hex: string): boolean {
  const v = hex.toUpperCase()
  return v === '#FFFFFF' || v === '#EAB308'
}
