// Tests for the personalized print file — the thing that actually gets printed
// when someone buys a "Custom Football Mom Shirt" with Team/Name/Number.
//
// This renders with sharp + an SVG text overlay ON PURPOSE. The Step Flow's
// letter-phrase.ts letters words into art with an AI image EDIT, which is right
// at design time (David picks a take and can reject a bad one) and wrong at
// order time: it costs money per sale, takes ~60s, and image models do not
// reliably spell an arbitrary surname. A paid order for a kid named
// Szczepanski has to come out right the first time, every time.
//
// The image assertions deliberately check dimensions and "did anything change",
// not exact pixels — glyph rasterization differs across machines and fonts, and
// a test that pins pixel values would be red on someone else's box for no
// reason.
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  PersonalizationRenderError,
  escapeSvgText,
  fitFontSize,
  resolvePrintZones,
  renderPersonalizedPrint
} from './personalization-render.js'

/** A plain transparent canvas standing in for a real print file. */
const baseImage = (width = 400, height = 300): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer()

const ZONE = { field: 'name' as const, x: 50, y: 100, width: 300, height: 60 }

describe('escapeSvgText', () => {
  it('escapes the characters that would break out of an SVG text node', () => {
    expect(escapeSvgText('Fish & Chips')).toBe('Fish &amp; Chips')
    expect(escapeSvgText('a<b>c')).toBe('a&lt;b&gt;c')
  })

  it('escapes quotes so a name can never terminate an attribute', () => {
    expect(escapeSvgText('the "Big" one')).toContain('&quot;')
    expect(escapeSvgText("O'Brien")).toContain('&apos;')
  })

  it("leaves an ordinary surname completely alone", () => {
    expect(escapeSvgText('Smith')).toBe('Smith')
  })

  it('handles empty input', () => {
    expect(escapeSvgText('')).toBe('')
  })
})

describe('fitFontSize', () => {
  const zone = { width: 300, height: 60 }

  it('never returns a size taller than the zone', () => {
    expect(fitFontSize('W', zone)).toBeLessThanOrEqual(zone.height)
  })

  it('shrinks a long name so it stays inside the zone width', () => {
    const short = fitFontSize('Ito', zone)
    const long = fitFontSize('Szczepanski-Wilkinson', zone)
    expect(long).toBeLessThan(short)
  })

  it('keeps a long name within the zone width at the size it chose', () => {
    const text = 'Szczepanski-Wilkinson'
    const size = fitFontSize(text, zone)
    // Same advance-width model the implementation uses to choose the size.
    expect(size * 0.6 * text.length).toBeLessThanOrEqual(zone.width + 0.001)
  })

  it('respects an explicit maximum so a 2-character number is not blown up absurdly', () => {
    expect(fitFontSize('12', zone, 24)).toBe(24)
  })

  it('never returns zero or a negative size for pathological input', () => {
    expect(fitFontSize('W'.repeat(500), zone)).toBeGreaterThan(0)
  })

  it('does not throw on empty text', () => {
    expect(fitFontSize('', zone)).toBeGreaterThan(0)
  })
})

describe('resolvePrintZones', () => {
  const withZones = (zones: unknown) =>
    ({ metadata: { personalization: { enabled: true, zones } } }) as any

  it('returns nothing for a product that declares no zones', () => {
    expect(resolvePrintZones({ metadata: {} } as any)).toEqual([])
    expect(resolvePrintZones({ metadata: { personalization: { enabled: true } } } as any)).toEqual([])
  })

  it('reads a declared zone', () => {
    const zones = resolvePrintZones(withZones([ZONE]))
    expect(zones).toHaveLength(1)
    expect(zones[0]).toMatchObject({ field: 'name', x: 50, y: 100, width: 300, height: 60 })
  })

  it('drops a zone naming a field that is not a personalization field', () => {
    expect(resolvePrintZones(withZones([{ ...ZONE, field: 'sleeve' }]))).toEqual([])
  })

  it('drops a zone with missing or non-numeric geometry rather than rendering it somewhere random', () => {
    expect(resolvePrintZones(withZones([{ field: 'name', x: 1, y: 2 }]))).toEqual([])
    expect(resolvePrintZones(withZones([{ ...ZONE, width: 'wide' }]))).toEqual([])
  })

  it('drops a zone with zero or negative size', () => {
    expect(resolvePrintZones(withZones([{ ...ZONE, width: 0 }]))).toEqual([])
    expect(resolvePrintZones(withZones([{ ...ZONE, height: -10 }]))).toEqual([])
  })

  it('ignores junk instead of throwing on a bad product row', () => {
    expect(resolvePrintZones(withZones('nope'))).toEqual([])
    expect(resolvePrintZones({ metadata: null } as any)).toEqual([])
  })

  it('keeps the optional styling a zone declares', () => {
    const zones = resolvePrintZones(withZones([{ ...ZONE, color: '#ff0000', uppercase: true, align: 'left' }]))
    expect(zones[0]).toMatchObject({ color: '#ff0000', uppercase: true, align: 'left' })
  })
})

