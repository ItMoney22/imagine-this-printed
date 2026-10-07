/**
 * Private 3D model files (Watchtower task 1417e863, 2026-10-07).
 *
 * model.stl / model.glb are PAID deliverables: a buyer pays 200 ITC (personal)
 * or 500 ITC (commercial) for the download, and the print floor prints from
 * them. They used to sit in the PUBLIC bucket next to the toy's concept.png,
 * so anyone who knew a toy's id (the toy page shows it in every image address)
 * could take the mesh for free, and every row carried a 1-year signed URL.
 *
 * Now:
 *   - the files live in the PRIVATE bucket (the same one as creator print
 *     files, services/print-files.ts; public access prevention enforced);
 *   - rows store a reference, `gs://<bucket>/<path>`, never a URL
 *     (user_3d_models.glb_url / stl_url, products.metadata.print3d.*_url);
 *   - a link is signed only when someone entitled needs the file: the license
 *     route, the owner's 3D preview, the print bridge. Short-lived, never stored.
 */

import { PRINT_FILES_BUCKET } from './print-files.js'
import { uploadBufferToBucket, signObjectInBucket } from './google-cloud-storage.js'

export type ModelFormat = 'stl' | 'glb'

export const MODEL_FILES_BUCKET = PRINT_FILES_BUCKET

/** The public bucket the files used to live in. Legacy refs there still resolve. */
const LEGACY_PUBLIC_BUCKET = process.env.GCS_BUCKET_NAME || 'imagine-this-printed-main'

/**
 * How long a download / preview link lives. The download button opens it at
 * once and the preview loads it at once, so an hour is plenty. The print
 * bridge uses the press-floor TTL from print-files.ts instead.
 */
export const MODEL_LINK_TTL_MINUTES = 60

export const MODEL_CONTENT_TYPES: Record<ModelFormat, string> = {
  stl: 'model/stl',
  glb: 'model/gltf-binary',
}

export interface ModelFileObject {
  bucket: string
  path: string
}

/** Object path for a generated toy's mesh. */
export function modelFilePath(modelId: string, format: ModelFormat): string {
  return `3d-models/${modelId}/model.${format}`
}

/** The string stored in the DB for a file: a reference, never a URL. */
export function toModelFileRef(bucket: string, path: string): string {
  return `gs://${bucket}/${path}`
}

/**
 * Bucket + object path from a stored value. Accepts the `gs://` reference this
 * module writes, and the legacy https storage URL (plain or signed) older rows
 * carried. Only the private bucket and the legacy public bucket resolve, so a
 * stray value can never make us sign an object anywhere else.
 */
export function parseModelFileRef(value: unknown): ModelFileObject | null {
  if (typeof value !== 'string' || !value) return null
  let bucket: string
  let path: string
  if (value.startsWith('gs://')) {
    const rest = value.slice('gs://'.length)
    const slash = rest.indexOf('/')
    if (slash <= 0) return null
    bucket = rest.slice(0, slash)
    path = rest.slice(slash + 1)
  } else {
    let u: URL
    try { u = new URL(value) } catch { return null }
    if (u.protocol !== 'https:' || u.hostname !== 'storage.googleapis.com') return null
    const m = u.pathname.match(/^\/([^/]+)\/(.+)$/)
    if (!m) return null
    bucket = m[1]
    try { path = decodeURIComponent(m[2]) } catch { return null }
  }
  if (!path || path.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) return null
  if (bucket !== MODEL_FILES_BUCKET && bucket !== LEGACY_PUBLIC_BUCKET) return null
  return { bucket, path }
}

/** Save a mesh to the private bucket; returns its reference for the DB. */
export async function storeModelFile(buffer: Buffer, path: string, format: ModelFormat): Promise<string> {
  await uploadBufferToBucket(MODEL_FILES_BUCKET, buffer, path, MODEL_CONTENT_TYPES[format])
  return toModelFileRef(MODEL_FILES_BUCKET, path)
}

/** Download a mesh (e.g. from the 3D provider's CDN) and save it privately. */
export async function storeModelFileFromUrl(url: string, path: string, format: ModelFormat): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${format.toUpperCase()}: ${res.status} ${res.statusText}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  return storeModelFile(buffer, path, format)
}

/**
 * A fresh, short-lived link for a stored reference, or null when there is
 * nothing to sign (no value, unknown bucket, or not the expected object).
 *
 * `expectedPath` pins the object: for a user_3d_models row it must be that
 * model's own `3d-models/<id>/model.<format>`, whatever the row says.
 */
export async function signModelFileRef(
  ref: unknown,
  opts: { ttlMinutes?: number; expectedPath?: string; downloadName?: string } = {}
): Promise<string | null> {
  const obj = parseModelFileRef(ref)
  if (!obj) return null
  if (opts.expectedPath && obj.path !== opts.expectedPath) {
    console.error(`[model-files] refusing to sign ${obj.bucket}/${obj.path}: expected ${opts.expectedPath}`)
    return null
  }
  try {
    return await signObjectInBucket(obj.bucket, obj.path, opts.ttlMinutes ?? MODEL_LINK_TTL_MINUTES, opts.downloadName)
  } catch (e: any) {
    console.error(`[model-files] could not sign ${obj.bucket}/${obj.path}:`, e?.message)
    return null
  }
}

/**
 * A link the print floor can fetch for a stored mesh value (products
 * metadata.print3d): our own files are signed fresh; a mesh the creator's
 * storefront hosts itself (an https link it sent in placement.print3d) passes
 * through unchanged.
 */
export async function meshLinkFor(value: unknown, ttlMinutes: number): Promise<string | undefined> {
  if (parseModelFileRef(value)) return (await signModelFileRef(value, { ttlMinutes })) ?? undefined
  if (typeof value === 'string') {
    try {
      const u = new URL(value)
      if (u.protocol === 'https:' && u.hostname !== 'storage.googleapis.com') return value
    } catch { /* not a link */ }
  }
  return undefined
}

/** Short-lived link to a user_3d_models row's own mesh, or null. */
export function signOwnModelFile(
  model: { id: string; glb_url?: unknown; stl_url?: unknown },
  format: ModelFormat,
  opts: { ttlMinutes?: number; downloadName?: string } = {}
): Promise<string | null> {
  const ref = format === 'glb' ? model.glb_url : model.stl_url
  return signModelFileRef(ref, { ...opts, expectedPath: modelFilePath(model.id, format) })
}

/**
 * A user_3d_models row as the owner's screens may see it: the GLB as a
 * short-lived link for the 3D preview, and NO STL reference. The STL (and the
 * GLB as a file to keep) comes only from the license route.
 */
export async function withPreviewLinks<T extends { id: string; glb_url?: unknown; stl_url?: unknown }>(
  model: T
): Promise<T & { glb_url: string | null; stl_url: null }> {
  return { ...model, glb_url: await signOwnModelFile(model, 'glb'), stl_url: null }
}
