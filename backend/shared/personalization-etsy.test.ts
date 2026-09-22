import { describe, it, expect } from 'vitest'
import {
  ETSY_PERSONALIZATION_PROPERTY_ID,
  etsyPersonalizationCharMax,
  etsyPersonalizationFields,
  etsyPersonalizationInstructions,
  extractPersonalizationText,
  parsePersonalizationText,
} from './personalization-etsy.js'
import { ETSY_INSTRUCTIONS_MAX, type TeamField, type TeamTemplate } from './team-template.js'

const NAME_FIELD: TeamField = {
  key: 'name',
  label: 'Last name',
  type: 'text',
  max: 12,
  placeholder: 'SMITH',
  uppercase: true,
  zone: { x: 220, y: 380, w: 3160, h: 900 },
  arch: 18,
  font: { family: 'collegiate-slab', src: 'house' },
  fill: '#8C1D2D',
  strokes: [],
  offset: null,
}

const NUMBER_FIELD: TeamField = {
  key: 'number',
  label: 'Number',
  type: 'number',
  max: 2,
  placeholder: '22',
  uppercase: false,
  zone: { x: 900, y: 1500, w: 1800, h: 2400 },
  arch: 0,
  font: { family: 'varsity-block', src: 'house' },
  fill: '#C9A227',
  strokes: [],
  offset: null,
}

const TEMPLATE: TeamTemplate = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 0,
  instructions: null,
  fields: [NAME_FIELD, NUMBER_FIELD],
}

const SINGLE: TeamTemplate = { ...TEMPLATE, fields: [{ ...NAME_FIELD, key: 'text', label: 'Custom text', max: 20 }] }

describe('etsyPersonalizationFields', () => {
  it('marks the listing personalizable and required', () => {
    const fields = etsyPersonalizationFields(TEMPLATE)
    expect(fields.is_personalizable).toBe(true)
    expect(fields.personalization_is_required).toBe(true)
  })

  it('derives instructions naming every field and its example', () => {
    const text = etsyPersonalizationInstructions(TEMPLATE)
    expect(text).toContain('Last name: SMITH')
    expect(text).toContain('Number: 22')
    expect(text).toContain('up to 12 characters')
    expect(text).toContain('up to 2 digits')
  })

  it("uses the operator's own instructions when the template carries them", () => {
    const text = etsyPersonalizationInstructions({ ...TEMPLATE, instructions: 'Name then number, please.' })
    expect(text).toBe('Name then number, please.')
  })

  it('never exceeds the length Etsy truncates at', () => {
    const wordy: TeamTemplate = {
      ...TEMPLATE,
      fields: TEMPLATE.fields.map((f) => ({ ...f, label: f.label.repeat(12) })),
    }
    expect(etsyPersonalizationInstructions(wordy).length).toBeLessThanOrEqual(ETSY_INSTRUCTIONS_MAX)
  })

  it('budgets enough characters for every field plus its label, and stays inside Etsy ceiling', () => {
    const max = etsyPersonalizationCharMax(TEMPLATE)
    // "Last name: VANDERMEULE, Number: 22" comfortably fits.
    expect(max).toBeGreaterThan('Last name: VANDERMEULE, Number: 22'.length)
    expect(max).toBeLessThanOrEqual(1024)
  })

  it('clamps an absurd template to Etsy ceiling rather than sending an illegal value', () => {
    const huge: TeamTemplate = { ...TEMPLATE, fields: [{ ...NAME_FIELD, max: 5000 }] }
    expect(etsyPersonalizationCharMax(huge)).toBe(1024)
  })
})

