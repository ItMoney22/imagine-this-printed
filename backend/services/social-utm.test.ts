import { describe, it, expect } from 'vitest'
import { buildUtmUrl, withSocialUtm, SOCIAL_UTM_MEDIUM } from './social-utm.js'

const PRODUCT_URL = 'https://imaginethisprinted.com/product/galaxy-cat-tee'
const OUTBOX_ID = '9f1c0d3e-4a2b-4c5d-8e6f-7a8b9c0d1e2f'

describe('buildUtmUrl', () => {
  it('appends the three tracking params', () => {
    const url = new URL(buildUtmUrl(PRODUCT_URL, { source: 'tiktok', medium: 'social', campaign: OUTBOX_ID }))
    expect(url.searchParams.get('utm_source')).toBe('tiktok')
    expect(url.searchParams.get('utm_medium')).toBe('social')
    expect(url.searchParams.get('utm_campaign')).toBe(OUTBOX_ID)
    expect(url.pathname).toBe('/product/galaxy-cat-tee')
  })

  it('keeps existing query params and the fragment', () => {
    const out = buildUtmUrl(`${PRODUCT_URL}?variant=xl#reviews`, {
      source: 'tiktok',
      medium: 'social',
      campaign: OUTBOX_ID
    })
    const url = new URL(out)
    expect(url.searchParams.get('variant')).toBe('xl')
    expect(url.hash).toBe('#reviews')
  })

  it('replaces rather than duplicates a utm that is already there', () => {
    const out = buildUtmUrl(`${PRODUCT_URL}?utm_source=old`, { source: 'tiktok', medium: 'social', campaign: OUTBOX_ID })
    expect(out.match(/utm_source=/g)).toHaveLength(1)
    expect(new URL(out).searchParams.get('utm_source')).toBe('tiktok')
  })

  it('omits utm_content when it is not supplied', () => {
    const out = buildUtmUrl(PRODUCT_URL, { source: 'tiktok', medium: 'social', campaign: OUTBOX_ID })
    expect(out).not.toContain('utm_content')
  })

  it('returns an unparseable url untouched instead of breaking the caption', () => {
    expect(buildUtmUrl('not a url', { source: 'tiktok', medium: 'social', campaign: OUTBOX_ID })).toBe('not a url')
    expect(buildUtmUrl('', { source: 'tiktok', medium: 'social', campaign: OUTBOX_ID })).toBe('')
  })
})

describe('withSocialUtm', () => {
  it('uses the platform as the source and the outbox id as the campaign', () => {
    const url = new URL(withSocialUtm(PRODUCT_URL, { platform: 'tiktok', outboxId: OUTBOX_ID }))
    expect(url.searchParams.get('utm_source')).toBe('tiktok')
    expect(url.searchParams.get('utm_medium')).toBe(SOCIAL_UTM_MEDIUM)
    expect(url.searchParams.get('utm_campaign')).toBe(OUTBOX_ID)
  })

  it('falls back to a generic source when the platform is blank', () => {
    const url = new URL(withSocialUtm(PRODUCT_URL, { platform: '', outboxId: OUTBOX_ID }))
    expect(url.searchParams.get('utm_source')).toBe('social')
  })
})
