// Jev pre-sort for the user-submitted product approval queue.
//
// GET /api/admin/user-products/pending used to hand the admin a flat list,
// newest first, and every item needed a full read to know whether it was a
// quick approve or a trademark problem. This module reads each pending item
// (name, tags, design prompt, description) and gives the reviewer a suggested
// verdict, a confidence, and a reason code — then orders the queue by it.
//
// The rules it is built around (David, 2026-09-23):
//
//   1. Always a multi-option choice with written criteria, never a yes/no.
//      Four verdicts: approve · needs_fix · reject_quality · reject_ip.
//   2. Gate on confidence. An answer under the bar is NO OPINION — the item
//      goes to the "needs a human" band with no suggested verdict at all, so a
//      shaky guess never biases the reviewer toward a click.
//   3. Jev never acts alone. Nothing in this module writes to the database;
//      it only annotates and orders a read. Every status change still needs an
//      admin to press Approve or Reject.
//   4. Deterministic checks are the FLOOR. The trademark denylist and the
//      missing-artwork/title checks run first and cannot be overruled by Jev —
//      Jev can only make a verdict stricter, never softer.
//   5. The IP half reuses the Jev IP gate (jev-ip-gate.ts), so the catalogue
//      and the approval queue ask the same IP question with the same bars.
//   6. Measure before enabling as default. JEV_PRESORT defaults to `shadow`:
//      verdicts ride in the payload but the queue keeps its old order unless
//      the caller asks for ?sort=jev. `on` makes Jev order the default; `off`
//      skips the Jev calls (the floor still runs — it costs nothing).
//
// Fail OPEN: Jev down, slow, or garbled → items get `jev_unavailable` and the
// floor alone decides, which is exactly the queue as it was before.
import { runCopyrightGate } from './etsy-copyright-gate.js'
import {
  classifyIpCached,
  defaultJevFetch,
  designPromptOf,
  type JevFetch,
  type JevIpDecision
} from './jev-ip-gate.js'

export const PRESORT_VERDICTS = ['approve', 'needs_fix', 'reject_quality', 'reject_ip'] as const
export type PresortVerdict = (typeof PRESORT_VERDICTS)[number]

/**
 * Written criteria per option. The four are written to be distinct KINDS of
 * outcome (sell it / edit it / drop it for quality / drop it for IP) rather
 * than rungs of one scale: Jev's confidence is the margin between its top two
 * options, and options that shade into each other split the vote.
 */
export const TRIAGE_CRITERIA: Record<PresortVerdict, string> = {
  approve:
    'Ready to sell as submitted. A clear, specific design idea a shopper would want on a shirt, print or toy, with a real title that describes it. Nothing needs changing before it goes live.',
  needs_fix:
    'The design idea is sellable, but the LISTING needs an edit first: the title is vague, generic, misspelled, a raw prompt, or keyword-stuffed; the tags are missing or unrelated; or the prompt asks for printed words that are likely to come out misspelled.',
  reject_quality:
    'Not worth selling at all: gibberish, a test or placeholder submission, spam, hateful, sexual or violent content, or an idea no shopper would buy. No edit would save it.',
  reject_ip:
    "Built on someone else's intellectual property: it names or clearly paraphrases a real brand, franchise, character, sports team or league, celebrity, or trademarked slogan."
}

const TRIAGE_QUESTION = 'What should the admin reviewing this user-submitted print-on-demand product do with it?'

/**
 * Below this, a triage answer is no opinion. 0.75 is the jev-decisions skill's
 * cheap-to-be-cautious bar: a missed pre-sort costs a reviewer one read, and
 * nothing is ever executed on the answer. Override with JEV_PRESORT_MIN_CONFIDENCE.
 */
export const MIN_CONFIDENCE = 0.75

/** Whole-queue budget. The admin page waits on this; a slow lane falls back to the floor. */
export const PRESORT_BUDGET_MS = 6000

export type PresortMode = 'off' | 'shadow' | 'on'

export function presortMode(): PresortMode {
  if (process.env.JEV === 'off') return 'off'
  const m = (process.env.JEV_PRESORT || 'shadow').toLowerCase()
  return m === 'off' || m === 'on' ? m : 'shadow'
}

