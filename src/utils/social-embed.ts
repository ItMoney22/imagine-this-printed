// Shared social-URL helpers, extracted out of the now-deleted mock
// src/utils/social-service.ts. Pure, no network/DB calls — used by
// Community.tsx (client-side validation before submitting) and mirrors the
// equivalent logic on the server in backend/routes/social.ts (which is the
// source of truth for what actually gets persisted).

export type SocialPlatform = 'tiktok' | 'instagram' | 'youtube' | 'twitter'

// Extract platform from URL
export function extractPlatformFromUrl(url: string): SocialPlatform | null {
  try {
    const lowerUrl = url.toLowerCase()

    if (lowerUrl.includes('tiktok.com')) return 'tiktok'
    if (lowerUrl.includes('instagram.com')) return 'instagram'
    if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube'
    if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) return 'twitter'

    return null
  } catch (error) {
    console.error('Error extracting platform from URL:', error)
    return null
  }
}

// Validate social media URL
export function validateSocialUrl(url: string): { isValid: boolean; platform?: SocialPlatform; error?: string } {
  try {
    const platform = extractPlatformFromUrl(url)

    if (!platform) {
      return {
        isValid: false,
        error: 'URL must be from TikTok, Instagram, YouTube, or Twitter'
      }
    }

    try {
      new URL(url)
    } catch {
      return {
        isValid: false,
        error: 'Invalid URL format'
      }
    }

    return {
      isValid: true,
      platform
    }
  } catch {
    return {
      isValid: false,
      error: 'Failed to validate URL'
    }
  }
}

// Client-side embed preview helper (best-effort; the server generates the
// authoritative embed_code stored on the post when a submission is approved
// — see generateEmbedCode() in backend/routes/social.ts).
export function getEmbedCode(url: string, platform: string): string | null {
  try {
    switch (platform) {
      case 'tiktok': {
        const tiktokId = url.split('/video/')[1]?.split('?')[0]
        return tiktokId
          ? `<iframe src="https://www.tiktok.com/embed/${tiktokId}" width="325" height="580" frameborder="0" allowfullscreen></iframe>`
          : null
      }
      case 'instagram':
        return `<iframe src="${url}embed/" width="400" height="480" frameborder="0" scrolling="no" allowtransparency="true"></iframe>`
      case 'youtube': {
        const youtubeId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/)?.[1]
        return youtubeId
          ? `<iframe width="560" height="315" src="https://www.youtube.com/embed/${youtubeId}" frameborder="0" allowfullscreen></iframe>`
          : null
      }
      case 'twitter':
        return `<blockquote class="twitter-tweet"><a href="${url}"></a></blockquote>`
      default:
        return null
    }
  } catch (error) {
    console.error('Error getting embed code:', error)
    return null
  }
}
