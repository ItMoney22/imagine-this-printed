// Step Flow — Phrase step (design doc §11, David 2026-09-02):
// "add a phrase to this design then a agent thinks of catchy phrase based on
// the design before gpt does the image ... add Mrs Imagine to this step i
// dont want her creating designs on her own anymore but i do like this new
// stepflow."
//
// Mrs. Imagine's ONLY job in the product line now is pitching inside Step 1
// (idea -> phrase -> best prompt), never generating a product unattended —
// see worker/mrs-imagine-daily.ts for the other half of that change (her
// daily autonomous batch is off unless explicitly re-enabled).
//
// Same OpenRouter-or-OpenAI writing-brain pattern as ./brief.ts: cheap
// gemini-2.5-flash via OpenRouter when available, OPENAI_TEXT_MODEL
// otherwise. Never throws — a failed/unusable call resolves to a
// deterministic fallback so the phrase step always has something to show.

import OpenAI from 'openai'
import sharp from 'sharp'
import { runCopyrightGate } from '../etsy-copyright-gate.js'
import { isLetteringStyleId, type LetteringStyleId } from '../../shared/lettering-styles.js'
import type { StepBrief, PhrasePlacement } from './brief.js'

export interface MrsImaginePhrase {
  text: string
  vibe: 'funny' | 'hype' | 'wholesome' | 'minimal' | 'pun'
  placement: PhrasePlacement
  reason: string
  /**
   * Lettering style Mrs. Imagine thinks fits this phrase (design doc §16) —
   * feeds straight into StepBriefPhrase.style once picked. Always a real
   * style id, never 'auto': an invalid/missing model reply coerces to
   * `defaultStyleForVibe(vibe)`, never dropped.
   */
  suggestedStyle: LetteringStyleId
}

/** Deterministic vibe -> lettering-style fallback (design doc §16), used both to coerce an invalid model reply and to build fallbackPhrases. */
function defaultStyleForVibe(vibe: MrsImaginePhrase['vibe']): LetteringStyleId {
  switch (vibe) {
    case 'funny':
      return 'bubble-comic'
    case 'hype':
      return 'heavy-sans'
    case 'wholesome':
      return 'brush-script'
    case 'minimal':
      return 'heavy-sans'
    case 'pun':
      return 'retro-70s'
    default:
      return 'heavy-sans'
  }
}

export interface PhrasesResult {
  persona: 'mrs-imagine'
  intro: string
  phrases: MrsImaginePhrase[]
}

/** David's line, verbatim — shown above the pitched phrases in the UI. */
export const MRS_IMAGINE_INTRO =
  'Based on this prompt, you can add these phrases that will make this shirt POP.'

const DEFAULT_COUNT = 6
const MAX_COUNT = 10
const MIN_SURVIVORS_BEFORE_RETRY = 3

function clampCount(count: unknown): number {
  const n = typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : DEFAULT_COUNT
  return Math.max(1, Math.min(MAX_COUNT, n))
}

const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY

const client = new OpenAI(
  USE_OPENROUTER
    ? {
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://imaginethisprinted.com',
          'X-Title': 'Imagine Studio - Step Flow Phrases',
        },
      }
    : { apiKey: process.env.OPENAI_API_KEY }
)

const MODEL = USE_OPENROUTER ? 'google/gemini-2.5-flash' : (process.env.OPENAI_TEXT_MODEL || 'gpt-5.4-nano')
// gpt-5.x/o-series reasoning models reject a non-default `temperature` and the
// legacy `max_tokens` param — see imagine-brain.ts / brief.ts for the same guard.
const isReasoningModel = /^(o[1-9]|gpt-5)/.test(MODEL)

const SYSTEM_PROMPT = `You are Mrs. Imagine, Imagine This Printed's in-house designer — playful, confident, and print-savvy. Given a design idea (and sometimes the finished art-direction prompt for it), pitch short phrases that would look great printed alongside the artwork.

HARD RULES for every phrase:
1. 2-6 words.
2. Print-friendly: no emoji, no hashtags, no quotation marks, at most one punctuation mark.
3. NEVER a trademark, brand name, song lyric, celebrity name, or sports team.
4. Spread the set across a mix of vibes: funny, hype, wholesome, minimal, pun.

Respond with STRICT JSON and nothing else, in exactly this shape:
{"phrases": [{"text": string, "vibe": "funny"|"hype"|"wholesome"|"minimal"|"pun", "placement": "below"|"above"|"integrated", "reason": string, "suggestedStyle": "graffiti"|"varsity"|"brush-script"|"chrome-3d"|"retro-70s"|"distressed"|"heavy-sans"|"blackletter"|"bubble-comic"|"neon-tube"|"western"}]}

- "text": the phrase itself, 2-6 words, spelled exactly as it should print.
- "vibe": one of funny, hype, wholesome, minimal, pun.
- "placement": where the phrase reads best relative to the artwork's subject.
- "reason": one short sentence on why this phrase fits the idea.
- "suggestedStyle": the ONE lettering style (from the list above) that best fits this phrase's vibe and the design — e.g. a funny phrase suits bubble-comic, a hype phrase suits heavy-sans or chrome-3d, a wholesome phrase suits brush-script.`