function minConfidence(): number {
  const n = Number(process.env.JEV_PRESORT_MIN_CONFIDENCE)
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : MIN_CONFIDENCE
}

export type ReasonCode =
  | 'floor_trademark'
  | 'floor_no_artwork'
  | 'floor_missing_title'
  | 'floor_missing_generations'
  | 'jev_ip_block'
  | 'jev_ip_review'
  | 'jev_approve'
  | 'jev_needs_fix'
  | 'jev_reject_quality'
  | 'jev_reject_ip'
  | 'jev_low_confidence'
  | 'jev_unavailable'
  | 'jev_off'

/** Review order. Lower = earlier in the queue. */
export type PresortBand = 'approve' | 'needs_human' | 'needs_fix' | 'reject_quality' | 'reject_ip'

export interface PresortResult {
  /** Suggested verdict, or null when nothing is sure enough to suggest one. */
  recommendation: PresortVerdict | null
  /** 0-1. 1 for a deterministic floor hit. */
  confidence: number | null
  /** Primary reason code — the one that decided the recommendation. */
  reasonCode: ReasonCode
  /** Every code that fired, floor first — including informational ones that set no verdict. */
  reasonCodes: ReasonCode[]
  /** Plain-language rationale for the reviewer. Jev writes no prose; this is ours. */
  rationale: string
  source: 'floor' | 'jev' | 'none'
  /** True when the item must get a careful human read: low confidence, Jev unsure on IP, or no answer. */
  lowConfidence: boolean
  band: PresortBand
  /** Numeric sort key (lower first) — band, then confidence. */
  priority: number
  probabilities?: Partial<Record<PresortVerdict, number>>
  ip?: JevIpDecision
}

export interface PresortItem {
  id: string
  name?: string | null
  description?: string | null
  tags?: string[]
  designPrompt?: string
  /** Deterministic facts computed from the row (see toPresortItem). */
  hasArtwork: boolean
  missingGenerations: string[]
}

interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  confidence: number
  probabilities?: Record<string, number>
}

const SEVERITY: Record<PresortVerdict, number> = { approve: 0, needs_fix: 1, reject_quality: 2, reject_ip: 3 }

const BAND_ORDER: Record<PresortBand, number> = {
  // Confident approvals first: the fastest clicks and the ones that make money.
  approve: 0,
  // Then the items that need real judgement, before the ones Jev already has a firm read on.
  needs_human: 1,
  needs_fix: 2,
  reject_quality: 3,
  // Pending items are not live, so an IP problem is not urgent — it is a reject
  // the reviewer confirms in one click once they have seen the reason.
  reject_ip: 4
}

/** Pull the deterministic inputs the floor needs out of a products row. */
export function toPresortItem(product: any): PresortItem {
  const meta = product?.metadata || {}
  const assets = meta.assets && typeof meta.assets === 'object' ? meta.assets : {}
  const images = Array.isArray(product?.images) ? product.images.filter(Boolean) : []
  const productAssets = Array.isArray(product?.product_assets) ? product.product_assets.filter((a: any) => a?.url) : []
  const hasArtwork = !!(assets.clean || images.length || productAssets.length || meta.mockup_url)

  // Mirrors the approve route's generation-completeness gate, so the floor
  // says exactly what approving right now would do.
  const tmpl = String(meta.product_template || meta.category || '').toLowerCase()
  const kind = (tmpl.includes('metal') || tmpl.includes('wall')) ? 'metal'
    : (tmpl.includes('3d') || tmpl.includes('toy')) ? '3d' : 'apparel'
  const hasMockup = !!(meta.mockup_url || (Array.isArray(assets.mockups) && assets.mockups.length))
  const isDirectPrint = !!meta.print_files?.front
  const missingGenerations: string[] = []
  if (!assets.clean && !images.length) missingGenerations.push('clean design')
  if (!hasMockup) missingGenerations.push('mockup')
  if (kind === 'apparel' && !isDirectPrint) {
    if (!assets.halftone) missingGenerations.push('halftone')
    if (!assets.dtf) missingGenerations.push('DTF print-ready')
  }

  const tagRows = Array.isArray(product?.product_tags) ? product.product_tags.map((t: any) => t?.tag) : []
  const metaTags = Array.isArray(meta.tags) ? meta.tags : []
  const tags = [...new Set([...tagRows, ...metaTags].filter((t): t is string => typeof t === 'string' && !!t.trim()))]

  return {
    id: String(product?.id),
    name: product?.name ?? null,
    description: product?.description ?? null,
    tags,
    designPrompt: designPromptOf(meta),
    hasArtwork,
    missingGenerations
  }
}