describe('renderPersonalizedPrint', () => {
  it('returns a PNG with the base image exact dimensions', async () => {
    const base = await baseImage(400, 300)
    const out = await renderPersonalizedPrint(base, [ZONE], { name: 'Smith' })
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(400)
    expect(meta.height).toBe(300)
  })

  it('actually changes the image — something got drawn', async () => {
    const base = await baseImage()
    const out = await renderPersonalizedPrint(base, [ZONE], { name: 'Smith' })
    expect(Buffer.compare(base, out)).not.toBe(0)
  })

  it('draws different pixels for different names', async () => {
    const base = await baseImage()
    const smith = await renderPersonalizedPrint(base, [ZONE], { name: 'Smith' })
    const jones = await renderPersonalizedPrint(base, [ZONE], { name: 'Jones' })
    expect(Buffer.compare(smith, jones)).not.toBe(0)
  })

  it('is deterministic — the same order rendered twice is byte-identical', async () => {
    const base = await baseImage()
    const a = await renderPersonalizedPrint(base, [ZONE], { name: 'Smith' })
    const b = await renderPersonalizedPrint(base, [ZONE], { name: 'Smith' })
    expect(Buffer.compare(a, b)).toBe(0)
  })

  it('renders every zone in one pass', async () => {
    const base = await baseImage(400, 400)
    const zones = [
      { field: 'team' as const, x: 20, y: 20, width: 360, height: 50 },
      { field: 'name' as const, x: 20, y: 120, width: 360, height: 50 },
      { field: 'number' as const, x: 20, y: 240, width: 360, height: 100 }
    ]
    const all = await renderPersonalizedPrint(base, zones, { team: 'Wildcats', name: 'Smith', number: '12' })
    const nameOnly = await renderPersonalizedPrint(base, zones, { name: 'Smith' })
    expect(Buffer.compare(all, nameOnly)).not.toBe(0)
  })

  it('leaves the image untouched when the buyer supplied nothing for that zone', async () => {
    const base = await baseImage()
    const out = await renderPersonalizedPrint(base, [ZONE], {})
    expect(Buffer.compare(base, out)).toBe(0)
  })

  it('leaves the image untouched when there are no zones at all', async () => {
    const base = await baseImage()
    const out = await renderPersonalizedPrint(base, [], { name: 'Smith' })
    expect(Buffer.compare(base, out)).toBe(0)
  })

  it('survives a name containing SVG-hostile characters instead of producing a broken file', async () => {
    const base = await baseImage()
    const out = await renderPersonalizedPrint(base, [ZONE], { name: 'A & <B> "C"' })
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(400)
  })

  it('rejects a zone that falls outside the print file rather than printing off-canvas', async () => {
    const base = await baseImage(400, 300)
    const offCanvas = { field: 'name' as const, x: 350, y: 100, width: 300, height: 60 }
    await expect(renderPersonalizedPrint(base, [offCanvas], { name: 'Smith' }))
      .rejects.toBeInstanceOf(PersonalizationRenderError)
  })

  it('rejects a negative origin for the same reason', async () => {
    const base = await baseImage(400, 300)
    const offCanvas = { field: 'name' as const, x: -10, y: 100, width: 100, height: 60 }
    await expect(renderPersonalizedPrint(base, [offCanvas], { name: 'Smith' }))
      .rejects.toBeInstanceOf(PersonalizationRenderError)
  })

  it('uppercases when the zone asks for it — and that changes the pixels', async () => {
    const base = await baseImage()
    const plain = await renderPersonalizedPrint(base, [ZONE], { name: 'Smith' })
    const upper = await renderPersonalizedPrint(base, [{ ...ZONE, uppercase: true }], { name: 'Smith' })
    expect(Buffer.compare(plain, upper)).not.toBe(0)
  })
})
