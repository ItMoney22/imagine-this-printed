import { describe, it, expect } from 'vitest'
import { extractPlatformFromUrl, validateSocialUrl, getEmbedCode } from './social-embed'

describe('extractPlatformFromUrl', () => {
  it('detects tiktok, instagram, youtube, and twitter/x URLs', () => {
    expect(extractPlatformFromUrl('https://www.tiktok.com/@user/video/123')).toBe('tiktok')
    expect(extractPlatformFromUrl('https://www.instagram.com/p/ABC123/')).toBe('instagram')
    expect(extractPlatformFromUrl('https://www.youtube.com/watch?v=abc')).toBe('youtube')
    expect(extractPlatformFromUrl('https://youtu.be/abc')).toBe('youtube')
    expect(extractPlatformFromUrl('https://twitter.com/user/status/123')).toBe('twitter')
    expect(extractPlatformFromUrl('https://x.com/user/status/123')).toBe('twitter')
  })

  it('returns null for unsupported URLs', () => {
    expect(extractPlatformFromUrl('https://example.com/whatever')).toBeNull()
  })
})

describe('validateSocialUrl', () => {
  it('accepts a valid supported-platform URL', () => {
    const result = validateSocialUrl('https://www.tiktok.com/@user/video/123')
    expect(result.isValid).toBe(true)
    expect(result.platform).toBe('tiktok')
  })

  it('rejects an unsupported platform with an explanatory error', () => {
    const result = validateSocialUrl('https://example.com/post/1')
    expect(result.isValid).toBe(false)
    expect(result.error).toMatch(/TikTok, Instagram, YouTube, or Twitter/)
  })

  it('rejects a malformed URL even if it superficially mentions a platform', () => {
    const result = validateSocialUrl('not a url but has tiktok.com in it')
    // extractPlatformFromUrl matches on substring so platform resolves, but
    // `new URL()` should still throw on the malformed string.
    expect(result.isValid).toBe(false)
  })
})

describe('getEmbedCode', () => {
  it('builds a tiktok iframe embed from a video URL', () => {
    const embed = getEmbedCode('https://www.tiktok.com/@user/video/123456', 'tiktok')
    expect(embed).toContain('tiktok.com/embed/123456')
  })

  it('builds a youtube iframe embed from a watch URL', () => {
    const embed = getEmbedCode('https://www.youtube.com/watch?v=abc123', 'youtube')
    expect(embed).toContain('youtube.com/embed/abc123')
  })

  it('returns null for an unknown platform', () => {
    expect(getEmbedCode('https://example.com', 'myspace')).toBeNull()
  })
})
