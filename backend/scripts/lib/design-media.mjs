// ---------------------------------------------------------------------------
// Shared helpers for the design-library importer and its backfill.
//
// Kept as plain .mjs so both scripts/import-designs.mjs and
// scripts/backfill-design-library-media.mjs import it directly (the scripts/
// folder is excluded from the TypeScript build).
//
// Three jobs live here:
//   1. stableMediaUrl()  — build the never-expiring /api/media/<path> address
//                          that replaces 365-day GCS signed URLs.
//   2. readImageStats()  — pixel dimensions + DPI + printability verdict.
//   3. uploadSources()   — push the .ai/.svg/.eps/.psd originals to GCS so
//                          metadata.source_files points at something reachable
//                          instead of a path on David's E: drive.
// ---------------------------------------------------------------------------
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

export const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main'

// Origin that serves routes/media.ts. Must match what the API is deployed on —
// this string is baked into every row we write.
export const API_ORIGIN = (
  process.env.MEDIA_PROXY_ORIGIN ||
  process.env.API_ORIGIN ||
  process.env.PUBLIC_URL ||
  'https://api.imaginethisprinted.com'
).replace(/\/+$/, '')

// OPTIONAL FAST PATH. As of 2026-07-26 this bucket answers plain
// https://storage.googleapis.com/<bucket>/<object> with HTTP 200 — it is on
// uniform bucket-level access with a public read binding (which is also why
// makePublic() throws "Cannot update access control ... when uniform
// bucket-level access is enabled"). Setting MEDIA_PUBLIC_BASE to
// "https://storage.googleapis.com/imagine-this-printed-main" stores those
// direct URLs instead, skipping the API hop and letting the CDN cache them.
//
// It is OFF by default deliberately: that public binding cannot be read or
// guaranteed by this service account (it lacks storage.buckets.getIamPolicy),
// and if the binding is ever tightened every stored URL 403s again — the exact
// failure this task existed to kill. The proxy works either way.
export const PUBLIC_BASE = (process.env.MEDIA_PUBLIC_BASE || '').replace(/\/+$/, '')

/** Permanent address for a GCS object. Never expires; signature is minted per request. */
export const stableMediaUrl = (gcsPath) => {
  const encoded = String(gcsPath).split('/').map(encodeURIComponent).join('/')
  return PUBLIC_BASE ? `${PUBLIC_BASE}/${encoded}` : `${API_ORIGIN}/api/media/${encoded}`
}

/**
 * Recover the GCS object name from whatever we previously stored:
 * a signed URL, a plain storage.googleapis.com URL, or an /api/media/ URL.
 */
export function gcsPathFromUrl(url) {
  if (!url || typeof url !== 'string') return null
  try {
    const u = new URL(url)
    const parts = u.pathname.replace(/^\/+/, '').split('/')
    if (u.pathname.startsWith('/api/media/')) {
      return parts.slice(2).map(decodeURIComponent).join('/')
    }
    if (u.hostname === 'storage.googleapis.com') {
      // /<bucket>/<object...>
      return parts.slice(1).map(decodeURIComponent).join('/') || null
    }
    if (u.hostname === `${BUCKET_NAME}.storage.googleapis.com`) {
      return parts.map(decodeURIComponent).join('/') || null
    }
    return null
  } catch {
    return null
  }
}

/** True when the URL is a GCS signed URL that will eventually 403. */
export function isExpiringUrl(url) {
  if (!url || typeof url !== 'string') return false
  return url.includes('storage.googleapis.com') &&
    (url.includes('Expires=') || url.includes('X-Goog-Expires='))
}

// Originals worth keeping beside the flattened PNG.
// Vectors scale losslessly for DTF/print, so they are the ones that matter.
// PSD is layered raster and ~7x the bytes of everything else combined
// (11 GB vs 4 GB across the library), so it is opt-in via --include-psd.
export const VECTOR_EXTS = ['ai', 'svg', 'eps', 'pdf', 'dxf']
export const DEFAULT_SOURCE_EXTS = [...VECTOR_EXTS, 'jpg']
export const PSD_EXTS = ['psd']

const CONTENT_TYPES = {
  ai: 'application/postscript',
  eps: 'application/postscript',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  dxf: 'image/vnd.dxf',
  psd: 'image/vnd.adobe.photoshop',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png'
}
export const contentTypeFor = (ext) => CONTENT_TYPES[String(ext).toLowerCase()] || 'application/octet-stream'

/**
 * Pixel dimensions, DPI and a printability verdict for an image buffer.
 *
 * Most of this library carries no pHYs/density chunk, so `dpi` is often null.
 * That is precisely why print_inches_at_300dpi exists: the honest measure of
 * whether art can fill a shirt is its pixel count, not a metadata tag that
 * any export step can drop.
 */
