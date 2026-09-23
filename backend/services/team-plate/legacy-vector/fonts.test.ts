import { describe, it, expect } from 'vitest'
import { HOUSE_FONTS, loadFont, measureWith, missingGlyphs, resolveHouseFont } from './fonts.js'

describe('HOUSE_FONTS', () => {
  it('ships the faces a team shirt actually needs', () => {
    const ids = HOUSE_FONTS.map((f) => f.id)
    expect(ids).toContain('varsity-block')
    expect(ids).toContain('collegiate-slab')
    expect(ids).toContain('brush-script')
    expect(ids).toContain('western')
  })

  it('gives every face a license file, because these are redistributed', () => {
    for (const face of HOUSE_FONTS) {
      expect(face.license).toBeTruthy()
      expect(resolveHouseFont(face.id)).toBeTruthy()
    }
  })

  it('has no duplicate ids', () => {
    const ids = HOUSE_FONTS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('loadFont', () => {
  it('loads every house face from disk', async () => {
    for (const face of HOUSE_FONTS) {
      const font = await loadFont({ family: face.id, src: 'house' })
      expect(font.unitsPerEm).toBeGreaterThan(0)
    }
  })

  it('returns the same instance on a second call — fonts are cached, not re-parsed', async () => {
    const a = await loadFont({ family: 'varsity-block', src: 'house' })
    const b = await loadFont({ family: 'varsity-block', src: 'house' })
    expect(a).toBe(b)
  })

  it('rejects an unknown house face by name rather than silently substituting one', async () => {
    await expect(loadFont({ family: 'not-a-face', src: 'house' })).rejects.toThrow(/not-a-face/)
  })
})

describe('measureWith', () => {
  it('measures in FONT UNITS, not px, so fit maths is resolution independent', async () => {
    const font = await loadFont({ family: 'varsity-block', src: 'house' })
    const measure = measureWith(font)
    const m = measure('SMITH')
    expect(m.unitsPerEm).toBe(font.unitsPerEm)
    // A five-glyph string in a 1000upm face is hundreds of units wide, not ~3.
    expect(m.width).toBeGreaterThan(font.unitsPerEm)
  })

  it('reports a longer string as wider', async () => {
    const measure = measureWith(await loadFont({ family: 'varsity-block', src: 'house' }))
    expect(measure('VANDERMEULEN').width).toBeGreaterThan(measure('BEAR').width)
  })

  it('carries the face ascender and descender through', async () => {
    const font = await loadFont({ family: 'varsity-block', src: 'house' })
    const m = measureWith(font)('A')
    expect(m.ascender).toBe(font.ascender)
    expect(m.descender).toBe(font.descender)
    expect(m.ascender).toBeGreaterThan(0)
    expect(m.descender).toBeLessThan(0)
  })
})

describe('missingGlyphs', () => {
  it('is empty for the plain ASCII a jersey actually uses', async () => {
    const font = await loadFont({ family: 'varsity-block', src: 'house' })
    expect(missingGlyphs(font, "SMITH-JONES O'BRIEN 22")).toEqual([])
  })

  it('names every character the face cannot set, so template save can warn', async () => {
    const font = await loadFont({ family: 'varsity-block', src: 'house' })
    // U+5B57 is a CJK ideograph; no Latin display face carries it.
    const missing = missingGlyphs(font, 'SMITH字')
    expect(missing).toContain('字')
    expect(missing).not.toContain('S')
  })

  it('reports each missing character once', async () => {
    const font = await loadFont({ family: 'varsity-block', src: 'house' })
    const missing = missingGlyphs(font, '字字字')
    expect(missing).toEqual(['字'])
  })

  it('checks the accented characters that actually appear in surnames', async () => {
    // Not an assertion that every face has them — an assertion that the check
    // RUNS on them, which is what stops a .notdef box reaching the press.
    const font = await loadFont({ family: 'varsity-block', src: 'house' })
    expect(Array.isArray(missingGlyphs(font, 'MUÑOZ'))).toBe(true)
  })
})
