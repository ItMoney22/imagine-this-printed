// Tests for the ONE definition of buyer personalization — the team / name /
// number a customer types on a "Custom Football Mom Shirt".
//
// This module is read by the storefront (ProductPage, CartContext), the server
// price/checkout path (routes/stripe.ts), the Etsy publisher (services/etsy.ts)
// and the Etsy receipt poller (worker/etsy-receipt-ingest.ts). If those four
// disagreed about what a valid personalization is, a buyer could type something
// our own site accepts and the print floor cannot use.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PERSONALIZATION_FIELDS,
  resolvePersonalization,
  validatePersonalization,
  personalizationSignature,
  isPersonalized,
  etsyPersonalizationInstructions,
  formatPersonalizationForEtsy,
  parseEtsyPersonalization,
  etsyPersonalizationFields,
  sanitizePersonalizationInput
} from './personalization.js'

const enabled = (extra: Record<string, unknown> = {}) =>
  ({ metadata: { personalization: { enabled: true, ...extra } } }) as any

describe('resolvePersonalization', () => {
  it('returns null for an ordinary product so nothing changes for the whole catalogue', () => {
    expect(resolvePersonalization({ metadata: {} } as any)).toBeNull()
    expect(resolvePersonalization({} as any)).toBeNull()
    expect(resolvePersonalization({ metadata: null } as any)).toBeNull()
  })

  it('returns null when the block exists but is switched off', () => {
    expect(resolvePersonalization({ metadata: { personalization: { enabled: false } } } as any)).toBeNull()
  })

  it('gives a bare {enabled:true} product all three fields in order', () => {
    const cfg = resolvePersonalization(enabled())
    expect(cfg?.fields.map(f => f.id)).toEqual(['team', 'name', 'number'])
  })

  it('defaults every field to required — a half-filled jersey is unprintable', () => {
    const cfg = resolvePersonalization(enabled())
    expect(cfg?.fields.every(f => f.required)).toBe(true)
  })

  it('defaults the number to two digits, the real football range', () => {
    const number = resolvePersonalization(enabled())?.fields.find(f => f.id === 'number')
    expect(number?.maxLength).toBe(2)
  })

  it('lets a product override one field without redefining the others', () => {
    const cfg = resolvePersonalization(enabled({ fields: { number: { required: false, maxLength: 3 } } }))
    const number = cfg?.fields.find(f => f.id === 'number')
    const team = cfg?.fields.find(f => f.id === 'team')
    expect(number?.required).toBe(false)
    expect(number?.maxLength).toBe(3)
    // untouched fields keep the defaults
    expect(team?.maxLength).toBe(DEFAULT_PERSONALIZATION_FIELDS.team.maxLength)
    expect(team?.required).toBe(true)
  })

  it('drops a field the product switches off (a name-only listing)', () => {
    const cfg = resolvePersonalization(enabled({ fields: { team: { enabled: false }, number: { enabled: false } } }))
    expect(cfg?.fields.map(f => f.id)).toEqual(['name'])
  })

  it('returns null when the product switches off every field rather than an empty form', () => {
    const cfg = resolvePersonalization(enabled({
      fields: { team: { enabled: false }, name: { enabled: false }, number: { enabled: false } }
    }))
    expect(cfg).toBeNull()
  })

  it('lets a product retitle a field for a non-football listing', () => {
    const cfg = resolvePersonalization(enabled({ fields: { team: { label: 'School' } } }))
    expect(cfg?.fields.find(f => f.id === 'team')?.label).toBe('School')
  })

  it('ignores junk in the metadata instead of throwing on a bad row', () => {
    expect(resolvePersonalization({ metadata: { personalization: 'yes' } } as any)).toBeNull()
    expect(resolvePersonalization(enabled({ fields: 'nope' }))?.fields).toHaveLength(3)
  })
})