/** Strip ```json fences / stray prose and parse the first JSON object found. Mirrors brief.ts's parseJsonLoose. */
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

// Matches ASCII control characters (C0 range + DEL) and the common emoji /
// pictograph blocks — built with RegExp(...) + \u escapes so no raw control
// or multi-byte bytes ever have to live in this source file.
/** Drop ASCII control characters (C0 range + DEL) by code point — no control-char regex class needed (eslint no-control-regex). */
const stripControlChars = (text: string): string =>
  Array.from(text).filter((ch) => { const c = ch.codePointAt(0) ?? 0; return !(c <= 0x1f || c === 0x7f) }).join('')
/** Drop emoji / pictographs / the variation selector by code point (eslint no-misleading-character-class). */
const stripEmoji = (text: string): string =>
  Array.from(text).filter((ch) => { const c = ch.codePointAt(0) ?? 0; return !((c >= 0x2190 && c <= 0x2bff) || (c >= 0x1f000 && c <= 0x1faff) || c === 0xfe0f) }).join('')
const QUOTE_HASH_RE = new RegExp("[\"'\\u2018\\u2019\\u201C\\u201D#]", 'g')

const VALID_VIBES: MrsImaginePhrase['vibe'][] = ['funny', 'hype', 'wholesome', 'minimal', 'pun']
const VALID_PLACEMENTS: PhrasePlacement[] = ['below', 'above', 'integrated']

