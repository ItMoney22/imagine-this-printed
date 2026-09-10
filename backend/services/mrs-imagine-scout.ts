// Mrs. Imagine — SCOUT (David 2026-09-09: "mrs imagine is a scout she finds
// great designs that are selling she needs to verify they are selling she
// drops a list of her top 10 everyday and i just have to click on it it goes
// to step flow ... they have to be ones that are SELLING").
//
// This replaces her autonomous batch (services/mrs-imagine.ts) as the thing
// the daily clock runs. The batch designed, mocked up, QA'd and queued 15
// products unattended; David turned it off on 2026-09-02 and the last run
// still managed to drain the OpenAI wallet to a 429 before it aborted. The
// scout spends NOTHING on images. It reads the marketplace, proves what sold,
// and hands David ten one-click ideas. Every pixel after that click is a
// decision he made in the Step Flow.
//
// WHAT "SELLING" MEANS HERE, precisely — this is the whole point of the
// feature, so it is worth being exact about what the number is:
//
//   Etsy publishes no sales count on a listing (`ShopListing` has
//   `num_favorers` and nothing else — checked against the live OpenAPI spec
//   2026-09-09). The one public proof of a completed purchase is a REVIEW:
//   Etsy only accepts a review from the buyer of that listing. So
//   `GET /listings/{id}/reviews?min_created=<90d ago>` answers "how many
//   people demonstrably bought this in the last 90 days".
//
//   About one buyer in three leaves a review, so the count is a conservative
//   FLOOR on sales, never the sales figure. Everything downstream — field
//   names, UI copy, this comment — says "verified sales" for that reason. A
//   scout that inflates its evidence is worse than no scout: David would stop
//   trusting the list, and the list is the only thing it produces.
//
// Ranking is deliberately split: `rankProven` is pure and unit-tested, so what
// makes the cut is arithmetic on real review counts, not a model's opinion.
// The writing brain only NAMES the themes afterwards, and it never sees a
// score it could invent. If it fails entirely, `fallbackPicks` still produces
// a usable list off the listings' own tags.

import OpenAI from 'openai'
import { supabase } from '../lib/supabase.js'
import { runCopyrightGate } from './etsy-copyright-gate.js'
import {
  searchActiveListings,
  verifySalesBatch,
  fetchShopStats,
  isEtsyResearchConfigured,
  type ActiveListing,
  type SalesProof,
  type ShopStats,
} from './etsy-market-research.js'

/** How far back a sale still counts as "selling now". */
export const SALES_WINDOW_DAYS = 90
/** How many listings get a (2-call) sales lookup per run. Etsy allows 10k
 *  calls/day and 10/sec; 140 listings is ~280 calls, a rounding error against
 *  that, and it keeps a run under ~30s. */
const VERIFY_BUDGET = 140
/** What David sees. */
export const PICK_COUNT = 10

export type ScoutKind = 'tshirt' | 'hoodie' | 'youth-tshirt' | 'metal'

/** The Etsy searches the scout sweeps. Kept in the scout rather than reusing
 *  etsy-market-research's SEED_QUERIES because those are tuned for aggregate
 *  trend signal (broad, category-shaped); the scout wants listings a buyer
 *  actually checked out of, so the seeds lean toward gift-intent language. */
const SEEDS: Array<{ kind: ScoutKind; queries: string[] }> = [
  {
    kind: 'tshirt',
    queries: [
      'funny graphic tee',
      'retro graphic t-shirt',
      'sarcastic shirt gift',
      'mom life shirt',
      'dad joke shirt',
      'teacher shirt funny',
      'nurse shirt funny',
    ],
  },
  { kind: 'hoodie', queries: ['graphic hoodie', 'funny hoodie gift', 'aesthetic hoodie'] },
  { kind: 'youth-tshirt', queries: ['funny kids shirt', 'toddler graphic tee'] },
  { kind: 'metal', queries: ['metal wall art', 'metal sign home decor', 'man cave metal sign'] },
]

