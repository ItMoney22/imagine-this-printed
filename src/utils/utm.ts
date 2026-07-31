// ---------------------------------------------------------------------------
// Landing attribution capture.
//
// Social links leave the outbox carrying utm_source / utm_medium /
// utm_campaign (backend/services/social-utm.ts). Those params only exist on
// the FIRST url of a visit — one client-side route change and they are gone,
// so they have to be read and stored the moment the app boots, long before
// checkout asks who sent this buyer.
//
// Attribution model: LAST touch wins. A visitor who arrives from a TikTok post
// today and a different post next week is credited to the second post, because
// the question David is actually asking is "which post drove this sale". A
// visit with no utm params does NOT clear a stored one — direct returns and
// internal navigation must not wipe the campaign that earned the visit.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'itp_attribution'
// Past this, a stored campaign is noise rather than signal.
const MAX_AGE_DAYS = 90

export interface LandingAttribution {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  referrer?: string
  landed_at: string
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

/** Pure: pull the utm_* params out of a query string. Empty object when none. */
export function parseUtmParams(search: string): Partial<Record<(typeof UTM_KEYS)[number], string>> {
  const params = new URLSearchParams(search || '')
  const out: Partial<Record<(typeof UTM_KEYS)[number], string>> = {}
  for (const key of UTM_KEYS) {
    const value = params.get(key)
    if (value) out[key] = value.slice(0, 200)
  }
  return out
}

/** Pure: has this attribution record aged out? */
export function isExpired(record: LandingAttribution, now: number = Date.now()): boolean {
  const landed = Date.parse(record.landed_at)
  if (Number.isNaN(landed)) return true
  return now - landed > MAX_AGE_DAYS * 24 * 60 * 60 * 1000
}

/**
 * Read the current URL's utm params and persist them. Called once from
 * main.tsx, before React mounts. Returns what is now stored (which may be an
 * older record when this visit carried no params), or null if nothing is known.
 */
export function captureLandingUtms(): LandingAttribution | null {
  if (typeof window === 'undefined') return null
  const utms = parseUtmParams(window.location.search)
  if (Object.keys(utms).length === 0) return getLandingUtms()

  const record: LandingAttribution = {
    ...utms,
    referrer: document.referrer ? document.referrer.slice(0, 300) : undefined,
    landed_at: new Date().toISOString()
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // Private mode / storage full — attribution is best-effort, never fatal.
  }
  return record
}

/** The stored attribution for this visitor, or null when absent/expired/corrupt. */
export function getLandingUtms(): LandingAttribution | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LandingAttribution
    if (!parsed?.landed_at || isExpired(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/** Clear attribution — call once an order has recorded it. */
export function clearLandingUtms(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
