// 3D name gifts — the template contract (task bf353160, 2026-10-28).
//
// A name ornament and a name keychain: the customer types a name and the
// print file is a 3D model with THAT name raised on the plate. What they type
// is what prints; there is no sample name anywhere in the pipeline.
//
// It rides the same lane as the team shirts (backend/shared/team-template.ts):
// the cart line carries `personalization` values, checkout re-reads this
// template from the DATABASE, re-sanitizes, and renders the print file on the
// server into order_items.metadata.print_file_path. The difference is what
// gets drawn: a team template is shirt art edited by an image model, this is
// geometry built in code (backend/services/name-print/geometry.ts) from a
// house font, so a preview is free and instant and the file is exact.
//
// NO MIGRATION: rides `products.metadata.name_print` (jsonb).
//
// Browser-safe on purpose (no node: imports): the product page imports the
// sanitizer so the input box never shows a character that will be dropped.

/** Bumped only for a breaking shape change. An unknown version is refused. */
export const NAME_PRINT_VERSION = 1

export type NamePrintShape = 'ornament' | 'keychain'

export interface NamePrintColour {
  /** What the customer reads ("Red"). */
  name: string
  /** For the preview only. */
  hex: string
}

export interface NamePrintTemplate {
  version: number
  shape: NamePrintShape
  /** A house font id (backend/assets/fonts, see HOUSE_FONTS). */
  font: string
  field: { key: string; label: string; max: number }
  /** The plate colour and the raised-letter colour: one filament change at the top of the plate. */
  colours: { plate: NamePrintColour; letters: NamePrintColour }
  /** Dollars added per line for personalizing. 0 = the price already includes it. */
  upcharge: number
}

/** Per-shape limits. A longer name than this gets letters too small to print cleanly. */
export const NAME_MAX: Record<NamePrintShape, number> = { ornament: 12, keychain: 10 }

const HEX_RE = /^#[0-9a-fA-F]{6}$/

// What a name actually uses: letters (accented Latin too: José, Zoë, Chloé),
// digits, space, apostrophe, hyphen, period and ampersand ("Mom & Dad").
// Every one of these has a glyph in the house fonts (name-print.test.ts
// checks it), so nothing here can print as an empty box.
const NAME_DROP_RE = /[^A-Za-z0-9À-ÖØ-öø-ÿ '&.-]/g

function parseColour(raw: unknown): NamePrintColour | null {
  if (!raw || typeof raw !== 'object') return null
  const { name, hex } = raw as Record<string, unknown>
  if (typeof name !== 'string' || !name.trim() || name.length > 40) return null
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) return null
  return { name: name.trim(), hex }
}

/** Reads products.metadata.name_print. Anything malformed is null, never guessed at. */
export function parseNamePrint(metadata: unknown): NamePrintTemplate | null {
  const raw = (metadata as any)?.name_print
  if (!raw || typeof raw !== 'object') return null
  if (raw.version !== NAME_PRINT_VERSION) return null
  const shape = raw.shape
  if (shape !== 'ornament' && shape !== 'keychain') return null
  if (typeof raw.font !== 'string' || !/^[a-z0-9-]{1,40}$/.test(raw.font)) return null

  const f = raw.field ?? {}
  const key = typeof f.key === 'string' && /^[a-z_]{1,20}$/.test(f.key) ? f.key : 'name'
  const label = typeof f.label === 'string' && f.label.trim() ? f.label.trim().slice(0, 40) : 'Name'
  const max = Number.isInteger(f.max) && f.max > 0 ? Math.min(f.max, NAME_MAX[shape as NamePrintShape]) : NAME_MAX[shape as NamePrintShape]

  const plate = parseColour(raw.colours?.plate)
  const letters = parseColour(raw.colours?.letters)
  if (!plate || !letters) return null

  const upcharge = typeof raw.upcharge === 'number' && Number.isFinite(raw.upcharge) && raw.upcharge >= 0 ? raw.upcharge : 0

  return { version: NAME_PRINT_VERSION, shape, font: raw.font, field: { key, label, max }, colours: { plate, letters }, upcharge }
}

/**
 * The name as it will print. Case is kept exactly as typed: a script face
 * reads "Emma", not "EMMA". Characters with no business on an ornament are
 * dropped rather than refused — a stray emoji should not cost the order.
 */
export function sanitizeName(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  return raw
    .normalize('NFC')
    .replace(NAME_DROP_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()
}

/**
 * The same rule while someone is still typing: a trailing space stays, so
 * "Mom " can become "Mom & Dad". sanitizeName runs again before it is kept.
 */
export function typingName(raw: string, max: number): string {
  return raw.normalize('NFC').replace(NAME_DROP_RE, '').replace(/\s+/g, ' ').replace(/^ /, '').slice(0, max)
}

/** The checkout/preview view of the values map: one field, sanitized. */
export function sanitizeNameValues(template: NamePrintTemplate, raw: unknown): Record<string, string> {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[template.field.key] : undefined
  return { [template.field.key]: sanitizeName(value, template.field.max) }
}