/** One listing that PROVED it sells, with the evidence attached. */
export interface ProvenListing {
  listingId: number
  shopId: number
  kind: ScoutKind
  title: string
  tags: string[]
  url: string
  priceUsd: number
  favorers: number
  ageDays: number
  /** Reviews inside SALES_WINDOW_DAYS — verified purchases, a floor. */
  verifiedSales: number
  verifiedSalesAllTime: number
  lastSaleAt: string | null
  /** verifiedSales normalised to a month, so a 3-week-old listing that sold 8
   *  outranks a 2019 listing that sold 9 in the same window. */
  salesPerMonth: number
  score: number
  shop?: ShopStats
}

/** One row on David's board. `idea` is what gets typed into Step 1 for him. */
export interface ScoutPick {
  id: string
  /** Buyer-facing theme name — "Overstimulated mom, running on iced coffee". */
  theme: string
  /** The Step Flow seed: an ORIGINAL design idea in the theme's lane. */
  idea: string
  kind: ScoutKind
  /** Why this theme is moving, in one sentence, for David to read at a glance. */
  angle: string
  /** Total verified sales across the evidence listings, last 90 days. */
  verifiedSales: number
  /** Median asking price of the evidence — what the market pays for this. */
  medianPriceUsd: number
  /** The receipts. Never empty: a pick with no evidence is not a pick. */
  evidence: Array<{
    title: string
    url: string
    verifiedSales: number
    priceUsd: number
    shopName?: string
    shopSoldCount?: number
  }>
  /** Copyright gate on the theme + idea, run before David ever sees it. */
  gate: { pass: boolean; reasons: string[] }
}

export interface ScoutResult {
  picks: ScoutPick[]
  /** Listings pulled from search. */
  sampled: number
  /** Listings that got a sales lookup. */
  verified: number
  /** Listings with at least one verified sale in the window. */
  proven: number
  windowDays: number
  fetchedAt: string
}

// --- Pure ranking (unit-tested, no network) ----------------------------------

/**
 * Score a verified listing. Recent, repeated purchases win; favourites are a
 * tie-breaker only, never a qualifier — a listing arrives here having already
 * proven at least one real sale.
 */
export function scoreProven(l: Omit<ProvenListing, 'score' | 'salesPerMonth'>): {
  score: number
  salesPerMonth: number
} {
  const observableDays = Math.max(1, Math.min(SALES_WINDOW_DAYS, l.ageDays))
  const salesPerMonth = (l.verifiedSales / observableDays) * 30
  // Freshness of the LAST sale matters as much as the count: a listing whose
  // newest review is 80 days old is cooling off even if it sold 20 that
  // quarter.
  const daysSinceSale = l.lastSaleAt
    ? Math.max(0, (Date.now() - Date.parse(l.lastSaleAt)) / 86_400_000)
    : SALES_WINDOW_DAYS
  const freshness = daysSinceSale <= 7 ? 1.5 : daysSinceSale <= 30 ? 1.2 : daysSinceSale <= 60 ? 1 : 0.7
  // Favourites per day, capped, so a viral-but-unbought listing can nudge
  // order but never outrank money.
  const favorTiebreak = Math.min(1, l.favorers / Math.max(1, l.ageDays) / 5)
  return {
    salesPerMonth: Math.round(salesPerMonth * 100) / 100,
    score: Math.round((salesPerMonth * freshness + favorTiebreak) * 1000) / 1000,
  }
}

/**
 * Keep only listings with a proven sale in the window, score them, and return
 * them best-first. A listing missing from `proofs` was never verified (its
 * lookup failed) and is DROPPED — never assumed to sell.
 */