describe('validatePersonalization', () => {
  const cfg = resolvePersonalization(enabled())!

  it('accepts a complete jersey and returns the cleaned values', () => {
    const res = validatePersonalization(cfg, { team: 'Wildcats', name: 'Smith', number: '12' })
    expect(res.ok).toBe(true)
    expect(res.ok && res.values).toEqual({ team: 'Wildcats', name: 'Smith', number: '12' })
  })

  it('trims what the buyer typed so trailing spaces never reach the print file', () => {
    const res = validatePersonalization(cfg, { team: '  Wildcats  ', name: ' Smith ', number: ' 12 ' })
    expect(res.ok && res.values).toEqual({ team: 'Wildcats', name: 'Smith', number: '12' })
  })

  it('rejects a missing required field, naming that field', () => {
    const res = validatePersonalization(cfg, { team: 'Wildcats', name: '', number: '12' })
    expect(res.ok).toBe(false)
    expect(!res.ok && res.errors.name).toMatch(/required/i)
    expect(!res.ok && res.errors.team).toBeUndefined()
  })

  it('treats whitespace-only as missing rather than printing a blank', () => {
    const res = validatePersonalization(cfg, { team: '   ', name: 'Smith', number: '12' })
    expect(res.ok).toBe(false)
    expect(!res.ok && res.errors.team).toMatch(/required/i)
  })

  it('reports every bad field at once so the buyer fixes the form in one pass', () => {
    const res = validatePersonalization(cfg, { team: '', name: '', number: '' })
    expect(!res.ok && Object.keys(res.errors).sort()).toEqual(['name', 'number', 'team'])
  })

  it('rejects text longer than the field allows — it will not fit the print zone', () => {
    const res = validatePersonalization(cfg, { team: 'W'.repeat(21), name: 'Smith', number: '12' })
    expect(!res.ok && res.errors.team).toMatch(/20/)
  })

  it('accepts text exactly at the limit', () => {
    const res = validatePersonalization(cfg, { team: 'W'.repeat(20), name: 'Smith', number: '12' })
    expect(res.ok).toBe(true)
  })

  it('rejects a non-numeric jersey number', () => {
    const res = validatePersonalization(cfg, { team: 'Wildcats', name: 'Smith', number: '1A' })
    expect(!res.ok && res.errors.number).toMatch(/digits/i)
  })

  it('keeps a leading zero — 07 is a real jersey number, not the integer 7', () => {
    const res = validatePersonalization(cfg, { team: 'Wildcats', name: 'Smith', number: '07' })
    expect(res.ok && res.values.number).toBe('07')
  })

  it('rejects newlines and control characters, which would break the SVG print zone', () => {
    const res = validatePersonalization(cfg, { team: 'Wild\ncats', name: 'Smith', number: '12' })
    expect(res.ok).toBe(false)
    expect(!res.ok && res.errors.team).toBeTruthy()
  })

  it('accepts the apostrophes and hyphens real surnames actually contain', () => {
    const res = validatePersonalization(cfg, { team: "St. Mary's", name: "O'Brien-Smith", number: '7' })
    expect(res.ok).toBe(true)
  })

  it('ignores a field the product switched off instead of demanding it', () => {
    const nameOnly = resolvePersonalization(enabled({
      fields: { team: { enabled: false }, number: { enabled: false } }
    }))!
    const res = validatePersonalization(nameOnly, { name: 'Smith' })
    expect(res.ok).toBe(true)
    expect(res.ok && res.values).toEqual({ name: 'Smith' })
  })

  it('drops a value for a switched-off field rather than smuggling it to the floor', () => {
    const nameOnly = resolvePersonalization(enabled({
      fields: { team: { enabled: false }, number: { enabled: false } }
    }))!
    const res = validatePersonalization(nameOnly, { name: 'Smith', team: 'Wildcats' })
    expect(res.ok && res.values.team).toBeUndefined()
  })

  it('lets an optional field be left blank', () => {
    const optional = resolvePersonalization(enabled({ fields: { number: { required: false } } }))!
    const res = validatePersonalization(optional, { team: 'Wildcats', name: 'Smith', number: '' })
    expect(res.ok).toBe(true)
    expect(res.ok && res.values.number).toBeUndefined()
  })

  it('survives null/undefined input without throwing', () => {
    expect(validatePersonalization(cfg, null as any).ok).toBe(false)
    expect(validatePersonalization(cfg, undefined as any).ok).toBe(false)
  })
})

describe('personalizationSignature — the cart dedupe key', () => {
  it('is empty for a line with no personalization', () => {
    expect(personalizationSignature(undefined)).toBe('')
    expect(personalizationSignature(null)).toBe('')
    expect(personalizationSignature({})).toBe('')
  })

  it('matches for two identical jerseys so they stack as quantity 2', () => {
    const a = personalizationSignature({ team: 'Wildcats', name: 'Smith', number: '12' })
    const b = personalizationSignature({ team: 'Wildcats', name: 'Smith', number: '12' })
    expect(a).toBe(b)
  })

  it('DIFFERS for two players on the same team — the bug that would merge two shirts into one line', () => {
    const smith = personalizationSignature({ team: 'Wildcats', name: 'Smith', number: '12' })
    const jones = personalizationSignature({ team: 'Wildcats', name: 'Jones', number: '7' })
    expect(smith).not.toBe(jones)
  })

  it('differs when only the number changes', () => {
    expect(personalizationSignature({ team: 'W', name: 'S', number: '12' }))
      .not.toBe(personalizationSignature({ team: 'W', name: 'S', number: '13' }))
  })

  it('does not depend on key order', () => {
    expect(personalizationSignature({ number: '12', name: 'Smith', team: 'Wildcats' }))
      .toBe(personalizationSignature({ team: 'Wildcats', name: 'Smith', number: '12' }))
  })
})

