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
//
// Inspiration step (David 2026-09-02): "i need a spot in the step flow in
// the beginning that we can add inspiration upload a photo of a design mrs
// imagine will anaylze it and ask what we like ... she basically breaks down
// the whole design." The breakdown itself lives in ./inspiration.ts; this
// file only has to (a) carry the reference's provenance on StepBrief and (b)
// guarantee the final designPrompt reads as an ORIGINAL design "inspired
// by" the reference — never a reproduction, and with anything Mrs. Imagine
// flagged (a logo, brand mark, licensed character, celebrity likeness, or
// copied text) stripped via the Etsy copyright gate's denylist — on BOTH the
// model-written path and the deterministic fallback path, same guarantee
// `withPhrase` gives the phrase text.

import OpenAI from 'openai'
import { normalizeGarment, type GarmentId } from '../../shared/catalog-capability.js'
import { runCopyrightGate } from '../etsy-copyright-gate.js'
import {
  getLetteringStyle,
  isLetteringStyleId,
  DEFAULT_LETTERING_STYLE,
  type LetteringStyleId,
} from '../../shared/lettering-styles.js'
import type { InspirationBreakdown } from './inspiration.js'

// Matches ASCII control characters (C0 range + DEL). Built via RegExp(...)
// rather than a /[...]/  literal so no raw control bytes ever have to live in
// this source file.
/** Drop ASCII control characters (C0 range + DEL) by code point — no control-char regex class needed (eslint no-control-regex). */
const stripControlChars = (text: string): string =>
  Array.from(text).filter((ch) => { const c = ch.codePointAt(0) ?? 0; return !(c <= 0x1f || c === 0x7f) }).join('')

export type PhrasePlacement = 'below' | 'above' | 'integrated'

/** A product-kind hint (design doc §14): 'metal' switches the writing brain to full-bleed wall-art prompts instead of DTF garment art. Defaults to 'garment'. */
export type StepProductKind = 'garment' | 'metal'

export interface StepBriefPhrase {
  text: string
  placement: PhrasePlacement
  /**
   * Lettering style for the exact-text render instruction (design doc §16).
   * A concrete id embeds that style's `prompt` descriptor; 'auto' lets the
   * model pick a style that suits the artwork. Always populated once a
   * phrase is coerced — an unrecognized/missing value coerces to
   * DEFAULT_LETTERING_STYLE, the same "invalid input -> safe default"
   * pattern `placement` already uses.
   */
  style?: LetteringStyleId | 'auto'
}

/** Provenance stamped on StepBrief when this design was seeded by an inspiration reference — the slim record, not the full breakdown (see StepFlowInspiration for that). */
export interface StepBriefInspiration {
  imageUrl: string
  keep: string[]
  change: Record<string, string>
}

/** The full inspiration record — reference photo + Mrs. Imagine's breakdown + the admin's keep/change choices — as accepted by writeStepBrief's `opts.inspiration`. */
export interface StepFlowInspiration {
  imageUrl: string
  breakdown: InspirationBreakdown
  choices: { keep: string[]; change: Record<string, string> }
}

