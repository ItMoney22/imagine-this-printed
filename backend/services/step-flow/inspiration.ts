// Step Flow — Inspiration step (David 2026-09-02): "i need a spot in the
// step flow in the beginning that we can add inspiration upload a photo of a
// design mrs imagine will anaylze it and ask what we like if we want the
// same just ours or if we want diff words diff subject she basically breaks
// down the whole design."
//
// HARD IP RULE: the reference photo is INSPIRATION ONLY — style,
// composition, palette, vibe. ITP must NEVER reproduce it. Any logo, brand
// mark, licensed character, celebrity likeness, or verbatim text detected in
// the reference is listed in `breakdown.flags` and NEVER echoed into
// `suggestedIdea` — every text candidate this file writes is run through the
// Etsy copyright gate's denylist (etsy-copyright-gate.ts), same as
// phrases.ts does for Mrs. Imagine's phrase pitches.
//
// Same cost-first writing-brain pattern as brief.ts/phrases.ts: OpenRouter
// gemini-2.5-flash (vision-capable) when configured, OPENAI_VISION_MODEL
// otherwise (the same vision-call shape as ai-product.ts's
// describeDesignForProduct). The analysis call never throws — a
// failed/unusable reply resolves to a deterministic, stats-based fallback
// breakdown so the step always has something to show. Decode/validate/
// upload failures DO throw (InspirationValidationError), same contract as
// StepFlowValidationError in shots.ts — the route maps it to 400.
import sharp from 'sharp'
import OpenAI from 'openai'
import { uploadFile } from '../gcs-storage.js'
import { runCopyrightGate } from '../etsy-copyright-gate.js'

/** Thrown for expected, user-facing validation failures — the route maps this to 400 (mirrors StepFlowValidationError in shots.ts). */
export class InspirationValidationError extends Error {}

export interface InspirationBreakdown {
  subject: string
  style: string
  palette: string[]
  text: string | null
  composition: string
  mood: string
  techniques: string[]
  whatWorks: string[]
  flags: string[]
}

export type InspirationQuestionKey = 'subject' | 'words' | 'style' | 'palette' | 'composition'

export interface InspirationQuestion {
  key: InspirationQuestionKey
  prompt: string
  options: string[]
}

export interface InspirationResult {
  persona: 'mrs-imagine'
  intro: string
  inspiration: {
    imageUrl: string
    breakdown: InspirationBreakdown
    questions: InspirationQuestion[]
    suggestedIdea: string
  }
}

/** Mrs. Imagine's intro line for this step — fixed voice, never model-written (mirrors phrases.ts's MRS_IMAGINE_INTRO). */
export const INSPIRATION_INTRO =
  "Here's what's working in this one — tell me what to keep and what to make ours."

const MAX_BYTES = 8 * 1024 * 1024
const ANALYSIS_MAX_DIM = 1024
const STATS_SAMPLE_DIM = 128
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/

// ---------------------------------------------------------------------------
// Decode + validate (data URL or https URL). Size limit is enforced BEFORE
// decoding — a data URL's byte size is estimated from the base64 string
// length, and an https fetch checks Content-Length up front — so an
// oversized payload is rejected without ever handing it to sharp/Buffer.from
// in full. sharp is what actually rejects non-images (a decode failure ->
// InspirationValidationError, never a silent pass-through).
// ---------------------------------------------------------------------------

