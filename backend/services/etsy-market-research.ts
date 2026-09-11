// Etsy MARKET research — realtime marketplace data for Mrs. Imagine's briefs.
//
// This is the first code in the repo that reads what is actually selling ON
// Etsy. Everything previously labeled "etsy trends" (product-trends.ts) was
// Google-SERP scraping with an Etsy-flavored query string; the Etsy client in
// services/etsy.ts is 100% shop-scoped (our own listings). This module hits
// the PUBLIC search surface — `GET /application/listings/active` — which needs
// only the x-api-key header (same keystring:secret convention as etsy.ts,
// verified live 2026-07-25), no OAuth token, no shop scope.
//
// Deliberately NOT gated on ETSY_ENABLED: that flag guards WRITES to the shop.
// Research is read-only public data and should work in dev with just the keys.
//
// "Selling fast" proxy: Etsy's public API exposes no sales velocity, so heat =
// num_favorers per day since original creation, blended with recency. A listing
// with 40 favorites that is 10 days old outranks one with 400 favorites from
// 2019 — David wants what is moving NOW, not the all-time catalog.

const ETSY_API_BASE = 'https://openapi.etsy.com/v3'

function researchApiKey(): string {
  const key = process.env.ETSY_KEYSTRING
  if (!key) throw new Error('ETSY_KEYSTRING is not set — Etsy market research needs the app keystring')
  const secret = process.env.ETSY_SHARED_SECRET || ''
  return secret ? `${key}:${secret}` : key
}

export function isEtsyResearchConfigured(): boolean {
  return !!process.env.ETSY_KEYSTRING
}

export interface ActiveListing {
  listing_id: number
  shop_id: number
  title: string
  tags: string[]
  price: { amount: number; divisor: number; currency_code: string }
  num_favorers: number
  original_creation_timestamp: number
  taxonomy_id: number
  url: string
}

export interface ListingSignal {
  title: string
  tags: string[]
  priceUsd: number
  favorers: number
  ageDays: number
  /** favorers/day with a recency boost — the "selling fast" proxy. */
  heat: number
}

export interface MarketSignal {
  category: ResearchCategory
  queries: string[]
  sampled: number
  topTags: { tag: string; count: number }[]
  topPhrases: { phrase: string; count: number }[]
  priceUsd: { p25: number; median: number; p75: number }
  hottest: ListingSignal[]
  fetchedAt: string
}

export type ResearchCategory = 'shirts' | 'hoodies' | 'polos' | 'metal-art'

// Seed queries name the SHOPPER's search, not our catalog language. Kept broad
// on purpose — the aggregation (tags/phrases/heat) is what localizes the trend;
// over-specific seeds would just echo our own assumptions back at us.
const SEED_QUERIES: Record<ResearchCategory, string[]> = {
  shirts: [
    'funny graphic tee',
    'retro graphic t-shirt',
    'dad shirt gift',
    'mom life shirt',
    'trending t-shirt',
    'teacher shirt',
  ],
  hoodies: ['graphic hoodie', 'aesthetic hoodie', 'funny hoodie gift', 'trendy hoodie'],
  polos: ['funny polo shirt', 'dad polo shirt', 'golf polo gift', 'embroidered polo'],
  'metal-art': ['metal wall art', 'metal sign home decor', 'man cave metal sign', 'garden metal art'],
}

/** Per-call ceiling. Node's fetch has NO default timeout, so one stalled Etsy
 *  socket used to wedge a verifySalesBatch worker permanently — with
 *  concurrency 4, four such stalls hang the whole sweep with the job row stuck
 *  on 'running' and nothing in the log. A slow call is better dropped: the
 *  caller already treats a failed lookup as "unverified, don't pitch it". */
const ETSY_CALL_TIMEOUT_MS = 20_000