/** Cleans one candidate's raw text into a print-friendly phrase: strips quotes/hashtags/emoji/control chars, collapses whitespace. */
function cleanPhraseText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return stripEmoji(stripControlChars(raw))
    .replace(QUOTE_HASH_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/** Coerces a loosely-typed model reply into a list of well-formed candidates; drops entries with no usable text. */
function coercePhrases(raw: any): MrsImaginePhrase[] {
  if (!raw || !Array.isArray(raw.phrases)) return []
  const out: MrsImaginePhrase[] = []
  for (const item of raw.phrases) {
    if (!item || typeof item !== 'object') continue
    const text = cleanPhraseText((item as any).text)
    if (!text) continue
    const vibeRaw = typeof (item as any).vibe === 'string' ? (item as any).vibe.toLowerCase() : ''
    const vibe = (VALID_VIBES as string[]).includes(vibeRaw) ? (vibeRaw as MrsImaginePhrase['vibe']) : 'hype'
    const placementRaw = (item as any).placement
    const placement = (VALID_PLACEMENTS as string[]).includes(placementRaw) ? (placementRaw as PhrasePlacement) : 'below'
    const reason =
      typeof (item as any).reason === 'string' && (item as any).reason.trim()
        ? (item as any).reason.trim()
        : 'A fitting line for this design.'
    const suggestedStyleRaw = (item as any).suggestedStyle
    const suggestedStyle: LetteringStyleId = isLetteringStyleId(suggestedStyleRaw) ? suggestedStyleRaw : defaultStyleForVibe(vibe)
    out.push({ text, vibe, placement, reason, suggestedStyle })
  }
  return out
}

/** True when a phrase's text trips no term on the Etsy copyright gate's trademark/brand denylist. Reuses the gate rather than duplicating its list. */
function passesCopyrightGate(text: string): boolean {
  return runCopyrightGate({ name: text }).pass
}

function filterClean(phrases: MrsImaginePhrase[]): MrsImaginePhrase[] {
  return phrases.filter((p) => passesCopyrightGate(p.text))
}

/** De-dupes by lowercased text, keeping the first occurrence. */
function dedupe(phrases: MrsImaginePhrase[]): MrsImaginePhrase[] {
  const seen = new Set<string>()
  const out: MrsImaginePhrase[] = []
  for (const p of phrases) {
    const key = p.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

/**
 * Deterministic fallback used whenever the writing brain is unreachable (or
 * returns nothing usable even after the retry). Six generic-but-fitting
 * phrases derived from the idea — always print-friendly, always clear of the
 * copyright gate by construction, so the phrase step never comes up empty.
 */
export function fallbackPhrases(idea: string, count = 6): MrsImaginePhrase[] {
  const trimmed = (idea || '').trim() || 'this design'
  const words = trimmed.split(/\s+/).filter(Boolean).slice(0, 3)
  const titled = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'This Drop'

  const withStyle = (p: Omit<MrsImaginePhrase, 'suggestedStyle'>): MrsImaginePhrase => ({
    ...p,
    suggestedStyle: defaultStyleForVibe(p.vibe),
  })

  const templates: MrsImaginePhrase[] = [
    withStyle({ text: `${titled} Vibes Only`, vibe: 'hype', placement: 'below', reason: 'A hype line built straight off the idea.' }),
    withStyle({ text: `Powered By ${titled}`, vibe: 'funny', placement: 'below', reason: 'A playful tagline anyone can read fast.' }),
    withStyle({ text: 'Made With Love', vibe: 'wholesome', placement: 'below', reason: 'A warm, generic line that fits almost any art.' }),
    withStyle({ text: 'Est. Today', vibe: 'minimal', placement: 'below', reason: 'A clean minimal stamp that never crowds the art.' }),
    withStyle({ text: `${titled} Or Nothing`, vibe: 'hype', placement: 'above', reason: 'Confident hype phrasing built off the idea.' }),
    withStyle({ text: 'Good Vibes Guaranteed', vibe: 'wholesome', placement: 'below', reason: 'A safe, upbeat catch-all line.' }),
  ]

  return filterClean(dedupe(templates)).slice(0, Math.max(1, Math.min(count, templates.length)))
}

function buildUserContent(idea: string, brief: StepBrief | undefined, count: number): string {
  const lines = [`Design idea: ${idea}`]
  if (brief?.designPrompt) lines.push(`Art-direction prompt for the design: ${brief.designPrompt}`)
  lines.push(`Pitch ${count} phrases.`)
  return lines.join('\n\n')
}

/** One call to the writing brain. Never throws — resolves to [] on any failure so the caller can retry/fall back. */
async function requestPhrasesFromBrain(idea: string, brief: StepBrief | undefined, count: number): Promise<MrsImaginePhrase[]> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserContent(idea, brief, count) },
      ],
      ...(isReasoningModel ? { max_completion_tokens: 700 } : { temperature: 0.9, max_tokens: 700 }),
    })
    const raw = completion.choices[0]?.message?.content || ''
    return coercePhrases(parseJsonLoose(raw))
  } catch (err: any) {
    console.warn('[step-flow/phrases] writing brain call failed:', err?.message || err)
    return []
  }
}

/**
 * Mrs. Imagine's pitch: idea (+ optional brief) -> a handful of print-ready
 * phrases. Every candidate is filtered through the Etsy copyright gate's
 * trademark/brand denylist; when fewer than 3 survive, the brain is asked
 * once more and the results are merged. Falls back to a deterministic set
 * derived from the idea if nothing usable ever comes back.
 */
export async function pitchPhrases(idea: string, brief?: StepBrief, count?: number): Promise<PhrasesResult> {
  const trimmed = (idea || '').trim()
  if (!trimmed) throw new Error('idea is required')
  const wantCount = clampCount(count)

  let candidates = filterClean(dedupe(await requestPhrasesFromBrain(trimmed, brief, wantCount)))

  if (candidates.length < MIN_SURVIVORS_BEFORE_RETRY) {
    const retry = await requestPhrasesFromBrain(trimmed, brief, wantCount)
    candidates = filterClean(dedupe([...candidates, ...retry]))
  }

  if (candidates.length === 0) {
    candidates = fallbackPhrases(trimmed, wantCount)
  }

  return {
    persona: 'mrs-imagine',
    intro: MRS_IMAGINE_INTRO,
    phrases: candidates.slice(0, wantCount),
  }
}

