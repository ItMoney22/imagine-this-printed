// Storage adapter — wraps existing GCS helpers for the image-flow module.
// Replaces Watchtower's R2 with ITP's GCS bucket.

import { uploadImageFromUrl, uploadImageFromBuffer } from '../google-cloud-storage.js'
import type { Purpose } from './models.js'

export interface ImageFlowKeyParts {
  productId?: string
  purpose: Purpose
  ext: string
}

/** Build a stable GCS path. Mirrors Watchtower's R2 key shape but uses our path conventions. */
export function generateKey(parts: ImageFlowKeyParts): string {
  const { productId, purpose, ext } = parts
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 10)
  const slug = `${purpose}-${ts}-${rand}.${ext}`
  if (productId) {
    return `image-flow/${productId}/${slug}`
  }
  return `image-flow/loose/${slug}`
}

/** Upload an image (by source URL) to GCS and return the public/signed URL. */
export async function uploadFromUrl(opts: {
  key: string
  url: string
}): Promise<{ publicUrl: string; path: string }> {
  return uploadImageFromUrl(opts.url, opts.key)
}

/** Pull a fresh signed URL for an existing GCS path. */
export async function getReadUrl(_path: string, _ttlSeconds = 3600): Promise<string> {
  // The existing GCS helper returns a 1-year signed URL on upload; that's already
  // stored on product_assets.url. For now, callers should use that stored URL.
  // Hook left in for parity with Watchtower's getPresignedReadUrl.
  throw new Error('getReadUrl not implemented — use the URL returned at upload time')
}

/** Upload an image already in memory. Used by the background-removal path,
 *  which resolves to a buffer so colour-key and AI results upload identically. */
export async function uploadFromBuffer(opts: {
  key: string
  buffer: Buffer
  contentType?: string
}): Promise<{ publicUrl: string; path: string }> {
  return uploadImageFromBuffer(opts.buffer, opts.key, opts.contentType ?? 'image/png')
}
