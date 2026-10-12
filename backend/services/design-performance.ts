// ---------------------------------------------------------------------------
// Design performance (task 47174caa): click-through, add-to-cart and paid
// orders per AI prompt variant, plus the prune / refresh rule.
//
// Event names (design_events.event_type):
//   impression   a product tile was at least half on screen (once per tab
//                session per product per page type)
//   click        a product tile was clicked through to its product page
//   detail_view  a product page opened, from a tile or from anywhere else
//   add_to_cart  the product went into the cart (house designs only, not a
//                blank carrying the shopper's own art)
//   order        NOT an event row: paid web-store order lines, read live from
//                orders/order_items through the design_order_events view
//
// Rates over a trailing window (default 30 days):
//   CTR            clicks / impressions
//   add-to-cart    add_to_carts / detail_views
//   conversion     orders / detail_views
//
// The rule (FLAG_RULES) judges each variant against the whole shop's rate in
// the same window, using the UPPER edge of a 90% Wilson interval: a variant is
// only flagged when even the generous reading of its numbers is under half the
// shop's. Few views can never flag anything; a variant that sold in the window
// is never flagged.
//   prune    seen >= 150 times and credibly under half the shop's CTR
//            (nobody stops on it: take it down or re-prompt the idea)
//   refresh  opened >= 30 times and credibly under half the shop's add-to-cart
//            rate (it draws clicks but nobody buys: new art pass or mockups)
//   learning not enough views yet to judge
//   healthy  everything else
// The daily worker sweep writes the verdict onto design_prompt_variants.flag.
// Flags only mark; nothing is unpublished automatically.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase.js'
import { artworkIdFor, deriveDesignPrompt, isTrackableDesign, type DesignPromptInfo } from './design-prompt.js'

export const DESIGN_EVENT_TYPES = ['impression', 'click', 'detail_view', 'add_to_cart'] as const
export type DesignEventType = (typeof DESIGN_EVENT_TYPES)[number]

export const FLAG_RULES = {
  /** Tile views a variant needs before a prune verdict. */
  minImpressions: 150,
  /** Product-page views a variant needs before a refresh verdict. */
  minDetailViews: 30,
  /** Underperforming = credibly under this share of the shop's rate. */
  ratioOfStore: 0.5,
  /** 90% two-sided Wilson interval; the upper edge is the generous reading. */
  z: 1.645,
} as const

export type DesignFlag = 'learning' | 'healthy' | 'refresh' | 'prune'

export interface DesignCounts {
  impressions: number
  clicks: number
  detailViews: number
  addToCarts: number
  orders: number
  units: number
  revenue: number
}

export interface DesignRates {
  ctr: number | null
  addToCartRate: number | null
  conversion: number | null
}

export const emptyCounts = (): DesignCounts => ({
  impressions: 0, clicks: 0, detailViews: 0, addToCarts: 0, orders: 0, units: 0, revenue: 0,
})

export function addCounts(a: DesignCounts, b: DesignCounts): DesignCounts {
  return {
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    detailViews: a.detailViews + b.detailViews,
    addToCarts: a.addToCarts + b.addToCarts,
    orders: a.orders + b.orders,
    units: a.units + b.units,
    revenue: Math.round((a.revenue + b.revenue) * 100) / 100,
  }
}

const ratio = (num: number, den: number) => (den > 0 ? num / den : null)

export function ratesOf(c: DesignCounts): DesignRates {
  return {
    ctr: ratio(c.clicks, c.impressions),
    addToCartRate: ratio(c.addToCarts, c.detailViews),
    conversion: ratio(c.orders, c.detailViews),
  }
}

/** Upper edge of the Wilson score interval for `hits` out of `n`. */
export function wilsonUpper(hits: number, n: number, z: number = FLAG_RULES.z): number {
  if (n <= 0) return 1
  const p = Math.min(1, Math.max(0, hits / n))
  const z2 = z * z
  const center = p + z2 / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return Math.min(1, (center + margin) / (1 + z2 / n))
}

