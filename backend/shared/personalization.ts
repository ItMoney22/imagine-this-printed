// Buyer personalization — the team / name / number a customer types on a
// "Custom Football Mom Shirt".
//
// David 2026-09-09, after linking a live Etsy listing: "i need to be able to add
// a listing just like this ... Both site and Etsy" / "separate fields for team,
// name, and number - build it".
//
// This is the ONE definition, deliberately in backend/shared/ (like
// catalog-capability.ts and promos.ts) because five callers must agree on it:
//   - src/pages/ProductPage.tsx      renders the fields and validates on add
//   - src/context/CartContext.tsx    keys two different jerseys apart
//   - backend/routes/stripe.ts       re-validates server-side and stores it
//   - backend/services/etsy.ts       turns it into Etsy personalization box
//   - backend/worker/etsy-receipt-ingest.ts  reads the buyer's text back
// If those disagreed, a buyer could type something our own site accepts and the
// print floor cannot use.
//
// A NOTE ON ETSY: Etsy exposes exactly ONE free-text personalization box per
// listing, not three fields. So the three fields are composed into one labelled
// string on the way out (`formatPersonalizationForEtsy`) and parsed back on the
// way in (`parseEtsyPersonalization`). The parser keys off the CANONICAL labels
// (Team/Name/Number), which is why `etsyPersonalizationInstructions` always
// prints those words even when a listing renames a field for its own storefront
// UI — otherwise the round trip would silently break for that listing.

export type PersonalizationFieldId = 'team' | 'name' | 'number'

/** Render/validate order. Also the signature order, so a signature never
 *  depends on the key order of the object it was built from. */
export const PERSONALIZATION_FIELD_ORDER: PersonalizationFieldId[] = ['team', 'name', 'number']

export interface PersonalizationFieldConfig {
  id: PersonalizationFieldId
  label: string
  required: boolean
  maxLength: number
}

/** Defaults for a product that says no more than `{ personalization: { enabled: true } }`.
 *  `number` is 2 because football jerseys run 0-99; a listing that needs 3 says so. */
export const DEFAULT_PERSONALIZATION_FIELDS: Record<PersonalizationFieldId, Omit<PersonalizationFieldConfig, 'id'>> = {
  team: { label: 'Team', required: true, maxLength: 20 },
  name: { label: 'Name', required: true, maxLength: 16 },
  number: { label: 'Number', required: true, maxLength: 2 }
}

/** What the buyer typed. `raw` is only ever set on the Etsy rail — it is the
 *  unmodified contents of Etsy's single box, kept so an order whose text we
 *  could not parse is still fulfillable by a human. */
export interface PersonalizationValues {
  team?: string
  name?: string
  number?: string
  raw?: string
}

export interface PersonalizationConfig {
  fields: PersonalizationFieldConfig[]
}

export type PersonalizationValidation =
  | { ok: true; values: PersonalizationValues }
  | { ok: false; errors: Partial<Record<PersonalizationFieldId, string>> }

/** Characters that would break the SVG text node the print zone is drawn with,
 *  or that simply cannot be printed (newlines, tabs, control codes). */
// eslint-disable-next-line no-control-regex -- matching control characters is exactly the point: they must never reach an SVG text node on a print file.
const UNPRINTABLE_RE = /[\u0000-\u001F\u007F]/
/** Same pattern, global, for stripping rather than detecting. Built from the
 *  source above so the two can never drift apart. */
const UNPRINTABLE_GLOBAL_RE = new RegExp(UNPRINTABLE_RE.source, 'g')

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Reads `product.metadata.personalization`. Returns null for the entire
 * ordinary catalogue — this feature is strictly opt-in per product, so nothing
 * changes for the ~2,600 products that never set it.
 */
export function resolvePersonalization(
  product: { metadata?: unknown } | null | undefined
): PersonalizationConfig | null {
  const block = isPlainObject(product?.metadata) ? (product!.metadata as any).personalization : null
  if (!isPlainObject(block)) return null
  if (block.enabled !== true) return null

  const overrides = isPlainObject(block.fields) ? block.fields : {}

  const fields: PersonalizationFieldConfig[] = []
  for (const id of PERSONALIZATION_FIELD_ORDER) {
    const base = DEFAULT_PERSONALIZATION_FIELDS[id]
    const over = isPlainObject(overrides[id]) ? (overrides[id] as Record<string, unknown>) : {}
    if (over.enabled === false) continue

    const maxLength = typeof over.maxLength === 'number' && Number.isInteger(over.maxLength) && over.maxLength > 0
      ? over.maxLength
      : base.maxLength

    fields.push({
      id,
      label: typeof over.label === 'string' && over.label.trim() ? over.label.trim() : base.label,
      required: typeof over.required === 'boolean' ? over.required : base.required,
      maxLength
    })
  }

  // Every field switched off is not a personalizable product — returning an
  // empty form would render a heading with no inputs under it.
  return fields.length ? { fields } : null
}