// ---------------------------------------------------------------------------
// Vision-grounded pitch (David 2026-09-09): "the phrases or ask mrs imagine to
// come up with a phrase she is going off the prompt and it really doesnt match
// the design of the image so it sucks".
//
// He was right, and it was worse than he thought. `pitchPhrases` above sees a
// design idea and — when the caller bothers to send one — an art-direction
// prompt. It has never seen a picture, because in the original flow no picture
// exists yet: phrase -> prompt -> render, in that order. Every pitch was a
// guess at art nobody had drawn.
//
// This half runs at the OTHER end: the design is on screen, and Mrs. Imagine
// LOOKS at it before she writes a word. She also reports what she sees
// (`saw`) and any words already drawn into the art (`existingText`) — the
// first so David can tell at a glance that she actually looked, the second
// because lettering a second line onto art that already carries one is how a
// shirt ends up with two competing slogans on it.
//
// Same cost-first brain order as inspiration.ts: OpenRouter gemini-2.5-flash
// (vision-capable) first, OPENAI_VISION_MODEL second. Never throws — a dead
// call falls back to the deterministic idea-derived set, exactly as the
// text-only pitch does, with `saw: null` so the caller can say so.
// ---------------------------------------------------------------------------

/** What Mrs. Imagine pitched after actually looking at the finished artwork. */
export interface DesignPhrasesResult extends PhrasesResult {
  /** One sentence on what she can see in the design. Null when the vision call failed and these are blind fallbacks. */
  saw: string | null
  /** Words already drawn INTO the artwork, spelled as seen, or null when it carries none. */
  existingText: string | null
}

const openrouterVisionClient = USE_OPENROUTER
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://imaginethisprinted.com',
        'X-Title': 'Imagine Studio - Step Flow Phrases (vision)',
      },
    })
  : null
const openaiVisionClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const OPENROUTER_VISION_MODEL = 'google/gemini-2.5-flash'
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
const isVisionReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

/** Her line above the chips once she has actually seen the art — deliberately different from MRS_IMAGINE_INTRO so the two pitches are told apart on sight. */
export const MRS_IMAGINE_DESIGN_INTRO = 'I looked at your design. These are the lines that fit what is actually on it.'

const VISION_SYSTEM_PROMPT = `You are Mrs. Imagine, Imagine This Printed's in-house designer. You are being shown a FINISHED piece of artwork that is about to be printed on a shirt. Your job is to pitch short phrases to letter onto THIS artwork.

Look at the image first. Every phrase must fit what is actually drawn — the subject, its expression, the action, the setting, the mood, the palette. A phrase that would fit any design at all is a wasted pitch.

HARD RULES for every phrase:
1. 2-6 words.
2. Print-friendly: no emoji, no hashtags, no quotation marks, at most one punctuation mark.
3. NEVER a trademark, brand name, song lyric, celebrity name, or sports team.
4. Spread the set across a mix of vibes: funny, hype, wholesome, minimal, pun.
5. Every "reason" must name something you can SEE in the image — the actual thing on the canvas, not the theme in general.

Respond with STRICT JSON and nothing else, in exactly this shape:
{"saw": string, "existingText": string|null, "phrases": [{"text": string, "vibe": "funny"|"hype"|"wholesome"|"minimal"|"pun", "placement": "below"|"above"|"integrated", "reason": string, "suggestedStyle": "graffiti"|"varsity"|"brush-script"|"chrome-3d"|"retro-70s"|"distressed"|"heavy-sans"|"blackletter"|"bubble-comic"|"neon-tube"|"western"}]}

- "saw": ONE sentence describing what is actually in this artwork.
- "existingText": any words already drawn into the artwork, spelled exactly as they appear, or null if the artwork carries no text at all.
- "text": the phrase itself, 2-6 words, spelled exactly as it should print.
- "vibe": one of funny, hype, wholesome, minimal, pun.
- "placement": where this phrase reads best on THIS artwork, given where the subject sits and where the empty space is.
- "reason": one short sentence naming what in the image makes this line fit.
- "suggestedStyle": the ONE lettering style (from the list above) that suits both this phrase and the art style you can see.`

/** One vision call. Throws on transport failure so the caller can fall through to the next brain. */
async function callPhraseVisionModel(client: OpenAI, model: string, imageUrl: string, userText: string): Promise<any> {
  const completion = await client.chat.completions.create({
    model,
    ...(isVisionReasoningModel(model) ? { max_completion_tokens: 900 } : { max_tokens: 900, temperature: 0.9 }),
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
  })
  return parseJsonLoose(completion.choices[0]?.message?.content || '')
}

/** OpenRouter first, OpenAI second, null when both are unreachable. Never throws. */
async function requestDesignPhrasesFromBrain(imageUrl: string, userText: string): Promise<any> {
  if (openrouterVisionClient) {
    try {
      const parsed = await callPhraseVisionModel(openrouterVisionClient, OPENROUTER_VISION_MODEL, imageUrl, userText)
      if (parsed) return parsed
    } catch (err: any) {
      console.warn('[step-flow/phrases] OpenRouter vision pitch failed, falling back to OpenAI:', err?.message || err)
    }
  }
  try {
    return await callPhraseVisionModel(openaiVisionClient, OPENAI_VISION_MODEL, imageUrl, userText)
  } catch (err: any) {
    console.warn('[step-flow/phrases] OpenAI vision pitch failed:', err?.message || err)
    return null
  }
}