export async function decodeInspirationImage(image: unknown): Promise<{ buffer: Buffer; contentType: string }> {
  if (typeof image !== 'string' || !image.trim()) {
    throw new InspirationValidationError('image is required')
  }
  const trimmed = image.trim()

  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(DATA_URL_RE)
    if (!match) throw new InspirationValidationError('image data URL must be a base64 PNG, JPG, or WEBP')
    const contentType = match[1]
    const base64 = match[2]
    // Size limit BEFORE decoding: base64 encodes 3 bytes as 4 chars.
    const estimatedBytes = Math.floor((base64.length * 3) / 4)
    if (estimatedBytes > MAX_BYTES) throw new InspirationValidationError('image is too large; max is 8MB')
    const buffer = Buffer.from(base64, 'base64')
    if (buffer.length > MAX_BYTES) throw new InspirationValidationError('image is too large; max is 8MB')
    await assertDecodableImage(buffer)
    return { buffer, contentType }
  }

  if (/^https:\/\//i.test(trimmed)) {
    const res = await fetch(trimmed)
    if (!res.ok) throw new InspirationValidationError(`Failed to fetch reference image: ${res.status} ${res.statusText}`)
    const declaredLength = Number(res.headers.get('content-length') || 0)
    if (declaredLength > MAX_BYTES) throw new InspirationValidationError('image is too large; max is 8MB')
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > MAX_BYTES) throw new InspirationValidationError('image is too large; max is 8MB')
    await assertDecodableImage(buffer)
    const headerType = (res.headers.get('content-type') || '').split(';')[0].trim()
    const contentType = headerType.startsWith('image/') ? headerType : await sniffContentType(buffer)
    return { buffer, contentType }
  }

  throw new InspirationValidationError('image must be a base64 data URL or an https URL')
}

async function assertDecodableImage(buffer: Buffer): Promise<void> {
  try {
    const meta = await sharp(buffer).metadata()
    if (!meta.width || !meta.height) throw new Error('no dimensions')
  } catch {
    throw new InspirationValidationError('image could not be decoded — not a valid image file')
  }
}

async function sniffContentType(buffer: Buffer): Promise<string> {
  try {
    const meta = await sharp(buffer).metadata()
    if (meta.format === 'jpeg') return 'image/jpeg'
    if (meta.format === 'webp') return 'image/webp'
    return 'image/png'
  } catch {
    return 'image/png'
  }
}

function extForContentType(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg'
  if (contentType === 'image/webp') return 'webp'
  return 'png'
}

// ---------------------------------------------------------------------------
// Deterministic stats (dominant colors, aspect, tone) — real, measured
// numbers off the actual pixels, same spirit as color-advice.ts's
// measureArtworkStats. Used both to seed the honest, stats-based fallback
// breakdown when the vision call fails, and as a fallback for any palette
// field the model left empty.
// ---------------------------------------------------------------------------

export interface InspirationStats {
  aspect: 'square' | 'portrait' | 'landscape'
  meanLuma: number
  saturation: number
  dominantColors: string[]
}

