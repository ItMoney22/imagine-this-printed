// Eyedrop on OPAQUE art: the painted background must not become the "fill".
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { borderBackground, eyedropColours } from './authoring.js'

/** 200x200 white canvas with a maroon block (the "letters") covering a third of it. */
async function opaqueArt(): Promise<Buffer> {
  const letters = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#7A1F2B' } }).png().toBuffer()
  return sharp({ create: { width: 200, height: 200, channels: 3, background: '#FFFFFF' } })
    .composite([{ input: letters, left: 60, top: 60 }])
    .png()
    .toBuffer()
}

describe('eyedrop on opaque art', () => {
  it('reads the border as the background', async () => {
    expect(await borderBackground(await opaqueArt())).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('without the ignore, the white background wins (the live 2026-09-24 bug)', async () => {
    const c = await eyedropColours(await opaqueArt(), { x: 20, y: 20, w: 160, h: 160 })
    expect(c.fill).toBe('#F8F8F8')
  })

  it('ignoring the background makes the letters the fill', async () => {
    const art = await opaqueArt()
    const c = await eyedropColours(art, { x: 20, y: 20, w: 160, h: 160 }, { ignore: (await borderBackground(art))! })
    expect(c.fill).toBe('#781828')
  })

  it('transparent art has no background to ignore', async () => {
    const clear = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    expect(await borderBackground(clear)).toBeNull()
  })
})