/**
 * Server-authoritative validation. The storefront runs this too, so the buyer
 * sees the same message before checkout rather than after paying.
 *
 * Values for fields the listing does not use are DROPPED, not just ignored — a
 * crafted cart payload must not smuggle a team name onto a name-only listing
 * and have it appear on the print sheet.
 */
export function validatePersonalization(
  config: PersonalizationConfig,
  values: PersonalizationValues | null | undefined
): PersonalizationValidation {
  const input = isPlainObject(values) ? (values as PersonalizationValues) : {}
  const clean: PersonalizationValues = {}
  const errors: Partial<Record<PersonalizationFieldId, string>> = {}

  for (const field of config.fields) {
    const rawValue = input[field.id]
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''

    if (!value) {
      if (field.required) errors[field.id] = `${field.label} is required`
      continue
    }
    if (UNPRINTABLE_RE.test(value)) {
      errors[field.id] = `${field.label} contains characters we cannot print`
      continue
    }
    if (field.id === 'number' && !/^\d+$/.test(value)) {
      errors[field.id] = `${field.label} must be digits only`
      continue
    }
    if (value.length > field.maxLength) {
      errors[field.id] = `${field.label} must be ${field.maxLength} characters or fewer`
      continue
    }
    clean[field.id] = value
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values: clean }
}

/**
 * The cart dedupe key. Without this in the ADD_TO_CART comparison, a parent
 * buying one shirt for Smith #12 and another for Jones #7 — same product, same
 * size, same colour — gets ONE line at quantity 2 and the floor prints the same
 * jersey twice.
 */
export function personalizationSignature(values?: PersonalizationValues | null): string {
  if (!isPlainObject(values)) return ''
  const parts: string[] = []
  for (const id of [...PERSONALIZATION_FIELD_ORDER, 'raw' as const]) {
    const v = (values as Record<string, unknown>)[id]
    if (typeof v === 'string' && v.trim()) parts.push(`${id}=${v.trim()}`)
  }
  return parts.join('|')
}

/** True when the buyer actually supplied something to print. */
export function isPersonalized(values?: PersonalizationValues | null): boolean {
  return personalizationSignature(values) !== ''
}

/** Example values used only to show Etsy buyers the shape of the answer. */
const ETSY_EXAMPLES: Record<PersonalizationFieldId, string> = {
  team: 'Wildcats',
  name: 'Smith',
  number: '12'
}

/**
 * The text Etsy shows above its personalization box. Capped at Etsy 255-char
 * limit. Uses the CANONICAL labels on purpose — see the file header.
 */
export function etsyPersonalizationInstructions(config: PersonalizationConfig): string {
  const example = config.fields
    .map(f => `${DEFAULT_PERSONALIZATION_FIELDS[f.id].label}: ${ETSY_EXAMPLES[f.id]}`)
    .join(', ')
  const text = `Spelled exactly as you want it printed. Copy this format - ${example}`
  return text.length > 255 ? text.slice(0, 255) : text
}

/** Compose the three fields into Etsy single box (also what we echo back on order confirmations). */
export function formatPersonalizationForEtsy(values?: PersonalizationValues | null): string {
  if (!isPlainObject(values)) return ''
  return PERSONALIZATION_FIELD_ORDER
    .filter(id => typeof (values as any)[id] === 'string' && (values as any)[id].trim())
    .map(id => `${DEFAULT_PERSONALIZATION_FIELDS[id].label}: ${(values as any)[id].trim()}`)
    .join(', ')
}

// Finds "Team:", "Name -", "NUMBER :" etc. anywhere in the buyer's text.
const LABEL_RE = /\b(team|name|number)\b\s*[:-]\s*/gi
// Separator debris left on the end of a value when labels are comma/semicolon/pipe delimited.
const TRAILING_SEPARATORS_RE = /[\s,;|]+$/