describe('isPersonalized', () => {
  it('is false for nothing and for an all-blank object', () => {
    expect(isPersonalized(undefined)).toBe(false)
    expect(isPersonalized({})).toBe(false)
    expect(isPersonalized({ team: '', name: '', number: '' })).toBe(false)
  })

  it('is true as soon as one field carries text', () => {
    expect(isPersonalized({ name: 'Smith' })).toBe(true)
  })

  it('is true when only the raw Etsy text survived parsing', () => {
    expect(isPersonalized({ raw: 'go wildcats' })).toBe(true)
  })
})

describe('etsyPersonalizationInstructions', () => {
  const cfg = resolvePersonalization(enabled())!

  it('tells the buyer the exact labelled format the parser reads back', () => {
    const text = etsyPersonalizationInstructions(cfg)
    expect(text).toMatch(/Team:/)
    expect(text).toMatch(/Name:/)
    expect(text).toMatch(/Number:/)
  })

  it('fits inside Etsy 255-character instruction limit', () => {
    expect(etsyPersonalizationInstructions(cfg).length).toBeLessThanOrEqual(255)
  })

  it('only asks for the fields the listing actually uses', () => {
    const nameOnly = resolvePersonalization(enabled({
      fields: { team: { enabled: false }, number: { enabled: false } }
    }))!
    const text = etsyPersonalizationInstructions(nameOnly)
    expect(text).toMatch(/Name:/)
    expect(text).not.toMatch(/Team:/)
  })
})

describe('formatPersonalizationForEtsy / parseEtsyPersonalization — the one-box round trip', () => {
  it('round-trips a full jersey through Etsy single text box', () => {
    const values = { team: 'Wildcats', name: 'Smith', number: '12' }
    const parsed = parseEtsyPersonalization(formatPersonalizationForEtsy(values))
    expect(parsed.team).toBe('Wildcats')
    expect(parsed.name).toBe('Smith')
    expect(parsed.number).toBe('12')
  })

  it('parses what a real buyer types, with newlines and loose casing', () => {
    const parsed = parseEtsyPersonalization('team: Wildcats\nNAME: Smith\nnumber: 12')
    expect(parsed).toMatchObject({ team: 'Wildcats', name: 'Smith', number: '12' })
  })

  it('parses a single line separated by commas', () => {
    const parsed = parseEtsyPersonalization('Team: Wildcats, Name: Smith, Number: 12')
    expect(parsed).toMatchObject({ team: 'Wildcats', name: 'Smith', number: '12' })
  })

  it('ALWAYS keeps the raw text so an unparseable order is never lost', () => {
    const parsed = parseEtsyPersonalization('go wildcats!! my son bobby wears 12')
    expect(parsed.raw).toBe('go wildcats!! my son bobby wears 12')
  })

  it('keeps the raw text even on a clean parse, so the floor can see exactly what was typed', () => {
    const parsed = parseEtsyPersonalization('Team: Wildcats, Name: Smith, Number: 12')
    expect(parsed.raw).toBe('Team: Wildcats, Name: Smith, Number: 12')
  })

  it('fills in only the labels it actually found', () => {
    const parsed = parseEtsyPersonalization('Name: Smith')
    expect(parsed.name).toBe('Smith')
    expect(parsed.team).toBeUndefined()
    expect(parsed.number).toBeUndefined()
  })

  it('returns an empty object for an empty box', () => {
    expect(parseEtsyPersonalization('')).toEqual({})
    expect(parseEtsyPersonalization(null)).toEqual({})
    expect(parseEtsyPersonalization(undefined)).toEqual({})
  })

  it('tolerates the dash and pipe separators buyers use instead of commas', () => {
    expect(parseEtsyPersonalization('Team: Wildcats | Name: Smith | Number: 12'))
      .toMatchObject({ team: 'Wildcats', name: 'Smith', number: '12' })
    expect(parseEtsyPersonalization('Team - Wildcats; Name - Smith; Number - 12'))
      .toMatchObject({ team: 'Wildcats', name: 'Smith', number: '12' })
  })

  it('does not swallow the next label into the previous value', () => {
    const parsed = parseEtsyPersonalization('Team: Wildcats Name: Smith Number: 12')
    expect(parsed.team).toBe('Wildcats')
    expect(parsed.name).toBe('Smith')
  })

  it('keeps a multi-word team name intact', () => {
    expect(parseEtsyPersonalization('Team: North Valley Wildcats, Name: Smith, Number: 12').team)
      .toBe('North Valley Wildcats')
  })

  it('omits a field the buyer left blank rather than storing an empty string', () => {
    const parsed = parseEtsyPersonalization('Team: , Name: Smith, Number: 12')
    expect(parsed.team).toBeUndefined()
    expect(parsed.name).toBe('Smith')
  })

  it('formats only the fields that have values', () => {
    expect(formatPersonalizationForEtsy({ name: 'Smith' })).toBe('Name: Smith')
  })

  it('returns an empty string when there is nothing to say', () => {
    expect(formatPersonalizationForEtsy({})).toBe('')
    expect(formatPersonalizationForEtsy(undefined)).toBe('')
  })
})

