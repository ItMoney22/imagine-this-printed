// Which objects leave the public bucket, and what a stored value becomes (task 4c100f9f).
// Pure, so a mistake that would move a live mockup fails a test instead of a product page.

export const PUBLIC_HOST = 'storage.googleapis.com'

/** The move group an object belongs to, or null when it stays public. */
export function groupOf(path) {
  if (path.startsWith('users/inbound/email-attachments/')) return 'email'
  if (path.startsWith('digital-products/')) return 'digital'
  if (path.startsWith('print-ready/')) return 'print-ready'
  if (path.startsWith('users/pet-ornaments/photos/')) return 'uploads'
  if (/^users\/[^/]+\/uploads\//.test(path)) return 'uploads'
  return null
}

/** Object path a stored value points at in the public bucket, or null. */
export function publicPathOf(value, publicBucket) {
  if (typeof value !== 'string') return null
  let u
  try { u = new URL(value) } catch { return null }
  if (u.hostname !== PUBLIC_HOST) return null
  const prefix = `/${publicBucket}/`
  if (!u.pathname.startsWith(prefix)) return null
  try { return decodeURIComponent(u.pathname.slice(prefix.length)) } catch { return null }
}

const isMoved = (value, publicBucket, moved) => {
  const path = publicPathOf(value, publicBucket)
  return path !== null && moved.has(path)
}

/** A gallery or outbox list without the moved files. Order of the rest is kept. */
export function withoutMoved(urls, publicBucket, moved) {
  return (urls || []).filter((u) => !isMoved(u, publicBucket, moved))
}

/** Stored attachments with each moved file's url replaced. `toValue(path)` gives the new value. */
export function rewriteAttachments(attachments, publicBucket, moved, toValue) {
  return (attachments || []).map((a) => {
    const path = publicPathOf(a?.url, publicBucket)
    return path !== null && moved.has(path) ? { ...a, url: toValue(path) } : a
  })
}

/**
 * products.metadata with moved print files rewritten. The print_upscale record is
 * a note, so it gets a gs:// reference (`toRef`). print_artwork is read as a plain
 * URL, so it gets a link (`toLink`). Anything else is left alone and is caught by
 * the scan that runs before any delete.
 */
export function rewriteProductMetadata(metadata, publicBucket, moved, toRef, toLink) {
  if (!metadata || typeof metadata !== 'object') return metadata
  const next = { ...metadata }
  const results = metadata.print_upscale?.results
  if (Array.isArray(results)) {
    next.print_upscale = {
      ...metadata.print_upscale,
      results: results.map((r) => {
        const path = publicPathOf(r?.to, publicBucket)
        return path !== null && moved.has(path) ? { ...r, to: toRef(path) } : r
      }),
    }
  }
  const artwork = metadata.print_artwork
  if (artwork && typeof artwork === 'object') {
    const swapped = { ...artwork }
    for (const key of ['front_image', 'back_image']) {
      const path = publicPathOf(artwork[key], publicBucket)
      if (path !== null && moved.has(path)) swapped[key] = toLink(path)
    }
    next.print_artwork = swapped
  }
  return next
}