export interface StepBrief {
  /** The full prompt handed to gpt-image-2. */
  designPrompt: string
  /**
   * Solid render background — rembg strips it into a transparent PNG.
   * Metal briefs (productKind:'metal') carry a placeholder value here
   * ('white') since metal art has no rembg step and no solid-background
   * rule; downstream metal code paths never read it.
   */
  background: 'white' | 'black'
  /** Working product title. */
  title: string
  styleTags: string[]
  /** Placeholder ('tshirt') for metal briefs — unused downstream since metal has no Garments step. */
  garmentHint: GarmentId
  /** One sentence: why this background / style. */
  rationale: string
  /** 'metal' switches the writing brain + downstream Step Flow routes to the wall-art lane (design doc §14). Defaults to 'garment'. */
  productKind: StepProductKind
  /** The phrase David picked (from Mrs. Imagine's pitch, or typed himself), if any. */
  phrase?: StepBriefPhrase
  /** The inspiration reference this design was seeded from, if any (design doc §12: never a reproduction — see withInspiration below). */
  inspiration?: StepBriefInspiration
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

/** Coerces a loosely-typed `{ text, placement?, style? }` body into a clean StepBriefPhrase, or undefined when there's nothing usable. */
function coercePhraseInput(input: unknown): StepBriefPhrase | undefined {
  if (!input || typeof input !== 'object') return undefined
  const text = sanitizePhraseText((input as any).text)
  if (!text) return undefined
  const placementRaw = (input as any).placement
  const placement: PhrasePlacement = placementRaw === 'above' || placementRaw === 'integrated' ? placementRaw : 'below'
  const styleRaw = (input as any).style
  const style: LetteringStyleId | 'auto' =
    styleRaw === 'auto' ? 'auto' : isLetteringStyleId(styleRaw) ? styleRaw : DEFAULT_LETTERING_STYLE
  return { text, placement, style }
}

/** The "in <style>" clause of the exact-text instruction (design doc §16). 'auto' lets the model pick a style that suits the artwork. */
function letteringStyleClause(style: LetteringStyleId | 'auto' | undefined): string {
  if (style === 'auto') return 'in a lettering style that matches the artwork'
  const resolved = getLetteringStyle(style) ?? getLetteringStyle(DEFAULT_LETTERING_STYLE)!
  return `in ${resolved.prompt}`
}

/**
 * The exact-text render instruction (design doc §11). Built once and reused
 * so the model-written path and the fallback path produce byte-identical
 * wording for the same phrase.
 */
function phraseInstruction(phrase: StepBriefPhrase): string {
  return `Render the exact text "${phrase.text}" ${letteringStyleClause(phrase.style)}, spelled exactly as written, placed ${phrase.placement} the subject, part of the artwork on the same solid background.`
}

/** Appends the exact-text instruction to designPrompt (idempotent) and stamps `phrase` on the brief. */
function withPhrase(brief: StepBrief, phrase: StepBriefPhrase): StepBrief {
  const instruction = phraseInstruction(phrase)
  const designPrompt = brief.designPrompt.includes(instruction) ? brief.designPrompt : `${brief.designPrompt} ${instruction}`
  return { ...brief, designPrompt, phrase }
}

// ---------------------------------------------------------------------------
// Inspiration step (design doc §12, David 2026-09-02). `opts.inspiration`
// comes straight off the request body (services/step-flow/inspiration.ts's
// analysis result + the admin's keep/change choices) — loosely typed, so it
// is coerced defensively the same way coercePhraseInput handles `phrase`.
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Strips any term the Etsy copyright gate's denylist matches (reused, as
 * phrases.ts's passesCopyrightGate does) — the safety net that guarantees a
 * flagged brand/franchise/celebrity name can never survive into designPrompt
 * or title, no matter what the model actually wrote.
 */
function stripDenylistedTerms(text: string): string {
  const result = runCopyrightGate({ name: text })
  if (result.pass) return text
  let cleaned = text
  for (const term of result.matchedTerms) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi'), 'an original element')
  }
  return cleaned.replace(/\s+/g, ' ').trim()
}