const pct = (r: number | null) => (r === null ? 'n/a' : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`)

export function flagFor(c: DesignCounts, store: DesignRates, rules = FLAG_RULES): { flag: DesignFlag; reason: string } {
  const r = ratesOf(c)
  if (c.orders > 0) {
    return { flag: 'healthy', reason: `Sold ${c.orders} order${c.orders === 1 ? '' : 's'} in this window.` }
  }
  if (c.impressions >= rules.minImpressions && store.ctr && store.ctr > 0) {
    if (wilsonUpper(c.clicks, c.impressions, rules.z) < rules.ratioOfStore * store.ctr) {
      return {
        flag: 'prune',
        reason: `Seen ${c.impressions} times, clicked ${c.clicks} (${pct(r.ctr)}). The shop averages ${pct(store.ctr)}; even read generously this is under half. Take it down or re-prompt the idea.`,
      }
    }
  }
  if (c.detailViews >= rules.minDetailViews && store.addToCartRate && store.addToCartRate > 0) {
    if (wilsonUpper(c.addToCarts, c.detailViews, rules.z) < rules.ratioOfStore * store.addToCartRate) {
      return {
        flag: 'refresh',
        reason: `Opened ${c.detailViews} times, added to cart ${c.addToCarts} (${pct(r.addToCartRate)}). The shop averages ${pct(store.addToCartRate)}; shoppers look but do not buy. Refresh the art or the mockups.`,
      }
    }
  }
  if (c.impressions < rules.minImpressions && c.detailViews < rules.minDetailViews) {
    return {
      flag: 'learning',
      reason: `Too early to judge: ${c.impressions} of ${rules.minImpressions} tile views, ${c.detailViews} of ${rules.minDetailViews} page views.`,
    }
  }
  return { flag: 'healthy', reason: 'Within range of the shop average.' }
}

// --- report ---------------------------------------------------------------

export interface CountRow {
  product_id: string
  prompt_variant_id: string | null
  impressions: number | string
  clicks: number | string
  detail_views: number | string
  add_to_carts: number | string
  orders: number | string
  units: number | string
  revenue: number | string
}

export interface VariantRecord {
  id: string
  variant_key: string
  concept_key: string
  concept_label: string
  prompt_text: string | null
  model_id: string | null
  source: string
  flag: DesignFlag
  flagged_at: string | null
}

export interface ProductRecord {
  id: string
  name: string
  slug: string | null
  status: string | null
  category: string | null
  image: string | null
}

export interface ReportProduct extends ProductRecord {
  artworkId: string | null
  counts: DesignCounts
}

export interface VariantReport {
  variantId: string
  variantKey: string
  conceptKey: string
  conceptLabel: string
  promptText: string | null
  modelId: string | null
  source: string
  products: ReportProduct[]
  counts: DesignCounts
  rates: DesignRates
  flag: DesignFlag
  flagReason: string
  storedFlag: DesignFlag
  flaggedAt: string | null
}

export interface DesignPerformanceReport {
  window: { since: string; until: string; days: number }
  store: { counts: DesignCounts; rates: DesignRates }
  rules: typeof FLAG_RULES
  variants: VariantReport[]
  /** Concepts with two or more variants: the side-by-side comparisons. */
  concepts: Array<{ conceptKey: string; conceptLabel: string; variantIds: string[] }>
}

export interface CurrentArtwork { productId: string; artworkId: string; variantId: string }

const num = (v: number | string | null | undefined) => Number(v) || 0

export function countsFromRow(row: CountRow): DesignCounts {
  return {
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    detailViews: num(row.detail_views),
    addToCarts: num(row.add_to_carts),
    orders: num(row.orders),
    units: num(row.units),
    revenue: num(row.revenue),
  }
}

const FLAG_ORDER: Record<DesignFlag, number> = { prune: 0, refresh: 1, learning: 2, healthy: 3 }

/**
 * Pure: count rows + the current product -> artwork -> variant map + the
 * variant and product records -> the dashboard report. Every live design
 * gets a row even with zero events; an event row whose variant is missing
 * (written before the product was mapped) goes to the product's current one.
 */
export function buildReport(input: {
  since: Date
  until: Date
  rows: CountRow[]
  current: CurrentArtwork[]
  variants: VariantRecord[]
  products: ProductRecord[]
}): DesignPerformanceReport {
  const currentByProduct = new Map(input.current.map(c => [c.productId, c]))
  const variantById = new Map(input.variants.map(v => [v.id, v]))
  const productById = new Map(input.products.map(p => [p.id, p]))

  // variantId -> productId -> counts
  const cells = new Map<string, Map<string, DesignCounts>>()
  const cell = (variantId: string, productId: string) => {
    let byProduct = cells.get(variantId)
    if (!byProduct) cells.set(variantId, (byProduct = new Map()))
    let c = byProduct.get(productId)
    if (!c) byProduct.set(productId, (c = emptyCounts()))
    return { byProduct, c }
  }

  for (const cur of input.current) cell(cur.variantId, cur.productId)

  let store = emptyCounts()
  for (const row of input.rows) {
    const variantId = row.prompt_variant_id || currentByProduct.get(row.product_id)?.variantId
    if (!variantId || !variantById.has(variantId)) continue
    const counts = countsFromRow(row)
    const { byProduct, c } = cell(variantId, row.product_id)
    byProduct.set(row.product_id, addCounts(c, counts))
    store = addCounts(store, counts)
  }
  const storeRates = ratesOf(store)

  const variants: VariantReport[] = []
  for (const [variantId, byProduct] of cells) {
    const v = variantById.get(variantId)
    if (!v) continue
    const products: ReportProduct[] = []
    let total = emptyCounts()
    for (const [productId, counts] of byProduct) {
      const p = productById.get(productId)
      const cur = currentByProduct.get(productId)
      products.push({
        id: productId,
        name: p?.name || 'Removed product',
        slug: p?.slug ?? null,
        status: p?.status ?? null,
        category: p?.category ?? null,
        image: p?.image ?? null,
        artworkId: cur && cur.variantId === variantId ? cur.artworkId : null,
        counts,
      })
      total = addCounts(total, counts)
    }
    products.sort((a, b) => b.counts.impressions - a.counts.impressions)
    const { flag, reason } = flagFor(total, storeRates)
    variants.push({
      variantId,
      variantKey: v.variant_key,
      conceptKey: v.concept_key,
      conceptLabel: v.concept_label,
      promptText: v.prompt_text,
      modelId: v.model_id,
      source: v.source,
      products,
      counts: total,
      rates: ratesOf(total),
      flag,
      flagReason: reason,
      storedFlag: v.flag,
      flaggedAt: v.flagged_at,
    })
  }

  // Underperformers first, then the lowest click-through.
  variants.sort((a, b) =>
    FLAG_ORDER[a.flag] - FLAG_ORDER[b.flag]
    || (a.rates.ctr ?? 1) - (b.rates.ctr ?? 1)
    || b.counts.impressions - a.counts.impressions,
  )

  const byConcept = new Map<string, { conceptKey: string; conceptLabel: string; variantIds: string[] }>()
  for (const v of variants) {
    const g = byConcept.get(v.conceptKey) || { conceptKey: v.conceptKey, conceptLabel: v.conceptLabel, variantIds: [] }
    g.variantIds.push(v.variantId)
    byConcept.set(v.conceptKey, g)
  }

  const days = Math.round((input.until.getTime() - input.since.getTime()) / 86_400_000)
  return {
    window: { since: input.since.toISOString(), until: input.until.toISOString(), days },
    store: { counts: store, rates: storeRates },
    rules: FLAG_RULES,
    variants,
    concepts: [...byConcept.values()].filter(g => g.variantIds.length > 1),
  }
}

// --- incoming events ------------------------------------------------------

export interface IncomingDesignEvent { type: DesignEventType; productId: string; surface: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SURFACE = /^[a-z][a-z0-9-]{0,23}$/
export const MAX_EVENTS_PER_BATCH = 50

/**
 * Validate an untrusted beacon body: { sid, events: [{ t, p, s }] }. Unknown
 * types, non-uuid products and junk surfaces are dropped, never stored; 'order'
 * is refused because orders are read from paid orders, not the browser.
 */
export function parseEventBatch(raw: unknown): { sessionId: string | null; events: IncomingDesignEvent[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { sessionId: null, events: [] }
  const body = raw as Record<string, unknown>
  const sid = typeof body.sid === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.sid) ? body.sid : null
  const list = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : []
  const events: IncomingDesignEvent[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const type = e.t as DesignEventType
    if (!DESIGN_EVENT_TYPES.includes(type)) continue
    if (typeof e.p !== 'string' || !UUID.test(e.p)) continue
    const surface = typeof e.s === 'string' && SURFACE.test(e.s) ? e.s : null
    events.push({ type, productId: e.p.toLowerCase(), surface })
  }
  return { sessionId: sid, events }
}

const BOT_UA = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|embedly|monitor/i

/** Crawlers that run JavaScript still are not shoppers. */
export function isBotUserAgent(ua: string | undefined | null): boolean {
  return !ua || BOT_UA.test(ua)
}

// --- I/O --------------------------------------------------------------------

interface ProductRow {
  id: string
  name: string
  slug: string | null
  status: string | null
  category: string | null
  images: string[] | null
  metadata: Record<string, any> | null
}

const PRODUCT_COLUMNS = 'id, name, slug, status, category, images, metadata'

/**
 * Map products to their artwork + prompt variant (upserting both tables).
 * With no ids it maps every live product. Blanks are skipped. Returns the
 * current mapping for the products it touched.
 */
export async function syncDesignArtworks(productIds?: string[]): Promise<CurrentArtwork[]> {
  let q = supabase.from('products').select(PRODUCT_COLUMNS)
  q = productIds ? q.in('id', productIds) : q.eq('status', 'active')
  const { data: products, error } = await q
  if (error) throw new Error(`design-performance: products read failed: ${error.message}`)
  const trackable = ((products || []) as ProductRow[]).filter(isTrackableDesign)
  if (trackable.length === 0) return []

  const { data: assets, error: assetErr } = await supabase
    .from('product_assets')
    .select('id, product_id, created_at')
    .in('product_id', trackable.map(p => p.id))
    .eq('kind', 'source')
    .eq('asset_role', 'design')
  if (assetErr) throw new Error(`design-performance: product_assets read failed: ${assetErr.message}`)

  const derived = trackable.map(p => ({ product: p, info: deriveDesignPrompt(p) }))
  const variantRows = new Map<string, DesignPromptInfo>()
  for (const d of derived) variantRows.set(d.info.variantKey, d.info)

  const now = new Date().toISOString()
  const { data: upserted, error: upErr } = await supabase
    .from('design_prompt_variants')
    .upsert(
      [...variantRows.values()].map(i => ({
        variant_key: i.variantKey,
        concept_key: i.conceptKey,
        concept_label: i.conceptLabel,
        prompt_text: i.promptText,
        model_id: i.modelId,
        source: i.source,
        updated_at: now,
      })),
      { onConflict: 'variant_key' },
    )
    .select('id, variant_key')
  if (upErr) throw new Error(`design-performance: variant upsert failed: ${upErr.message}`)
  const idByKey = new Map((upserted || []).map(r => [r.variant_key as string, r.id as string]))

  const current: CurrentArtwork[] = []
  for (const { product, info } of derived) {
    const variantId = idByKey.get(info.variantKey)
    if (!variantId) continue
    const mine = (assets || []).filter(a => a.product_id === product.id)
    current.push({ productId: product.id, artworkId: artworkIdFor(product, mine), variantId })
  }

  const { error: artErr } = await supabase.from('design_artworks').upsert(
    current.map(c => ({ product_id: c.productId, artwork_id: c.artworkId, prompt_variant_id: c.variantId, updated_at: now })),
    { onConflict: 'product_id' },
  )
  if (artErr) throw new Error(`design-performance: artwork upsert failed: ${artErr.message}`)
  return current
}

/**
 * Store a validated batch. Each row is stamped with the artwork and variant
 * the product carries right now; a live product with no mapping yet is mapped
 * on the spot. Events for unknown or non-live products are dropped.
 */
export async function recordDesignEvents(sessionId: string | null, events: IncomingDesignEvent[]): Promise<number> {
  if (events.length === 0) return 0
  const ids = [...new Set(events.map(e => e.productId))]

  const { data: mapped, error } = await supabase
    .from('design_artworks')
    .select('product_id, artwork_id, prompt_variant_id, products!inner(status)')
    .in('product_id', ids)
  if (error) throw new Error(`design-performance: artwork read failed: ${error.message}`)

  const byProduct = new Map<string, CurrentArtwork>()
  for (const row of (mapped || []) as any[]) {
    if (row.products?.status !== 'active') continue
    byProduct.set(row.product_id, { productId: row.product_id, artworkId: row.artwork_id, variantId: row.prompt_variant_id })
  }

  const missing = ids.filter(id => !byProduct.has(id))
  if (missing.length > 0) {
    const { data: live } = await supabase.from('products').select('id').in('id', missing).eq('status', 'active')
    const liveIds = (live || []).map(r => r.id as string)
    if (liveIds.length > 0) for (const c of await syncDesignArtworks(liveIds)) byProduct.set(c.productId, c)
  }

  const rows = events
    .filter(e => byProduct.has(e.productId))
    .map(e => {
      const cur = byProduct.get(e.productId)!
      return {
        event_type: e.type,
        product_id: e.productId,
        artwork_id: cur.artworkId,
        prompt_variant_id: cur.variantId,
        surface: e.surface,
        session_id: sessionId,
      }
    })
  if (rows.length === 0) return 0
  const { error: insErr } = await supabase.from('design_events').insert(rows)
  if (insErr) throw new Error(`design-performance: event insert failed: ${insErr.message}`)
  return rows.length
}

export const REPORT_WINDOWS = [7, 30, 90] as const

/** Live mapping refresh + counts + records -> the report for the last `days`. */
export async function loadDesignPerformance(days = 30, until = new Date()): Promise<DesignPerformanceReport> {
  const since = new Date(until.getTime() - days * 86_400_000)
  const current = await syncDesignArtworks()

  const { data: rows, error } = await supabase.rpc('design_performance_counts', {
    p_since: since.toISOString(),
    p_until: until.toISOString(),
  })
  if (error) throw new Error(`design-performance: counts failed: ${error.message}`)
  const countRows = (rows || []) as CountRow[]

  const variantIds = new Set(current.map(c => c.variantId))
  for (const r of countRows) if (r.prompt_variant_id) variantIds.add(r.prompt_variant_id)
  const productIds = new Set([...current.map(c => c.productId), ...countRows.map(r => r.product_id)])

  const [variantsRes, productsRes] = await Promise.all([
    supabase
      .from('design_prompt_variants')
      .select('id, variant_key, concept_key, concept_label, prompt_text, model_id, source, flag, flagged_at')
      .in('id', [...variantIds]),
    supabase.from('products').select(PRODUCT_COLUMNS).in('id', [...productIds]),
  ])
  if (variantsRes.error) throw new Error(`design-performance: variants read failed: ${variantsRes.error.message}`)
  if (productsRes.error) throw new Error(`design-performance: products read failed: ${productsRes.error.message}`)

  const products: ProductRecord[] = ((productsRes.data || []) as ProductRow[]).map(p => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    category: p.category,
    image: (Array.isArray(p.images) && p.images[0]) || null,
  }))

  return buildReport({
    since,
    until,
    rows: countRows,
    current,
    variants: (variantsRes.data || []) as VariantRecord[],
    products,
  })
}

/** Write each variant's verdict where it changed. Returns how many changed. */
export async function persistFlags(report: DesignPerformanceReport): Promise<number> {
  let changed = 0
  const now = new Date().toISOString()
  for (const v of report.variants) {
    if (v.flag === v.storedFlag) continue
    const { error } = await supabase
      .from('design_prompt_variants')
      .update({ flag: v.flag, flag_reason: v.flagReason, flagged_at: now, updated_at: now })
      .eq('id', v.variantId)
    if (error) throw new Error(`design-performance: flag write failed: ${error.message}`)
    changed++
  }
  return changed
}

/** Raw counts straight off the event table + paid order lines, for reconciling one product. */
export async function rawCountsForProduct(productId: string, days = 30, until = new Date()) {
  const since = new Date(until.getTime() - days * 86_400_000).toISOString()
  const untilIso = until.toISOString()
  const out: Record<string, number> = {}
  await Promise.all(DESIGN_EVENT_TYPES.map(async type => {
    const { count, error } = await supabase
      .from('design_events')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId)
      .eq('event_type', type)
      .gte('created_at', since)
      .lt('created_at', untilIso)
    if (error) throw new Error(`design-performance: raw ${type} count failed: ${error.message}`)
    out[type] = count || 0
  }))
  const { data: lines, error } = await supabase
    .from('design_order_events')
    .select('order_id')
    .eq('product_id', productId)
    .gte('created_at', since)
    .lt('created_at', untilIso)
  if (error) throw new Error(`design-performance: raw order count failed: ${error.message}`)
  out.order = new Set((lines || []).map(l => l.order_id)).size
  return { productId, since, until: untilIso, counts: out }
}