// Etsy enforces 10 requests/second on the public API and answers a burst with
// 429 "Exceeded per second rate limit". Concurrency alone never held that line:
// verifySalesBatch runs 4 workers and verifyListingSales fires its 2 calls in
// parallel, so 8 requests left at once with no pacing between iterations. On
// the first real sweep (2026-09-11) that 429'd 122 of 140 lookups and failed
// the whole run at the "more than half failed" guard.
//
// So every public call now goes through one process-wide pacer. Slots are
// claimed synchronously — JS runs this to completion before any other caller
// can interleave — which is what makes a shared counter safe here.
const ETSY_MIN_INTERVAL_MS = 130 // ~7.7 req/s, comfortably under the 10/s ceiling
const ETSY_MAX_ATTEMPTS = 4
let nextSlotMs = 0

async function takeRateLimitSlot(): Promise<void> {
  const now = Date.now()
  const slot = Math.max(now, nextSlotMs)
  nextSlotMs = slot + ETSY_MIN_INTERVAL_MS
  const wait = slot - now
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

async function etsyPublicFetch(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString()
  let lastBody = ''
  for (let attempt = 1; attempt <= ETSY_MAX_ATTEMPTS; attempt++) {
    await takeRateLimitSlot()
    const res = await fetch(`${ETSY_API_BASE}${path}?${qs}`, {
      headers: { 'x-api-key': researchApiKey() },
      signal: AbortSignal.timeout(ETSY_CALL_TIMEOUT_MS),
    })
    if (res.ok) return res.json()

    lastBody = await res.text().catch(() => '')
    // 429 is the limiter talking, not a bad request: back off and try again.
    // Anything else (404, 403, a dead key) will not improve with a retry.
    if (res.status !== 429 || attempt === ETSY_MAX_ATTEMPTS) {
      throw new Error(`Etsy public API ${res.status} on ${path}: ${lastBody.slice(0, 300)}`)
    }
    // Push every other in-flight caller back too — a 429 means the whole
    // process is over the line, not just this one request.
    const backoff = 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200)
    nextSlotMs = Math.max(nextSlotMs, Date.now() + backoff)
    await new Promise((r) => setTimeout(r, backoff))
  }
  throw new Error(`Etsy public API 429 on ${path} after ${ETSY_MAX_ATTEMPTS} attempts: ${lastBody.slice(0, 300)}`)
}

/** One page of public marketplace search, relevancy-sorted. */
export async function searchActiveListings(
  keywords: string,
  opts: { limit?: number; sortOn?: 'score' | 'created' } = {}
): Promise<ActiveListing[]> {
  const data = await etsyPublicFetch('/application/listings/active', {
    keywords,
    limit: String(Math.min(100, opts.limit ?? 50)),
    sort_on: opts.sortOn ?? 'score',
  })
  return Array.isArray(data?.results) ? data.results : []
}

// --- Pure aggregation (unit-tested, no network) ------------------------------

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'gift',
  'gifts', 'shirt', 'tshirt', 't-shirt', 'tee', 'hoodie', 'polo', 'sweatshirt',
  'metal', 'sign', 'art', 'wall', 'decor', 'her', 'him', 'his', 'hers', 'men',
  'women', 'mens', 'womens', 'unisex', 'custom', 'personalized', 'idea', 'ideas',
])

export function listingSignal(l: ActiveListing, nowMs: number): ListingSignal {
  const ageDays = Math.max(1, (nowMs / 1000 - (l.original_creation_timestamp || nowMs / 1000)) / 86_400)
  const favorers = l.num_favorers || 0
  // favorers/day, with a boost for young listings: momentum on a 2-week-old
  // listing means far more than the same rate sustained since 2020.
  const recencyBoost = ageDays <= 45 ? 2 : ageDays <= 180 ? 1.25 : 1
  const price = l.price && l.price.divisor ? l.price.amount / l.price.divisor : 0
  return {
    title: l.title ?? '',
    tags: Array.isArray(l.tags) ? l.tags : [],
    priceUsd: Math.round(price * 100) / 100,
    favorers,
    ageDays: Math.round(ageDays),
    heat: Math.round(((favorers / ageDays) * recencyBoost) * 1000) / 1000,
  }
}

