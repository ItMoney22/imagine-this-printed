/**
 * The boxes we actually ship in.
 *
 * Every Shippo call in this codebase used to declare the same parcel — 10x8x4 —
 * whatever was really in the box, because nobody was ever asked. That is not a
 * cosmetic detail: carriers price on dimensional weight as well as scale
 * weight, and UPS Ground Saver bills (L x W x H) / 139 when that beats the
 * actual pounds. A 10x8x4 declaration is 2.3 lb of dim weight. Hand a customer's
 * 16x12x10 box the same declaration and the label is underpaid by roughly 11 lb
 * of dim weight — which the carrier does not refuse at drop-off. It reweighs,
 * redimensions, and bills the difference back weeks later as an adjustment.
 *
 * So the station asks. This list is the one place the answers live; the API
 * validates against it and the station screen renders from it, so the two
 * cannot drift.
 *
 * EDITING THIS LIST: add or change entries freely — ids are the only thing that
 * must stay stable, because they are recorded on the order at purchase time.
 * A retired box should keep its id so old orders still read back correctly.
 */

export interface ParcelPreset {
  id: string
  name: string
  /** Outer dimensions in inches, as the carrier should be told them. */
  lengthIn: number
  widthIn: number
  heightIn: number
  /** Shown under the name on the station screen. */
  note?: string
}

export const PARCEL_PRESETS: ParcelPreset[] = [
  {
    id: 'poly-mailer-small',
    name: 'Poly mailer — small',
    lengthIn: 10,
    widthIn: 13,
    heightIn: 1,
    note: 'One or two shirts, no box'
  },
  {
    id: 'poly-mailer-large',
    name: 'Poly mailer — large',
    lengthIn: 14,
    widthIn: 19,
    heightIn: 1,
    note: 'Hoodie or a stack of shirts'
  },
  {
    id: 'box-8x6x4',
    name: 'Small box',
    lengthIn: 8,
    widthIn: 6,
    heightIn: 4,
    note: 'Tumbler, small 3D print'
  },
  {
    id: 'box-12x9x4',
    name: 'Medium box',
    lengthIn: 12,
    widthIn: 9,
    heightIn: 4,
    note: 'Metal art, mixed orders'
  },
  {
    id: 'box-14x12x6',
    name: 'Large box',
    lengthIn: 14,
    widthIn: 12,
    heightIn: 6
  },
  {
    id: 'box-16x12x10',
    name: 'Extra large box',
    lengthIn: 16,
    widthIn: 12,
    heightIn: 10,
    note: 'Multi-item, bulky toys'
  }
]

/** What actually goes on the shipment, once a preset or custom size is resolved. */
export interface ResolvedParcel {
  presetId: string | null
  presetName: string | null
  lengthIn: number
  widthIn: number
  heightIn: number
}

export interface ParcelInput {
  presetId?: string | null
  lengthIn?: number | string | null
  widthIn?: number | string | null
  heightIn?: number | string | null
}

// Carrier ceilings, not ours. UPS and USPS both stop at 108in on the longest
// side; anything past that is freight and this screen is the wrong tool.
const MIN_IN = 0.25
const MAX_IN = 108

function toDimension(value: unknown): number | null {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value)
  if (!Number.isFinite(n) || n < MIN_IN || n > MAX_IN) return null
  return Math.round(n * 100) / 100
}

export function findPreset(presetId: string | null | undefined): ParcelPreset | null {
  if (!presetId) return null
  return PARCEL_PRESETS.find(p => p.id === presetId) || null
}

/**
 * Turn what the station sent into a parcel, or explain why it cannot.
 *
 * A preset id wins when it resolves. Explicit dimensions are accepted for the
 * custom-size case. Nothing is silently defaulted: a caller that sends neither
 * gets an error, because a guessed box is the bug this whole thing exists to
 * fix.
 */
export function resolveParcel(input: ParcelInput | null | undefined): { parcel: ResolvedParcel } | { error: string } {
  const preset = findPreset(input?.presetId)
  if (preset) {
    return {
      parcel: {
        presetId: preset.id,
        presetName: preset.name,
        lengthIn: preset.lengthIn,
        widthIn: preset.widthIn,
        heightIn: preset.heightIn
      }
    }
  }

  if (input?.presetId) {
    return { error: `Unknown box "${input.presetId}". Pick one of: ${PARCEL_PRESETS.map(p => p.id).join(', ')}` }
  }

  const lengthIn = toDimension(input?.lengthIn)
  const widthIn = toDimension(input?.widthIn)
  const heightIn = toDimension(input?.heightIn)

  if (lengthIn && widthIn && heightIn) {
    return { parcel: { presetId: null, presetName: 'Custom size', lengthIn, widthIn, heightIn } }
  }

  if (input?.lengthIn != null || input?.widthIn != null || input?.heightIn != null) {
    return { error: `Custom box needs a length, width and height, each between ${MIN_IN}in and ${MAX_IN}in.` }
  }

  return { error: 'Pick a box size before buying the label — the carrier prices on dimensions as well as weight.' }
}

/** Longest side plus the girth of the other two — what carriers call oversize. */
export function lengthPlusGirthIn(parcel: ResolvedParcel): number {
  const sides = [parcel.lengthIn, parcel.widthIn, parcel.heightIn].sort((a, b) => b - a)
  return sides[0] + 2 * (sides[1] + sides[2])
}