export function rankProven(
  listings: Array<Omit<ProvenListing, 'score' | 'salesPerMonth' | 'verifiedSales' | 'verifiedSalesAllTime' | 'lastSaleAt'>>,
  proofs: Map<number, SalesProof>
): ProvenListing[] {
  const out: ProvenListing[] = []
  for (const l of listings) {
    const proof = proofs.get(l.listingId)
    if (!proof || proof.verifiedSales <= 0) continue
    const base = {
      ...l,
      verifiedSales: proof.verifiedSales,
      verifiedSalesAllTime: proof.verifiedSalesAllTime,
      lastSaleAt: proof.lastSaleAt,
    }
    out.push({ ...base, ...scoreProven(base) })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** Median, rounded to cents. */
export function medianPrice(prices: number[]): number {
  const sorted = prices.filter((p) => p > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(value * 100) / 100
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'gift',
  'gifts', 'shirt', 'tshirt', 't-shirt', 'tee', 'tees', 'hoodie', 'sweatshirt',
  'metal', 'sign', 'art', 'wall', 'decor', 'her', 'him', 'his', 'hers', 'men',
  'women', 'mens', 'womens', 'unisex', 'custom', 'personalized', 'funny',
  'cute', 'vintage', 'retro', 'graphic', 'print', 'printed', 'design', 'new',
])

/** The strongest non-generic tag on a listing — the seed of a theme name. */
export function leadTag(tags: string[]): string | null {
  for (const raw of tags) {
    const tag = String(raw || '').trim()
    if (tag.length < 4) continue
    const words = tag.toLowerCase().split(/\s+/)
    if (words.every((w) => STOPWORDS.has(w))) continue
    return tag
  }
  return null
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * Deterministic picks, used when the writing brain is unavailable or replies
 * with junk. Each proven listing becomes its own theme off its lead tag. Less
 * insightful than the model's clustering, but every row still carries real
 * receipts, which is the part that must never depend on an LLM being up.
 */
export function fallbackPicks(proven: ProvenListing[], count = PICK_COUNT): ScoutPick[] {
  const seen = new Set<string>()
  const picks: ScoutPick[] = []
  for (const l of proven) {
    const tag = leadTag(l.tags) ?? l.title.split(/[|,\-–]/)[0]?.trim()
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    picks.push(
      finalizePick({
        theme: titleCase(tag),
        idea: `An original ${tag.toLowerCase()} design — same buyer, our own artwork and wording`,
        kind: l.kind,
        angle: `${l.verifiedSales} verified sales in the last ${SALES_WINDOW_DAYS} days on one listing at $${l.priceUsd.toFixed(2)}`,
        sources: [l],
      })
    )
    if (picks.length >= count) break
  }
  return picks
}

/** Attach evidence, price and the copyright gate to a named theme. */
function finalizePick(input: {
  theme: string
  idea: string
  kind: ScoutKind
  angle: string
  sources: ProvenListing[]
}): ScoutPick {
  const gate = runCopyrightGate({
    name: input.theme,
    description: input.idea,
    tags: input.sources.flatMap((s) => s.tags).slice(0, 20),
    aiGenerated: true,
  })
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    theme: input.theme,
    idea: input.idea,
    kind: input.kind,
    angle: input.angle,
    verifiedSales: input.sources.reduce((n, s) => n + s.verifiedSales, 0),
    medianPriceUsd: medianPrice(input.sources.map((s) => s.priceUsd)),
    evidence: input.sources.slice(0, 3).map((s) => ({
      title: s.title,
      url: s.url,
      verifiedSales: s.verifiedSales,
      priceUsd: s.priceUsd,
      shopName: s.shop?.shopName,
      shopSoldCount: s.shop?.soldCount,
    })),
    gate: { pass: gate.pass, reasons: gate.reasons },
  }
}

const SEED_KINDS = new Set<string>(['tshirt', 'hoodie', 'youth-tshirt', 'metal'])

/**
 * Turn the model's reply into picks, discarding anything it made up. A theme
 * that cites no listing index we actually verified is dropped: the receipts
 * are the product, and a hallucinated citation would put an unproven idea on
 * a board whose whole claim is proof.
 */
export function coercePicks(parsed: any, proven: ProvenListing[], count = PICK_COUNT): ScoutPick[] {
  const rows = Array.isArray(parsed?.themes) ? parsed.themes : Array.isArray(parsed) ? parsed : []
  const picks: ScoutPick[] = []
  const usedThemes = new Set<string>()
  for (const row of rows) {
    const theme = typeof row?.theme === 'string' ? row.theme.trim() : ''
    const idea = typeof row?.idea === 'string' ? row.idea.trim() : ''
    if (!theme || !idea) continue
    if (usedThemes.has(theme.toLowerCase())) continue
    const indexes: number[] = Array.isArray(row?.sources)
      ? row.sources
          .map((n: any) => Number(n))
          .filter((n: number) => Number.isInteger(n) && n >= 0 && n < proven.length)
      : []
    const sources = indexes.map((i) => proven[i])
    if (sources.length === 0) continue
    usedThemes.add(theme.toLowerCase())
    const kind = SEED_KINDS.has(row?.kind) ? (row.kind as ScoutKind) : sources[0].kind
    picks.push({
      ...finalizePick({
        theme,
        idea,
        kind,
        angle: typeof row?.angle === 'string' && row.angle.trim() ? row.angle.trim() : '',
        sources,
      }),
    })
    if (picks.length >= count) break
  }
  // Every pick needs an angle; the model sometimes omits it on the tail rows.
  return picks.map((p) =>
    p.angle
      ? p
      : {
          ...p,
          angle: `${p.verifiedSales} verified sales in the last ${SALES_WINDOW_DAYS} days across ${p.evidence.length} listing(s)`,
        }
  )
}


// --- The writing brain (names the themes; never touches the evidence) --------

const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY
const MODEL = USE_OPENROUTER ? 'google/gemini-2.5-flash' : process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-nano'
const isReasoningModel = /^(o[1-9]|gpt-5)/.test(MODEL)

// Lazy, for the reason services/mrs-imagine.ts documents: `new OpenAI()` with
// no key throws at construction, which would break importing this module (and
// its pure exports) in any environment without one — a bare test run included.
let _brain: OpenAI | null = null
function brain(): OpenAI {
  if (_brain) return _brain
  _brain = new OpenAI(
    USE_OPENROUTER
      ? {
          apiKey: process.env.OPENROUTER_API_KEY,
          baseURL: 'https://openrouter.ai/api/v1',
          defaultHeaders: {
            'HTTP-Referer': 'https://imaginethisprinted.com',
            'X-Title': 'Mrs. Imagine - Scout',
          },
        }
      : { apiKey: process.env.OPENAI_API_KEY }
  )
  return _brain
}

const SYSTEM_PROMPT = `You are Mrs. Imagine, a print-on-demand scout. You are handed Etsy listings that are PROVEN to be selling (each number is a count of verified buyer reviews, i.e. real purchases).

Your job: group them into distinct buyer THEMES and, for each, write an ORIGINAL design idea we could draw ourselves.

Hard rules:
- NEVER copy a listing. No copying its wording, its artwork, its exact phrase. Name the buyer and the feeling, then describe our own take.
- No brand names, franchises, characters, sports teams, celebrities or song lyrics. If a listing sells on borrowed IP, find the generic human truth underneath it and use that instead.
- Every theme must cite the listing indexes it came from, using the numbers given.
- Themes must be genuinely different from each other. Ten variations of "funny mom shirt" is a failed answer.
- "idea" is one sentence a designer could draw from, in plain words. No prompt engineering, no camera or style jargon.

Reply with JSON only: {"themes":[{"theme":"...","idea":"...","kind":"tshirt|hoodie|youth-tshirt|metal","angle":"one sentence on why this sells right now","sources":[0,3]}]}`

function buildUserContent(proven: ProvenListing[]): string {
  const lines = proven.map(
    (l, i) =>
      `${i}. [${l.kind}] "${l.title.slice(0, 110)}" — ${l.verifiedSales} verified sales/${SALES_WINDOW_DAYS}d, $${l.priceUsd.toFixed(2)}, tags: ${l.tags.slice(0, 8).join(', ')}`
  )
  return `Proven sellers, best first:\n${lines.join('\n')}\n\nGive me exactly ${PICK_COUNT} themes.`
}

function parseJsonLoose(raw: string | null | undefined): any {
  if (!raw) return null
  const txt = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = txt.indexOf('{')
  const end = txt.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(txt.slice(start, end + 1))
  } catch {
    return null
  }
}

// --- The run -----------------------------------------------------------------

/** Sweep the seed searches, deduped by listing id. */
async function gatherCandidates(): Promise<ActiveListing[]> {
  const byId = new Map<number, ActiveListing & { kind: ScoutKind }>()
  for (const seed of SEEDS) {
    for (const q of seed.queries) {
      try {
        const page = await searchActiveListings(q, { limit: 50, sortOn: 'score' })
        for (const l of page) {
          if (!byId.has(l.listing_id)) byId.set(l.listing_id, { ...l, kind: seed.kind })
        }
      } catch (e: any) {
        console.warn(`[mrs-imagine-scout] seed "${q}" failed: ${e?.message}`)
      }
      await new Promise((r) => setTimeout(r, 120))
    }
  }
  return [...byId.values()]
}

function toCandidate(l: ActiveListing & { kind?: ScoutKind }, nowMs: number) {
  const ageDays = Math.max(
    1,
    Math.round((nowMs / 1000 - (l.original_creation_timestamp || nowMs / 1000)) / 86_400)
  )
  const priceUsd = l.price && l.price.divisor ? l.price.amount / l.price.divisor : 0
  return {
    listingId: l.listing_id,
    shopId: l.shop_id,
    kind: (l.kind ?? 'tshirt') as ScoutKind,
    title: l.title ?? '',
    tags: Array.isArray(l.tags) ? l.tags : [],
    url: l.url ?? `https://www.etsy.com/listing/${l.listing_id}`,
    priceUsd: Math.round(priceUsd * 100) / 100,
    favorers: l.num_favorers || 0,
    ageDays,
  }
}

/**
 * One scout pass. Read-only against Etsy, one cheap text call, zero image
 * spend. Throws only when it cannot produce a proven list at all — a caller
 * showing a stale list is better than showing an unproven one.
 */
export async function runScout(): Promise<ScoutResult> {
  if (!isEtsyResearchConfigured()) {
    throw new Error('ETSY_KEYSTRING is not set — the scout reads the public Etsy API')
  }
  const nowMs = Date.now()
  const listings = await gatherCandidates()
  if (listings.length === 0) {
    throw new Error('Etsy search returned nothing — check ETSY_KEYSTRING/ETSY_SHARED_SECRET')
  }

  // Verification costs 2 calls per listing, so spend the budget on the
  // listings most likely to have sold: favourites per day is a bad proxy for
  // sales but a decent proxy for "worth checking".
  const candidates = listings
    .map((l) => toCandidate(l as ActiveListing & { kind: ScoutKind }, nowMs))
    .sort((a, b) => b.favorers / b.ageDays - a.favorers / a.ageDays)
    .slice(0, VERIFY_BUDGET)

  const { proofs, failed, firstError } = await verifySalesBatch(
    candidates.map((c) => c.listingId),
    { windowDays: SALES_WINDOW_DAYS }
  )
  // "Nothing sold" and "we could not ask Etsy" look identical downstream — an
  // empty proofs map either way — and reporting the first as the second would
  // have David hunting for a dead market instead of a dead credential. If most
  // lookups failed, say so, and name the error Etsy actually returned.
  if (failed > candidates.length / 2) {
    throw new Error(
      `Could not verify sales: ${failed} of ${candidates.length} review lookups failed (${firstError ?? 'no detail'})`
    )
  }
  const proven = rankProven(candidates, proofs)
  if (proven.length === 0) {
    throw new Error(
      `No listing out of ${proofs.size} verified showed a sale in the last ${SALES_WINDOW_DAYS} days — nothing to pitch`
    )
  }

  // Shop stats for the shortlist only, deduped — context for David ("this
  // shop has sold 4.2k"), and a guard against a one-hit listing on a shop
  // that has otherwise never sold anything.
  const shortlist = proven.slice(0, 40)
  const shopIds = [...new Set(shortlist.map((l) => l.shopId).filter(Boolean))].slice(0, 25)
  const shops = new Map<number, ShopStats>()
  await Promise.all(
    shopIds.map(async (id) => {
      try {
        shops.set(id, await fetchShopStats(id))
      } catch {
        // A missing shop stat is cosmetic — the sales proof already stands.
      }
    })
  )
  for (const l of shortlist) l.shop = shops.get(l.shopId)

  let picks: ScoutPick[] = []
  try {
    const completion = await brain().chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserContent(shortlist.slice(0, 25)) },
      ],
      ...(isReasoningModel ? { max_completion_tokens: 1600 } : { temperature: 0.8, max_tokens: 1600 }),
    })
    picks = coercePicks(parseJsonLoose(completion.choices[0]?.message?.content), shortlist.slice(0, 25))
  } catch (e: any) {
    console.warn('[mrs-imagine-scout] writing brain failed, using tag fallback:', e?.message)
  }
  if (picks.length === 0) picks = fallbackPicks(shortlist)

  return {
    picks,
    sampled: listings.length,
    verified: proofs.size,
    proven: proven.length,
    windowDays: SALES_WINDOW_DAYS,
    fetchedAt: new Date().toISOString(),
  }
}

