// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { parseUtmParams, isExpired, captureLandingUtms, getLandingUtms, clearLandingUtms } from './utm'

const setUrl = (search: string) => {
  window.history.replaceState({}, '', `/product/galaxy-cat-tee${search}`)
}

beforeEach(() => {
  window.localStorage.clear()
  setUrl('')
})

describe('parseUtmParams', () => {
  it('extracts every utm param it knows about', () => {
    expect(parseUtmParams('?utm_source=tiktok&utm_medium=social&utm_campaign=abc-123')).toEqual({
      utm_source: 'tiktok',
      utm_medium: 'social',
      utm_campaign: 'abc-123'
    })
  })

  it('ignores non-utm params and empty values', () => {
    expect(parseUtmParams('?variant=xl&utm_source=&utm_campaign=abc')).toEqual({ utm_campaign: 'abc' })
  })

  it('returns an empty object for a bare url', () => {
    expect(parseUtmParams('')).toEqual({})
  })
})

describe('isExpired', () => {
  const now = Date.parse('2026-07-28T00:00:00.000Z')
  it('keeps a recent record', () => {
    expect(isExpired({ landed_at: '2026-07-01T00:00:00.000Z' }, now)).toBe(false)
  })
  it('drops one older than 90 days', () => {
    expect(isExpired({ landed_at: '2026-01-01T00:00:00.000Z' }, now)).toBe(true)
  })
  it('treats an unparseable timestamp as expired', () => {
    expect(isExpired({ landed_at: 'whenever' }, now)).toBe(true)
  })
})

describe('captureLandingUtms', () => {
  it('stores the campaign that brought the visitor in', () => {
    setUrl('?utm_source=tiktok&utm_medium=social&utm_campaign=outbox-1')
    const captured = captureLandingUtms()
    expect(captured?.utm_campaign).toBe('outbox-1')
    expect(getLandingUtms()?.utm_source).toBe('tiktok')
  })

  it('does NOT clear a stored campaign on a later param-free visit', () => {
    setUrl('?utm_source=tiktok&utm_campaign=outbox-1')
    captureLandingUtms()
    setUrl('')
    expect(captureLandingUtms()?.utm_campaign).toBe('outbox-1')
    expect(getLandingUtms()?.utm_campaign).toBe('outbox-1')
  })

  it('lets a newer campaign overwrite an older one (last touch wins)', () => {
    setUrl('?utm_campaign=outbox-1')
    captureLandingUtms()
    setUrl('?utm_campaign=outbox-2')
    captureLandingUtms()
    expect(getLandingUtms()?.utm_campaign).toBe('outbox-2')
  })
})

describe('getLandingUtms', () => {
  it('returns null when nothing has been captured', () => {
    expect(getLandingUtms()).toBeNull()
  })

  it('returns null for corrupt storage instead of throwing', () => {
    window.localStorage.setItem('itp_attribution', '{not json')
    expect(getLandingUtms()).toBeNull()
  })

  it('returns null once the record has aged out', () => {
    window.localStorage.setItem('itp_attribution', JSON.stringify({ utm_campaign: 'old', landed_at: '2020-01-01T00:00:00.000Z' }))
    expect(getLandingUtms()).toBeNull()
  })

  it('is empty again after clearLandingUtms', () => {
    setUrl('?utm_campaign=outbox-1')
    captureLandingUtms()
    clearLandingUtms()
    expect(getLandingUtms()).toBeNull()
  })
})
