import { describe, it, expect, vi } from 'vitest'

vi.mock('./print-palette.js', () => ({ matchMaterials: vi.fn() }))

import { matchMaterials } from './print-palette.js'
import {
  buildMiniMePrompt,
  sniffVideoContentType,
  extForVideo,
  hasConsent,
  createRateLimiter,
  nameForHex,
  toFilamentPlan,
  customerColorSentence,
  floorFilamentLine,
  getMiniMeFilamentPlan
} from './mini-me.js'

describe('buildMiniMePrompt', () => {
  it('asks for THIS person, printable, and white when not color', () => {
    const p = buildMiniMePrompt('white')
    expect(p).toMatch(/THIS exact person/)
    expect(p).toMatch(/one solid piece/)
    expect(p).toMatch(/matte white/)
    expect(p).not.toMatch(/flat solid colors/)
  })

  it('caps color at 4 flat colors and carries a short customer note', () => {
    const p = buildMiniMePrompt('color4', '  holding a basketball  ')
    expect(p).toMatch(/at most 4 flat solid colors/)
    expect(p).toMatch(/Customer note: holding a basketball\./)
  })
})

describe('upload checks', () => {
  it('sniffs mp4, mov and webm by their magic bytes, not the file name', () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(8)])
    const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(8)])
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(12)])
    expect(sniffVideoContentType(mp4)).toBe('video/mp4')
    expect(sniffVideoContentType(mov)).toBe('video/quicktime')
    expect(sniffVideoContentType(webm)).toBe('video/webm')
    expect(sniffVideoContentType(Buffer.from('not a video at all'))).toBeNull()
    expect(extForVideo('video/quicktime')).toBe('mov')
  })

  it('needs the consent box ticked', () => {
    expect(hasConsent('true')).toBe(true)
    expect(hasConsent('on')).toBe(true)
    expect(hasConsent(undefined)).toBe(false)
    expect(hasConsent('false')).toBe(false)
  })
})

describe('createRateLimiter', () => {
  it('allows max calls per window per key, then refuses until the window passes', () => {
    let t = 0
    const rl = createRateLimiter(2, 1000, () => t)
    expect(rl.take('u1')).toBe(true)
    expect(rl.take('u1')).toBe(true)
    expect(rl.take('u1')).toBe(false)
    expect(rl.take('u2')).toBe(true)
    t = 1500
    expect(rl.take('u1')).toBe(true)
  })
})

describe("Mrs. Imagine's filament plan", () => {
  it('names colors the way a shop buys filament', () => {
    expect(nameForHex('#000000')).toBe('Black')
    expect(nameForHex('#e9b77f')).toBe('Light Skin Tone')
    expect(nameForHex('#2059a8')).toBe('Denim Blue')
    expect(nameForHex('nope')).toBe('Unknown color')
  })

  const palette = [
    { hex: '#050505', pct: 0.4 },
    { hex: '#e9b77f', pct: 0.3 },
    { hex: '#2059a8', pct: 0.2 },
    { hex: '#fafafa', pct: 0.1 }
  ]
  const matches = [
    { slot: 1, target_hex: '#050505', material_id: 'a', color_name: 'Black', brand: 'Bambu', material: 'PLA', matched_hex: '#000000', in_stock: true },
    { slot: 2, target_hex: '#e9b77f', material_id: null, color_name: null, brand: null, material: null, matched_hex: null, in_stock: false },
    { slot: 3, target_hex: '#2059a8', material_id: null, color_name: null, brand: null, material: null, matched_hex: null, in_stock: false },
    { slot: 4, target_hex: '#fafafa', material_id: 'b', color_name: 'White', brand: 'Bambu', material: 'PLA', matched_hex: '#ffffff', in_stock: true }
  ]

  it('loads stocked spools and says exactly what to buy for the rest', () => {
    const plan = toFilamentPlan(matches, palette)
    expect(plan.map(p => p.load)).toEqual(['Black Bambu PLA', 'BUY Light Skin Tone PLA (#e9b77f)', 'BUY Denim Blue PLA (#2059a8)', 'White Bambu PLA'])
    expect(floorFilamentLine(plan)).toBe(
      'Load AMS: 1. Black Bambu PLA · 2. BUY Light Skin Tone PLA (#e9b77f) · 3. BUY Denim Blue PLA (#2059a8) · 4. White Bambu PLA — not in stock, buy before printing: Light Skin Tone, Denim Blue'
    )
  })

  it('tells the customer in plain words', () => {
    expect(customerColorSentence(toFilamentPlan(matches, palette))).toBe("We'll print you in: Black, Light Skin Tone, Denim Blue and White.")
    expect(customerColorSentence([])).toBe('')
  })

  it('never throws and falls back to "buy" for every color when the stock read fails', async () => {
    ;(matchMaterials as any).mockRejectedValueOnce(new Error('db down'))
    const plan = await getMiniMeFilamentPlan(palette)
    expect(plan).toHaveLength(4)
    expect(plan.every(p => !p.inStock)).toBe(true)
    expect(await getMiniMeFilamentPlan(null)).toEqual([])
  })
})
