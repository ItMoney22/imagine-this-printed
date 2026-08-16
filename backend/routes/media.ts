// ---------------------------------------------------------------------------
// Stable media proxy — permanent public addresses for private GCS objects.
//
// Public bucket access is blocked at the org level (see services/gcs-storage.ts),
// so every asset URL we persisted was a 365-day signed URL. Those URLs rot: the
// design-library import minted ~2,700 of them, and every one of those product
// images would start returning 403 a year after import.
//
// This route is the permanent address. `/api/media/<gcs-path>` 302s to a freshly
// minted, short-lived signed URL, so the string we store in the database never
// expires and never needs a refresh sweep.
//
//   stored:   https://api.imaginethisprinted.com/api/media/design-library/gaming/12.png
//   served:   302 → https://storage.googleapis.com/...?X-Goog-Signature=...  (1 h)
//
// Only allowlisted prefixes are proxied. `users/**` (private customer uploads)
// is deliberately NOT reachable through here.
// ---------------------------------------------------------------------------
import { Router, Request, Response } from 'express'
import { Storage, Bucket } from '@google-cloud/storage'

const router = Router()

const projectId = process.env.GCS_PROJECT_ID || 'imagine-this-printed-main'
const bucketName = process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main'

function createStorageClient(): Storage {
  // GCS_CREDENTIALS is inline JSON on Render and a key-file path locally.
  const creds = (process.env.GCS_CREDENTIALS || '').trim()
  if (creds && creds !== '{}') {
    if (creds.startsWith('{')) {
      try {
        return new Storage({ projectId, credentials: JSON.parse(creds) })
      } catch (e) {
        console.error('[media] GCS_CREDENTIALS is not valid JSON:', (e as Error).message)
      }
    } else {
      return new Storage({ projectId, keyFilename: creds })
    }
  }
  if (process.env.GCS_CREDENTIALS_PATH) {
    return new Storage({ projectId, keyFilename: process.env.GCS_CREDENTIALS_PATH })
  }
  return new Storage({ projectId })
}

let bucketRef: Bucket | null = null
function getBucket(): Bucket {
  if (!bucketRef) bucketRef = createStorageClient().bucket(bucketName)
  return bucketRef
}

// Prefixes this route is allowed to hand out. Override with MEDIA_PROXY_PREFIXES
// (comma separated) if a new asset folder needs a permanent address.
const DEFAULT_PREFIXES = [
  'design-library/',   // flattened design PNGs (the catalog product image)
  'design-sources/',   // .ai/.svg/.eps/.psd originals for the same designs
  'graphics/',         // product graphics uploaded through the admin
  'stock-models/',     // model photos used by the mockup pipeline
  'products/',
  'mockups/'
]
const ALLOWED_PREFIXES = (() => {
  const configured = (process.env.MEDIA_PROXY_PREFIXES || '')
    .split(',')
    .map(p => p.trim().replace(/^\/+/, ''))
    .filter(Boolean)
    .map(p => (p.endsWith('/') ? p : `${p}/`))
  return configured.length > 0 ? configured : DEFAULT_PREFIXES
})()

// Signature lifetime vs. how long anyone may cache the redirect. Cache TTL is
// kept well under the signature TTL so a cached 302 can never point at a dead
// signature.
const SIGNED_TTL_MS = 60 * 60 * 1000        // 1 hour
const REDIRECT_CACHE_S = 45 * 60            // 45 minutes
// Misses are remembered briefly too, so a loop requesting absent objects can't
// turn into an unbounded stream of GCS exists() calls.
const MISS_TTL_MS = 60 * 1000

// url === null means "known missing" (negative cache entry).
type CacheEntry = { url: string | null; expiresAt: number }
const signedUrlCache = new Map<string, CacheEntry>()
const MAX_CACHE_ENTRIES = 5000

/** undefined = not cached, null = cached miss, string = cached signed URL. */
function cacheGet(key: string): string | null | undefined {
  const hit = signedUrlCache.get(key)
  if (!hit) return undefined
  if (hit.expiresAt <= Date.now()) {
    signedUrlCache.delete(key)
    return undefined
  }
  return hit.url
}

function cacheSet(key: string, url: string | null, ttlMs: number): void {
  if (signedUrlCache.size >= MAX_CACHE_ENTRIES) {
    // Cheap eviction: drop the oldest insertion (Map preserves insert order).
    const oldest = signedUrlCache.keys().next().value
    if (oldest) signedUrlCache.delete(oldest)
  }
  signedUrlCache.set(key, { url, expiresAt: Date.now() + ttlMs })
}

/** Decode the request path back into a GCS object name, or null if unsafe. */
export function normalizeMediaPath(rawPath: string): string | null {
  let decoded: string
  try {
    decoded = rawPath
      .replace(/^\/+/, '')
      .split('/')
      .map(segment => decodeURIComponent(segment))
      .join('/')
  } catch {
    return null
  }
  if (!decoded) return null
  if (decoded.includes('\\')) return null
  if (decoded.split('/').some(segment => segment === '..' || segment === '.')) return null
  if (decoded.includes('\0')) return null
  return decoded
}

export function isAllowedMediaPath(gcsPath: string): boolean {
  return ALLOWED_PREFIXES.some(prefix => gcsPath.startsWith(prefix))
}

router.get(/.*/, async (req: Request, res: Response) => {
  const gcsPath = normalizeMediaPath(req.path)
  if (!gcsPath) return res.status(400).json({ error: 'Invalid media path' })
  if (!isAllowedMediaPath(gcsPath)) {
    // Same response as a miss — do not confirm whether the object exists.
    return res.status(404).json({ error: 'Not found' })
  }

  // ?download=1 turns the redirect into a save-as (used for vector sources).
  const asDownload = req.query.download === '1' || req.query.download === 'true'
  const cacheKey = `${gcsPath}::${asDownload ? 'dl' : 'inline'}`

  try {
    const cached = cacheGet(cacheKey)
    if (cached === null) return res.status(404).json({ error: 'Not found' })
    if (cached) {
      res.setHeader('Cache-Control', `public, max-age=${REDIRECT_CACHE_S}`)
      return res.redirect(302, cached)
    }

    const file = getBucket().file(gcsPath)
    const [exists] = await file.exists()
    if (!exists) {
      cacheSet(cacheKey, null, MISS_TTL_MS)
      return res.status(404).json({ error: 'Not found' })
    }

    const filename = gcsPath.split('/').pop() || 'download'
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_TTL_MS,
      ...(asDownload
        ? { responseDisposition: `attachment; filename="${filename.replace(/"/g, '')}"` }
        : {})
    })

    // Expire the cache entry before the signature does.
    cacheSet(cacheKey, signedUrl, SIGNED_TTL_MS - 5 * 60 * 1000)
    res.setHeader('Cache-Control', `public, max-age=${REDIRECT_CACHE_S}`)
    return res.redirect(302, signedUrl)
  } catch (error: any) {
    console.error('[media] failed to sign', gcsPath, error?.message)
    return res.status(502).json({ error: 'Media temporarily unavailable' })
  }
})

export default router
