import { describe, it, expect } from 'vitest'
import { NAME_MAX, parseNamePrint, sanitizeName, sanitizeNameValues } from './name-print'

const valid = {
  version: 1,
  shape: 'ornament',
  font: 'brush-script',
  field: { key: 'name', label: 'Name', max: 12 },
  colours: { plate: { name: 'Red', hex: '#B3262E' }, letters: { name: 'White', hex: '#F4F1EA' } },
  upcharge: 0,
}

describe('parseNamePrint', () => {
  it('reads a valid template', () => {
    expect(parseNamePrint({ name_print: valid })).toEqual(valid)
  })

  it('refuses an unknown version, shape, font id or colour', () => {
    expect(parseNamePrint({ name_print: { ...valid, version: 2 } })).toBeNull()
    expect(parseNamePrint({ name_print: { ...valid, shape: 'mug' } })).toBeNull()
    expect(parseNamePrint({ name_print: { ...valid, font: '../../etc/passwd' } })).toBeNull()
    expect(parseNamePrint({ name_print: { ...valid, colours: { ...valid.colours, plate: { name: 'Red', hex: 'red' } } } })).toBeNull()
    expect(parseNamePrint({})).toBeNull()
    expect(parseNamePrint(null)).toBeNull()
  })

  it('never lets a template raise the per-shape name limit', () => {
    const t = parseNamePrint({ name_print: { ...valid, shape: 'keychain', field: { key: 'name', label: 'Name', max: 40 } } })
    expect(t?.field.max).toBe(NAME_MAX.keychain)
  })
})

describe('sanitizeName', () => {
  it('keeps the name exactly as typed, case included', () => {
    expect(sanitizeName('Emma', 12)).toBe('Emma')
    expect(sanitizeName("D'Angelo-Smith", 20)).toBe("D'Angelo-Smith")
    expect(sanitizeName('Mom & Dad', 12)).toBe('Mom & Dad')
  })

  it('keeps accented letters and drops what has no glyph business on a plate', () => {
    expect(sanitizeName('Zoë', 12)).toBe('Zoë')
    expect(sanitizeName('José 🎄', 12)).toBe('José')
    expect(sanitizeName('<b>Liam</b>', 12)).toBe('bLiamb')
  })

  it('collapses spaces, trims, and cuts at the limit', () => {
    expect(sanitizeName('  Ava   Rose  ', 12)).toBe('Ava Rose')
    expect(sanitizeName('Christopherson', 10)).toBe('Christophe')
    expect(sanitizeName('Ava         Rosemary', 4)).toBe('Ava')
  })

  it('returns empty for a non-string', () => {
    expect(sanitizeName(undefined, 12)).toBe('')
    expect(sanitizeName(42, 12)).toBe('')
  })
})

describe('sanitizeNameValues', () => {
  it('reads only the template field', () => {
    const t = parseNamePrint({ name_print: valid })!
    expect(sanitizeNameValues(t, { name: 'Noah', number: '22', extra: 'x' })).toEqual({ name: 'Noah' })
    expect(sanitizeNameValues(t, null)).toEqual({ name: '' })
  })
})
