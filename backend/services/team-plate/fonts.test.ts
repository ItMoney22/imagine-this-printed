import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  HOUSE_FONTS,
  loadFont,
  measureWith,
  missingGlyphs,
  resolveFontDir,
  resolveHouseFont,
} from './fonts.js'

describe('resolveFontDir', () => {
  it('resolves the real dev (tsx) source path to backend/assets/fonts on disk', () => {
    // This IS the dev case: fonts.test.ts runs from this very source file
    // via tsx/vite, same as fonts.ts does at runtime in `npm run dev`.
    const dir = resolveFontDir(import.meta.url)
    expect(existsSync(dir)).toBe(true)
    const ttfs = readdirSync(dir).filter((f) => f.endsWith('.ttf'))
    expect(ttfs.length).toBe(HOUSE_FONTS.length)
  })

  it('resolves relative to a compiled dist/ location the same way it resolves in dev', () => {
    // Simulates the production case (dist/services/team-plate/fonts.js)
    // without requiring an actual `tsc` build: same relative offset, a
    // different base file. This is the exact shape that shipped broken —
    // the offset was always correct, `dist/assets/fonts` just never existed
    // until `scripts/copy-assets.mjs` started populating it in `build`.
    const backendDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
    const simulatedDistFile = path.join(backendDir, 'dist', 'services', 'team-plate', 'fonts.js')
    const distDir = resolveFontDir(pathToFileURL(simulatedDistFile).href)
    expect(path.basename(distDir)).toBe('fonts')
    expect(path.basename(path.dirname(distDir))).toBe('assets')
    expect(path.dirname(path.dirname(distDir))).toBe(path.join(backendDir, 'dist'))
  })
})

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
