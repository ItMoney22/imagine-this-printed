// Jev IP gate — the second opinion on top of the Etsy copyright gate.
//
// The deterministic denylist in etsy-copyright-gate.ts only catches marks it
// has been told about, spelled the way it was told. It waved through FIFA and
// Team USA until a sweep found them live, and it can never catch a paraphrase:
// "wizard school with a lightning scar", "yellow electric mouse", "swoosh",
// "mouse ears castle". Jev (typesafe/jev on OpenRouter's decisions endpoint,
// see the jev-decisions skill) reads the listing and picks one of four tiers
// with a probability for each.
//
// The rules this module is built around (David, 2026-09-23):
//
//   1. The regex gate is a FLOOR. It runs first; a regex hit blocks and Jev is
//      never even asked. Jev can only ADD a flag or a block — nothing it says
//      can unblock a listing the denylist caught.
//   2. Always a multi-option choice with written criteria, never a yes/no.
//   3. Gate on confidence. A listing is only auto-accepted when the combined
//      probability of the two SAFE tiers clears SAFE_CONFIDENCE. Anything less
//      sure goes to a human.
//   4. Jev never takes a destructive action alone. Its strongest outcome is
//      "hold this listing for a person" — nothing is deleted or delisted.
//   5. Measure before enforcing. JEV_IP_GATE defaults to `shadow`: decisions
//      are computed and reported but do not change pass/fail. `enforce` makes
//      review/block verdicts stop publication; `off` skips the call.
//
// Fail OPEN on the Jev half only: if the lane is down, the result is exactly
// the regex gate's, which is what shipped before this module existed.
import { runCopyrightGate, type CopyrightGateInput, type CopyrightGateResult } from './etsy-copyright-gate.js'

export const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
export const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13'

/**
 * Below this combined clean+generic probability a listing is NOT auto-accepted;
 * it goes to a human. 0.80 sits between the jev-decisions skill's two bars
 * (0.75 cheap-to-be-cautious, 0.85 skipping-a-safety-check): a false "safe"
 * here risks an Etsy IP strike, but a false "review" only costs a glance.
 * Override with JEV_IP_SAFE_CONFIDENCE.
 */
export const SAFE_CONFIDENCE = 0.8

/** Top choice `definite_brand_or_character` at or above this → block, not just review. */
export const BLOCK_CONFIDENCE = 0.8

export const IP_TIERS = ['clean', 'generic_theme', 'likely_ip_reference', 'definite_brand_or_character'] as const
export type IpTier = (typeof IP_TIERS)[number]

/** Written criteria per option — a bare list of keys reads as mushy as `noul`. */
export const IP_CRITERIA: Record<IpTier, string> = {
  clean:
    'Original or generic subject matter. Nothing in it points at any real brand, franchise, character, team, league, celebrity or trademarked slogan.',
  generic_theme:
    'Uses a broad genre or common motif (wizards, space, dinosaurs, samurai, cats, retro sunsets) that many unrelated works share. No specific franchise or brand is identifiable from the words.',
  likely_ip_reference:
    "Does not name the brand, but paraphrases or hints at one specific franchise, character, brand, slogan, team, athlete or celebrity closely enough that a reader would think of it (e.g. 'wizard school with lightning scar', 'yellow electric mouse', 'swoosh', 'mouse ears castle').",
  definite_brand_or_character:
    'Names or directly quotes a real brand, franchise, character, team, league, athlete, celebrity, or trademarked slogan.'
}

const QUESTION_TEXT = "Does this print-on-demand listing reference someone else's intellectual property?"

export type JevIpMode = 'off' | 'shadow' | 'enforce'

/** pass = auto-accept · review = a human looks first · block = hold, strong IP signal · unavailable = no answer (fail open). */
export type JevIpVerdict = 'pass' | 'review' | 'block' | 'unavailable'

export interface JevIpInput extends CopyrightGateInput {
  /** The prompt the artwork was generated from, when there is one. */
  designPrompt?: string
}

export interface JevIpDecision {
  verdict: JevIpVerdict
  tier?: IpTier
  confidence?: number
  /** Combined probability of clean + generic_theme. The number the pass bar is set on. */
  safeProbability?: number
  probabilities?: Partial<Record<IpTier, number>>
  /** Plain-language reason for a human reviewer. Jev writes no prose, so this is ours. */
  reason: string
}

