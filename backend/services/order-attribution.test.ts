import { describe, it, expect } from 'vitest'
import { sanitizeAttribution } from './order-attribution.js'

describe('sanitizeAttribution', () => {
  it('keeps allowlisted string fields and normalizes landed_at to ISO', () => {
    const out = sanitizeAttribution({
      utm_source: 'tiktok',
      utm_medium: 'social',
      utm_campaign: '9f1c0d3e-4a2b-4c5d-8e6f-7a8b9c0d1e2f',
      utm_content: 'v2',
      utm_term: 'custom shirt',
      referrer: 'https://www.tiktok.com/@imaginethisprinted',
      landed_at: '2026-08-10T12:00:00.000Z'
    })
    expect(out).toEqual({
      utm_source: 'tiktok',
      utm_medium: 'social',
      utm_campaign: '9f1c0d3e-4a2b-4c5d-8e6f-7a8b9c0d1e2f',
      utm_content: 'v2',
      utm_term: 'custom shirt',
      referrer: 'https://www.tiktok.com/@imaginethisprinted',
      landed_at: '2026-08-10T12:00:00.000Z'
    })
  })

  it('returns null for absent/null/wrong-type input', () => {
    expect(sanitizeAttribution(undefined)).toBeNull()
    expect(sanitizeAttribution(null)).toBeNull()
    expect(sanitizeAttribution('tiktok')).toBeNull()
    expect(sanitizeAttribution(['tiktok'])).toBeNull()
    expect(sanitizeAttribution(42)).toBeNull()
  })

  it('returns null when every field is empty', () => {
    expect(sanitizeAttribution({})).toBeNull()
    expect(sanitizeAttribution({ utm_source: '', utm_medium: '   ' })).toBeNull()
  })

  it('drops unknown keys — no arbitrary JSONB payload from the client', () => {
    const out = sanitizeAttribution({ utm_source: 'tiktok', evil: '<script>alert(1)</script>', __proto__: { polluted: true } })
    expect(out).toEqual({ utm_source: 'tiktok' })
  })

  it('coerces non-string values on allowlisted keys to absent rather than throwing', () => {
    const out = sanitizeAttribution({ utm_source: 123, utm_medium: { nested: true }, utm_campaign: 'organic' })
    expect(out).toEqual({ utm_campaign: 'organic' })
  })

  it('caps string length so a hostile payload cannot bloat the row', () => {
    const long = 'a'.repeat(1000)
    const out = sanitizeAttribution({ utm_source: long })
    expect(out?.utm_source?.length).toBe(300)
  })

  it('drops an unparseable landed_at instead of storing garbage', () => {
    const out = sanitizeAttribution({ utm_source: 'tiktok', landed_at: 'not-a-date' })
    expect(out).toEqual({ utm_source: 'tiktok' })
    expect(out?.landed_at).toBeUndefined()
  })
})
