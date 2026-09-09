// "Render THIS buyer's Team / Name / Number onto THIS product's real print file."
//
// personalization-render.ts owns the pixels. This module owns the plumbing
// around them: which product, which artwork, where the result lands, and what
// to say when any of that is missing.
//
// Every dependency is injected (mirrors ai-jobs-worker.ts's claimQueuedJob(db,
// ...) pattern) so the whole thing is testable without Supabase, GCS or the
// network — see personalization-print.test.ts.
//
// The base artwork is resolved through the EXISTING getProductFilesFor rather
// than a second competing resolver: `dtf` is the press-ready file when a
// product has one, otherwise the clean `design` source.
import { supabase } from '../lib/supabase.js'
import { getProductFilesFor } from './product-files.js'
import { uploadFromBuffer } from './image-flow/storage.js'
import { renderPersonalizedPrint, resolvePrintZones } from './personalization-render.js'
import {
  resolvePersonalization,
  sanitizePersonalizationInput,
  type PersonalizationValues
} from '../shared/personalization.js'

export interface PersonalizedPrintDeps {
  loadProduct: (productId: string) => Promise<{ id: string; metadata: unknown } | null>
  /** The artwork the buyer's words get burned into. */
  loadBasePrintUrl: (productId: string) => Promise<string | null>
  fetchImage: (url: string) => Promise<Buffer>
  upload: (key: string, buffer: Buffer) => Promise<{ publicUrl: string; path: string }>
}

export type PersonalizedPrintResult =
  | { ok: true; url: string; path: string }
  | {
    ok: false
    reason:
    | 'product-not-found'
    /** The product never opted in via metadata.personalization. */
    | 'not-personalizable'
    /** Opted in, but nobody drew the boxes the text goes in — the setup step that gets forgotten. */
    | 'no-zones'
    /** Nothing the buyer typed survived sanitizing. */
    | 'nothing-to-print'
    /** No dtf and no design asset — there is no artwork to print onto. */
    | 'no-print-file'
  }

export const defaultPersonalizedPrintDeps: PersonalizedPrintDeps = {
  loadProduct: async (productId) => {
    const { data } = await supabase
      .from('products')
      .select('id, metadata')
      .eq('id', productId)
      .maybeSingle()
    return (data as { id: string; metadata: unknown } | null) ?? null
  },
  loadBasePrintUrl: async (productId) => {
    const files = await getProductFilesFor([productId])
    return files[productId]?.dtf ?? files[productId]?.design ?? null
  },
  fetchImage: async (url) => {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch print file (${res.status}) from ${url}`)
    return Buffer.from(await res.arrayBuffer())
  },
  upload: async (key, buffer) => {
    const { publicUrl, path } = await uploadFromBuffer({ key, buffer, contentType: 'image/png' })
    return { publicUrl, path }
  }
}

/**
 * Renders and uploads the personalized print file.
 *
 * A misconfigured ZONE throws (PersonalizationRenderError from the renderer):
 * that is a product-setup bug and must be loud, not a silently skipped sale.
 * Everything else that is merely absent comes back as a `reason` the admin UI
 * can explain.
 */
export async function renderPersonalizedPrintForProduct(
  opts: { productId: string; values: PersonalizationValues },
  deps: PersonalizedPrintDeps = defaultPersonalizedPrintDeps
): Promise<PersonalizedPrintResult> {
  const product = await deps.loadProduct(opts.productId)
  if (!product) return { ok: false, reason: 'product-not-found' }

  if (!resolvePersonalization(product)) return { ok: false, reason: 'not-personalizable' }

  const zones = resolvePrintZones(product)
  if (!zones.length) return { ok: false, reason: 'no-zones' }

  // Sanitized here too, not only at checkout: this same function backs the
  // admin preview route, whose payload is just as untrusted as a cart's.
  const values = sanitizePersonalizationInput(opts.values)
  if (!values) return { ok: false, reason: 'nothing-to-print' }
  if (!zones.some(zone => values[zone.field])) return { ok: false, reason: 'nothing-to-print' }

  const baseUrl = await deps.loadBasePrintUrl(opts.productId)
  if (!baseUrl) return { ok: false, reason: 'no-print-file' }

  const base = await deps.fetchImage(baseUrl)
  const rendered = await renderPersonalizedPrint(base, zones, values)

  // Timestamped rather than content-addressed: a re-render after an artwork or
  // zone change must not be served from a CDN copy of the previous one.
  const key = `personalized/${opts.productId}/${Date.now()}.png`
  const { publicUrl, path } = await deps.upload(key, rendered)
  return { ok: true, url: publicUrl, path }
}