/**
 * Read Etsy single box back into the three fields.
 *
 * Works by locating every label and slicing the text BETWEEN them, rather than
 * matching a value pattern — that is what keeps "Team: North Valley Wildcats"
 * intact and still stops "Team: Wildcats Name: Smith" (no separator at all)
 * from swallowing the next label into the team name.
 *
 * `raw` is always preserved. A buyer who ignores the format entirely ("go
 * wildcats!! my son bobby wears 12") still produces a fulfillable order — the
 * floor reads the raw line — instead of an empty personalization.
 */
export function parseEtsyPersonalization(text?: string | null): PersonalizationValues {
  if (typeof text !== 'string' || !text.trim()) return {}

  const matches: { id: PersonalizationFieldId; start: number; end: number }[] = []
  LABEL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LABEL_RE.exec(text)) !== null) {
    matches.push({
      id: m[1].toLowerCase() as PersonalizationFieldId,
      start: m.index,
      end: m.index + m[0].length
    })
  }

  const out: PersonalizationValues = { raw: text }
  matches.forEach((match, i) => {
    const stop = i + 1 < matches.length ? matches[i + 1].start : text.length
    const value = text.slice(match.end, stop).replace(TRAILING_SEPARATORS_RE, '').trim()
    // First label wins if a buyer repeats one; blank values are omitted rather
    // than stored as an empty string.
    if (value && out[match.id] === undefined) out[match.id] = value
  })

  return out
}

/** Etsy caps a personalization box at 1024 characters. */
const ETSY_PERSONALIZATION_CHAR_CEILING = 1024
/** Headroom over the exact format length, for buyers who add a word of their own. */
const ETSY_PERSONALIZATION_CHAR_MARGIN = 40

export interface EtsyPersonalizationFields {
  is_personalizable: boolean
  personalization_is_required?: boolean
  personalization_char_count_max?: number
  personalization_instructions?: string
}

/**
 * The personalization half of an Etsy listing body — used by BOTH the create
 * and the update path in services/etsy.ts, so a listing cannot end up
 * personalizable on publish and not on reprice.
 *
 * `is_personalizable: false` is sent explicitly for ordinary products: on the
 * update path a listing that was personalizable must be able to go back to
 * being plain, and omitting the field would leave the old value in place.
 */
export function etsyPersonalizationFields(
  config: PersonalizationConfig | null | undefined
): EtsyPersonalizationFields {
  if (!config || !config.fields.length) return { is_personalizable: false }

  // Exact length of the longest correctly-formatted answer, plus margin.
  const formatLength =
    config.fields.reduce(
      (sum, f) => sum + DEFAULT_PERSONALIZATION_FIELDS[f.id].label.length + 2 + f.maxLength,
      0
    ) + Math.max(0, config.fields.length - 1) * 2

  return {
    is_personalizable: true,
    // Etsy has ONE box, so it is required if any single field is.
    personalization_is_required: config.fields.some(f => f.required),
    personalization_char_count_max: Math.min(
      ETSY_PERSONALIZATION_CHAR_CEILING,
      formatLength + ETSY_PERSONALIZATION_CHAR_MARGIN
    ),
    personalization_instructions: etsyPersonalizationInstructions(config)
  }
}

/** Hard ceiling for a single personalization field arriving from an untrusted
 *  payload. Deliberately far above the per-listing maxLength (20/16/2) — this
 *  is the "cannot write a novel into the database" guard, not the print rule. */
const MAX_SANITIZED_FIELD_CHARS = 64
/** Etsy own personalization ceiling, applied to the preserved raw text. */
const MAX_SANITIZED_RAW_CHARS = 1024

/**
 * Cleans personalization arriving from a client cart payload or an Etsy
 * receipt. Applies only the HARD safety rules — strip control characters, drop
 * non-strings and unknown keys, cap the length — because this runs where the
 * product row (and therefore its per-field config) is not loaded.
 *
 * The config-aware rules (which fields are required, per-field maxLength,
 * digits-only numbers) are enforced by `validatePersonalization` on the
 * storefront before checkout.
 */
export function sanitizePersonalizationInput(
  values: unknown
): PersonalizationValues | undefined {
  if (!isPlainObject(values)) return undefined

  const out: PersonalizationValues = {}
  for (const id of [...PERSONALIZATION_FIELD_ORDER, 'raw' as const]) {
    const value = (values as Record<string, unknown>)[id]
    if (typeof value !== 'string') continue
    const cleaned = value
      .replace(UNPRINTABLE_GLOBAL_RE, '')
      .trim()
      .slice(0, id === 'raw' ? MAX_SANITIZED_RAW_CHARS : MAX_SANITIZED_FIELD_CHARS)
    if (cleaned) out[id] = cleaned
  }

  return Object.keys(out).length ? out : undefined
}
