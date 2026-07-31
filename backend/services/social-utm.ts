// ---------------------------------------------------------------------------
// UTM tagging for outbound social links.
//
// Every product URL that leaves the social outbox carries attribution, so a
// sale can be traced back to the exact post that drove it. utm_campaign is the
// social_outbox row id (a UUID) — that is the only identifier that is unique
// per post and already exists, and it joins straight back to the outbox row
// that produced the click.
//
// Pure and I/O-free on purpose: it is unit-tested directly
// (social-utm.test.ts) and imported by seo-pack.ts and routes/social-outbox.ts.
// ---------------------------------------------------------------------------

/** Every outbox link is organic social, whatever the platform. */
export const SOCIAL_UTM_MEDIUM = 'social'

export interface UtmParams {
  source: string
  medium: string
  campaign: string
  content?: string
}

/**
 * Append utm_* params to a URL. Existing utm values are replaced, every other
 * query param and the fragment survive. An unparseable URL is returned
 * unchanged — a caption with a plain link beats a caption with a broken one.
 */
export function buildUtmUrl(rawUrl: string, params: UtmParams): string {
  if (!rawUrl) return rawUrl
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return rawUrl
  }
  const pairs: Array<[string, string | undefined]> = [
    ['utm_source', params.source],
    ['utm_medium', params.medium],
    ['utm_campaign', params.campaign],
    ['utm_content', params.content]
  ]
  for (const [key, value] of pairs) {
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

/**
 * The one call site shape the outbox needs: tag a product URL for a specific
 * queued post. `platform` becomes utm_source (tiktok, instagram, …) so David
 * can split traffic per network in analytics.
 */
export function withSocialUtm(productUrl: string, opts: { platform: string; outboxId: string }): string {
  return buildUtmUrl(productUrl, {
    source: opts.platform || 'social',
    medium: SOCIAL_UTM_MEDIUM,
    campaign: opts.outboxId
  })
}
