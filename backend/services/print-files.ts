/**
 * Private print-ready files for creator products (Watchtower task b312de9c, 2026-10-07).
 *
 * A creator's print file IS their art at full press resolution. It used to sit
 * on the public products row (metadata.print_files / assets.clean / assets.dtf)
 * as a 1-year signed URL in the PUBLIC bucket, so anyone with the site's anon
 * key — or anyone listing that bucket — could take Darrell McCutchen's
 * "Walk By Faith" front.png.
 *
 * Now:
 *   - the file is saved to the PRIVATE bucket (public access prevention
 *     enforced), under print-files/;
 *   - its bucket + object path are recorded in product_print_files, a table
 *     only the service role can read (RLS on, no policies, grants revoked);
 *   - the public row keeps only metadata.print_file_placements (['front'] /
 *     ['front','back']) so the approval gate and admin queue know a file exists;
 *   - a link is signed only when the press floor reads an order (short-lived),
 *     never stored.
 */

import { supabase } from '../lib/supabase.js'
import { uploadBufferToBucket, signObjectInBucket } from './google-cloud-storage.js'

export const PRINT_FILES_BUCKET = process.env.PRINT_FILES_BUCKET || 'imagine-this-printed-products'

/** How long a press-floor link lives: long enough for a page left open through a shift. */
export const PRINT_FILE_LINK_TTL_MINUTES = 12 * 60

export type PrintPlacement = 'front' | 'back'

/** Where a product's print files are. Paths, never URLs. */
export interface PrintFileRefs {
  bucket: string
  front: string
  back?: string | null
}

/** Object path for a creator print file inside the private bucket. */
export function printFilePath(vendor: string, batchId: string, placement: PrintPlacement): string {
  return `print-files/merch-studio/${vendor}/${batchId}/${placement}.png`
}

/**
 * Object path for a creator's 3D-print mesh (Merch Studio model_file) in the
 * private bucket. Stored on the product as a gs:// reference by
 * services/model-files.ts and signed only for the print bridge (task 1417e863).
 */
export function printModelFilePath(vendor: string, batchId: string, format: 'stl' | 'glb'): string {
  return `print-files/merch-studio/${vendor}/${batchId}/model.${format}`
}

/** The placements a set of refs covers, for the public metadata marker. */
export function placementsOf(refs: Pick<PrintFileRefs, 'front' | 'back'>): PrintPlacement[] {
  return refs.back ? ['front', 'back'] : ['front']
}

/** True for a value that looks like the shape stored on an order line. */
export function isPrintFileRefs(value: unknown): value is PrintFileRefs {
  const v = value as PrintFileRefs | null
  return !!v && typeof v === 'object' && typeof v.bucket === 'string' && !!v.bucket &&
    typeof v.front === 'string' && !!v.front
}

/** Save a print file to the private bucket; returns its object path. */
export async function storePrintFile(buffer: Buffer, path: string): Promise<string> {
  return uploadBufferToBucket(PRINT_FILES_BUCKET, buffer, path, 'image/png')
}

/** Record (or replace) where a product's print files are. Throws on failure. */
export async function savePrintFileRefs(productId: string, refs: PrintFileRefs, source = 'merch-studio'): Promise<void> {
  const { error } = await supabase
    .from('product_print_files')
    .upsert({
      product_id: productId,
      bucket: refs.bucket,
      front_path: refs.front,
      back_path: refs.back ?? null,
      source,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id' })
  if (error) throw new Error(`product_print_files write failed: ${error.message}`)
}

/**
 * Private print-file refs for many products in one round trip. Products with
 * no row are simply absent. A read failure degrades to "none found" (logged):
 * callers are order screens and checkout, which must not fall over on it.
 */
export async function getPrintFileRefsFor(productIds: string[]): Promise<Record<string, PrintFileRefs>> {
  const ids = [...new Set(productIds.filter((id): id is string => typeof id === 'string' && !!id))]
  const out: Record<string, PrintFileRefs> = {}
  if (ids.length === 0) return out

  const { data, error } = await supabase
    .from('product_print_files')
    .select('product_id, bucket, front_path, back_path')
    .in('product_id', ids)
  if (error) {
    console.error('[print-files] product_print_files read failed:', error.message)
    return out
  }
  for (const row of (data ?? []) as { product_id: string; bucket: string; front_path: string; back_path: string | null }[]) {
    if (!row?.product_id || !row.bucket || !row.front_path) continue
    out[row.product_id] = { bucket: row.bucket, front: row.front_path, back: row.back_path ?? null }
  }
  return out
}

/**
 * Fresh, short-lived links for a set of refs ({ front, back? }). A placement
 * that fails to sign is left out rather than failing the caller.
 */
export async function signPrintFileRefs(
  refs: PrintFileRefs,
  ttlMinutes: number = PRINT_FILE_LINK_TTL_MINUTES
): Promise<{ front?: string; back?: string }> {
  const out: { front?: string; back?: string } = {}
  const placements: [PrintPlacement, string | null | undefined][] = [['front', refs.front], ['back', refs.back]]
  for (const [placement, path] of placements) {
    if (!path) continue
    try {
      out[placement] = await signObjectInBucket(refs.bucket, path, ttlMinutes)
    } catch (e: any) {
      console.error(`[print-files] could not sign ${placement} (${refs.bucket}/${path}):`, e?.message)
    }
  }
  return out
}
