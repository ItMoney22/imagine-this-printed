// Step Flow — Step 1 "Idea → best prompt" writing brain.
//
// David 2026-09-01: type or speak one idea; the system writes the best prompt
// and picks a plain white-or-black render background (never a checkerboard,
// never a pattern — that's what fooled the QA gate's print_background
// criterion, see docs/plans/2026-09-01-imagine-studio-step-flow-design.md §3).
// gpt-image-2 has no alpha channel, so a SOLID background is what makes the
// later rembg pass clean; a "transparent-looking" checkerboard render bakes a
// painted pattern into the art instead of real transparency.
//
// Same OpenRouter-or-OpenAI client pattern as services/imagine-brain.ts:
// gemini-2.5-flash via OpenRouter when available (cheap text job, separate
// wallet from the OpenAI image budget), OPENAI_TEXT_MODEL otherwise.
//
// Phrase step (design doc §11, David 2026-09-02): "add a phrase to this
// design then a agent thinks of catchy phrase based on the design before gpt
// does the image ... add Mrs Imagine to this step". Mrs. Imagine's pitch
// lives in ./phrases.ts; this file only has to (a) carry the picked phrase on
// StepBrief and (b) guarantee the exact quoted text reaches designPrompt — on
// BOTH the model-written path and the deterministic fallback path, so a
// picked phrase can never silently go missing from the render.

import OpenAI from 'openai'
import { normalizeGarment, type GarmentId } from '../../shared/catalog-capability.js'

// Matches ASCII control characters (C0 range + DEL). Built via RegExp(...)
// rather than a /[...]/  literal so no raw control bytes ever have to live in
// this source file.
/** Drop ASCII control characters (C0 range + DEL) by code point — no control-char regex class needed (eslint no-control-regex). */
const stripControlChars = (text: string): string =>
  Array.from(text).filter((ch) => { const c = ch.codePointAt(0) ?? 0; return !(c <= 0x1f || c === 0x7f) }).join('')

export type PhrasePlacement = 'below' | 'above' | 'integrated'

export interface StepBriefPhrase {
  text: string
  placement: PhrasePlacement
}

export interface StepBrief {
  /** The full prompt handed to gpt-image-2. */
  designPrompt: string
  /** Solid render background — rembg strips it into a transparent PNG. */
  background: 'white' | 'black'
  /** Working product title. */
  title: string
  styleTags: string[]
  garmentHint: GarmentId
  /** One sentence: why this background / style. */
  rationale: string
  /** The phrase David picked (from Mrs. Imagine's pitch, or typed himself), if any. */
  phrase?: StepBriefPhrase
}

/**
 * Trim, collapse internal whitespace, strip control characters, and cap
 * length — the exact sanitize contract for an incoming phrase (design doc
 * §11: "Sanitize the phrase (trim, collapse whitespace, max 60 chars, strip
 * control chars)"). Exported for phrases.ts / the route layer to reuse the
 * same rule instead of re-implementing it.
 */
export function sanitizePhraseText(raw: unknown, maxLen = 60): string {
  if (typeof raw !== 'string') return ''
  return stripControlChars(raw)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/** Coerces a loosely-typed `{ text, placement? }` body into a clean StepBriefPhrase, or undefined when there's nothing usable. */
function coercePhraseInput(input: unknown): StepBriefPhrase | undefined {
  if (!input || typeof input !== 'object') return undefined
  const text = sanitizePhraseText((input as any).text)
  if (!text) return undefined
  const placementRaw = (input as any).placement
  const placement: PhrasePlacement = placementRaw === 'above' || placementRaw === 'integrated' ? placementRaw : 'below'
  return { text, placement }
}

/**
 * The exact-text render instruction (design doc §11). Built once and reused
 * so the model-written path and the fallback path produce byte-identical
 * wording for the same phrase.
 */
function phraseInstruction(phrase: StepBriefPhrase): string {
  return `Render the exact text "${phrase.text}" in bold, clean, highly legible lettering, spelled exactly as written, placed ${phrase.placement} the subject, part of the artwork on the same solid background.`
}

/** Appends the exact-text instruction to designPrompt (idempotent) and stamps `phrase` on the brief. */
function withPhrase(brief: StepBrief, phrase: StepBriefPhrase): StepBrief {
  const instruction = phraseInstruction(phrase)
  const designPrompt = brief.designPrompt.includes(instruction) ? brief.designPrompt : `${brief.designPrompt} ${instruction}`
  return { ...brief, designPrompt, phrase }
}

const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY

const client = new OpenAI(
  USE_OPENROUTER
    ? {
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://imaginethisprinted.com',
          'X-Title': 'Imagine Studio - Step Flow Brief',
        },
      }
    : { apiKey: process.env.OPENAI_API_KEY }
)