interface FloorHit {
  /** null = informational: the code rides along but sets no verdict. */
  verdict: PresortVerdict | null
  code: ReasonCode
  rationale: string
}

const PLACEHOLDER_TITLE = /^(untitled|new product|product|test|asdf+|design|my design)\b/i

/** Deterministic checks. Pure, synchronous, always run, never overruled. Most severe first. */
export function runFloor(item: PresortItem): FloorHit[] {
  const hits: FloorHit[] = []
  const gate = runCopyrightGate({ name: item.name ?? undefined, description: item.description ?? undefined, tags: [...(item.tags || []), item.designPrompt || ''] })
  if (gate.matchedTerms.length) {
    hits.push({
      verdict: 'reject_ip',
      code: 'floor_trademark',
      rationale: `Trademark denylist hit: ${gate.matchedTerms.join(', ')}. Needs human IP clearance before it can sell.`
    })
  }
  if (!item.hasArtwork) {
    hits.push({ verdict: 'reject_quality', code: 'floor_no_artwork', rationale: 'No artwork is attached to this submission.' })
  }
  const title = (item.name || '').trim()
  if (title.length < 3 || PLACEHOLDER_TITLE.test(title)) {
    hits.push({ verdict: 'needs_fix', code: 'floor_missing_title', rationale: `Title is missing or a placeholder ("${title}").` })
  }
  // Informational only. Missing mockup/halftone/DTF is the NORMAL state of a
  // pending item (the 2026-09-23 benchmark hit it on 10 of 11 decided rows,
  // approved and rejected alike), so as a verdict it flattened the whole queue
  // into needs_fix. The reviewer still sees it; it just doesn't decide.
  if (item.hasArtwork && item.missingGenerations.length) {
    hits.push({
      verdict: null,
      code: 'floor_missing_generations',
      rationale: `Missing ${item.missingGenerations.join(', ')} — approving now saves it as incomplete.`
    })
  }
  const sev = (h: FloorHit) => (h.verdict ? SEVERITY[h.verdict] : -1)
  return hits.sort((a, b) => sev(b) - sev(a))
}

/** The one line Jev reads for an item. Clipped — title, tags and prompt carry the signal. */
export function itemText(item: PresortItem): string {
  const parts = [
    `title: ${item.name || '(none)'}`,
    item.tags?.length ? `tags: ${item.tags.slice(0, 20).join(', ')}` : 'tags: (none)',
    item.designPrompt && `design prompt: ${item.designPrompt.slice(0, 600)}`,
    item.description && `description: ${item.description.slice(0, 500)}`
  ]
  return parts.filter(Boolean).join(' | ')
}

export interface TriageDecision {
  verdict: PresortVerdict | null
  confidence?: number
  probabilities?: Partial<Record<PresortVerdict, number>>
  status: 'sure' | 'low_confidence' | 'unavailable'
}

/** Gate one raw triage answer on confidence. Pure — this is what the tests pin. */
export function gateTriage(answer: JevChoiceAnswer | undefined, bar = minConfidence()): TriageDecision {
  if (!answer || answer.type !== 'choice' || typeof answer.confidence !== 'number' ||
      !(PRESORT_VERDICTS as readonly string[]).includes(answer.choice)) {
    return { verdict: null, status: 'unavailable' }
  }
  const probabilities: Partial<Record<PresortVerdict, number>> = {}
  for (const v of PRESORT_VERDICTS) {
    const p = answer.probabilities?.[v]
    if (typeof p === 'number') probabilities[v] = p
  }
  if (answer.confidence < bar) {
    // Under the bar is NO opinion, not a weak one — keep the numbers for the
    // record but suggest nothing.
    return { verdict: null, confidence: answer.confidence, probabilities, status: 'low_confidence' }
  }
  return { verdict: answer.choice as PresortVerdict, confidence: answer.confidence, probabilities, status: 'sure' }
}

