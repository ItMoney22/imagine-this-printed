// Personalization across the Etsy boundary — both directions.
//
// David 2026-09-02: "we made a shirt for a football team we should be able to
// let the customer change name jersey number etc ... translate that to our
// Etsy store."
//
// THE SHAPE MISMATCH THIS MODULE EXISTS TO ABSORB
//
// ITP models personalization as TYPED FIELDS: a `name` field capped at 12
// letters and a `number` field capped at 2 digits, each with its own zone and
// font on the plate (backend/shared/team-template.ts).
//
// Etsy models it as ONE free-text box. A listing gets `is_personalizable`, a
// single `personalization_char_count_max`, and one line of
// `personalization_instructions` — and whatever the buyer types arrives on the
// receipt as a single string. There is no structure on that side at all.
//
// So the outbound job is to flatten typed fields into one instruction line
// good enough that buyers type something parseable, and the inbound job is to
// get that string back into the field map the press renderer needs. The
// inbound parser is deliberately forgiving: a buyer who ignores the format and
// types "SMITH 22" has still told us everything, and refusing their order over
// punctuation would be absurd. What it will NOT do is guess a value it cannot
// see — an unparsed receipt lands on the order with its raw text intact and a
// flag, so a human fixes it before the press runs rather than after.
//
// No imports beyond the template contract, which is itself import-free: the
// Step Flow renders the instruction preview in the browser from this module.
import {
  ETSY_INSTRUCTIONS_MAX,
  sanitizeFieldValue,
  type TeamField,
  type TeamTemplate,
} from './team-template.js'

/**
 * Etsy's own property id for the personalization box. It arrives on a receipt
 * transaction inside `variations` alongside real variations like Size and
 * Colour — it is not a separate field on the transaction, which is the detail
 * that makes personalization easy to miss when reading the API docs.
 */
export const ETSY_PERSONALIZATION_PROPERTY_ID = 54

/** Etsy's ceiling on personalization_char_count_max. */
export const ETSY_CHAR_COUNT_CEILING = 1024

/** Below this, a buyer with a long surname gets blocked by Etsy's own counter. */
const CHAR_COUNT_FLOOR = 32

/**
 * Head-room over the exact bytes the fields need. A buyer types
 * "Last name: VANDERMEULEN" — the label, the separator and a stray space or
 * two — and Etsy stops them at the character count we set. Being tight here
 * costs real orders and saves nothing, so the budget is generous and the
 * server sanitizes what arrives anyway.
 */
const CHAR_COUNT_SLACK = 40

export interface EtsyPersonalizationFields {
  is_personalizable: boolean
  personalization_is_required: boolean
  personalization_char_count_max: number
  personalization_instructions: string
}

function unitFor(field: Pick<TeamField, 'type'>): string {
  return field.type === 'number' ? 'digits' : 'characters'
}

/**
 * The one line Etsy shows above the buyer's box.
 *
 * Uses the operator's own text when the template carries one; otherwise it is
 * derived from the fields so a template is never published to Etsy with a
 * blank instruction — the single likeliest cause of an unparseable receipt.
 */
export function etsyPersonalizationInstructions(template: TeamTemplate): string {
  if (template.instructions) return template.instructions.slice(0, ETSY_INSTRUCTIONS_MAX)

  const example = template.fields
    .map((f) => `${f.label}: ${f.placeholder || (f.type === 'number' ? '00' : 'NAME')}`)
    .join(' | ')
  const limits = template.fields
    .map((f) => `${f.label} up to ${f.max} ${unitFor(f)}`)
    .join(', ')

  const full = `Type it exactly like this: ${example}. ${limits}. Numbers only in number fields.`
  if (full.length <= ETSY_INSTRUCTIONS_MAX) return full

  // Drop the limits sentence before the example — a buyer who sees the shape
  // types the right thing; a buyer who only sees the limits does not.
  const short = `Type it exactly like this: ${example}.`
  return short.slice(0, ETSY_INSTRUCTIONS_MAX)
}

/** How many characters Etsy lets the buyer type. */
export function etsyPersonalizationCharMax(template: TeamTemplate): number {
  const needed = template.fields.reduce(
    // label + ": " + the value itself + ", " between entries
    (sum, f) => sum + f.label.length + 2 + f.max + 2,
    0
  )
  return Math.min(ETSY_CHAR_COUNT_CEILING, Math.max(CHAR_COUNT_FLOOR, needed + CHAR_COUNT_SLACK))
}