const MODEL = USE_OPENROUTER ? 'google/gemini-2.5-flash' : (process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-nano')
// gpt-5.x/o-series reasoning models reject a non-default `temperature` and the
// legacy `max_tokens` param — see imagine-brain.ts for the same guard.
const isReasoningModel = /^(o[1-9]|gpt-5)/.test(MODEL)

const SYSTEM_PROMPT = `You are a DTF (direct-to-film) transfer art director. Given a one-line design idea, write the single best image-generation prompt for a print-ready graphic, and pick the background that will contrast best with the art.

HARD RULES for the prompt you write:
1. Contained subject with a clean, print-ready silhouette — a bold, centered focal point, not a busy full scene.
2. Choose a SOLID background color, "white" or "black" — dark/moody art contrasts best on white; light/pastel art contrasts best on black. NEVER a gradient, a drop shadow, a checkerboard, any simulated/painted transparency, or a pattern of any kind.
3. NEVER include a garment, a mockup, a person, or any clothing in the described scene — this is artwork only, printed onto a shirt LATER.
4. NO text/words/letters in the design UNLESS the idea explicitly asks for text — if it does, spell the requested text out EXACTLY in the prompt.
5. Square 1:1 composition.

Respond with STRICT JSON and nothing else, in exactly this shape:
{"designPrompt": string, "background": "white"|"black", "title": string, "styleTags": string[], "garmentHint": "tshirt"|"hoodie", "rationale": string}

- "designPrompt": the full prompt to hand to the image model. Must explicitly state the solid background color and explicitly forbid gradients, drop shadows, checkerboards, and painted transparency.
- "background": "white" or "black" — must match the background named in designPrompt.
- "title": a short working product title (max 80 chars).
- "styleTags": 2-6 short style/vibe tags.
- "garmentHint": "tshirt" or "hoodie" — whichever the idea reads as more suited to; default "tshirt" when unclear.
- "rationale": ONE sentence explaining why this background/style choice.`

/** Strip ```json fences / stray prose and parse the first JSON object found. */
function parseJsonLoose(raw: string | null | undefined): any {
  if (!raw) return null
  let txt = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = txt.indexOf('{')
  const end = txt.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(txt.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Deterministic fallback used whenever the writing brain call fails (network,
 * bad key, non-JSON reply). Always white background + tee — a safe default
 * that still passes the QA gate's solid-background rule.
 */
export function fallbackBrief(idea: string): StepBrief {
  const trimmed = (idea || '').trim() || 'a custom design'
  return {
    designPrompt: [
      `${trimmed}.`,
      `Standalone graphic illustration, isolated subject with a clean, bold silhouette, centered composition.`,
      `Rendered on a SOLID, FLAT white background — no gradients, no drop shadows, no checkerboard pattern, no simulated or painted transparency.`,
      `No garment, no mockup, no person, no clothing in frame — artwork only.`,
      `Bold, high-contrast, print-ready style with clean edges. Square 1:1 composition.`,
    ].join(' '),
    background: 'white',
    title: trimmed.slice(0, 80),
    styleTags: [],
    garmentHint: 'tshirt',
    rationale: 'Fallback brief (writing brain unavailable): safe default of a white background and a tee.',
  }
}

/** Coerce a loosely-typed model reply into a well-formed StepBrief, falling back per-field. */
export function coerceBrief(idea: string, raw: any): StepBrief {
  const fb = fallbackBrief(idea)
  if (!raw || typeof raw !== 'object') return fb

  const designPrompt =
    typeof raw.designPrompt === 'string' && raw.designPrompt.trim() ? raw.designPrompt.trim() : fb.designPrompt
  const background: 'white' | 'black' = raw.background === 'black' ? 'black' : raw.background === 'white' ? 'white' : fb.background
  const title =
    typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 80) : fb.title
  const styleTags = Array.isArray(raw.styleTags)
    ? raw.styleTags.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 8)
    : []
  // Mrs. Imagine lost 'polo' the same way (Track A) — anything unrecognized
  // coerces to tshirt so a stray "polo"/"tank" reply from the model can never
  // reach a garment ITP doesn't offer.
  const garmentHint: GarmentId = normalizeGarment(raw.garmentHint) === 'hoodie' ? 'hoodie' : 'tshirt'
  const rationale =
    typeof raw.rationale === 'string' && raw.rationale.trim() ? raw.rationale.trim() : fb.rationale

  return { designPrompt, background, title, styleTags, garmentHint, rationale }
}

/**
 * Step 1 of the flow: idea → best prompt. Never throws — any failure (network,
 * bad key, malformed JSON) resolves to the deterministic fallback so the flow
 * always advances.
 *
 * `phrase` (design doc §11) is either David's own typed line or one Mrs.
 * Imagine pitched (services/step-flow/phrases.ts). When present, the model is
 * asked to write it into designPrompt — but `withPhrase` below APPENDS the
 * canonical exact-text instruction regardless of what the model produced (or
 * whether the model was reached at all), so the picked phrase is guaranteed
 * to reach the render on both the model-written path and the fallback path.
 */
export async function writeStepBrief(idea: string, opts?: { phrase?: unknown }): Promise<StepBrief> {
  const trimmed = (idea || '').trim()
  if (!trimmed) throw new Error('idea is required')
  const phrase = coercePhraseInput(opts?.phrase)

  let brief: StepBrief
  try {
    const userContent = phrase
      ? `${trimmed}\n\nInclude this exact phrase, spelled exactly as written, as legible text within the artwork: "${phrase.text}" (placement: ${phrase.placement} the subject).`
      : trimmed
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      ...(isReasoningModel ? { max_completion_tokens: 500 } : { temperature: 0.7, max_tokens: 500 }),
    })
    const raw = completion.choices[0]?.message?.content || ''
    const parsed = parseJsonLoose(raw)
    brief = coerceBrief(trimmed, parsed)
  } catch (err: any) {
    console.warn('[step-flow/brief] writing brain call failed, using fallback:', err?.message || err)
    brief = fallbackBrief(trimmed)
  }

  return phrase ? withPhrase(brief, phrase) : brief
}