// --- Persistence (ai_jobs, no new tables) ------------------------------------
//
// Same "state on an ai_jobs row" pattern the batch used — `type` is free text
// (replicate_image, replicate_rembg, step_flow_model_shot, mrs_imagine_batch
// all coexist), so this needs no migration and no prod DDL.

export const SCOUT_JOB_TYPE = 'mrs_imagine_scout'

export interface ScoutRun {
  id: string
  status: 'running' | 'succeeded' | 'failed'
  output?: ScoutResult
  error?: string | null
  input?: { requestedBy?: string | null }
  created_at: string
  updated_at: string
}

/** Newest scout run, whatever its state. */
export async function latestScoutRun(): Promise<ScoutRun | null> {
  const { data } = await supabase
    .from('ai_jobs')
    .select('id, status, input, output, error, created_at, updated_at')
    .eq('type', SCOUT_JOB_TYPE)
    .order('created_at', { ascending: false })
    .limit(1)
  return (data?.[0] as ScoutRun) ?? null
}

/** True while a scout pass is already in flight (older than 15 minutes counts
 *  as dead — a deploy mid-run leaves the row stuck on 'running'). */
export async function scoutIsRunning(): Promise<boolean> {
  const latest = await latestScoutRun()
  if (!latest || latest.status !== 'running') return false
  return Date.now() - Date.parse(latest.updated_at) < 15 * 60_000
}

/**
 * Run a scout pass and record it. Resolves with the run row either way — a
 * failure is a visible red row on David's board, not a silent nothing.
 */
export async function runAndRecordScout(opts: { requestedBy?: string | null } = {}): Promise<ScoutRun> {
  const { data: created, error } = await supabase
    .from('ai_jobs')
    .insert({
      type: SCOUT_JOB_TYPE,
      status: 'running',
      input: { requestedBy: opts.requestedBy ?? null },
    })
    .select('id, status, input, output, error, created_at, updated_at')
    .single()
  if (error) throw new Error(`Could not start a scout run: ${error.message}`)

  try {
    const result = await runScout()
    const { data } = await supabase
      .from('ai_jobs')
      .update({ status: 'succeeded', output: result, updated_at: new Date().toISOString() })
      .eq('id', created.id)
      .select('id, status, input, output, error, created_at, updated_at')
      .single()
    return (data as ScoutRun) ?? { ...(created as ScoutRun), status: 'succeeded', output: result }
  } catch (e: any) {
    const message = e?.message || 'Scout failed'
    await supabase
      .from('ai_jobs')
      .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
      .eq('id', created.id)
    return { ...(created as ScoutRun), status: 'failed', error: message }
  }
}
