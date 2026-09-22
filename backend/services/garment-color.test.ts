import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  relativeLuminance,
  luminanceOfHex,
  contrastRatio,
  vanishingFraction,
  meanContrastAgainst,
  measureArtworkLuminanceFromBuffer,
  LUMA_BINS,
  INK_ALPHA,
  type ArtworkLuminance
} from './image-metrics.js'
import {
  pickGarmentColor,
  scoreGarment,
  garmentLumaOf,
  toRenderableColor,
  renderableColorsFor,
  garmentColorMetadata,
  garmentColorPromptClause,
  GARMENT_LUMA,
  GARMENT_LABEL,
  RENDERABLE_COLORS,
  MIN_INK_CONTRAST,
  BLOCK_VANISHING_FRACTION,
  MULTI_COLORWAY_MAX_VANISHING
} from './garment-color.js'

// ---------------------------------------------------------------------------
// The garment picker, deterministic half. This is the module that decides which
// colour shirt a design is printed on, so the properties that matter are:
//
//   1. The maths is WCAG's, not a lookalike. A contrast ratio that drifts from
//      the standard is a number nobody can argue with or check.
//   2. The measurement only counts INK. Dead air is most of a DTF transfer, and
//      averaging it in makes every design the same colour.
//   3. Dark art goes on a light garment and light art on a dark one — the whole
//      point, and the thing David caught by hand.
//   4. Ranking is by VANISHING INK first, not mean contrast. Mean contrast
//      alone is happy to lose all of a design's line work as long as the bulk
//      of it looks fine, which IS the defect.
//   5. Nothing is ever picked that the mockup renderer cannot photograph.
// ---------------------------------------------------------------------------

/** Build artwork with a known ink colour on a transparent field. */
async function artwork(hex: string, coverage = 0.25, size = 128): Promise<Buffer> {
  const side = Math.max(1, Math.round(size * Math.sqrt(coverage)))
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{
      input: await sharp({ create: { width: side, height: side, channels: 4, background: hex } }).png().toBuffer(),
      left: 0,
      top: 0
    }])
    .png()
    .toBuffer()
}

/** Two-tone artwork: `share` of the ink in `a`, the rest in `b`. */
async function twoTone(a: string, b: string, share: number, size = 128): Promise<Buffer> {
  const aw = Math.max(1, Math.round(size * share))
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([
      { input: await sharp({ create: { width: aw, height: size, channels: 4, background: a } }).png().toBuffer(), left: 0, top: 0 },
      { input: await sharp({ create: { width: size - aw, height: size, channels: 4, background: b } }).png().toBuffer(), left: aw, top: 0 }
    ])
    .png()
    .toBuffer()
}

const measured = async (buf: Buffer): Promise<ArtworkLuminance> => {
  const r = await measureArtworkLuminanceFromBuffer(buf)
  if (!r.ok) throw new Error(`fixture unreadable: ${r.error}`)
  return r
}

describe('WCAG maths', () => {
  it('matches the published relative luminances', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0)
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 6)
    // Pure red is 0.2126 by definition of the coefficients — the case that
    // makes a greyscale byte the wrong number to use here (sRGB-average calls
    // red 85/255 = 0.33, gamma greyscale calls it 0.21 on a scale that is not
    // linear at all).
    expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 4)
    expect(relativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 4)
    expect(relativeLuminance(0, 0, 255)).toBeCloseTo(0.0722, 4)
  })

  it('gives black-on-white the standard 21:1 and identical colours 1:1', () => {
    expect(contrastRatio(0, 1)).toBeCloseTo(21, 6)
    expect(contrastRatio(0.3, 0.3)).toBe(1)
  })

  it('parses hex in both lengths', () => {
    expect(luminanceOfHex('#000000')).toBe(0)
    expect(luminanceOfHex('#fff')).toBeCloseTo(1, 6)
    expect(() => luminanceOfHex('not-a-colour')).toThrow()
  })
})

