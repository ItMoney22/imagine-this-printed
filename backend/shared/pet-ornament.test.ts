import { describe, it, expect } from 'vitest'
import { parsePetOrnament, sanitizePetValues, FILAMENTS, PETS } from './pet-ornament.js'

const meta = (over: Record<string, unknown> = {}) => ({ pet_ornament: { version: 1, font: 'brush-script', ...over } })

describe('pet ornament template', () => {
  it('reads a minimal template with every pet and the photo on', () => {
    const t = parsePetOrnament(meta())!
    expect(t.pets.map((p) => p.id)).toEqual(PETS.map((p) => p.id))
    expect(t.photo).toBe(true)
    expect(t.field).toEqual({ key: 'name', label: "Your pet's name", max: 12 })
  })

  it('refuses an unknown version or font, and caps the name length', () => {
    expect(parsePetOrnament(meta({ version: 2 }))).toBeNull()
    expect(parsePetOrnament(meta({ font: '../x' }))).toBeNull()
    expect(parsePetOrnament(meta({ field: { max: 40 } }))!.field.max).toBe(12)
    expect(parsePetOrnament({})).toBeNull()
  })

  it('reads the live seeded row, whose pets are stored as whole choices (task 5d007181)', () => {
    // products dff53dc2 as pet-ornament-seed.ts wrote it on 2026-11-01.
    const live = { pet_ornament: { font: 'brush-script', pets: [{ id: 'cat', label: 'Cat' }, { id: 'dog', label: 'Dog' }, { id: 'bunny', label: 'Bunny' }], field: { key: 'name', max: 12, label: "Your pet's name" }, photo: true, version: 1, upcharge: 0 } }
    const t = parsePetOrnament(live)
    expect(t?.pets.map((p) => p.id)).toEqual(['cat', 'dog', 'bunny'])
    expect(parsePetOrnament(meta({ pets: [{ id: 'dragon' }, { label: 'Dog' }, null] }))).toBeNull()
  })

  it('keeps only pets the house can draw', () => {
    expect(parsePetOrnament(meta({ pets: ['dog', 'dragon'] }))!.pets.map((p) => p.id)).toEqual(['dog'])
    expect(parsePetOrnament(meta({ pets: ['dragon'] }))).toBeNull()
  })

  it('sanitizes values: pet from the list, name as typed, portrait only a server id', () => {
    const t = parsePetOrnament(meta())!
    expect(sanitizePetValues(t, { pet: 'dog', name: 'Zoë & Max', portrait: 'abcdefabcdefabcdefabcdef' })).toEqual({ pet: 'dog', name: 'Zoë & Max', portrait: 'abcdefabcdefabcdefabcdef' })
    expect(sanitizePetValues(t, { pet: 'x', name: '<i>', portrait: 'http://x' })).toEqual({ pet: 'cat', name: 'i', portrait: '' })
    const noPhoto = parsePetOrnament(meta({ photo: false }))!
    expect(sanitizePetValues(noPhoto, { portrait: 'abcdefabcdefabcdefabcdef' }).portrait).toBe('')
  })

  it('every filament has a valid colour', () => {
    for (const f of FILAMENTS) expect(f.hex).toMatch(/^#[0-9A-F]{6}$/i)
  })
})