const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * Fold floor + IP gate + triage into one result. Precedence:
 *   - floor hits are absolute: sure by definition, and nothing softens them;
 *   - Jev can add a STRICTER verdict (IP block, or a sure triage answer);
 *   - the most severe candidate wins, the floor winning ties;
 *   - an IP "review" (the gate is unsure) outranks any softer Jev suggestion,
 *     so the item goes to a human with no suggested verdict at all.
 */
export function combinePresort(
  floor: FloorHit[],
  ip: JevIpDecision | undefined,
  triage: TriageDecision,
  opts: { jevOff?: boolean } = {}
): PresortResult {
  type Cand = { verdict: PresortVerdict; confidence: number; code: ReasonCode; source: 'floor' | 'jev'; note: string }
  const codes: ReasonCode[] = floor.map(f => f.code)
  const notes: string[] = floor.map(f => f.rationale)
  const cands: Cand[] = floor
    .filter((f): f is FloorHit & { verdict: PresortVerdict } => f.verdict !== null)
    .map(f => ({ verdict: f.verdict, confidence: 1, code: f.code, source: 'floor' as const, note: f.rationale }))

  const floorBlockedIp = floor.some(f => f.verdict === 'reject_ip')
  let ipDoubt = false
  if (!floorBlockedIp && ip?.verdict === 'block') {
    codes.push('jev_ip_block')
    notes.push(ip.reason)
    cands.push({ verdict: 'reject_ip', confidence: ip.confidence ?? 0, code: 'jev_ip_block', source: 'jev', note: ip.reason })
  } else if (!floorBlockedIp && ip?.verdict === 'review') {
    codes.push('jev_ip_review')
    notes.push(ip.reason)
    ipDoubt = true
  }

  if (opts.jevOff) {
    codes.push('jev_off')
  } else if (triage.status === 'unavailable') {
    codes.push('jev_unavailable')
  } else if (triage.status === 'low_confidence') {
    codes.push('jev_low_confidence')
    notes.push(`Jev was not sure enough to suggest a verdict (${pct(triage.confidence ?? 0)}, bar ${pct(minConfidence())}).`)
  } else if (triage.verdict) {
    const code = `jev_${triage.verdict}` as ReasonCode
    const note = `Jev suggests ${triage.verdict.replace('_', ' ')} (${pct(triage.confidence ?? 0)} sure).`
    codes.push(code)
    notes.push(note)
    cands.push({ verdict: triage.verdict, confidence: triage.confidence ?? 0, code, source: 'jev', note })
  }

  // Most severe first; the floor wins a tie.
  cands.sort((a, b) => SEVERITY[b.verdict] - SEVERITY[a.verdict] || (a.source === b.source ? 0 : a.source === 'floor' ? -1 : 1))
  const top = cands[0]

  let chosen: Cand | undefined = top
  // A soft Jev suggestion never stands over an IP doubt.
  if (top && top.source === 'jev' && ipDoubt && top.verdict !== 'reject_ip') chosen = undefined

  const band: PresortBand = chosen ? chosen.verdict : 'needs_human'
  const confidence = chosen ? chosen.confidence : (triage.confidence ?? null)
  const primary: ReasonCode = chosen?.code
    ?? (ipDoubt ? 'jev_ip_review' : codes.find(c => c === 'jev_low_confidence' || c === 'jev_off') ?? 'jev_unavailable')
  // Band first; inside a band the surest item leads.
  const priority = BAND_ORDER[band] * 10 + (1 - Math.min(1, Math.max(0, confidence ?? 0)))
  const jevUnsure = !opts.jevOff && triage.status !== 'sure'

  return {
    recommendation: chosen?.verdict ?? null,
    confidence,
    reasonCode: primary,
    reasonCodes: codes,
    rationale: notes.join(' ') || (opts.jevOff ? 'Jev pre-sort is off and no floor check fired.' : 'No check fired.'),
    source: chosen?.source ?? 'none',
    lowConfidence: band === 'needs_human' || ipDoubt || (jevUnsure && chosen?.source !== 'floor'),
    band,
    priority,
    probabilities: triage.probabilities,
    ip
  }
}

function triageQuestion(label: string) {
  return { type: 'choice', instructions: `${label}: ${TRIAGE_QUESTION}`, criteria: TRIAGE_CRITERIA }
}