/**
 * The four fields an Etsy listing carries for personalization.
 *
 * `personalization_is_required` is true because every field on an ITP team
 * template is required: the plate has a hole in it shaped like a name, and a
 * blank one presses a shirt nobody ordered. The product page enforces the same
 * rule by refusing Add to Cart until each field is filled.
 */
export function etsyPersonalizationFields(template: TeamTemplate): EtsyPersonalizationFields {
  return {
    is_personalizable: true,
    personalization_is_required: true,
    personalization_char_count_max: etsyPersonalizationCharMax(template),
    personalization_instructions: etsyPersonalizationInstructions(template),
  }
}

// ---------------------------------------------------------------------------
// Inbound — receipt text back into field values
// ---------------------------------------------------------------------------

/** One receipt transaction's variations, as Etsy returns them. */
interface VariationLike {
  property_id?: number
  formatted_name?: string
  formatted_value?: string
}

/**
 * Pull the buyer's personalization text off a receipt transaction.
 *
 * Matches on Etsy's property id FIRST and on the label only as a fallback: the
 * id is stable, the label is whatever locale/casing the shop is set to.
 */
export function extractPersonalizationText(
  transaction: { variations?: VariationLike[] | null } | null | undefined
): string | null {
  const variations = transaction?.variations
  if (!Array.isArray(variations)) return null
  const byId = variations.find((v) => Number(v?.property_id) === ETSY_PERSONALIZATION_PROPERTY_ID)
  const hit = byId ?? variations.find((v) => /personaliz/i.test(String(v?.formatted_name ?? '')))
  const text = hit?.formatted_value
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  return trimmed.length ? trimmed : null
}

export interface ParsedPersonalization {
  /** Sanitized, keyed by the template's own field keys. Always has every key. */
  values: Record<string, string>
  /** How the text was read. 'none' means nothing usable was found. */
  matched: 'labelled' | 'positional' | 'single' | 'none'
  /** Field keys left empty — the reason a human should look at this line. */
  missing: string[]
}

/**
 * Label synonyms a buyer actually types, on top of the field's own label and
 * key. Kept short and specific: a loose alias (e.g. bare "no") would swallow
 * the word "no" out of a surname.
 */
const SYNONYMS: Record<'text' | 'number', string[]> = {
  number: ['number', 'jersey number', 'jersey no', 'jersey', 'no', 'num', 'nr'],
  text: ['name', 'last name', 'lastname', 'surname', 'player name', 'player', 'text'],
}

/** Regex-escape a label before it becomes part of a pattern. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function labelsFor(field: TeamField): string[] {
  const own = [field.label, field.key].filter((s) => typeof s === 'string' && s.trim().length > 0)
  // Longest first, so "last name" wins over "name" on the same string.
  return [...new Set([...own, ...SYNONYMS[field.type]].map((s) => s.trim().toLowerCase()))].sort(
    (a, b) => b.length - a.length
  )
}

/** Anything a buyer uses to end one entry and start the next. */
const ENTRY_SEPARATOR = /[\n\r,;|/]+/

/**
 * Read `label: value` pairs out of the text.
 *
 * Returns the matched values plus the text with those pairs removed, so a
 * partially-labelled string ("Number: 22 SMITH") can still resolve its
 * remaining fields positionally from what is left.
 */