describe('artwork luminance — ink only', () => {
  it('ignores transparent pixels entirely', async () => {
    // A quarter of the frame is white ink; the rest is dead air. If dead air
    // were counted as black the mean would land near 0.25, not 1.0.
    const lum = await measured(await artwork('#ffffff', 0.25))
    expect(lum.meanLuma).toBeCloseTo(1, 2)
    expect(lum.inkFraction).toBeGreaterThan(0.2)
    expect(lum.inkFraction).toBeLessThan(0.3)
  })

  it('reports a fully transparent file as having no ink rather than failing', async () => {
    const empty = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const lum = await measured(empty)
    expect(lum.inkPixels).toBe(0)
    expect(lum.inkFraction).toBe(0)
  })

  it('treats a file with no alpha channel as all ink, and says so', async () => {
    const flat = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#808080' } }).png().toBuffer()
    const lum = await measured(flat)
    expect(lum.inkFraction).toBe(1)
  })

  it('does not let anti-aliased edge pixels vote', async () => {
    // Alpha below INK_ALPHA is a blend of the ink and whatever is behind it —
    // in the press, the garment. Counting it biases every design toward
    // "already matches the shirt".
    const faint = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 255, b: 255, alpha: (INK_ALPHA - 1) / 255 } } }).png().toBuffer()
    const lum = await measured(faint)
    expect(lum.inkPixels).toBe(0)
  })

  it('returns a histogram that sums to the whole ink', async () => {
    const lum = await measured(await twoTone('#000000', '#ffffff', 0.5))
    expect(lum.histogram).toHaveLength(LUMA_BINS)
    expect(lum.histogram.reduce((t, v) => t + v, 0)).toBeCloseTo(1, 2)
    // Two flat tones at the extremes: the ends carry it, the middle is empty.
    expect(lum.histogram[0]).toBeGreaterThan(0.4)
    expect(lum.histogram[LUMA_BINS - 1]).toBeGreaterThan(0.4)
  })

  it('never throws on an unreadable buffer — a failure is a result', async () => {
    const r = await measureArtworkLuminanceFromBuffer(Buffer.from('not an image'), 'x')
    expect(r.ok).toBe(false)
  })
})

describe('vanishingFraction', () => {
  it('counts the share of ink under the contrast floor and nothing else', () => {
    const histogram = Array.from({ length: LUMA_BINS }, () => 0)
    histogram[0] = 0.6 // near-black ink
    histogram[LUMA_BINS - 1] = 0.4 // near-white ink
    // Against a black garment the dark 60% vanishes and the white 40% does not.
    expect(vanishingFraction(histogram, GARMENT_LUMA.black, MIN_INK_CONTRAST)).toBeCloseTo(0.6, 3)
    // Against white it is the other way round.
    expect(vanishingFraction(histogram, GARMENT_LUMA.white, MIN_INK_CONTRAST)).toBeCloseTo(0.4, 3)
    expect(meanContrastAgainst(histogram, GARMENT_LUMA.black)).toBeGreaterThan(1)
  })
})

describe('pickGarmentColor', () => {
  it('puts DARK artwork on a light garment', async () => {
    const pick = pickGarmentColor(await measured(await artwork('#111111')), { garment: 'tshirt' })
    expect(pick).not.toBeNull()
    expect(pick!.color).toBe('white')
    expect(pick!.reason).toContain('dark')
  })

  it('puts LIGHT artwork on a dark garment', async () => {
    const pick = pickGarmentColor(await measured(await artwork('#f4f4f4')), { garment: 'tshirt' })
    expect(pick!.color).toBe('black')
  })

  it('ranks on vanishing ink, not on mean contrast', async () => {
    // The case where the two disagree, which is the whole reason the order
    // matters. 70% mid-dark body + 30% near-white highlights:
    //   on BLACK  the body reads 2.8:1 (muddy) and the highlights blaze 18.8:1
    //             -> mean 7.6:1, but 70% of the design is under the floor
    //   on WHITE  the body reads 7.5:1 and only the highlights are lost
    //             -> mean 5.6:1, and 30% under the floor
    // Mean contrast says black. The shirt a shopper can actually read is white.
    const lum = await measured(await twoTone('#555555', '#F2F2F2', 0.7))
    const onBlack = scoreGarment(lum, 'black')
    const onWhite = scoreGarment(lum, 'white')
    expect(onBlack.meanContrast).toBeGreaterThan(onWhite.meanContrast)
    expect(onBlack.vanishing).toBeGreaterThan(onWhite.vanishing)
    expect(pickGarmentColor(lum, { garment: 'tshirt' })!.color).toBe('white')
  })

  it('offers a second colourway only when the design really holds up on both', async () => {
    // Dark line art is legible on white AND on heather grey, so it earns a
    // second colourway. (This is what the live golf design does: white primary,
    // heather grey alternate.)
    const versatile = pickGarmentColor(await measured(await artwork('#111111')), { garment: 'tshirt' })!
    expect(versatile.color).toBe('white')
    expect(versatile.alternates).toContain('gray')
    for (const alt of versatile.alternates) {
      expect(versatile.scores.find(s => s.color === alt)!.vanishing).toBeLessThanOrEqual(MULTI_COLORWAY_MAX_VANISHING)
    }

    // PALE art works on black and nowhere else — white and heather grey both
    // swallow it — so it gets no second colourway rather than a bad one.
    const oneWay = pickGarmentColor(await measured(await artwork('#F4F4F4')), { garment: 'tshirt' })!
    expect(oneWay.color).toBe('black')
    expect(oneWay.alternates).toEqual([])
  })

  it('never picks a colour the renderer has no mockup base for', async () => {
    const lum = await measured(await artwork('#111111'))
    for (const garment of ['tshirt', 'hoodie', 'youth-tshirt', 'shirts', 'hoodies']) {
      const pick = pickGarmentColor(lum, { garment })
      expect(RENDERABLE_COLORS).toContain(pick!.color)
      for (const s of pick!.scores) expect(renderableColorsFor(garment)).toContain(s.color)
    }
    // Hoodie has no gray BACK base on disk, so gray is not offered at all.
    expect(renderableColorsFor('hoodie')).toEqual(['black', 'white'])
  })

  it('declines to decide when there is nothing to judge', async () => {
    const empty = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    expect(pickGarmentColor(await measured(empty), { garment: 'tshirt' })).toBeNull()
    expect(pickGarmentColor({ url: 'x', ok: false, error: 'boom' }, { garment: 'tshirt' })).toBeNull()
  })

  it('flags a flattened file as low confidence instead of pretending', async () => {
    const flat = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#222222' } }).png().toBuffer()
    const pick = pickGarmentColor(await measured(flat), { garment: 'tshirt' })
    expect(pick!.confident).toBe(false)
  })

  it('records every candidate, so the call can be argued with', async () => {
    const pick = pickGarmentColor(await measured(await artwork('#111111')), { garment: 'tshirt' })!
    expect(pick.scores.map(s => s.color).sort()).toEqual(['black', 'gray', 'white'])
    const meta = garmentColorMetadata(pick, 'measured')
    expect(meta.source).toBe('measured')
    expect(meta.color).toBe('white')
    expect(meta.reason).toBeTruthy()
    expect(Array.isArray(meta.scores)).toBe(true)
  })
})