export function aggregateSignals(category: ResearchCategory, queries: string[], listings: ActiveListing[], nowMs: number): MarketSignal {
  const signals = listings.map((l) => listingSignal(l, nowMs))

  const tagCounts = new Map<string, number>()
  for (const s of signals) {
    for (const raw of s.tags) {
      const tag = String(raw).toLowerCase().trim()
      if (!tag || STOPWORDS.has(tag)) continue
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }

  const phraseCounts = new Map<string, number>()
  for (const s of signals) {
    const words = s.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = `${words[i]} ${words[i + 1]}`
      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1)
    }
  }

  const prices = signals.map((s) => s.priceUsd).filter((p) => p > 0).sort((a, b) => a - b)
  const q = (frac: number) => (prices.length ? prices[Math.min(prices.length - 1, Math.floor(prices.length * frac))] : 0)

  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)

  return {
    category,
    queries,
    sampled: signals.length,
    topTags: top(tagCounts, 25).map(([tag, count]) => ({ tag, count })),
    topPhrases: top(phraseCounts, 20).map(([phrase, count]) => ({ phrase, count })),
    priceUsd: { p25: q(0.25), median: q(0.5), p75: q(0.75) },
    hottest: [...signals].sort((a, b) => b.heat - a.heat).slice(0, 12),
    fetchedAt: new Date(nowMs).toISOString(),
  }
}

// --- The research run --------------------------------------------------------

/**
 * Realtime market snapshot for one category: every seed query, one
 * relevancy-sorted page each, deduped by listing id, aggregated. ~4-6 public
 * API calls per category (Etsy caps at 10/sec, 10k/day — nowhere close).
 */
