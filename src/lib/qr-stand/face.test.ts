import { describe, it, expect } from 'vitest'
import { faceLayout, modulesPath, logoBox, captionBox, PLATE } from './face'

describe('faceLayout matches what gen.py prints', () => {
  // gen.py on Earth, 2026-10-18: bellascafe.com/menu -> v4, 33 modules, 25.0 mm
  // blank; a 58-byte link -> v6, 41 modules, 27.4 mm blank.
  it('a short link: version 4, 33 modules, a 25 mm centre square', () => {
    const { layout } = faceLayout('https://bellascafe.com/menu')
    expect(layout!.version).toBe(4)
    expect(layout!.n).toBe(33)
    expect(layout!.blank.size).toBeCloseTo(25.0, 1)
  })

  it('58 bytes: version 6, 41 modules, a 27.4 mm square', () => {
    const { layout } = faceLayout('https://example.com/' + 'a'.repeat(38))
    expect(layout!.version).toBe(6)
    expect(layout!.n).toBe(41)
    expect(layout!.blank.size).toBeCloseTo(27.4, 1)
  })

  it('refuses 59 bytes with the shop\'s words and draws nothing', () => {
    expect(faceLayout('https://example.com/' + 'a'.repeat(39))).toEqual({ layout: null, problem: 'use a shorter link' })
  })

  it('no link, no code and no complaint yet', () => {
    expect(faceLayout('')).toEqual({ layout: null, problem: null })
  })

  it('clears the centre square and centres the code on the plate', () => {
    const { layout } = faceLayout('https://davidtrinidad.com')
    const l = layout!
    for (let r = l.blank.lo; r < l.blank.lo + l.blank.k; r++)
      for (let c = l.blank.lo; c < l.blank.lo + l.blank.k; c++) expect(l.dark[r][c]).toBe(false)
    expect(l.x0).toBe(7.5)
    expect(l.y0).toBe(PLATE.qrTop)
    expect(l.blank.x + l.blank.size / 2).toBeCloseTo(PLATE.w / 2, 6)
    // The three finder squares are where a phone expects them.
    expect(l.dark[0][0] && l.dark[0][l.n - 1] && l.dark[l.n - 1][0]).toBe(true)
    expect(modulesPath(l)).toMatch(/^M7\.5 7\.5h/)
  })

  it('keeps a module of quiet space round the logo', () => {
    const l = faceLayout('https://davidtrinidad.com').layout!
    const box = logoBox(l)
    expect(box.x - l.blank.x).toBeCloseTo(l.cell, 6)
    expect(box.size).toBeCloseTo(l.blank.size - 2 * l.cell, 6)
  })

  it('sets the caption 16 mm up, 8.5 mm caps, and shrinks a long one to 76 mm', () => {
    const short = captionBox(4) // e.g. "Pay Here"
    expect(short.fontSize).toBeCloseTo(8.5 / 0.716, 3)
    expect(short.baseline).toBeCloseTo(120 - 16 + 8.5 / 2, 6)
    const long = captionBox(12)
    expect(long.fontSize * 12).toBeCloseTo(76, 6)
  })
})