// Same text → same answer. The admin tab refreshes; don't re-ask Jev each time.
const triageCache = new Map<string, { at: number; answer: JevChoiceAnswer }>()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

export function resetPresortCache(): void {
  triageCache.clear()
}

/** One triage question per item, batched through the shared Jev transport. Missing keys = no answer. */
export async function askTriage(
  items: PresortItem[],
  opts: { fetchImpl?: JevFetch; batchSize?: number } = {}
): Promise<Record<string, JevChoiceAnswer | undefined>> {
  const doFetch = opts.fetchImpl ?? defaultJevFetch
  const out: Record<string, JevChoiceAnswer | undefined> = {}
  const now = Date.now()
  const misses: PresortItem[] = []
  for (const item of items) {
    const hit = triageCache.get(itemText(item))
    if (hit && now - hit.at < CACHE_TTL_MS) out[item.id] = hit.answer
    else misses.push(item)
  }
  const size = Math.max(1, opts.batchSize ?? 25)
  const chunks: PresortItem[][] = []
  for (let i = 0; i < misses.length; i += size) chunks.push(misses.slice(i, i + size))
  await Promise.all(chunks.map(async chunk => {
    const state: Record<string, string> = {}
    const questions: Record<string, unknown> = {}
    chunk.forEach((item, n) => {
      const label = `item_${n}`
      state[label] = itemText(item)
      questions[label] = triageQuestion(`Item ${label}`)
    })
    const answers = await doFetch(state, questions).catch(() => null)
    chunk.forEach((item, n) => {
      const a = answers?.[`item_${n}`] as JevChoiceAnswer | undefined
      out[item.id] = a
      // Never cache a failure — the next refresh should retry.
      if (a && a.type === 'choice') triageCache.set(itemText(item), { at: now, answer: a })
    })
  }))
  return out
}

function withBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms) })
  return Promise.race([p.catch(() => fallback), timeout]).finally(() => clearTimeout(timer))
}

/**
 * Pre-sort a list of pending product rows. Returns a result per product id.
 * Reads only — never writes a status, never touches the database.
 */
export async function presortProducts(
  products: any[],
  opts: { fetchImpl?: JevFetch; mode?: PresortMode; budgetMs?: number } = {}
): Promise<Record<string, PresortResult>> {
  const mode = opts.mode ?? presortMode()
  // One transport for both questions, so an injected fetch covers the IP gate too.
  const fetchImpl = opts.fetchImpl ?? defaultJevFetch
  const items = products.map(toPresortItem)
  const floors = new Map(items.map(i => [i.id, runFloor(i)]))

  let ipDecisions: Record<string, JevIpDecision> = {}
  let triageAnswers: Record<string, JevChoiceAnswer | undefined> = {}
  if (mode !== 'off' && items.length) {
    // The IP gate is only worth asking when the floor has not already blocked on IP.
    const ipInputs = Object.fromEntries(
      items
        .filter(i => !floors.get(i.id)!.some(f => f.verdict === 'reject_ip'))
        .map(i => [i.id, { name: i.name ?? undefined, description: i.description ?? undefined, tags: i.tags, designPrompt: i.designPrompt }])
    )
    const budget = opts.budgetMs ?? PRESORT_BUDGET_MS
    ;[ipDecisions, triageAnswers] = await Promise.all([
      withBudget(classifyIpCached(ipInputs, { fetchImpl }), budget, {} as Record<string, JevIpDecision>),
      withBudget(askTriage(items, { fetchImpl }), budget, {} as Record<string, JevChoiceAnswer | undefined>)
    ])
  }

  const out: Record<string, PresortResult> = {}
  for (const item of items) {
    out[item.id] = combinePresort(
      floors.get(item.id)!,
      ipDecisions[item.id],
      mode === 'off' ? { verdict: null, status: 'unavailable' } : gateTriage(triageAnswers[item.id]),
      { jevOff: mode === 'off' }
    )
  }
  return out
}

/** Order by band then confidence; ties keep newest first. Does not mutate the input. */
export function sortByPresort<T extends { id: string; created_at?: string; jev_presort?: PresortResult }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const pa = a.jev_presort?.priority ?? Number.MAX_SAFE_INTEGER
    const pb = b.jev_presort?.priority ?? Number.MAX_SAFE_INTEGER
    if (pa !== pb) return pa - pb
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })
}
