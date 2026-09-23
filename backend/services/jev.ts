// ---------------------------------------------------------------------------
// Jev — the decision lane (TypeSafe jev-1.13 on OpenRouter's alpha DECISIONS
// endpoint). Text in, typed decisions out, each with a confidence. It writes no
// prose, so it is for "which of these known options" questions asked in bulk —
// here, grading listing copy before the expensive vision reviewer runs.
//
// Three rules from the fleet's jev-decisions skill, each learned the hard way:
//   1. Never ask its yes/no type ("noul") — it is mush. Ask a `choice` with a
//      written description per option.
//   2. `score` criteria is a RUBRIC ARRAY, low to high, and the answer is a
//      float INDEX into it (a 4-rung rubric answers 0-3).
//   3. Gate on confidence. Under the bar means "no opinion", never a default.
//
// Single provider, no fallback, so this fails OPEN: any error returns null and
// the caller carries on exactly as it would without Jev. Kill switch: JEV=off.
// ---------------------------------------------------------------------------

export const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
export const JEV_MODEL = process.env.JEV_MODEL || 'typesafe/jev-1.13'

export interface JevChoiceQuestion {
  type: 'choice'
  instructions: string
  /** option key -> what choosing it means */
  criteria: Record<string, string>
}

export interface JevScoreQuestion {
  type: 'score'
  instructions: string
  /** rubric, lowest rung first */
  criteria: string[]
}

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion

export interface JevChoiceAnswer { type: 'choice'; choice: string; confidence: number }
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
 * Ask Jev a batch of questions about one `state`. Returns null — never throws —
 * on a missing key, the kill switch, a non-200, a timeout or a malformed body.
 */
export async function askJev(
  state: Record<string, unknown>,
  questions: Record<string, JevQuestion>,
  opts: { timeoutMs?: number } = {}
): Promise<JevResult | null> {
  if (!jevEnabled() || !Object.keys(questions).length) return null
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? Number(process.env.JEV_TIMEOUT_MS || 8000))
  try {
    const res = await transport(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: controller.signal
    })
    if (!res.ok) {
      console.warn(`[jev] HTTP ${res.status}`)
      return null
    }
    const body: any = await res.json()
    if (!body || typeof body.answers !== 'object' || !body.answers) return null
    return {
      answers: body.answers,
      usage: {
        input_tokens: Number(body.usage?.input_tokens ?? 0),
        output_tokens: Number(body.usage?.output_tokens ?? 0),
        cost: Number(body.usage?.cost ?? 0)
      },
      model: String(body.model ?? JEV_MODEL),
      durationMs: Date.now() - started
    }
  } catch (err: any) {
    console.warn(`[jev] call failed (${err?.name === 'AbortError' ? 'timeout' : err?.message || err})`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** A choice answer, or undefined when it is missing, off-menu or under the bar. */
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
