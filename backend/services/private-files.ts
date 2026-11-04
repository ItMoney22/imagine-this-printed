/**
 * Private files that are not 3D meshes or creator print files (Watchtower task
 * 4c100f9f, 2026-11-04): inbound email attachments, digital product files,
 * print-ready upscales and files customers hand us.
 *
 * imagine-this-printed-main answers any plain path to anyone, so a signature on
 * a link there protects nothing. These files now live in the private bucket
 * (public access prevention enforced), the same home as services/print-files.ts
 * and services/model-files.ts, and only a signed link reaches them.
 *
 * Two ways to hold one, depending on who reads the stored value:
 *   - a `gs://<bucket>/<path>` reference, signed per read. The default.
 *   - a long signed link, for values many readers use as a plain URL (a design
 *     on a canvas, a Step Flow source row). LONG_LINK_TTL_MINUTES matches the
 *     one-year link those readers already had, and such a value must only sit
 *     where the public cannot read it: a link in a public row is a leak.
 */

import { signObjectInBucket, uploadBufferToBucket } from './google-cloud-storage.js'

// Same bucket as print-files.ts. Read here rather than imported: that module
// loads the database client, and the pet store and upscaler must not need one.
export const PRIVATE_FILES_BUCKET = process.env.PRINT_FILES_BUCKET || 'imagine-this-printed-products'

/** A link someone opens at once: an attachment, a download button. */
export const PRIVATE_LINK_TTL_MINUTES = 60

/** A link that sits in a mailbox: forwarded mail outlives a page view. */
export const FORWARD_LINK_TTL_MINUTES = 7 * 24 * 60

/** The lifetime stored links have always had (see the header). */
export const LONG_LINK_TTL_MINUTES = 365 * 24 * 60

/** Object path of a `gs://` reference into the private bucket, or null. */
export function privateRefPath(value: unknown): string | null {
  const prefix = `gs://${PRIVATE_FILES_BUCKET}/`
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null
  const path = value.slice(prefix.length)
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null
  return path
}

/** True for a `gs://` reference into the private bucket. */
export function isPrivateRef(value: unknown): value is string {
  return privateRefPath(value) !== null
}

/** Save a file to the private bucket; returns its reference for the DB. */
export async function storePrivateFile(buffer: Buffer, path: string, contentType: string): Promise<string> {
  await uploadBufferToBucket(PRIVATE_FILES_BUCKET, buffer, path, contentType)
  return `gs://${PRIVATE_FILES_BUCKET}/${path}`
}

/**
 * Save a `data:` URL to the private bucket. Returns the reference and a link,
 * for the callers whose next step (an image model, the customer's canvas)
 * needs a URL.
 */
export async function storePrivateDataUrl(
  dataUrl: string,
  path: string,
  ttlMinutes: number = PRIVATE_LINK_TTL_MINUTES
): Promise<{ ref: string; url: string }> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid base64 data URL format')
  const ref = await storePrivateFile(Buffer.from(match[2], 'base64'), path, match[1])
  return { ref, url: await signObjectInBucket(PRIVATE_FILES_BUCKET, path, ttlMinutes) }
}

/**
 * A link for a stored value. A private reference is signed fresh; any other
 * string is an older stored link and comes back unchanged, so a reader works
 * across a move. Null when there is nothing to link, or signing fails.
 */
export async function linkForStoredFile(
  value: unknown,
  opts: { ttlMinutes?: number; downloadName?: string } = {}
): Promise<string | null> {
  if (typeof value !== 'string' || !value) return null
  if (!value.startsWith('gs://')) return value
  const path = privateRefPath(value)
  if (!path) return null
  try {
    return await signObjectInBucket(
      PRIVATE_FILES_BUCKET,
      path,
      opts.ttlMinutes ?? PRIVATE_LINK_TTL_MINUTES,
      opts.downloadName
    )
  } catch (e: any) {
    console.error(`[private-files] could not sign ${path}:`, e?.message)
    return null
  }
}

/**
 * A stored attachment list with every reference swapped for a fresh link. An
 * attachment that cannot be signed keeps its name and size and loses its link,
 * so the message still opens. Never returns a `gs://` value to a reader.
 */
export async function withAttachmentLinks<T extends { url?: string | null }>(
  attachments: T[] | null | undefined,
  ttlMinutes: number = PRIVATE_LINK_TTL_MINUTES
): Promise<T[]> {
  if (!Array.isArray(attachments)) return []
  return Promise.all(
    attachments.map(async (a) => {
      if (!a?.url) return a
      const url = await linkForStoredFile(a.url, { ttlMinutes })
      return { ...a, url: url ?? undefined }
    })
  )
}