export async function researchCategory(category: ResearchCategory, extraQueries: string[] = []): Promise<MarketSignal> {
  const queries = [...SEED_QUERIES[category], ...extraQueries.filter(Boolean)]
  const byId = new Map<number, ActiveListing>()
  for (const kw of queries) {
    try {
      const page = await searchActiveListings(kw, { limit: 50, sortOn: 'score' })
      for (const l of page) byId.set(l.listing_id, l)
    } catch (e: any) {
      // One failed seed shouldn't kill the snapshot — log and keep sampling.
      console.warn(`[etsy-research] seed "${kw}" failed: ${e?.message}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  if (byId.size === 0) throw new Error(`Etsy research returned zero listings for ${category} — check ETSY_KEYSTRING/ETSY_SHARED_SECRET`)
  return aggregateSignals(category, queries, [...byId.values()], Date.now())
}

// --- SALES VERIFICATION ------------------------------------------------------
//
// David 2026-09-09: "they have to be ones that are SELLING". Everything above
// this line ranks on `num_favorers` — a wish list, not money — because that is
// the only demand-ish number Etsy puts on a listing. `ShopListing` carries no
// sales count at all (checked against the live OpenAPI spec, 2026-09-09).
//
// The one public proof of purchase Etsy does expose is the review: only a
// BUYER can leave one, and `GET /listings/{id}/reviews` takes `min_created`,
// so "how many verified purchases in the last 90 days" is a single call. Both
// endpoints below are api-key only (global security `api_key`) — no OAuth, no
// shop scope, nothing for David to reconnect.
//
// IMPORTANT about the number: roughly one buyer in three leaves a review, so a
// review count is a conservative FLOOR on sales, never the sales figure. Every
// label in the UI says "verified sales" for exactly that reason — we can prove
// the floor, we cannot prove the ceiling, and a scout that overstates is worse
// than no scout at all.

export interface SalesProof {
  listingId: number
  /** Reviews created inside the window — each one is a completed purchase. */
  verifiedSales: number
  /** Reviews over the listing's whole life. */
  verifiedSalesAllTime: number
  /** Most recent review, ISO. Null when the listing has never been reviewed. */
  lastSaleAt: string | null
  windowDays: number
}

/** Verified purchases for one listing. Two calls: the window, then all-time
 *  (Etsy has no "count only" mode, but `limit=1` keeps each response tiny). */
export async function verifyListingSales(
  listingId: number,
  windowDays = 90
): Promise<SalesProof> {
  const minCreated = Math.floor(Date.now() / 1000) - windowDays * 86_400
  const [recent, allTime] = await Promise.all([
    etsyPublicFetch(`/application/listings/${listingId}/reviews`, {
      limit: '1',
      min_created: String(minCreated),
    }),
    etsyPublicFetch(`/application/listings/${listingId}/reviews`, { limit: '1' }),
  ])
  const newest = Array.isArray(allTime?.results) ? allTime.results[0] : undefined
  const ts = newest?.created_timestamp ?? newest?.create_timestamp
  return {
    listingId,
    verifiedSales: Number(recent?.count ?? 0),
    verifiedSalesAllTime: Number(allTime?.count ?? 0),
    lastSaleAt: ts ? new Date(ts * 1000).toISOString() : null,
    windowDays,
  }
}

export interface ShopStats {
  shopId: number
  shopName: string
  /** Lifetime completed transactions for the whole shop. */
  soldCount: number
  reviewAverage: number
  activeListings: number
}

/** Shop-level sanity check, so one fluke listing on a dead shop can't rank. */
export async function fetchShopStats(shopId: number): Promise<ShopStats> {
  const shop = await etsyPublicFetch(`/application/shops/${shopId}`, {})
  return {
    shopId,
    shopName: shop?.shop_name ?? String(shopId),
    soldCount: Number(shop?.transaction_sold_count ?? 0),
    reviewAverage: Number(shop?.review_average ?? 0),
    activeListings: Number(shop?.listing_active_count ?? 0),
  }
}

export interface SalesBatchResult {
  proofs: Map<number, SalesProof>
  /** Listings whose lookup threw. Kept because "nothing sold" and "we could
   *  not ask" are completely different answers, and only one of them means
   *  the market is quiet — see the caller's guard in mrs-imagine-scout.ts. */
  failed: number
  /** First error seen, for the operator. */
  firstError: string | null
}

/** Verify a batch of listings politely. Etsy allows 10 req/sec and 10k/day;
 *  each listing costs 2 calls, so the concurrency cap here is what keeps a
 *  200-listing sweep inside a couple of seconds without tripping the limiter.
 *  A listing whose lookup throws is DROPPED, never passed through unverified —
 *  an unproven listing must not reach a list whose whole promise is proof. */
export async function verifySalesBatch(
  listingIds: number[],
  opts: {
    windowDays?: number
    concurrency?: number
    /** Called after every listing settles (success OR failure) so a caller can
     *  drive a progress bar. This phase is ~90% of a scout run's wall clock,
     *  and without it the only honest UI is a spinner. */
    onSettled?: (done: number, total: number) => void
  } = {}
): Promise<SalesBatchResult> {
  const windowDays = opts.windowDays ?? 90
  const concurrency = Math.max(1, Math.min(5, opts.concurrency ?? 4))
  const proofs = new Map<number, SalesProof>()
  let failed = 0
  let firstError: string | null = null
  let settled = 0
  const total = listingIds.length
  const queue = [...listingIds]
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const id = queue.shift()
      if (id === undefined) return
      try {
        proofs.set(id, await verifyListingSales(id, windowDays))
      } catch (e: any) {
        failed += 1
        if (!firstError) firstError = e?.message ?? 'unknown error'
        console.warn(`[etsy-research] sales lookup failed for ${id}: ${e?.message}`)
      }
      settled += 1
      opts.onSettled?.(settled, total)
    }
  })
  await Promise.all(workers)
  return { proofs, failed, firstError }
}