function relativeLuma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function rgbToSat(r: number, g: number, b: number): number {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const lightness = (max + min) / 2
  if (delta < 1e-6) return 0
  return delta / (1 - Math.abs(2 * lightness - 1))
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${[clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

export async function measureInspirationStats(buffer: Buffer): Promise<InspirationStats> {
  const meta = await sharp(buffer).metadata()
  const width = meta.width || 1
  const height = meta.height || 1
  const ratio = width / height
  const aspect: InspirationStats['aspect'] = ratio > 1.15 ? 'landscape' : ratio < 0.87 ? 'portrait' : 'square'

  const { data, info } = await sharp(buffer)
    .resize(STATS_SAMPLE_DIM, STATS_SAMPLE_DIM, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const channels = info.channels || 3
  let total = 0
  let sumLuma = 0
  let sumSat = 0
  const buckets = new Map<string, number>()

  for (let i = 0; i + channels <= data.length; i += channels) {
    total++
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    sumLuma += relativeLuma(r, g, b)
    sumSat += rgbToSat(r, g, b)
    const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`
    buckets.set(key, (buckets.get(key) || 0) + 1)
  }

  const meanLuma = total > 0 ? sumLuma / total : 0.5
  const saturation = total > 0 ? sumSat / total : 0
  const dominantColors = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => {
      const [r, g, b] = key.split(',').map(Number)
      return rgbToHex(r, g, b)
    })

  return { aspect, meanLuma, saturation, dominantColors: dominantColors.length ? dominantColors : ['#808080'] }
}

async function prepareForAnalysis(buffer: Buffer): Promise<{ dataUrl: string; stats: InspirationStats }> {
  const [stats, resized] = await Promise.all([
    measureInspirationStats(buffer),
    sharp(buffer)
      .resize(ANALYSIS_MAX_DIM, ANALYSIS_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer(),
  ])
  return { dataUrl: `data:image/jpeg;base64,${resized.toString('base64')}`, stats }
}

// ---------------------------------------------------------------------------
// Copyright-gate sanitizing (etsy-copyright-gate.ts's denylist — same one
// phrases.ts reuses). `suggestedIdea` is the one field here that later seeds
// brief.ts's designPrompt, so it is the field that must never carry a
// denylisted term through, no matter what the model actually wrote.
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripDenylistedTerms(text: string): string {
  const result = runCopyrightGate({ name: text })
  if (result.pass) return text
  let cleaned = text
  for (const term of result.matchedTerms) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi'), 'an original design')
  }
  return cleaned.replace(/\s+/g, ' ').trim()
}

const GENERIC_SAFE_IDEA =
  "An original design inspired by this reference's style and palette — reimagined with all-new, original subject matter."

function sanitizeSuggestedIdea(text: string): string {
  const cleaned = stripDenylistedTerms(text)
  return runCopyrightGate({ name: cleaned }).pass ? cleaned : GENERIC_SAFE_IDEA
}

// ---------------------------------------------------------------------------
// Deterministic fallback breakdown — stats-based, honest wording. Used
// whenever the vision call fails/is unreachable so the step never comes up
// empty. Deliberately does NOT claim to know the subject, and always flags
// that automated IP detection did not run — fail-open on availability, but
// never fail-silent on the one check we could not actually perform.
// ---------------------------------------------------------------------------

function fallbackBreakdown(stats: InspirationStats): { breakdown: InspirationBreakdown; suggestedIdea: string } {
  const toneWord = stats.meanLuma > 0.65 ? 'bright, light-toned' : stats.meanLuma < 0.35 ? 'dark, moody' : 'balanced-tone'
  const satWord = stats.saturation > 0.35 ? 'vivid, saturated' : 'muted, soft'
  const aspectWord = stats.aspect === 'square' ? 'square' : stats.aspect === 'portrait' ? 'portrait/tall' : 'landscape/wide'

  const breakdown: InspirationBreakdown = {
    subject:
      "Automated subject recognition didn't run for this reference (fallback mode) — describe what it is and Mrs. Imagine will build an original piece around it.",
    style: `A ${toneWord}, ${satWord} look, measured directly from the image (not AI-identified).`,
    palette: stats.dominantColors,
    text: null,
    composition: `${aspectWord} framing (measured aspect ratio).`,
    mood: satWord,
    techniques: [],
    whatWorks: [`Strong ${toneWord} tone`, `A ${satWord} color palette`],
    flags: [
      'Automated logo/brand/character detection did not run for this reference — have a human confirm it is clear of trademarks, brand marks, licensed characters, celebrity likeness, or copyrighted text before using it as inspiration.',
    ],
  }
  const suggestedIdea = `An original design inspired by this reference's ${satWord} ${toneWord} palette and ${aspectWord} composition — describe your own subject and Mrs. Imagine will build something all-new around that feel.`
  return { breakdown, suggestedIdea: sanitizeSuggestedIdea(suggestedIdea) }
}

// ---------------------------------------------------------------------------
// Deterministic questions — always the same 5 fixed dimensions (subject /
// words / style / palette / composition) so the frontend's question keys
// never depend on the model returning them well-formed. Built from whatever
// breakdown we ended up with (model or fallback).
// ---------------------------------------------------------------------------

export function buildInspirationQuestions(breakdown: InspirationBreakdown): InspirationQuestion[] {
  return [
    {
      key: 'subject',
      prompt: `Keep the same subject (${breakdown.subject}), or go with something different?`,
      options: ['Keep this subject', 'Different subject, same vibe', 'Let Mrs. Imagine surprise me'],
    },
    {
      key: 'words',
      prompt: breakdown.text
        ? `The reference has text ("${breakdown.text}") — same idea in your own words, different words, or no text at all?`
        : 'Want to add any words/text to your version?',
      options: ['No text', 'Same idea, our own words', 'Totally different words'],
    },
    {
      key: 'style',
      prompt: `Keep the ${breakdown.style} or try something else?`,
      options: ['Keep this style', 'Try a different style', 'Let Mrs. Imagine pick'],
    },
    {
      key: 'palette',
      prompt: `Keep this palette (${breakdown.palette.join(', ') || 'as shown'}), or go a different direction?`,
      options: ['Keep this palette', 'Different colors', 'Let Mrs. Imagine pick'],
    },
    {
      key: 'composition',
      prompt: `Keep the ${breakdown.composition} or change it up?`,
      options: ['Keep this composition', 'Different composition', 'Let Mrs. Imagine pick'],
    },
  ]
}

// ---------------------------------------------------------------------------
// Vision call — OpenRouter gemini-2.5-flash first (cost-first, same pattern
// as brief.ts/phrases.ts), OPENAI_VISION_MODEL fallback (the same model
// ai-product.ts's describeDesignForProduct uses). Never throws — resolves to
// null on total failure so the caller falls back to the stats-based
// breakdown above.
// ---------------------------------------------------------------------------

const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY

const openrouterClient = USE_OPENROUTER
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://imaginethisprinted.com',
        'X-Title': 'Imagine Studio - Step Flow Inspiration',
      },
    })
  : null
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const OPENROUTER_VISION_MODEL = 'google/gemini-2.5-flash'
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
// gpt-5.x/o-series reasoning models reject a non-default `temperature` and
// the legacy `max_tokens` param — see brief.ts/ai-product.ts for the same guard.
const isReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

const SYSTEM_PROMPT = `You are Mrs. Imagine, Imagine This Printed's in-house designer and art director. You will be shown a REFERENCE image an admin uploaded for INSPIRATION ONLY — never a reproduction target. Break it down like a design critique.

HARD RULES:
1. This reference is for inspiration only — style, composition, palette, vibe. ITP must NEVER reproduce it.
2. If you see a brand logo/trademark, a licensed or copyrighted character, a celebrity's likeness, or verbatim text/lyrics that read as trademarked/copyrighted, list EACH one in "flags" in plain language (e.g. "Nike swoosh logo on the shoe"). If you see none of these, return an empty flags array.
3. "suggestedIdea" MUST describe an ORIGINAL design that keeps what works (style/composition/mood/palette) but NEVER names, describes, or reproduces anything listed in "flags" — replace each flagged element with an original, generic equivalent.
4. Never put a brand name, franchise name, celebrity name, or verbatim copyrighted text into "suggestedIdea".

Respond with STRICT JSON and nothing else, in exactly this shape:
{"subject": string, "style": string, "palette": string[], "text": string|null, "composition": string, "mood": string, "techniques": string[], "whatWorks": string[], "flags": string[], "suggestedIdea": string}

- "subject": what the reference actually depicts (1 sentence).
- "style": the art style/technique (1 short phrase).
- "palette": 2-6 dominant colors, as plain color names or hex codes.
- "text": any text/words visible in the reference, spelled as seen, or null if none.
- "composition": how the subject is framed/arranged (1 short phrase).
- "mood": the overall vibe (1-3 words).
- "techniques": 1-4 short technique/style tags.
- "whatWorks": 2-5 short bullets on what makes this reference effective.
- "flags": empty array, or one plain-language entry per logo/brand mark/licensed character/celebrity likeness/copyrighted text detected.
- "suggestedIdea": ONE sentence — an original idea inspired by this reference, with any flagged element replaced by an original equivalent.`

/** Strip ```json fences / stray prose and parse the first JSON object found. Mirrors brief.ts/phrases.ts's parseJsonLoose. */
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

async function callVisionModel(client: OpenAI, model: string, dataUrl: string): Promise<any> {
  const completion = await client.chat.completions.create({
    model,
    ...(isReasoningModel(model) ? { max_completion_tokens: 900 } : { max_tokens: 900, temperature: 0.6 }),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Break down this reference image.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  })
  const raw = completion.choices[0]?.message?.content || ''
  return parseJsonLoose(raw)
}

/** Never throws — resolves to null when both the OpenRouter and OpenAI vision calls fail, so the caller falls back to the stats-based breakdown. */
async function requestBreakdownFromModel(dataUrl: string): Promise<any> {
  if (openrouterClient) {
    try {
      const parsed = await callVisionModel(openrouterClient, OPENROUTER_VISION_MODEL, dataUrl)
      if (parsed) return parsed
    } catch (err: any) {
      console.warn('[step-flow/inspiration] OpenRouter vision call failed, falling back to OpenAI:', err?.message || err)
    }
  }
  try {
    return await callVisionModel(openaiClient, OPENAI_VISION_MODEL, dataUrl)
  } catch (err: any) {
    console.warn('[step-flow/inspiration] OpenAI vision call failed:', err?.message || err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Coerce a loosely-typed model reply into a well-formed breakdown, falling
// back per-field (same discipline as brief.ts's coerceBrief).
// ---------------------------------------------------------------------------

const stripControlChars = (text: string): string =>
  Array.from(text)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0
      return !(c <= 0x1f || c === 0x7f)
    })
    .join('')

function cleanText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return ''
  return stripControlChars(raw).replace(/\s+/g, ' ').trim().slice(0, maxLen)
}

function cleanArray(raw: unknown, maxLen: number, maxItems: number): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => cleanText(t, maxLen))
    .filter(Boolean)
    .slice(0, maxItems)
}

