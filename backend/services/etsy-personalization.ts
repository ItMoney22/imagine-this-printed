// Etsy personalization answers on a sold transaction (task 5d007181, 2026-11-01).
//
// Etsy now lets a listing ask several personalization questions, including a
// file upload. A buyer's answers come back on the receipt's transaction in the
// SAME variations array as before (Etsy personalization migration guide,
// "Reading transaction personalization data", read 2026-11-01):
//   - every answer is an object with property_id 54,
//   - there may be more than one,
//   - formatted_name is the seller's own question label, not "Personalization",
//   - an upload answer's formatted_value is a URL.
// Etsy also HTML-escapes the strings (an apostrophe reads back as &#39;).
//
// This module is listing-agnostic on purpose: the pet ornament reads a name and
// a photo, and the name-gift path (task 38b25b7d) can read its name the same way.
// It only ever READS from Etsy.
import type { EtsyReceiptTransaction } from './etsy.js'
import { sniffImageContentType } from './google-cloud-storage.js'

export const PERSONALIZATION_PROPERTY_ID = 54

export interface PersonalizationAnswer {
  /** The seller's question label, unescaped ("Your pet's name"). */
  label: string
  /** The buyer's answer, unescaped. For an upload: the URL(s). */
  value: string
  /** Every http(s) URL in the answer, in order. Empty for a typed answer. */
  urls: string[]
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Undo Etsy's HTML escaping: &#39; -> ', &amp; -> &, &#x27; -> '. Unknown entities stay as typed. */
export function decodeEtsyText(s: unknown): string {
  if (typeof s !== 'string') return ''
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

const URL_RE = /https?:\/\/[^\s,<>"']+/gi

/**
 * Every personalization answer on a transaction. property_id 54 is the rule;
 * an entry literally named "Personalization" (the old single-box format) is
 * read too, so an order from before the questions changed still has its text.
 */
export function readPersonalization(txn: Pick<EtsyReceiptTransaction, 'variations'>): PersonalizationAnswer[] {
  const out: PersonalizationAnswer[] = []
  for (const v of txn.variations ?? []) {
    const isAnswer = v.property_id === PERSONALIZATION_PROPERTY_ID || /^personali[sz]ation$/i.test(String(v.formatted_name ?? '').trim())
    if (!isAnswer) continue
    const value = decodeEtsyText(v.formatted_value).trim()
    if (!value) continue
    out.push({ label: decodeEtsyText(v.formatted_name).trim(), value, urls: value.match(URL_RE) ?? [] })
  }
  return out
}

/**
 * The typed answer to a "name" question: the first typed answer whose label
 * says name, else the first typed answer at all (the old single box). Raw:
 * the caller sanitizes and caps it with the product's own rule.
 */
export function typedAnswer(answers: PersonalizationAnswer[], labelHint: RegExp = /name/i): string | null {
  const typed = answers.filter((a) => a.urls.length === 0)
  return (typed.find((a) => labelHint.test(a.label)) ?? typed[0])?.value ?? null
}

/** Every uploaded file URL across the answers, in answer order, de-duplicated. */
export function uploadUrls(answers: PersonalizationAnswer[]): string[] {
  return [...new Set(answers.flatMap((a) => a.urls))]
}

// ---------------------------------------------------------------------------
// Downloading an uploaded photo
// ---------------------------------------------------------------------------

/**
 * Only Etsy's own hosts are fetched. The URL sits in a buyer-facing answer,
 * and a typed answer can hold any URL a buyer likes, so fetching whatever is
 * there would let a buyer point our server anywhere. ETSY_UPLOAD_HOSTS adds
 * hosts (comma list) if Etsy serves uploads from somewhere new: the error
 * names the host, so the first real order says what to add.
 */
const ETSY_HOSTS = ['etsy.com', 'etsystatic.com']

export function isAllowedUploadUrl(url: string, extraHosts: string = process.env.ETSY_UPLOAD_HOSTS ?? ''): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  const allowed = [...ETSY_HOSTS, ...extraHosts.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)]
  return allowed.some((h) => host === h || host.endsWith(`.${h}`))
}

const isEtsyHost = (url: string) => isAllowedUploadUrl(url, '')

/** Same ceiling as the site's own photo upload (routes/pet-ornament.ts). */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface DownloadDeps {
  fetch: typeof fetch
  /** Etsy API headers, asked for only if Etsy refuses the plain download. Never sent to another host. */
  etsyHeaders?: () => Promise<Record<string, string>>
}

export interface DownloadedFile {
  url: string
  bytes: Buffer
  contentType: string
  /** True when Etsy wanted the API headers for this file. */
  authed: boolean
}

async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > MAX_UPLOAD_BYTES) throw new Error(`the file is ${Math.round(declared / 1e6)} MB, over the ${MAX_UPLOAD_BYTES / 1e6} MB limit`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_UPLOAD_BYTES) throw new Error(`the file is ${Math.round(buf.length / 1e6)} MB, over the ${MAX_UPLOAD_BYTES / 1e6} MB limit`)
  return buf
}

/**
 * Downloads one buyer upload. Plain GET first; if Etsy answers 401/403, once
 * more with the API headers, following any redirect by hand so the token
 * never leaves Etsy. Throws a plain-English reason on anything that is not a
 * JPEG, PNG or WebP photo.
 */
export async function downloadUpload(url: string, deps: DownloadDeps): Promise<DownloadedFile> {
  if (!isAllowedUploadUrl(url)) {
    let host = 'an unreadable address'
    try { host = new URL(url).hostname } catch { /* keep the default */ }
    throw new Error(`the photo link is on ${host}, which is not an Etsy address (add it to ETSY_UPLOAD_HOSTS if Etsy now serves uploads there)`)
  }
  const ua = { 'User-Agent': 'ImagineThisPrinted-orders/1.0 (+https://imaginethisprinted.com)' }
  let res = await deps.fetch(url, { headers: ua, redirect: 'follow' })
  let authed = false
  if ((res.status === 401 || res.status === 403) && deps.etsyHeaders && isEtsyHost(url)) {
    authed = true
    res = await deps.fetch(url, { headers: { ...ua, ...(await deps.etsyHeaders()) }, redirect: 'manual' })
    const next = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && next) {
      const hop = new URL(next, url).toString()
      if (!isAllowedUploadUrl(hop)) throw new Error(`Etsy sent the photo on to ${new URL(hop).hostname}, which is not an Etsy address`)
      res = await deps.fetch(hop, { headers: isEtsyHost(hop) ? { ...ua, ...(await deps.etsyHeaders()) } : ua, redirect: 'follow' })
    }
  }
  if (!res.ok) throw new Error(`Etsy answered ${res.status} for the photo`)
  const bytes = await readCapped(res)
  const contentType = sniffImageContentType(bytes)
  if (!contentType || !PHOTO_TYPES.has(contentType)) {
    const declared = res.headers.get('content-type') || 'unknown'
    throw new Error(`the upload is not a JPEG, PNG or WebP photo (Etsy says ${declared})`)
  }
  return { url, bytes, contentType, authed }
}