function readLabelled(
  template: TeamTemplate,
  text: string
): { values: Record<string, string>; rest: string } {
  const values: Record<string, string> = {}
  let rest = text

  // Where a TEXT value has to stop when the buyer used no punctuation:
  // "Name: Johnson Number: 12" must not read the name as "Johnson Number 12".
  // A number value stops at its own digits, so it needs none of this.
  const otherLabels = template.fields
    .flatMap((f) => labelsFor(f))
    .map(escapeRe)
    .sort((a, b) => b.length - a.length)
    .join('|')
  const textEnd = otherLabels
    ? `(?=$|[\\n\\r,;|/]|\\s+(?:${otherLabels})\\s*(?:[:\\-=#]|\\s))`
    : '(?=$|[\\n\\r,;|/])'

  for (const field of template.fields) {
    for (const label of labelsFor(field)) {
      // label, an optional separator (: - = #) or just whitespace, then the
      // value — digits for a number field, everything up to the next entry or
      // the next field's label for a text one.
      const value = field.type === 'number' ? `(\\d{1,${Math.max(1, field.max)}})` : `([^\\n\\r,;|/]*?)${textEnd}`
      const re = new RegExp(
        `(?:^|[\\n\\r,;|/])\\s*#?\\s*${escapeRe(label)}\\s*(?:[:\\-=#]\\s*|\\s+)${value}`,
        'i'
      )
      const m = re.exec(rest)
      if (!m) continue
      const raw = (m[1] ?? '').trim()
      if (!raw) continue
      const clean = sanitizeFieldValue(field, raw)
      if (!clean) continue
      values[field.key] = clean
      rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)
      break
    }
  }

  return { values, rest }
}

/**
 * Read values out of text carrying no labels at all — "SMITH 22", "22 SMITH",
 * "Smith / 22".
 *
 * Numbers are claimed first and from the END, because a jersey number is
 * almost always trailing and a surname never contains a bare number. What is
 * left goes to the text fields in template order.
 */
function readPositional(
  template: TeamTemplate,
  text: string,
  already: Record<string, string>
): Record<string, string> {
  const values: Record<string, string> = { ...already }
  let tokens = text
    .split(ENTRY_SEPARATOR)
    .join(' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)

  for (const field of template.fields) {
    if (values[field.key]) continue
    if (field.type !== 'number') continue
    const idx = [...tokens].reverse().findIndex((t) => /^#?\d+$/.test(t))
    if (idx === -1) continue
    const realIdx = tokens.length - 1 - idx
    const clean = sanitizeFieldValue(field, tokens[realIdx])
    if (!clean) continue
    values[field.key] = clean
    tokens = [...tokens.slice(0, realIdx), ...tokens.slice(realIdx + 1)]
  }

  for (const field of template.fields) {
    if (values[field.key]) continue
    if (field.type === 'number') continue
    if (!tokens.length) continue
    // One text field takes everything that is left (surnames have spaces:
    // "VAN DYKE"); with several, each takes one token in order.
    const remainingText = template.fields.filter((f) => f.type !== 'number' && !values[f.key])
    const take = remainingText.length === 1 ? tokens.join(' ') : tokens[0]
    const clean = sanitizeFieldValue(field, take)
    if (!clean) continue
    values[field.key] = clean
    tokens = remainingText.length === 1 ? [] : tokens.slice(1)
  }

  return values
}

/**
 * Turn one Etsy personalization string into this template's field values.
 *
 * Never throws and never invents: a field it cannot find stays empty and is
 * named in `missing`, which is what puts the order in front of a human.
 */
export function parsePersonalizationText(
  template: TeamTemplate,
  text: string | null | undefined
): ParsedPersonalization {
  const empty: Record<string, string> = {}
  for (const field of template.fields) empty[field.key] = ''

  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) {
    return { values: empty, matched: 'none', missing: template.fields.map((f) => f.key) }
  }

  // A single-field template takes the whole string — there is nothing to split
  // and a buyer typing "Go Wildcats" means all of it.
  if (template.fields.length === 1) {
    const field = template.fields[0]
    const labelled = readLabelled(template, raw)
    const value = labelled.values[field.key] || sanitizeFieldValue(field, raw)
    return {
      values: { ...empty, [field.key]: value },
      matched: value ? 'single' : 'none',
      missing: value ? [] : [field.key],
    }
  }

  const { values: labelled, rest } = readLabelled(template, raw)
  const anyLabelled = Object.keys(labelled).length > 0
  const values = readPositional(template, anyLabelled ? rest : raw, labelled)

  const filled: Record<string, string> = { ...empty }
  for (const field of template.fields) filled[field.key] = values[field.key] ?? ''
  const missing = template.fields.filter((f) => !filled[f.key]).map((f) => f.key)

  const matched: ParsedPersonalization['matched'] =
    missing.length === template.fields.length ? 'none' : anyLabelled ? 'labelled' : 'positional'

  return { values: filled, matched, missing }
}