describe('colour resolution', () => {
  it('maps every spelling the codebase uses onto a renderable id', () => {
    expect(toRenderableColor('grey')).toBe('gray')
    expect(toRenderableColor('gray')).toBe('gray')
    expect(toRenderableColor('heather-grey')).toBe('gray')
    expect(toRenderableColor('Heather Grey')).toBe('gray')
    expect(toRenderableColor('BLACK')).toBe('black')
    // Sold, but the mockup renderer has no base image for it.
    expect(toRenderableColor('navy')).toBeNull()
    expect(toRenderableColor(null)).toBeNull()
    expect(toRenderableColor('')).toBeNull()
  })

  it('resolves a null garment colour as BLACK, because that is what renders', () => {
    // worker/ai-jobs-worker.ts falls back to 'black' when nothing is stamped.
    // Treating null as "unknown" would give every legacy row a free pass.
    expect(garmentLumaOf(null)!.id).toBe('black')
    expect(garmentLumaOf(undefined)!.id).toBe('black')
    expect(garmentLumaOf('')!.id).toBe('black')
  })

  it('can still grade a colour it would never pick', () => {
    const navy = garmentLumaOf('navy')!
    expect(navy.renderable).toBe(false)
    expect(navy.luma).toBeGreaterThan(0)
    expect(navy.luma).toBeLessThan(GARMENT_LUMA.gray)
  })

  it('returns null for a colour that is not in the catalogue at all', () => {
    expect(garmentLumaOf('chartreuse')).toBeNull()
  })

  it('derives garment luminance from the capability hexes, not the eyeballed luma field', () => {
    expect(GARMENT_LUMA.black).toBe(0)
    expect(GARMENT_LUMA.white).toBeCloseTo(1, 6)
    // #9CA3AF is 0.3636 relative luminance; catalog-capability's hand-entered
    // `luma: 0.55` is an sRGB-ish guess, nearly 0.2 out, and would change the
    // answer on mid-tone art if it were used here.
    expect(GARMENT_LUMA.gray).toBeCloseTo(0.3636, 3)
  })
})

describe('the prompt clause', () => {
  it('names a colour only when one has actually been chosen', () => {
    const unknown = garmentColorPromptClause(null, 'crew neck t-shirt')
    expect(unknown).not.toMatch(/\bblack\b/i)
    expect(unknown).toMatch(/chosen AFTER/i)
    expect(garmentColorPromptClause('white', 'crew neck t-shirt')).toMatch(/white/)
  })
})

describe('the failure David reported', () => {
  it('blocks black line art on a black garment and moves it to white', async () => {
    const lum = await measured(await artwork('#0A0A0A', 0.05))
    const onBlack = scoreGarment(lum, 'black')
    expect(onBlack.vanishing).toBeGreaterThanOrEqual(BLOCK_VANISHING_FRACTION)
    expect(onBlack.ok).toBe(false)
    const pick = pickGarmentColor(lum, { garment: 'tshirt' })!
    expect(pick.color).toBe('white')
    expect(GARMENT_LABEL[pick.color]).toBe('white')
  })
})
