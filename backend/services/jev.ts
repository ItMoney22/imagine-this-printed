// Jev — the decision lane (TypeSafe's typesafe/jev-1.13 on OpenRouter's alpha
// DECISIONS endpoint). Text in, typed choices out, each with a confidence.
//
// It is NOT a chat model: it lives on /api/alpha/decisions, writes no prose,
// and answers `choice` questions (key → written description of that option)
// or `score` questions (a rubric array, answered as an index). Measured on the
// fleet board: 315 decisions in 2.1s for $0.0028.
//
// Rules this client enforces for every caller (David 2026-09-23, and the
// fleet's jev-decisions skill):
//   • Always a multi-option `choice` with a written description per option —
//     never a yes/no. Jev's yes/no type came back as mush (0.26-0.65 on
//     obvious cases); the same question as a described 3-way choice hit 0.96+.
//   • `score` criteria is a RUBRIC ARRAY, low to high, and the answer is a
//     float INDEX into it (a 4-rung rubric answers 0-3).
//   • Gate on confidence. Under the bar is NO OPINION, never a default —
//     `readChoice`/`pickChoice`/`readScore` return undefined, and the caller
//     falls through to its deterministic path.
//   • Single provider, no fallback: every failure resolves to null. Callers
//     must fail OPEN.
//   • Jev decides, it never acts. Nothing here writes anywhere.
//
// Two callers grew their own copy of this file on parallel branches (Step Flow
// casting on main, presentation copy QA on the Jev QA branch); the 2026-10-12
// merge batch (task e14d239c) folded them into this one client.
//
// Kill switch: JEV=off.

export const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
export const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13'
export const JEV_MODEL = process.env.JEV_MODEL || DEFAULT_JEV_MODEL

export interface JevChoiceQuestion<K extends string = string> {
  type: 'choice'
  instructions: string
  /** Option key → what choosing it means. Every option gets a real description. */
  criteria: Record<K, string>
}

export interface JevScoreQuestion {
  type: 'score'
  instructions: string
  /** rubric, lowest rung first */
  criteria: string[]
}

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion

export interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities?: Record<string, number>
  confidence: number
}

export interface JevScoreAnswer { type: 'score'; score: number; confidence: number }

export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | { type: string; confidence?: number; [k: string]: unknown }

export interface JevResult {
  answers: Record<string, JevAnswer>
  usage: { input_tokens: number; output_tokens: number; cost: number }
  model: string
  durationMs: number
}

export const jevEnabled = (): boolean =>
  String(process.env.JEV ?? '').toLowerCase() !== 'off' && Boolean(process.env.OPENROUTER_API_KEY)

/** Test seam: swap the transport without mocking the global fetch. */
type Fetch = typeof fetch
let transport: Fetch = (...args) => fetch(...args)
export function setJevTransport(next: Fetch | null): void {
  transport = next ?? ((...args) => fetch(...args))
}

/**
 * Ask Jev a batch of questions about one free-form `state`. Never throws —
 * null on no key, kill switch, HTTP error, timeout or a malformed body.
 */
export async function askJev(
  state: Record<string, unknown>,
  questions: Record<string, JevQuestion>,
  opts: { timeoutMs?: number; model?: string } = {}
): Promise<JevResult | null> {
  if (!jevEnabled() || !Object.keys(questions).length) return null
  const started = Date.now()
  const model = opts.model ?? JEV_MODEL
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? Number(process.env.JEV_TIMEOUT_MS || 8000))
  try {
    const res = await transport(JEV_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://imaginethisprinted.com',
        'X-Title': 'Imagine This Printed - Jev decisions',
      },
      body: JSON.stringify({ model, state, questions }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.warn(`[jev] decisions call returned ${res.status}`)
      return null
    }
    const body: any = await res.json()
    if (!body || typeof body.answers !== 'object' || !body.answers) return null
    return {
      answers: body.answers,
      usage: {
        input_tokens: Number(body.usage?.input_tokens ?? 0),
        output_tokens: Number(body.usage?.output_tokens ?? 0),
        cost: Number(body.usage?.cost ?? 0),
      },
      model: String(body.model ?? model),
      durationMs: Date.now() - started,
    }
  } catch (err: any) {
    console.warn('[jev] decisions call failed:', err?.name === 'AbortError' ? 'timeout' : err?.message || err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** One choice answer, read strictly: the right type, an offered option, a numeric confidence. */
export function readChoice<K extends string>(
  result: JevResult | null | undefined,
  key: string,
  options: readonly K[]
): { choice: K; confidence: number } | undefined {
  const a = result?.answers?.[key] as JevChoiceAnswer | undefined
  if (!a || a.type !== 'choice' || typeof a.confidence !== 'number') return undefined
  if (!(options as readonly string[]).includes(a.choice)) return undefined
  return { choice: a.choice as K, confidence: a.confidence }
}

/** A choice off an answers map, or undefined when it is missing, off-menu or under the bar. */
export function pickChoice<T extends string>(
  answers: Record<string, JevAnswer> | null | undefined,
  key: string,
  options: readonly T[],
  minConfidence: number
): T | undefined {
  const a = answers?.[key] as JevChoiceAnswer | undefined
  if (!a || a.type !== 'choice' || typeof a.confidence !== 'number' || a.confidence < minConfidence) return undefined
  return (options as readonly string[]).includes(a.choice) ? (a.choice as T) : undefined
}

/** A score answer as its rubric INDEX, or undefined when missing or under the bar. */
export function readScore(
  answers: Record<string, JevAnswer> | null | undefined,
  key: string,
  minConfidence: number
): number | undefined {
  const a = answers?.[key] as JevScoreAnswer | undefined
  if (!a || a.type !== 'score' || typeof a.confidence !== 'number' || a.confidence < minConfidence) return undefined
  return typeof a.score === 'number' && Number.isFinite(a.score) ? a.score : undefined
}

/** The raw confidence on any answer (0 when absent) — for "was it sure" reporting. */
export const confidenceOf = (answers: Record<string, JevAnswer> | null | undefined, key: string): number =>
  typeof answers?.[key]?.confidence === 'number' ? (answers[key].confidence as number) : 0