describe('extractPersonalizationText', () => {
  it('finds the box by Etsy property id even when the label is odd', () => {
    const txn = {
      variations: [
        { property_id: 100, formatted_name: 'Size', formatted_value: 'L' },
        { property_id: ETSY_PERSONALIZATION_PROPERTY_ID, formatted_name: 'Personalisierung', formatted_value: 'SMITH 22' },
      ],
    }
    expect(extractPersonalizationText(txn)).toBe('SMITH 22')
  })

  it('falls back to the label when no property id is present', () => {
    const txn = { variations: [{ formatted_name: 'Personalization', formatted_value: 'LOPEZ 41' }] }
    expect(extractPersonalizationText(txn)).toBe('LOPEZ 41')
  })

  it('is null for an ordinary transaction, a blank box, and a missing variations array', () => {
    expect(extractPersonalizationText({ variations: [{ property_id: 200, formatted_name: 'Color', formatted_value: 'Red' }] })).toBeNull()
    expect(extractPersonalizationText({ variations: [{ property_id: 54, formatted_name: 'Personalization', formatted_value: '   ' }] })).toBeNull()
    expect(extractPersonalizationText({})).toBeNull()
    expect(extractPersonalizationText(null)).toBeNull()
  })
})

describe('parsePersonalizationText', () => {
  const cases: Array<[string, string, Record<string, string>, string]> = [
    ['the format we ask for', 'Last name: SMITH | Number: 22', { name: 'SMITH', number: '22' }, 'labelled'],
    ['comma separated labels', 'Name: Lopez, Number: 41', { name: 'LOPEZ', number: '41' }, 'labelled'],
    ['newlines and dashes', 'name - oconnor\nnumber - 7', { name: 'OCONNOR', number: '7' }, 'labelled'],
    ['a jersey hash', 'Last name: Bear / Jersey #: 9', { name: 'BEAR', number: '9' }, 'labelled'],
    ['no labels at all', 'SMITH 22', { name: 'SMITH', number: '22' }, 'positional'],
    ['number typed first', '22 SMITH', { name: 'SMITH', number: '22' }, 'positional'],
    ['a two-word surname', 'VAN DYKE 5', { name: 'VAN DYKE', number: '5' }, 'positional'],
    ['a slash between them', 'Rodriguez / 10', { name: 'RODRIGUEZ', number: '10' }, 'positional'],
    ['only half of it labelled', 'Number: 12 Johnson', { name: 'JOHNSON', number: '12' }, 'labelled'],
  ]

  for (const [why, text, expected, matched] of cases) {
    it(`reads ${why}: "${text}"`, () => {
      const parsed = parsePersonalizationText(TEMPLATE, text)
      expect(parsed.values).toEqual(expected)
      expect(parsed.missing).toEqual([])
      expect(parsed.matched).toBe(matched)
    })
  }

  it('applies the field rules — caps length, strips punctuation, uppercases', () => {
    const parsed = parsePersonalizationText(TEMPLATE, 'Last name: Vandermeulen!!! Number: 220')
    expect(parsed.values.name).toBe('VANDERMEULEN') // exactly the 12 allowed; the ! are dropped
    expect(parsed.values.number).toBe('22') // 2 digits max
  })

  it('keeps an apostrophe and a hyphen, which real surnames have', () => {
    expect(parsePersonalizationText(TEMPLATE, "O'Brien-Smith 3").values.name).toBe("O'BRIEN-SMIT")
  })

  it('names what is missing instead of guessing, when the buyer only typed a name', () => {
    const parsed = parsePersonalizationText(TEMPLATE, 'SMITH')
    expect(parsed.values).toEqual({ name: 'SMITH', number: '' })
    expect(parsed.missing).toEqual(['number'])
  })

  it('reports nothing usable for an empty box', () => {
    const parsed = parsePersonalizationText(TEMPLATE, '   ')
    expect(parsed.values).toEqual({ name: '', number: '' })
    expect(parsed.matched).toBe('none')
    expect(parsed.missing).toEqual(['name', 'number'])
  })

  it('handles a null box without throwing', () => {
    expect(parsePersonalizationText(TEMPLATE, null).matched).toBe('none')
  })

  it('gives a single-field template the whole string', () => {
    expect(parsePersonalizationText(SINGLE, 'Go Wildcats').values).toEqual({ text: 'GO WILDCATS' })
    expect(parsePersonalizationText(SINGLE, 'Custom text: Go Wildcats').values).toEqual({ text: 'GO WILDCATS' })
  })
})
