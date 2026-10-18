// api/share-card.mjs (kept here: a file directly under api/ would deploy as an endpoint).
// The link-preview card: real sharp on small synthetic images, fetch stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'
import handler, { renderShareCard, CARD_WIDTH, CARD_HEIGHT } from '../share-card.mjs'

/** A square photo: `bg` everywhere, a dark block in the middle (the garment). */
const photo = (bg, { alpha = false } = {}) =>
  sharp({ create: { width: 200, height: 200, channels: alpha ? 4 : 3, background: alpha ? { ...bg, alpha: 1 } : bg } })
    .composite([{ input: { create: { width: 100, height: 120, channels: 3, background: { r: 20, g: 20, b: 20 } } }, left: 50, top: 40 }])
    .png()
    .toBuffer()

/** Transparent art: only a centred block of `ink` is opaque. */
const art = (ink) =>
  sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 120, height: 60, channels: 4, background: { ...ink, alpha: 1 } } }, left: 40, top: 70 }])
    .png()
    .toBuffer()

/** Colour of the card's left padding bar. */
async function paddingColour(jpeg) {
  const { data } = await sharp(jpeg).extract({ left: 10, top: 300, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
  return [data[0], data[1], data[2]]
}
const near = (rgb, target) => rgb.every((c, i) => Math.abs(c - target[i]) <= 6)

describe('renderShareCard', () => {
  it('fits the whole photo into a 1200x630 JPEG, padded with the photo backdrop', async () => {
    const jpeg = await renderShareCard(await photo({ r: 238, g: 238, b: 240 }), sharp)
    const meta = await sharp(jpeg).metadata()
    expect([meta.width, meta.height, meta.format]).toEqual([CARD_WIDTH, CARD_HEIGHT, 'jpeg'])
    expect(near(await paddingColour(jpeg), [238, 238, 240])).toBe(true)
  })

  it('treats a fully opaque image with an alpha channel as a photo (the 3D print render)', async () => {
    const jpeg = await renderShareCard(await photo({ r: 250, g: 250, b: 250 }, { alpha: true }), sharp)
    expect(near(await paddingColour(jpeg), [250, 250, 250])).toBe(true)
  })

  it('puts light transparent art on near-black so white lettering stays visible', async () => {
    const jpeg = await renderShareCard(await art({ r: 255, g: 255, b: 255 }), sharp)
    expect(near(await paddingColour(jpeg), [24, 24, 27])).toBe(true)
  })

  it('puts dark transparent art on white', async () => {
    const jpeg = await renderShareCard(await art({ r: 30, g: 60, b: 160 }), sharp)
    expect(near(await paddingColour(jpeg), [255, 255, 255])).toBe(true)
  })
})

describe('handler', () => {
  const res = () => ({
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    end(body) {
      this.body = body
      return this
    }
  })
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('never fetches a caller-supplied url: a bad id goes to the logo', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const out = res()
    await handler({ query: { id: 'https://evil.test/x.png' } }, out)
    expect(out.statusCode).toBe(302)
    expect(out.headers.Location).toMatch(/itp-logo-v3\.png$/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
