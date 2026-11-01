// Tests for sourceDesignFileName — the name a download-tier listing's digital
// file is posted to Etsy under. Etsy 400s anything outside 3-70 chars or using
// characters other than letters, digits, '-', '_' and '.'. The old 60-char slug
// plus '-300dpi.png' made 71 for the Merry Christmas Emblem (draft 4607163717,
// 2026-10-31), so its file never attached and Craft type was never set.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase.js', () => ({ supabase: {} }))

const { sourceDesignFileName } = await import('./etsy.js')

const ETSY_NAME = /^[A-Za-z0-9._-]{3,70}$/
const PNG = 'https://storage.googleapis.com/bucket/designs/8583d64f.png?X-Goog-Signature=abc'

describe('sourceDesignFileName', () => {
  it('keeps the Merry Christmas Emblem name inside Etsy\'s 70 chars', () => {
    const name = sourceDesignFileName('Merry Christmas Emblem Festive Graphic T-Shirt | Unisex Holiday Tee', PNG)
    expect(name.length).toBeLessThanOrEqual(70)
    expect(name).toMatch(ETSY_NAME)
    expect(name).toBe('Merry-Christmas-Emblem-Festive-Graphic-T-Shirt-Unisex-Holid-300dpi.png')
  })

  it('cuts a 200-char name to a valid <=70 name with no trailing hyphen', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Word${i}`).join(' ').padEnd(200, ' x').slice(0, 200)
    expect(long.length).toBe(200)
    const name = sourceDesignFileName(long, PNG)
    expect(name.length).toBeLessThanOrEqual(70)
    expect(name).toMatch(ETSY_NAME)
    const slug = name.slice(0, -'-300dpi.png'.length)
    expect(slug).not.toMatch(/-$/)
    expect(name).not.toContain('--')
  })

  it('trims a hyphen the cut lands on', () => {
    // 58 letters then a space: the 59-char budget for png ends on the hyphen.
    const name = sourceDesignFileName(`${'A'.repeat(58)} Tail`, PNG)
    expect(name).toBe(`${'A'.repeat(58)}-300dpi.png`)
    expect(name).toMatch(ETSY_NAME)
  })

  it('budgets for a 4-letter extension and falls back to "design"', () => {
    expect(sourceDesignFileName('B'.repeat(200), 'https://x/y/art.jpeg').length).toBe(70)
    expect(sourceDesignFileName(null, PNG)).toBe('design-300dpi.png')
    expect(sourceDesignFileName('|||', 'https://x/y/noext')).toMatch(ETSY_NAME)
  })
})
