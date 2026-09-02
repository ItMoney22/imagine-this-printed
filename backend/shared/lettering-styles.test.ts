import { describe, it, expect } from 'vitest'
import {
  LETTERING_STYLES,
  LETTERING_STYLE_IDS,
  DEFAULT_LETTERING_STYLE,
  getLetteringStyle,
  isLetteringStyleId,
} from './lettering-styles.js'

// ---------------------------------------------------------------------------
// Tests for the shared lettering-style catalog (design doc §16). The
// property that matters most: every style is a well-formed, non-empty
// {id, label, prompt, preview.googleFamily} tuple — brief.ts's phrase
// instruction embeds `prompt` verbatim into the image-generation call, and
// the frontend renders `preview.googleFamily` as a real web-font tile, so a
// blank/malformed entry would silently produce a broken render or a blank
// tile.
// ---------------------------------------------------------------------------

const EXPECTED_IDS = [
  'graffiti',
  'varsity',
  'brush-script',
  'chrome-3d',
  'retro-70s',
  'distressed',
  'heavy-sans',
  'blackletter',
  'bubble-comic',
  'neon-tube',
  'western',
]

describe('LETTERING_STYLES', () => {
  it('has exactly the 11 styles named in the design doc, in order', () => {
    expect(LETTERING_STYLES.map((s) => s.id)).toEqual(EXPECTED_IDS)
  })

  it('every style has a non-empty label, prompt, and preview.googleFamily', () => {
    for (const style of LETTERING_STYLES) {
      expect(style.label.length).toBeGreaterThan(0)
      expect(style.prompt.length).toBeGreaterThan(10)
      expect(style.preview.googleFamily.length).toBeGreaterThan(0)
    }
  })

  it('has no duplicate ids or google font families', () => {
    const ids = LETTERING_STYLES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const families = LETTERING_STYLES.map((s) => s.preview.googleFamily)
    expect(new Set(families).size).toBe(families.length)
  })

  it('LETTERING_STYLE_IDS mirrors LETTERING_STYLES exactly', () => {
    expect(LETTERING_STYLE_IDS).toEqual(LETTERING_STYLES.map((s) => s.id))
  })
})

describe('DEFAULT_LETTERING_STYLE', () => {
  it('is heavy-sans, and is a real style in the catalog', () => {
    expect(DEFAULT_LETTERING_STYLE).toBe('heavy-sans')
    expect(getLetteringStyle(DEFAULT_LETTERING_STYLE)).toBeDefined()
  })
})

describe('getLetteringStyle', () => {
  it('returns the matching style for a known id', () => {
    const style = getLetteringStyle('graffiti')
    expect(style?.label).toBe('Graffiti')
  })

  it('returns undefined for an unknown or missing id', () => {
    expect(getLetteringStyle('made-up-style')).toBeUndefined()
    expect(getLetteringStyle(undefined)).toBeUndefined()
    expect(getLetteringStyle(null)).toBeUndefined()
    expect(getLetteringStyle(42)).toBeUndefined()
  })
})

describe('isLetteringStyleId', () => {
  it('accepts every real style id', () => {
    for (const id of LETTERING_STYLE_IDS) {
      expect(isLetteringStyleId(id)).toBe(true)
    }
  })

  it('rejects unknown ids and "auto" (auto is not a style id)', () => {
    expect(isLetteringStyleId('auto')).toBe(false)
    expect(isLetteringStyleId('made-up')).toBe(false)
    expect(isLetteringStyleId(undefined)).toBe(false)
  })
})