export interface JevGateResult extends CopyrightGateResult {
  mode: JevIpMode
  /** Absent when the regex floor already blocked (Jev is not asked) or mode is off. */
  jev?: JevIpDecision
  /** True when Jev's verdict is not `pass` — whether or not it was enforced. */
  jevFlagged: boolean
}

interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  confidence: number
  probabilities?: Record<string, number>
}

export type JevFetch = (
  state: Record<string, string>,
  questions: Record<string, unknown>
) => Promise<Record<string, JevChoiceAnswer> | null>

export function jevIpMode(): JevIpMode {
  if (process.env.JEV === 'off') return 'off'
  const m = (process.env.JEV_IP_GATE || 'shadow').toLowerCase()
  return m === 'off' || m === 'enforce' ? m : 'shadow'
}

function safeBar(): number {
  const n = Number(process.env.JEV_IP_SAFE_CONFIDENCE)
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : SAFE_CONFIDENCE
}

/** Flatten the listing into the one line Jev reads. Long descriptions are clipped — the title and tags carry the signal. */
export function listingText(input: JevIpInput): string {
  const parts = [
    input.name && `title: ${input.name}`,
    input.tags?.length ? `tags: ${input.tags.join(', ')}` : '',
    input.designPrompt && `design prompt: ${input.designPrompt.slice(0, 600)}`,
    input.description && `description: ${input.description.slice(0, 800)}`
  ]
  return parts.filter(Boolean).join(' | ')
}

function question(label: string) {
  return { type: 'choice', instructions: `${label}: ${QUESTION_TEXT}`, criteria: IP_CRITERIA }
}

/** The real transport. Returns null on any failure — callers fail open. */
export const defaultJevFetch: JevFetch = async (state, questions) => {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(process.env.JEV_TIMEOUT_MS) || 15000)
  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.JEV_MODEL || DEFAULT_JEV_MODEL, state, questions }),
      signal: controller.signal
    })
    if (!res.ok) return null
    const body = (await res.json()) as { answers?: Record<string, JevChoiceAnswer> }
    return body && typeof body.answers === 'object' && body.answers ? body.answers : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Turn one raw Jev answer into a gated decision. Pure — this is what the tests pin. */
export function decide(answer: JevChoiceAnswer | undefined, bar = safeBar()): JevIpDecision {
  if (!answer || answer.type !== 'choice' || typeof answer.confidence !== 'number' || !(IP_TIERS as readonly string[]).includes(answer.choice)) {
    return { verdict: 'unavailable', reason: 'Jev gave no usable answer; the regex gate alone decided.' }
  }
  const tier = answer.choice as IpTier
  const probs = answer.probabilities ?? {}
  const p = (t: IpTier) => (typeof probs[t] === 'number' ? probs[t] : t === tier ? answer.confidence : 0)
  const probabilities = Object.fromEntries(IP_TIERS.map(t => [t, p(t)])) as Record<IpTier, number>
  const safeProbability = probabilities.clean + probabilities.generic_theme
  const base = { tier, confidence: answer.confidence, safeProbability, probabilities }
  const pct = (n: number) => `${Math.round(n * 100)}%`

  if (tier === 'definite_brand_or_character' && answer.confidence >= BLOCK_CONFIDENCE) {
    return { ...base, verdict: 'block', reason: `Jev: names a real brand or character (${pct(answer.confidence)} sure). Needs human IP clearance.` }
  }
  if (tier === 'definite_brand_or_character' || tier === 'likely_ip_reference') {
    return { ...base, verdict: 'review', reason: `Jev: ${tier === 'likely_ip_reference' ? 'likely paraphrases a brand, franchise or character' : 'may name a real brand or character'} (${pct(answer.confidence)}). Needs human IP review.` }
  }
  if (safeProbability < bar) {
    return { ...base, verdict: 'review', reason: `Jev leans ${tier} but only ${pct(safeProbability)} sure it is safe (bar ${pct(bar)}). Needs a human look.` }
  }
  return { ...base, verdict: 'pass', reason: `Jev: ${tier} (${pct(safeProbability)} safe).` }
}

/**
 * Classify many listings in as few calls as possible. Keys in → decisions out.
 * Batches of `batchSize` share one call (the listings ride in `state`, one
 * question each). A failed batch yields `unavailable` for its keys only.
 */
