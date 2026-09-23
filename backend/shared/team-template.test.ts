import { describe, it, expect } from 'vitest'
import {
  parseTeamTemplate,
  sanitizeFieldValue,
  sanitizeValues,
  templateCacheKey,
  type TeamField,
  type TeamTemplate,
} from './team-template.js'

const NAME_FIELD: TeamField = {
  key: 'name',
  label: 'Last name',
  type: 'text',
  max: 12,
  uppercase: true,
  zone: { x: 220, y: 380, w: 3160, h: 900 },
  arch: 18,
  font: { family: 'collegiate-slab', src: 'house' },
  fill: '#8C1D2D',
  strokes: [{ color: '#F2E0BC', w: 26 }],
  offset: null,
}

const NUMBER_FIELD: TeamField = {
  key: 'number',
  label: 'Number',
  type: 'number',
  max: 2,
  uppercase: false,
  zone: { x: 900, y: 1500, w: 1800, h: 2400 },
  arch: 0,
  font: { family: 'varsity-block', src: 'house' },
  fill: '#C9A227',
  strokes: [{ color: '#8C1D2D', w: 34 }],
  offset: null,
}

const TEMPLATE: TeamTemplate = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sourceAssetId: null,
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 0,
  fields: [NAME_FIELD, NUMBER_FIELD],
}

describe('parseTeamTemplate', () => {
  it('accepts a well-formed template', () => {
    expect(parseTeamTemplate(TEMPLATE)).toEqual(TEMPLATE)
  })

  it('reads the template out of a product metadata object', () => {
    expect(parseTeamTemplate({ team_template: TEMPLATE })).toEqual(TEMPLATE)
  })

  it('returns null for a product with no template', () => {
    expect(parseTeamTemplate(undefined)).toBeNull()
    expect(parseTeamTemplate(null)).toBeNull()
    expect(parseTeamTemplate({})).toBeNull()
    expect(parseTeamTemplate({ garment: { blank: true } })).toBeNull()
  })

  it('rejects a template with no fields — there would be nothing to personalize', () => {
    expect(parseTeamTemplate({ ...TEMPLATE, fields: [] })).toBeNull()
  })

  it('rejects a zone that escapes the canvas', () => {
    const bad = {
      ...TEMPLATE,
      fields: [{ ...NAME_FIELD, zone: { x: 3500, y: 380, w: 3160, h: 900 } }],
    }
    expect(parseTeamTemplate(bad)).toBeNull()
  })

  it('rejects a future version rather than guessing at it', () => {
    expect(parseTeamTemplate({ ...TEMPLATE, version: 2 })).toBeNull()
  })

  it('rejects a colour that is not hex — it would reach an SVG attribute', () => {
    expect(parseTeamTemplate({ ...TEMPLATE, fields: [{ ...NAME_FIELD, fill: 'red; }' }] })).toBeNull()
  })

  it('rejects duplicate field keys, which would collide in the values map', () => {
    expect(parseTeamTemplate({ ...TEMPLATE, fields: [NAME_FIELD, NAME_FIELD] })).toBeNull()
  })

  it('never throws on hostile input — a product page must still render', () => {
    expect(() => parseTeamTemplate('nonsense')).not.toThrow()
    expect(() => parseTeamTemplate(42)).not.toThrow()
    expect(() => parseTeamTemplate({ team_template: { fields: 'no' } })).not.toThrow()
    expect(parseTeamTemplate({ team_template: { fields: 'no' } })).toBeNull()
  })
})

describe('sanitizeFieldValue', () => {
  it('uppercases and trims a name', () => {
    expect(sanitizeFieldValue(NAME_FIELD, '  smith ')).toBe('SMITH')
  })

  it('keeps the characters real surnames actually use', () => {
    expect(sanitizeFieldValue(NAME_FIELD, "o'brien")).toBe("O'BRIEN")
    expect(sanitizeFieldValue(NAME_FIELD, 'smith-jones')).toBe('SMITH-JONES')
    expect(sanitizeFieldValue(NAME_FIELD, 'van dyke')).toBe('VAN DYKE')
  })

  it('collapses runs of whitespace', () => {
    expect(sanitizeFieldValue(NAME_FIELD, 'van    dyke')).toBe('VAN DYKE')
  })

  it('strips characters a press cannot set', () => {
    expect(sanitizeFieldValue(NAME_FIELD, 'SM<script>ITH')).toBe('SMSCRIPTITH')
  })

  it('truncates at max', () => {
    expect(sanitizeFieldValue(NAME_FIELD, 'VANDERMEULENSKI')).toBe('VANDERMEULEN')
  })

  it('keeps only digits in a number field, capped at max', () => {
    expect(sanitizeFieldValue(NUMBER_FIELD, '2x2')).toBe('22')
    expect(sanitizeFieldValue(NUMBER_FIELD, '123')).toBe('12')
    expect(sanitizeFieldValue(NUMBER_FIELD, '7')).toBe('7')
  })

  it('returns an empty string for a value that sanitizes away entirely', () => {
    expect(sanitizeFieldValue(NAME_FIELD, '!!!')).toBe('')
    expect(sanitizeFieldValue(NAME_FIELD, undefined)).toBe('')
    expect(sanitizeFieldValue(NUMBER_FIELD, 'abc')).toBe('')
  })
})

describe('sanitizeValues', () => {
  it('maps every field key, filling absent ones with an empty string', () => {
    expect(sanitizeValues(TEMPLATE, { name: 'smith' })).toEqual({ name: 'SMITH', number: '' })
  })

  it('drops keys the template does not declare', () => {
    expect(sanitizeValues(TEMPLATE, { name: 'smith', number: '22', evil: 'x' })).toEqual({
      name: 'SMITH',
      number: '22',
    })
  })
})

describe('templateCacheKey', () => {
  it('changes when the source art the flare edit works from changes', () => {
    const values = { name: 'SMITH', number: '22' }
    const withSource = { ...TEMPLATE, sourceAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
    expect(templateCacheKey(withSource, values)).not.toBe(templateCacheKey(TEMPLATE, values))
  })

  it('round-trips sourceAssetId through the parser, and reads a missing one as null', () => {
    const withSource = { ...TEMPLATE, sourceAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
    expect(parseTeamTemplate(withSource)?.sourceAssetId).toBe(withSource.sourceAssetId)
    const { sourceAssetId: _omit, ...legacy } = TEMPLATE
    expect(parseTeamTemplate(legacy)?.sourceAssetId).toBeNull()
  })

  it('is stable for the same values', () => {
    const a = templateCacheKey(TEMPLATE, { name: 'SMITH', number: '22' })
    const b = templateCacheKey(TEMPLATE, { number: '22', name: 'SMITH' })
    expect(a).toBe(b)
  })

  it('changes when a value changes', () => {
    const a = templateCacheKey(TEMPLATE, { name: 'SMITH', number: '22' })
    const b = templateCacheKey(TEMPLATE, { name: 'LOPEZ', number: '22' })
    expect(a).not.toBe(b)
  })

  it('changes when the template itself changes, so an edit invalidates derived files', () => {
    const a = templateCacheKey(TEMPLATE, { name: 'SMITH', number: '22' })
    const moved = { ...TEMPLATE, fields: [{ ...NAME_FIELD, fill: '#000000' }, NUMBER_FIELD] }
    const b = templateCacheKey(moved, { name: 'SMITH', number: '22' })
    expect(a).not.toBe(b)
  })
})