export function coerceModelBreakdown(raw: any, stats: InspirationStats): { breakdown: InspirationBreakdown; suggestedIdea: string } {
  const fb = fallbackBreakdown(stats)
  if (!raw || typeof raw !== 'object') return fb

  const subject = cleanText(raw.subject, 300) || fb.breakdown.subject
  const style = cleanText(raw.style, 160) || fb.breakdown.style
  const palette = cleanArray(raw.palette, 40, 6)
  const text = typeof raw.text === 'string' && raw.text.trim() ? cleanText(raw.text, 160) : null
  const composition = cleanText(raw.composition, 160) || fb.breakdown.composition
  const mood = cleanText(raw.mood, 60) || fb.breakdown.mood
  const techniques = cleanArray(raw.techniques, 40, 4)
  const whatWorks = cleanArray(raw.whatWorks, 200, 5)
  const flags = cleanArray(raw.flags, 200, 10)

  const breakdown: InspirationBreakdown = {
    subject,
    style,
    palette: palette.length ? palette : fb.breakdown.palette,
    text,
    composition,
    mood,
    techniques,
    whatWorks,
    flags,
  }

  const rawSuggestedIdea = cleanText(raw.suggestedIdea, 400) || fb.suggestedIdea
  return { breakdown, suggestedIdea: sanitizeSuggestedIdea(rawSuggestedIdea) }
}

