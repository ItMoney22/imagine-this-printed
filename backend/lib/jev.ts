// Jev — the decision lane (TypeSafe's typesafe/jev-1.13 on OpenRouter's alpha
// DECISIONS endpoint). Jev is text -> typed decisions: it takes free-form
// `state` plus a map of typed questions and returns one answer per question
// with a confidence. It writes no prose, so it is only ever asked to pick from
// a menu — every caller here asks a `choice` with a written description per
// option (the yes/no `noul` type measured as mush, see the jev-decisions skill).
//
// Single provider, no fallback: if TypeSafe is down the lane is down. So every
// function here FAILS OPEN — a missing key, an HTTP error, a timeout or a
// garbage body all return null, and the callers fall back to their
// deterministic rules. Nothing downstream may treat "no answer" as a verdict.
//
// Kill switch: JEV=off (or JEV_TRIAGE=off for just the triage callers).

export const JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
export const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13'

export interface JevChoiceQuestion {
  type: 'choice'
  instructions: string
  /** option key -> what that option means. Never a bare list of keys. */
  criteria: Record<string, string>
}

export interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  confidence: number
  probabilities?: Record<string, number>
}

export type JevAnswers = Record<string, JevChoiceAnswer | { type: string; confidence?: number; [k: string]: unknown }>

export interface JevResult {
  answers: JevAnswers
  usage: { input_tokens: number; output_tokens: number; cost: number }
  model?: string
}

/** The shape every triage caller depends on, so tests can inject a fake. */
export type AskJev = (state: Record<string, unknown>, questions: Record<string, JevChoiceQuestion>) => Promise<JevResult | null>

export function jevEnabled(): boolean {
  return process.env.JEV !== 'off' && Boolean(process.env.OPENROUTER_API_KEY)
}

/**
 * Ask Jev a batch of questions about one `state`. Chunked so one oversized
 * batch never loses everything — a failed chunk only costs its own keys.
 */
export async function askJev(
  state: Record<string, unknown>,
  questions: Record<string, JevChoiceQuestion>,
  opts: { timeoutMs?: number; maxQuestionsPerCall?: number; apiKey?: string } = {}
): Promise<JevResult | null> {
  const key = opts.apiKey ?? process.env.OPENROUTER_API_KEY
  if (!key || process.env.JEV === 'off') return null
  const entries = Object.entries(questions)
  if (!entries.length) return null

  const size = Math.max(1, opts.maxQuestionsPerCall ?? 60)
  const chunks: Record<string, JevChoiceQuestion>[] = []
  for (let i = 0; i < entries.length; i += size) chunks.push(Object.fromEntries(entries.slice(i, i + size)))

  const one = async (chunk: Record<string, JevChoiceQuestion>): Promise<JevResult | null> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000)
    try {
      const res = await fetch(JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.JEV_MODEL || DEFAULT_JEV_MODEL, state, questions: chunk }),
        signal: controller.signal,
      })
      if (!res.ok) return null
      const body: any = await res.json()
      return body && typeof body.answers === 'object' && body.answers ? body : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  const settled = await Promise.all(chunks.map(one))
  const answers: JevAnswers = {}
  const usage = { input_tokens: 0, output_tokens: 0, cost: 0 }
  let model: string | undefined
  for (const body of settled) {
    if (!body) continue
    Object.assign(answers, body.answers)
    usage.input_tokens += body.usage?.input_tokens ?? 0
    usage.output_tokens += body.usage?.output_tokens ?? 0
    usage.cost += body.usage?.cost ?? 0
    model ??= body.model
  }
  return model !== undefined || Object.keys(answers).length ? { answers, usage, model } : null
}

/**
 * Read one choice answer. Returns the choice AND its confidence when the
 * answer is well-formed and on the menu, else undefined — never a default.
 * Gating on the bar is the caller's job (it needs the confidence either way to
 * record why a row went to a human).
 */
export function readChoice<T extends string>(
  answers: JevAnswers | undefined,
  key: string,
  options: readonly T[]
): { choice: T; confidence: number } | undefined {
  const a = answers?.[key] as JevChoiceAnswer | undefined
  if (!a || a.type !== 'choice' || typeof a.confidence !== 'number') return undefined
  if (!(options as readonly string[]).includes(a.choice)) return undefined
  return { choice: a.choice as T, confidence: a.confidence }
}