/** Coerces a loosely-typed `{ imageUrl, breakdown?, choices? }` body into a clean StepFlowInspiration, or undefined when there's no usable imageUrl. */
function coerceInspirationInput(input: unknown): StepFlowInspiration | undefined {
  if (!input || typeof input !== 'object') return undefined
  const obj = input as any
  const imageUrl = typeof obj.imageUrl === 'string' ? obj.imageUrl.trim() : ''
  if (!imageUrl) return undefined

  const rawBreakdown = obj.breakdown && typeof obj.breakdown === 'object' ? obj.breakdown : {}
  const breakdown: InspirationBreakdown = {
    subject: typeof rawBreakdown.subject === 'string' ? rawBreakdown.subject : '',
    style: typeof rawBreakdown.style === 'string' ? rawBreakdown.style : '',
    palette: Array.isArray(rawBreakdown.palette) ? rawBreakdown.palette.filter((p: unknown): p is string => typeof p === 'string') : [],
    text: typeof rawBreakdown.text === 'string' ? rawBreakdown.text : null,
    composition: typeof rawBreakdown.composition === 'string' ? rawBreakdown.composition : '',
    mood: typeof rawBreakdown.mood === 'string' ? rawBreakdown.mood : '',
    techniques: Array.isArray(rawBreakdown.techniques) ? rawBreakdown.techniques.filter((t: unknown): t is string => typeof t === 'string') : [],
    whatWorks: Array.isArray(rawBreakdown.whatWorks) ? rawBreakdown.whatWorks.filter((t: unknown): t is string => typeof t === 'string') : [],
    flags: Array.isArray(rawBreakdown.flags) ? rawBreakdown.flags.filter((t: unknown): t is string => typeof t === 'string') : [],
  }

  const rawChoices = obj.choices && typeof obj.choices === 'object' ? obj.choices : {}
  const keep: string[] = Array.isArray(rawChoices.keep)
    ? rawChoices.keep.filter((k: unknown): k is string => typeof k === 'string' && k.trim().length > 0)
    : []
  const change: Record<string, string> = {}
  if (rawChoices.change && typeof rawChoices.change === 'object') {
    for (const [key, value] of Object.entries(rawChoices.change)) {
      if (typeof value === 'string' && value.trim()) change[key] = stripControlChars(value).replace(/\s+/g, ' ').trim().slice(0, 200)
    }
  }

  return { imageUrl, breakdown, choices: { keep, change } }
}

const INSPIRATION_CLAUSE_MARKER = 'original artwork inspired by'

/** Builds the natural-language user content describing the breakdown + choices, so the writing brain has full context without needing its own vision call. */
function buildInspirationUserContent(inspiration: StepFlowInspiration): string {
  const { breakdown, choices } = inspiration
  const lines = ["This design takes inspiration from a reference image Mrs. Imagine already broke down:"]
  if (breakdown.subject) lines.push(`- Subject: ${breakdown.subject}`)
  if (breakdown.style) lines.push(`- Style: ${breakdown.style}`)
  if (breakdown.palette.length) lines.push(`- Palette: ${breakdown.palette.join(', ')}`)
  if (breakdown.composition) lines.push(`- Composition: ${breakdown.composition}`)
  if (breakdown.mood) lines.push(`- Mood: ${breakdown.mood}`)
  if (breakdown.text) lines.push(`- Text detected in the reference: "${breakdown.text}"`)
  if (breakdown.flags.length) {
    lines.push(`- FLAGGED (must NOT be reproduced — replace each with an original equivalent): ${breakdown.flags.join('; ')}`)
  }
  lines.push(`- Admin wants to KEEP: ${choices.keep.length ? choices.keep.join(', ') : 'nothing specified'}`)
  const changeEntries = Object.entries(choices.change)
  lines.push(`- Admin wants to CHANGE: ${changeEntries.length ? changeEntries.map(([k, v]) => `${k} -> ${v}`).join(', ') : 'nothing specified'}`)
  lines.push(
    `HARD RULE: designPrompt must describe an ORIGINAL design only "inspired by" this reference — never a reproduction. Never name or describe any flagged element; replace it with an original equivalent. Include a short clause in designPrompt stating this is an original artwork inspired by the reference, not a copy.`
  )
  return lines.join('\n')
}

/** The exact-wording "not a reproduction" clause appended to designPrompt whenever inspiration is present. */
function buildInspirationClause(inspiration: StepFlowInspiration): string {
  const kept = inspiration.choices.keep.length ? inspiration.choices.keep.join(', ') : 'its style and composition'
  return `This is an original artwork inspired by a reference image — keeping ${kept} in spirit — and is NOT a reproduction: no logos, brand marks, licensed characters, celebrity likeness, or copied text from the reference.`
}

/**
 * Guarantees the final brief reads as an original design inspired by (never
 * a copy of) the reference: appends the "original artwork inspired by"
 * clause (idempotent — checked by marker text, same pattern as withPhrase)
 * and strips any denylisted term from BOTH designPrompt and title, so a
 * flagged brand/franchise/celebrity name can never survive regardless of
 * what the model-written or fallback path produced.
 */