// ---------------------------------------------------------------------------
// Entry point — decode/validate/upload the ORIGINAL, then analyze a
// downscaled copy. Decode/upload failures throw (InspirationValidationError
// for the expected ones); an analysis failure resolves to the deterministic
// fallback — same "the step must always advance" discipline as
// brief.ts/phrases.ts.
// ---------------------------------------------------------------------------

export async function analyzeInspirationImage(image: unknown, opts?: { actorId?: string }): Promise<InspirationResult> {
  const { buffer, contentType } = await decodeInspirationImage(image)

  const filename = `inspiration-${Date.now()}.${extForContentType(contentType)}`
  const { publicUrl } = await uploadFile(buffer, {
    userId: opts?.actorId || 'system',
    folder: 'inspiration',
    filename,
    contentType,
  })

  const { dataUrl, stats } = await prepareForAnalysis(buffer)
  const modelRaw = await requestBreakdownFromModel(dataUrl)
  const { breakdown, suggestedIdea } = modelRaw ? coerceModelBreakdown(modelRaw, stats) : fallbackBreakdown(stats)
  const questions = buildInspirationQuestions(breakdown)

  return {
    persona: 'mrs-imagine',
    intro: INSPIRATION_INTRO,
    inspiration: { imageUrl: publicUrl, breakdown, questions, suggestedIdea },
  }
}