// Longest edge handed to the vision model. A design is drawn at 1024 anyway;
// this only clamps the occasional larger print file. Mirrors
// inspiration.ts's ANALYSIS_MAX_DIM.
const ANALYSIS_MAX_DIM = 1024

/**
 * Fetches the design and inlines it as a data URL.
 *
 * PROVEN NECESSARY 2026-09-09, against real products. Handing the model a
 * plain URL works for a design sitting on GCS and FAILS for one adopted from
 * the design library: those serve through `api.imaginethisprinted.com/api/
 * media/...`, which answers 302 to a signed GCS link. curl follows it and gets
 * a 315KB PNG; the model's own fetcher does not, so the pitch came back blind
 * for every library design — the exact population the /step/adopt route just
 * started pushing through this flow.
 *
 * Inlining removes the model's fetcher from the path entirely, which also
 * covers signed URLs that expire and buckets that are not world-readable.
 * Returns the original URL on any failure: a direct-URL attempt that might
 * work beats refusing to pitch at all.
 */
async function toAnalysisDataUrl(url: string): Promise<string> {
  try {
    // Node's fetch follows redirects by default — that is the whole point here.
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`design fetch ${resp.status}`)
    const buffer = Buffer.from(await resp.arrayBuffer())
    const png = await sharp(buffer)
      .resize(ANALYSIS_MAX_DIM, ANALYSIS_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch (err: any) {
    console.warn('[step-flow/phrases] could not inline the design, passing the URL through:', err?.message || err)
    return url
  }
}

/** A sentence of model prose, cleaned like a phrase but allowed to be longer. */
function cleanSentence(raw: unknown, maxLen = 200): string | null {
  if (typeof raw !== 'string') return null
  const text = stripEmoji(stripControlChars(raw)).replace(/\s+/g, ' ').trim().slice(0, maxLen)
  return text || null
}

/**
 * Mrs. Imagine looks at a finished design and pitches phrases that match it.
 *
 * `idea` rides along as context only — the IMAGE is the subject of the call,
 * so a pitch still lands for a design that arrived with no idea text at all
 * (the design library's /step/adopt brings in exactly those). Never throws: an
 * unreachable or unusable vision call resolves to the same deterministic
 * fallback set the text-only pitch uses, with `saw: null` so the caller can
 * tell David she never actually got to look.
 */
export async function pitchPhrasesForDesign(
  designImageUrl: string,
  opts?: { idea?: string; count?: number }
): Promise<DesignPhrasesResult> {
  const url = (designImageUrl || '').trim()
  if (!url) throw new Error('designImageUrl is required')
  const idea = (opts?.idea || '').trim()
  const wantCount = clampCount(opts?.count)

  const userText = idea
    ? `Pitch ${wantCount} phrases for this artwork. For context the idea behind it was: "${idea}". Judge every phrase against the picture, not the idea.`
    : `Pitch ${wantCount} phrases for this artwork.`

  const image = await toAnalysisDataUrl(url)

  let raw = await requestDesignPhrasesFromBrain(image, userText)
  let candidates = filterClean(dedupe(coercePhrases(raw)))

  if (candidates.length < MIN_SURVIVORS_BEFORE_RETRY) {
    const retryRaw = await requestDesignPhrasesFromBrain(image, userText)
    const merged = filterClean(dedupe([...candidates, ...coercePhrases(retryRaw)]))
    if (merged.length > candidates.length) candidates = merged
    // Keep whichever reply actually described the art — a first call that
    // produced junk phrases but a good `saw` line should not blank it, and a
    // retry that finally saw something should fill it.
    if (!cleanSentence(raw?.saw) && cleanSentence(retryRaw?.saw)) raw = retryRaw
  }

  if (candidates.length === 0) {
    return {
      persona: 'mrs-imagine',
      intro: MRS_IMAGINE_DESIGN_INTRO,
      saw: null,
      existingText: null,
      phrases: fallbackPhrases(idea || 'this design', wantCount),
    }
  }

  return {
    persona: 'mrs-imagine',
    intro: MRS_IMAGINE_DESIGN_INTRO,
    saw: cleanSentence(raw?.saw),
    existingText: cleanSentence(raw?.existingText, 120),
    phrases: candidates.slice(0, wantCount),
  }
}
