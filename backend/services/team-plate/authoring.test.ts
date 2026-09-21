import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { deriveZonesAndDistress, eyedropColours } from './authoring.js'

const CANVAS = { w: 1200, h: 1600 }

/** A plate: flat cream with a maroon band, standing in for artwork. */
async function plate(): Promise<Buffer> {
  const band = await sharp({
    create: { width: 1200, height: 200, channels: 3, background: '#8C1D2D' },
  })
    .png()
    .toBuffer()
  return sharp({ create: { width: CANVAS.w, height: CANVAS.h, channels: 3, background: '#F2E0BC' } })
    .composite([{ input: band, left: 0, top: 1100 }])
    .png()
    .toBuffer()
}

/**
 * The "original": the plate with two blocks of lettering on it — a wide short
 * one up top (the name) and a tall narrow one below (the number).
 */
async function original(opts: { scratch?: boolean } = {}): Promise<Buffer> {
  const name = await sharp({
    create: { width: 800, height: 220, channels: 3, background: '#111111' },
  })
    .png()
    .toBuffer()
  const number = await sharp({
    create: { width: 300, height: 500, channels: 3, background: '#C9A227' },
  })
    .png()
    .toBuffer()

  const layers: any[] = [
    { input: name, left: 200, top: 150 },
    { input: number, left: 450, top: 600 },
  ]

  if (opts.scratch) {
    // A stripe of the PLATE colour straight through the name — a scratch that
    // lets the background show, exactly what a distressed face does.
    const scratch = await sharp({
      create: { width: 800, height: 40, channels: 3, background: '#F2E0BC' },
    })
      .png()
      .toBuffer()
    layers.push({ input: scratch, left: 200, top: 250 })
  }

  return sharp(await plate()).composite(layers).png().toBuffer()
}

describe('deriveZonesAndDistress', () => {
  it('finds one zone per block of lettering', async () => {
    const { zones } = await deriveZonesAndDistress(await original(), await plate(), CANVAS)
    expect(zones).toHaveLength(2)
  })

  it('orders zones top to bottom, not by size', async () => {
    // The name block is wider but SHORTER than the number block; sorting by
    // area would put them the other way round on most real shirts.
    const { zones } = await deriveZonesAndDistress(await original(), await plate(), CANVAS)
    expect(zones[0].y).toBeLessThan(zones[1].y)
  })

  it('places each zone roughly over the lettering it found', async () => {
    const { zones } = await deriveZonesAndDistress(await original(), await plate(), CANVAS)
    const [name, number] = zones
    // Name block was at (200,150) 800x220.
    expect(Math.abs(name.x - 200)).toBeLessThan(40)
    expect(Math.abs(name.y - 150)).toBeLessThan(40)
    expect(Math.abs(name.w - 800)).toBeLessThan(60)
    // Number block was at (450,600) 300x500.
    expect(Math.abs(number.x - 450)).toBeLessThan(40)
    expect(Math.abs(number.h - 500)).toBeLessThan(60)
  })

  it('merges the letters of one word into a single zone', async () => {
    // Three separate blobs on one line must come back as ONE zone, not three.
    const glyph = await sharp({
      create: { width: 120, height: 200, channels: 3, background: '#111111' },
    })
      .png()
      .toBuffer()
    const word = await sharp(await plate())
      .composite([
        { input: glyph, left: 200, top: 300 },
        { input: glyph, left: 400, top: 300 },
        { input: glyph, left: 600, top: 300 },
      ])
      .png()
      .toBuffer()

    const { zones } = await deriveZonesAndDistress(word, await plate(), CANVAS)
    expect(zones).toHaveLength(1)
    expect(zones[0].w).toBeGreaterThan(500)
  })

  it('ignores specks too small to be lettering', async () => {
    const speck = await sharp({
      create: { width: 3, height: 3, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer()
    const noisy = await sharp(await original())
      .composite([{ input: speck, left: 50, top: 1400 }])
      .png()
      .toBuffer()
    const { zones } = await deriveZonesAndDistress(noisy, await plate(), CANVAS)
    expect(zones).toHaveLength(2)
  })

  it('returns a canvas-sized distress mask', async () => {
    const { distress } = await deriveZonesAndDistress(await original(), await plate(), CANVAS)
    const meta = await sharp(distress).metadata()
    expect(meta.width).toBe(CANVAS.w)
    expect(meta.height).toBe(CANVAS.h)
  })

  it('puts HOLES in the distress mask where the original was scratched', async () => {
    // The whole point of lifting the mask off the artwork: the scratch that ran
    // through the sample lettering has to come back as transparent, so the new
    // name gets the same scratch.
    const { distress } = await deriveZonesAndDistress(await original({ scratch: true }), await plate(), CANVAS)
    const { data, info } = await sharp(distress).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => data[(y * info.width + x) * info.channels]

    // Solid part of the name block -> bright (keep the ink).
    expect(at(600, 200)).toBeGreaterThan(120)
    // The scratch stripe (y ~250-290) -> dark (punch a hole).
    expect(at(600, 270)).toBeLessThan(60)
  })

  it('is dark everywhere the plate was untouched', async () => {
    const { distress } = await deriveZonesAndDistress(await original(), await plate(), CANVAS)
    const { data, info } = await sharp(distress).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const corner = data[(20 * info.width + 20) * info.channels]
    expect(corner).toBeLessThan(30)
  })
})

describe('eyedropColours', () => {
  it('reads the dominant colour inside the zone as the fill', async () => {
    const colours = await eyedropColours(await original(), { x: 450, y: 600, w: 300, h: 500 })
    expect(colours.fill).toBe('#C8A020') // #C9A227 quantized to 5 bits/channel
  })

  it('offers a contrasting second colour as an outline', async () => {
    // The name block sits on cream, so the zone contains both.
    const colours = await eyedropColours(await original(), { x: 150, y: 120, w: 900, h: 300 })
    expect(colours.strokes.length).toBeGreaterThan(0)
    expect(colours.strokes[0].color).not.toBe(colours.fill)
  })

  it('returns no outline when the zone is a single flat colour', async () => {
    const colours = await eyedropColours(await original(), { x: 500, y: 700, w: 200, h: 300 })
    expect(colours.strokes).toEqual([])
  })
})