export async function readImageStats(buffer) {
  const meta = await sharp(buffer, { limitInputPixels: false }).metadata()
  const width = meta.width ?? null
  const height = meta.height ?? null
  const dpi = meta.density && meta.density > 0 ? Math.round(meta.density) : null

  const stats = {
    width_px: width,
    height_px: height,
    dpi,
    dpi_source: dpi ? 'embedded' : 'unset',
    format: meta.format ?? null,
    has_alpha: Boolean(meta.hasAlpha),
    bytes: buffer.length,
    measured_at: new Date().toISOString()
  }

  if (width && height) {
    stats.print_inches_at_300dpi = {
      w: Number((width / 300).toFixed(2)),
      h: Number((height / 300).toFixed(2))
    }
    const shortEdge = Math.min(width, height)
    const longEdge = Math.max(width, height)
    // 3600px on the long edge = a 12" print at 300 DPI, the standard DTF
    // front-of-shirt placement. Anything under 1200px short-edge cannot fill
    // even a 4" square cleanly.
    stats.print_quality =
      longEdge >= 3600 ? 'high' :
      longEdge >= 2400 ? 'good' :
      longEdge >= 1500 ? 'marginal' : 'low'
    stats.printable = shortEdge >= 1200
  } else {
    stats.print_quality = 'unknown'
    stats.printable = null
  }

  return stats
}

/** Which original-source files sit next to a design's PNG on disk. */
export function findSourceFiles(dirPath, designId, { includePsd = false } = {}) {
  const exts = includePsd ? [...DEFAULT_SOURCE_EXTS, ...PSD_EXTS] : DEFAULT_SOURCE_EXTS
  const found = []
  for (const ext of exts) {
    for (const candidate of [`${designId}.${ext}`, `${designId}.${ext.toUpperCase()}`]) {
      const p = path.join(dirPath, candidate)
      if (fs.existsSync(p)) {
        found.push({ ext, localPath: p, bytes: fs.statSync(p).size })
        break
      }
    }
  }
  return found
}

export const sourceGcsPath = (collectionSlug, designId, ext) =>
  `design-sources/${collectionSlug}/${designId}.${ext}`

/**
 * Upload the originals and return the metadata.source_files shape:
 *   { ai: { url, gcs_path, bytes, content_type, uploaded_at }, ... }
 *
 * Resumable by design: an object already in the bucket at the same byte size is
 * left alone, so a 4 GB sweep can be interrupted and restarted freely.
 */
export async function uploadSources(bucket, { dirPath, designId, collectionSlug, includePsd = false, maxBytes = 0, dryRun = false }) {
  const results = {}
  const skipped = []

  for (const src of findSourceFiles(dirPath, designId, { includePsd })) {
    if (maxBytes && src.bytes > maxBytes) {
      skipped.push({ ext: src.ext, bytes: src.bytes, reason: 'over_size_cap' })
      continue
    }
    const dest = sourceGcsPath(collectionSlug, designId, src.ext)
    const contentType = contentTypeFor(src.ext)

    if (dryRun) {
      results[src.ext] = {
        url: stableMediaUrl(dest),
        gcs_path: dest,
        bytes: src.bytes,
        content_type: contentType,
        uploaded_at: null
      }
      continue
    }

    const file = bucket.file(dest)
    let alreadyThere = false
    try {
      const [exists] = await file.exists()
      if (exists) {
        const [meta] = await file.getMetadata()
        alreadyThere = Number(meta.size) === src.bytes
      }
    } catch {
      alreadyThere = false
    }

    if (!alreadyThere) {
      // Streamed upload — .psd/.eps originals run to hundreds of MB and must
      // not be slurped into memory the way the PNGs are.
      await bucket.upload(src.localPath, {
        destination: dest,
        contentType,
        resumable: src.bytes > 8 * 1024 * 1024,
        metadata: { cacheControl: 'public, max-age=31536000, immutable' }
      })
    }

    results[src.ext] = {
      url: stableMediaUrl(dest),
      gcs_path: dest,
      bytes: src.bytes,
      content_type: contentType,
      uploaded_at: new Date().toISOString()
    }
  }

  return { sourceFiles: results, skipped }
}

/** True when metadata.source_files still holds bare local paths (the old shape). */
export function sourceFilesAreLocalPaths(sourceFiles) {
  if (!sourceFiles || typeof sourceFiles !== 'object') return false
  return Object.values(sourceFiles).some(v => typeof v === 'string')
}
