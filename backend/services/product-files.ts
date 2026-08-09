/**
 * Production file bundle per product, for the Order Management floor.
 *
 * The crew needs three things off an order line: what it should LOOK like
 * (mockups), the artwork itself (the source PNG), and the press file (DTF or
 * halftone). Those do NOT live on the order — order_items only carries what the
 * customer picked plus an optional per-placement print file. They live on the
 * product, in the `product_assets` table.
 *
 * Two traps this module exists to hide from callers:
 *
 * 1. Halftone is NOT `kind='halftone'`. The halftone API writes `kind='source'`
 *    with `asset_role='design_halftone'` (services/image-flow/api/halftone.ts),
 *    so a kind-only query silently returns the clean design as if it were the
 *    press file. Role is the discriminator, kind is not.
 * 2. A handful of products (3 in prod as of 2026-08-09) carry the older
 *    `products.metadata.assets` bundle instead of asset rows, and older ones
 *    still carry a single `metadata.mockup_url`. Both are folded in here so the
 *    UI has one contract.
 */

import { supabase } from '../lib/supabase.js'

export interface ProductFiles {
  /** Clean artwork — the actual PNG. */
  design: string | null
  /** Halftone press file. Null until someone runs the halftone engine. */
  halftone: string | null
  /** DTF-optimized print file. */
  dtf: string | null
  /** Contextual mockups (ghost mannequin, flat lay, Mr. Imagine). */
  mockups: { role: string; url: string }[]
  /** Parent for halftone generation — the API prefers an asset id over a URL. */
  designAssetId: string | null
}

export function emptyProductFiles(): ProductFiles {
  return { design: null, halftone: null, dtf: null, mockups: [], designAssetId: null }
}

interface AssetRow {
  id: string
  product_id: string
  kind: string | null
  url: string | null
  asset_role: string | null
  is_primary: boolean | null
  display_order: number | null
}

/** Primary first, then explicit display_order — matches the storefront gallery. */
function byPriority(a: AssetRow, b: AssetRow): number {
  if (!!b.is_primary !== !!a.is_primary) return b.is_primary ? 1 : -1
  return (a.display_order ?? 999) - (b.display_order ?? 999)
}

const isHalftoneRole = (role: string | null | undefined) => String(role ?? '').includes('halftone')

/**
 * Resolve files for many products in ONE round trip. Returns a map keyed by
 * product id; ids with nothing found are simply absent (callers should fall
 * back to emptyProductFiles()).
 */
export async function getProductFilesFor(productIds: string[]): Promise<Record<string, ProductFiles>> {
  const ids = [...new Set(productIds.filter((id): id is string => typeof id === 'string' && !!id))]
  const out: Record<string, ProductFiles> = {}
  if (ids.length === 0) return out

  const [assetsRes, productsRes] = await Promise.all([
    supabase
      .from('product_assets')
      .select('id, product_id, kind, url, asset_role, is_primary, display_order')
      .in('product_id', ids),
    supabase.from('products').select('id, metadata').in('id', ids),
  ])

  // A failure here must not take the whole order list down — the floor still
  // needs the rest of the order. Log and degrade to whatever did come back.
  if (assetsRes.error) console.error('[product-files] product_assets read failed:', assetsRes.error.message)
  if (productsRes.error) console.error('[product-files] products read failed:', productsRes.error.message)

  const grouped: Record<string, AssetRow[]> = {}
  for (const row of (assetsRes.data ?? []) as AssetRow[]) {
    if (!row.url) continue
    ;(grouped[row.product_id] ??= []).push(row)
  }

  for (const id of ids) {
    const rows = (grouped[id] ?? []).slice().sort(byPriority)
    const files = emptyProductFiles()

    // Halftone is a `source` row distinguished ONLY by its role, so it must be
    // matched before the clean-design lookup or it would be claimed as design.
    const halftoneRow = rows.find((r) => isHalftoneRole(r.asset_role))
    files.halftone = halftoneRow?.url ?? null

    const designRow = rows.find((r) => r.kind === 'source' && !isHalftoneRole(r.asset_role))
    files.design = designRow?.url ?? null
    files.designAssetId = designRow?.id ?? null

    files.dtf = rows.find((r) => r.kind === 'dtf')?.url ?? null
    files.mockups = rows
      .filter((r) => r.kind === 'mockup' && r.url)
      .map((r) => ({ role: r.asset_role || 'mockup', url: r.url as string }))

    out[id] = files
  }

  // Legacy bundle on products.metadata.assets — only fills gaps, never
  // overrides a real asset row.
  for (const p of (productsRes.data ?? []) as { id: string; metadata: any }[]) {
    const legacy = p.metadata?.assets
    const files = (out[p.id] ??= emptyProductFiles())
    if (legacy && typeof legacy === 'object') {
      files.design ||= typeof legacy.clean === 'string' ? legacy.clean : null
      files.halftone ||= typeof legacy.halftone === 'string' ? legacy.halftone : null
      files.dtf ||= typeof legacy.dtf === 'string' ? legacy.dtf : null
      if (files.mockups.length === 0 && Array.isArray(legacy.mockups)) {
        files.mockups = legacy.mockups
          .filter((u: unknown): u is string => typeof u === 'string' && !!u)
          .map((url: string) => ({ role: 'mockup', url }))
      }
    }
    if (files.mockups.length === 0 && typeof p.metadata?.mockup_url === 'string' && p.metadata.mockup_url) {
      files.mockups = [{ role: 'mockup', url: p.metadata.mockup_url }]
    }
  }

  return out
}

/**
 * Attach a `product_files` bundle to every line of every order, in one query
 * for the whole page. Mutates nothing — returns new objects.
 *
 * `product_id` is null on snapshot-reconstructed lines, which fall back to the
 * client product id the cart recorded.
 */
export async function attachProductFiles<T extends { order_items?: any[] }>(orders: T[]): Promise<T[]> {
  const idOf = (item: any): string | null =>
    (typeof item?.product_id === 'string' && item.product_id) ||
    (typeof item?.metadata?.client_product_id === 'string' && item.metadata.client_product_id) ||
    null

  const ids = orders.flatMap((o) => (o.order_items ?? []).map(idOf)).filter((x): x is string => !!x)

  // NB: do not early-return `orders` when there are no ids. Every line must
  // carry a bundle even when it resolves to nothing, or the UI reads
  // `.mockups` off undefined — which is precisely the shape of a catalogue
  // order whose product has no generated assets.
  const filesById = ids.length > 0 ? await getProductFilesFor(ids) : {}

  return orders.map((order) => ({
    ...order,
    order_items: (order.order_items ?? []).map((item: any) => {
      const id = idOf(item)
      return { ...item, product_files: (id && filesById[id]) || emptyProductFiles() }
    }),
  }))
}