describe('etsyPersonalizationFields — what goes on the listing itself', () => {
  it('switches personalization OFF for an ordinary product', () => {
    expect(etsyPersonalizationFields(null)).toEqual({ is_personalizable: false })
  })

  it('turns the box on for a personalized listing', () => {
    const fields = etsyPersonalizationFields(resolvePersonalization(enabled()))
    expect(fields.is_personalizable).toBe(true)
  })

  it('makes the box required when any field is required', () => {
    const fields = etsyPersonalizationFields(resolvePersonalization(enabled()))
    expect(fields.personalization_is_required).toBe(true)
  })

  it('leaves the box optional when every field is optional', () => {
    const cfg = resolvePersonalization(enabled({
      fields: { team: { required: false }, name: { required: false }, number: { required: false } }
    }))
    expect(etsyPersonalizationFields(cfg).personalization_is_required).toBe(false)
  })

  it('carries the instructions the parser can read back', () => {
    const fields = etsyPersonalizationFields(resolvePersonalization(enabled()))
    expect(fields.personalization_instructions).toMatch(/Team:/)
    expect(fields.personalization_instructions).toMatch(/Number:/)
  })

  it('allows enough characters for the whole labelled format the buyer is told to type', () => {
    const cfg = resolvePersonalization(enabled())!
    const longest = formatPersonalizationForEtsy({
      team: 'W'.repeat(20), name: 'N'.repeat(16), number: '99'
    })
    expect(etsyPersonalizationFields(cfg).personalization_char_count_max!)
      .toBeGreaterThanOrEqual(longest.length)
  })

  it('never exceeds Etsy 1024-character ceiling', () => {
    const cfg = resolvePersonalization(enabled({ fields: { team: { maxLength: 5000 } } }))
    expect(etsyPersonalizationFields(cfg).personalization_char_count_max!).toBeLessThanOrEqual(1024)
  })
})

describe('sanitizePersonalizationInput — the untrusted-payload guard', () => {
  it('passes an ordinary jersey straight through', () => {
    expect(sanitizePersonalizationInput({ team: 'Wildcats', name: 'Smith', number: '12' }))
      .toEqual({ team: 'Wildcats', name: 'Smith', number: '12' })
  })

  it('returns undefined for anything that is not an object', () => {
    expect(sanitizePersonalizationInput(null)).toBeUndefined()
    expect(sanitizePersonalizationInput('Smith' as any)).toBeUndefined()
    expect(sanitizePersonalizationInput(['Smith'] as any)).toBeUndefined()
  })

  it('returns undefined when nothing survives, rather than an empty object', () => {
    expect(sanitizePersonalizationInput({})).toBeUndefined()
    expect(sanitizePersonalizationInput({ name: '   ' })).toBeUndefined()
  })

  it('drops keys that are not personalization fields', () => {
    expect(sanitizePersonalizationInput({ name: 'Smith', evil: 'x' } as any))
      .toEqual({ name: 'Smith' })
  })

  it('drops non-string values instead of coercing them', () => {
    expect(sanitizePersonalizationInput({ name: 'Smith', number: 12 as any }))
      .toEqual({ name: 'Smith' })
  })

  it('strips control characters a crafted payload could use to break the print SVG', () => {
    const out = sanitizePersonalizationInput({ name: 'Sm\u0000i\u001Fth' })
    expect(out?.name).toBe('Smith')
  })

  it('caps an absurdly long field so a crafted cart cannot write a novel to the DB', () => {
    const out = sanitizePersonalizationInput({ name: 'N'.repeat(5000) })
    expect(out!.name!.length).toBeLessThanOrEqual(64)
  })

  it('keeps the raw Etsy text but caps it at Etsy own ceiling', () => {
    const out = sanitizePersonalizationInput({ raw: 'R'.repeat(5000) })
    expect(out!.raw!.length).toBeLessThanOrEqual(1024)
  })

  it('trims whitespace', () => {
    expect(sanitizePersonalizationInput({ name: '  Smith  ' })).toEqual({ name: 'Smith' })
  })
})