function withInspiration(brief: StepBrief, inspiration: StepFlowInspiration): StepBrief {
  const clause = buildInspirationClause(inspiration)
  const hasClause = brief.designPrompt.toLowerCase().includes(INSPIRATION_CLAUSE_MARKER)
  const designPrompt = stripDenylistedTerms(hasClause ? brief.designPrompt : `${brief.designPrompt} ${clause}`)
  const title = stripDenylistedTerms(brief.title)
  return {
    ...brief,
    designPrompt,
    title,
    inspiration: { imageUrl: inspiration.imageUrl, keep: inspiration.choices.keep, change: inspiration.choices.change },
  }
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
6. If the user content includes a design breakdown of a reference image ("This design takes inspiration from a reference image"), treat it ONLY as inspiration for style/composition/palette/mood — write an ORIGINAL design, never a reproduction, never include anything listed as FLAGGED, and explicitly state in designPrompt that this is an original artwork inspired by the reference, not a copy.

Respond with STRICT JSON and nothing else, in exactly this shape:
{"designPrompt": string, "background": "white"|"black", "title": string, "styleTags": string[], "garmentHint": "tshirt"|"hoodie", "rationale": string}

- "designPrompt": the full prompt to hand to the image model. Must explicitly state the solid background color and explicitly forbid gradients, drop shadows, checkerboards, and painted transparency.
- "background": "white" or "black" — must match the background named in designPrompt.
- "title": a short working product title (max 80 chars).
- "styleTags": 2-6 short style/vibe tags.
- "garmentHint": "tshirt" or "hoodie" — whichever the idea reads as more suited to; default "tshirt" when unclear.
- "rationale": ONE sentence explaining why this background/style choice.`

// Metal wall-art lane (design doc §14, David 2026-09-02) — a completely
// different art direction from the DTF garment prompt above: a full-bleed
// gallery scene that fills the panel edge to edge, not an isolated cut-out
// subject on a solid background. No rembg step exists for metal (there is no
// transparency to extract), so this system prompt asks for neither a
// background color nor a garmentHint — StepBrief still carries placeholder
// values for those fields (see coerceMetalBrief) purely for type-shape
// stability; nothing downstream reads them for a metal product.
const METAL_SYSTEM_PROMPT = `You are an art director for premium metal wall-art prints. Given a one-line idea, write the single best image-generation prompt for a museum-quality, full-bleed fine-art panel.

HARD RULES for the prompt you write:
1. A COMPLETE scene composed full-bleed, edge to edge, filling the entire frame — never an isolated cut-out subject floating on a background, never a logo/icon-style composition.
2. Photographic or painterly realism, rich detail, considered lighting and color palette — we get realism throughout.
3. Portrait 2:3 composition (the physical panel is portrait) — state this explicitly in designPrompt.
4. NEVER describe a solid-color background, a checkerboard, transparency, a garment, a mockup, a frame, or a border — this is a complete standalone art image, not artwork isolated for later placement.
5. NO text/words/letters in the design UNLESS the idea explicitly asks for text — if it does, spell the requested text out EXACTLY in the prompt.
6. If the user content includes a design breakdown of a reference image ("This design takes inspiration from a reference image"), treat it ONLY as inspiration for style/composition/palette/mood — write an ORIGINAL design, never a reproduction, never include anything listed as FLAGGED, and explicitly state in designPrompt that this is an original artwork inspired by the reference, not a copy.

Respond with STRICT JSON and nothing else, in exactly this shape:
{"designPrompt": string, "title": string, "styleTags": string[], "rationale": string}

- "designPrompt": the full prompt to hand to the image model — a complete, full-bleed, portrait 2:3 fine-art scene.
- "title": a short working product title (max 80 chars).
- "styleTags": 2-6 short style/vibe tags.
- "rationale": ONE sentence explaining the art direction.`

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
    productKind: 'garment',
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

  return { designPrompt, background, title, styleTags, garmentHint, rationale, productKind: 'garment' }
}

/**
 * Deterministic fallback for the metal wall-art lane (design doc §14) — used
 * whenever the writing brain call fails for a metal brief. A full-bleed
 * portrait scene description; never a solid-background/garment brief like
 * fallbackBrief above.
 */
export function fallbackMetalBrief(idea: string): StepBrief {
  const trimmed = (idea || '').trim() || 'a custom design'
  return {
    designPrompt: [
      `${trimmed}.`,
      'A complete, full-bleed fine-art scene composed edge to edge, filling the entire frame — not an isolated cut-out subject.',
      'Photographic or painterly realism, rich detail, cinematic lighting and a considered color palette.',
      'Portrait 2:3 composition, fills the frame — no border, no vignette, no letterboxing, no solid-color margin.',
      'No garment, no mockup, no product in frame — standalone wall-art imagery only.',
      'No text or lettering unless explicitly requested.',
    ].join(' '),
    background: 'white',
    title: trimmed.slice(0, 80),
    styleTags: [],
    garmentHint: 'tshirt',
    rationale: 'Fallback metal wall-art brief (writing brain unavailable): full-bleed portrait scene.',
    productKind: 'metal',
  }
}

/** Coerce a loosely-typed model reply into a well-formed metal StepBrief, falling back per-field. */
export function coerceMetalBrief(idea: string, raw: any): StepBrief {
  const fb = fallbackMetalBrief(idea)
  if (!raw || typeof raw !== 'object') return fb

  const designPrompt =
    typeof raw.designPrompt === 'string' && raw.designPrompt.trim() ? raw.designPrompt.trim() : fb.designPrompt
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 80) : fb.title
  const styleTags = Array.isArray(raw.styleTags)
    ? raw.styleTags.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 8)
    : []
  const rationale =
    typeof raw.rationale === 'string' && raw.rationale.trim() ? raw.rationale.trim() : fb.rationale

  return { designPrompt, background: fb.background, title, styleTags, garmentHint: fb.garmentHint, rationale, productKind: 'metal' }
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
 *
 * `inspiration` (design doc §12) is the result of services/step-flow/
 * inspiration.ts's breakdown plus the admin's keep/change choices. When
 * present, the model is given the breakdown as context — but `withInspiration`
 * below APPENDS the "original artwork inspired by" clause and strips any
 * denylisted term regardless of what the model produced (or whether the
 * model was reached at all), so the design can never read as a reproduction
 * on either the model-written path or the fallback path.
 *
 * `productKind` (design doc §14) switches the writing brain (and its
 * fallback) to the metal wall-art lane — a full-bleed portrait scene
 * instead of an isolated cut-out on a solid background. Defaults to
 * 'garment' when omitted/unrecognized.
 */
export async function writeStepBrief(
  idea: string,
  opts?: { phrase?: unknown; inspiration?: unknown; productKind?: unknown }
): Promise<StepBrief> {
  const trimmed = (idea || '').trim()
  if (!trimmed) throw new Error('idea is required')
  const phrase = coercePhraseInput(opts?.phrase)
  const inspiration = coerceInspirationInput(opts?.inspiration)
  const productKind: StepProductKind = opts?.productKind === 'metal' ? 'metal' : 'garment'
  const isMetal = productKind === 'metal'

  let brief: StepBrief
  try {
    let userContent = phrase
      ? `${trimmed}\n\nInclude this exact phrase, spelled exactly as written, as legible text within the artwork: "${phrase.text}" (placement: ${phrase.placement} the subject).`
      : trimmed
    if (inspiration) {
      userContent = `${userContent}\n\n${buildInspirationUserContent(inspiration)}`
    }
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: isMetal ? METAL_SYSTEM_PROMPT : SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      ...(isReasoningModel ? { max_completion_tokens: 500 } : { temperature: 0.7, max_tokens: 500 }),
    })
    const raw = completion.choices[0]?.message?.content || ''
    const parsed = parseJsonLoose(raw)
    brief = isMetal ? coerceMetalBrief(trimmed, parsed) : coerceBrief(trimmed, parsed)
  } catch (err: any) {
    console.warn('[step-flow/brief] writing brain call failed, using fallback:', err?.message || err)
    brief = isMetal ? fallbackMetalBrief(trimmed) : fallbackBrief(trimmed)
  }

  if (phrase) brief = withPhrase(brief, phrase)
  if (inspiration) brief = withInspiration(brief, inspiration)
  return brief
}
