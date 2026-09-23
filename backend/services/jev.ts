// Jev — the decision lane (TypeSafe's typesafe/jev-1.13 on OpenRouter's alpha
// DECISIONS endpoint). Text in, typed choices out, each with a confidence.
//
// It is NOT a chat model: it lives on /api/alpha/decisions, writes no prose,
// and answers `choice` questions (key → written description of that option)
// or `score` questions (a rubric array, answered as an index). Measured on the
// fleet board: 315 decisions in 2.1s for $0.0028.
//
// Rules this client enforces for every caller (David 2026-09-23):
//   • Always a multi-option `choice` with a written description per option —
//     never a yes/no. Jev's yes/no type came back as mush (0.26-0.65 on
//     obvious cases); the same question as a described 3-way choice hit 0.96+.
//   • Gate on confidence. Under the bar is NO OPINION, never a default —
//     `pickChoice` returns undefined, and the caller falls through to its
//     deterministic path.
//   • Single provider, no fallback: every failure resolves to null. Callers
//     must fail OPEN.
//   • Jev decides, it never acts. Nothing here writes anywhere.
//
// Kill switch: JEV=off.

export const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
export const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13'

export interface JevChoiceQuestion<K extends string = string> {
  type: 'choice'
  instructions: string
  /** Option key → what choosing it means. Every option gets a real description. */
  criteria: Record<K, string>
}

export interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities?: Record<string, number>
  confidence: number
}

export interface JevResult {
  answers: Record<string, JevChoiceAnswer | { type: string; [k: string]: unknown }>
  model?: string
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number }
}

export const jevEnabled = (): boolean =>
  String(process.env.JEV ?? '').toLowerCase() !== 'off' && Boolean(process.env.OPENROUTER_API_KEY)

/**
 * Ask Jev a batch of questions about one free-form `state`. Never throws —
 * null on no key, kill switch, HTTP error, timeout or a malformed body.
 */
export async function askJev(
  state: Record<string, unknown>,
  questions: Record<string, JevChoiceQuestion>,
  opts: { timeoutMs?: number; model?: string } = {}
): Promise<JevResult | null> {
  if (!jevEnabled() || !Object.keys(questions).length) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6000)
  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://imaginethisprinted.com',
        'X-Title': 'Imagine This Printed - Jev decisions',
      },
      body: JSON.stringify({ model: opts.model ?? process.env.JEV_MODEL ?? DEFAULT_JEV_MODEL, state, questions }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.warn(`[jev] decisions call returned ${res.status}`)
      return null
    }
    const body: any = await res.json()
    return body && typeof body.answers === 'object' && body.answers ? (body as JevResult) : null
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

/** `readChoice` gated on confidence — undefined (no opinion) under the bar. */
export function pickChoice<K extends string>(
  result: JevResult | null | undefined,
  key: string,
  options: readonly K[],
  minConfidence: number
): K | undefined {
  const read = readChoice(result, key, options)
  return read && read.confidence >= minConfidence ? read.choice : undefined
}