export async function classifyIpBatch(
  listings: Record<string, JevIpInput>,
  opts: { fetchImpl?: JevFetch; batchSize?: number } = {}
): Promise<Record<string, JevIpDecision>> {
  const doFetch = opts.fetchImpl ?? defaultJevFetch
  const ids = Object.keys(listings)
  const size = Math.max(1, opts.batchSize ?? 25)
  const out: Record<string, JevIpDecision> = {}
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size))

  await Promise.all(
    chunks.map(async chunk => {
      // Short synthetic labels keep UUIDs out of the question text.
      const state: Record<string, string> = {}
      const questions: Record<string, unknown> = {}
      chunk.forEach((id, n) => {
        const label = `listing_${n}`
        state[label] = listingText(listings[id])
        questions[label] = question(`Listing ${label}`)
      })
      const answers = await doFetch(state, questions).catch(() => null)
      chunk.forEach((id, n) => {
        out[id] = decide(answers?.[`listing_${n}`])
      })
    })
  )
  return out
}

// Same listing text → same answer. The admin candidates panel polls, so
// without this a sitting page would re-ask Jev every few seconds.
const cache = new Map<string, { at: number; decision: JevIpDecision }>()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

export function resetJevIpCache(): void {
  cache.clear()
}

export async function classifyIpCached(
  listings: Record<string, JevIpInput>,
  opts: { fetchImpl?: JevFetch } = {}
): Promise<Record<string, JevIpDecision>> {
  const out: Record<string, JevIpDecision> = {}
  const misses: Record<string, JevIpInput> = {}
  const now = Date.now()
  for (const [id, input] of Object.entries(listings)) {
    const hit = cache.get(listingText(input))
    if (hit && now - hit.at < CACHE_TTL_MS) out[id] = hit.decision
    else misses[id] = input
  }
  if (Object.keys(misses).length) {
    const fresh = await classifyIpBatch(misses, opts)
    for (const [id, d] of Object.entries(fresh)) {
      out[id] = d
      // Never cache a transport failure — the next poll should retry.
      if (d.verdict !== 'unavailable') cache.set(listingText(misses[id]), { at: now, decision: d })
    }
  }
  return out
}

/**
 * What `enforce` holds: `all` = every non-pass verdict; `ip` = only verdicts
 * where Jev actually picked an IP tier, leaving the low-confidence "leans safe"
 * tail advisory (it is mostly 'Keep Calm and …' riffs). JEV_IP_ENFORCE.
 */
export type JevEnforceLevel = 'all' | 'ip'
export function jevEnforceLevel(): JevEnforceLevel {
  return process.env.JEV_IP_ENFORCE === 'ip' ? 'ip' : 'all'
}

/** Fold a Jev decision into a regex gate result. The regex result can only get stricter. */
export function combine(
  regex: CopyrightGateResult,
  jev: JevIpDecision | undefined,
  mode: JevIpMode,
  level: JevEnforceLevel = jevEnforceLevel()
): JevGateResult {
  const jevFlagged = !!jev && jev.verdict !== 'pass' && jev.verdict !== 'unavailable'
  const ipTier = jev?.tier === 'likely_ip_reference' || jev?.tier === 'definite_brand_or_character'
  const enforced = mode === 'enforce' && jevFlagged && (level === 'all' || ipTier)
  return {
    ...regex,
    pass: regex.pass && !enforced,
    reasons: enforced ? [...regex.reasons, jev!.reason] : regex.reasons,
    mode,
    jev,
    jevFlagged
  }
}

/**
 * The full gate: regex floor first, then Jev. A regex block returns at once
 * and Jev is never asked — nothing it could say would change the outcome.
 */
export async function runCopyrightGateWithJev(
  input: JevIpInput,
  opts: { fetchImpl?: JevFetch; mode?: JevIpMode } = {}
): Promise<JevGateResult> {
  const mode = opts.mode ?? jevIpMode()
  const regex = runCopyrightGate(input)
  if (!regex.pass || mode === 'off') return { ...regex, mode, jevFlagged: false }
  const decisions = await classifyIpCached({ one: input }, { fetchImpl: opts.fetchImpl })
  return combine(regex, decisions.one, mode)
}

/** The design prompt lives under a few metadata keys depending on which pipeline made the product. */
export function designPromptOf(metadata: any): string | undefined {
  const m = metadata || {}
  const v = m.original_prompt || m.image_prompt || m.tailored_prompt
  return typeof v === 'string' && v.trim() ? v : undefined
}
