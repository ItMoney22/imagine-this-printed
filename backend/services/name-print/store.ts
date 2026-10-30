// 3D name gifts — the print file's home (task bf353160).
//
// geometry.ts is pure; this is the I/O half. The STL for a name lives at a
// DETERMINISTIC path (template + name + geometry version), so the same name
// on the same product is built and uploaded once, and checkout can write the
// path onto the order line before the upload has even finished.
//
// Orders store the durable gcsPath, never a signed URL (they expire, an order
// outlives them); whoever needs the file signs it on read (plate-store.ts
// rules, same bucket).
import { createHash } from 'node:crypto'
import { fileExists, generateSignedUrl } from '../gcs-storage.js'
import { uploadImageFromBuffer } from '../google-cloud-storage.js'
import type { NamePrintTemplate } from '../../shared/name-print.js'
import { GEOMETRY_VERSION, buildNameModel, toBinaryStl } from './geometry.js'

const OWNER = 'name-prints'

export function namePrintKey(template: NamePrintTemplate, name: string): string {
  return createHash('sha256')
    .update(JSON.stringify([template.version, template.shape, template.font, name]))
    .digest('hex')
    .slice(0, 24)
}

/** Where the STL for this name lives (or will). Knowable before it exists. */
export function namePrintPath(template: NamePrintTemplate, name: string): string {
  return `users/${OWNER}/geo-v${GEOMETRY_VERSION}/${template.shape}-${namePrintKey(template, name)}.stl`
}

export interface StoredNamePrint {
  path: string
  /** True when this call built and uploaded it. */
  built: boolean
  colourChangeAtMm: number
}

/** Builds and uploads the STL unless it is already there. ~10-50 ms of geometry plus one upload. */
export async function storeNamePrint(template: NamePrintTemplate, name: string): Promise<StoredNamePrint> {
  const path = namePrintPath(template, name)
  const model = buildNameModel(template.shape, template.font, name)
  if (await fileExists(path)) return { path, built: false, colourChangeAtMm: model.colourChangeAtMm }
  const stl = toBinaryStl(model)
  await uploadImageFromBuffer(stl, path, 'model/stl')
  return { path, built: true, colourChangeAtMm: model.colourChangeAtMm }
}

/** A download link for the print floor (V4 signing caps at 7 days). Re-signed on every read. */
export function signNamePrint(path: string, hours = 24 * 7 - 1): Promise<string> {
  return generateSignedUrl(path, hours)
}
