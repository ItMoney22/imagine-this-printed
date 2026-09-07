// Step Flow — casting. Mrs. Imagine LOOKS AT THE DESIGN and decides who
// should be wearing it.
//
// David 2026-09-03, with a screenshot of a cute "Too Cute To Spook" ghost tee
// modelled by a bearded adult man: "in the step flow we need Mrs. Imagine to
// understand the design so something like this should of been mocked up on a
// kid she should adjust what our model looks like based on the design so the
// person matches what they wearing."
//
// Before this file existed, the Step Flow's on-person shot called
// `shootOneModelShot` with NO cast, and etsy-model-shots.ts fell through to a
// uniform random draw over sixteen adult archetypes. The design never reached
// the casting decision at all.
//
// TWO THINGS DECIDE THE CAST, and they are not the same thing:
//   • The GARMENT decides the age band — adult tee/hoodie → an adult, youth
//     tee → a child. That is a capability fact (shared/catalog-capability.ts),
//     enforced in etsy-model-shots.ts's resolveCast, and nothing in this file
//     can override it. A photo may never advertise a size we don't sell.
//   • The DESIGN decides which KIND of person within that band — the goth for
//     horror art, the mom for a mama tee, the sporty kid for a soccer design.
//     That is this file's job.
// When the design's own audience disagrees with the garment (a kids' design on
// an adult tee), we do NOT quietly cast a child. We cast the best adult and
// hand the panel a `mismatch` line telling the admin to switch the garment —
// the fix is one click away and it is the admin's call, not ours.
//
// Same cost-first writing-brain pattern as brief.ts / phrases.ts /
// inspiration.ts: OpenRouter gemini-2.5-flash (vision) when configured,
// OPENAI_VISION_MODEL otherwise. The call NEVER throws — every failure path
// resolves to the deterministic keyword match below, so a casting outage
// degrades to the old keyword behaviour instead of blocking a shoot.
import OpenAI from 'openai'
import {
  audienceForGarment,
  getGarment,
  type GarmentAudience,
  type GarmentId,
} from '../../shared/catalog-capability.js'
import { listShotSubjects, type ShotSubject } from '../etsy-model-shots.js'

/** How the design read to Mrs. Imagine — advisory, recorded for the panel and the logs. */
export interface DesignRead {
  /** Who the ARTWORK is for, in the design's own terms — not who can be photographed. */
  audience: 'kids' | 'teen' | 'adult' | 'any'
  /** What the design actually depicts, one short phrase. */
  subjectMatter: string
  /** The design's vibe, 1-3 words. */
  vibe: string
}

export interface CastingDecision {
  /** Archetype id from etsy-model-shots.ts — safe to pass straight through as `cast.subjects`. */
  subjectId: string
  label: string
  /** The garment's age band. Always the garment's, never the design's. */
  audience: GarmentAudience
  /** One plain sentence for the panel: why this person is wearing this design. */
  reason: string
  /** Where the decision came from, so a bad cast is explainable. */
  source: 'mrs-imagine' | 'keywords' | 'default'
  read?: DesignRead
  /**
   * Set when the DESIGN reads as a different audience than the GARMENT sells
   * to — e.g. a kids' design on an adult tee. The shot still happens (cast
   * from the garment's band); this is the nudge that tells the admin the
   * listing would be better as a youth tee.
   */
  mismatch?: string
}

// Built on demand, not at import time. This module is imported by
// services/step-flow/shots.ts, which is imported by the step-flow route and
// its tests — an eager `new OpenAI()` throws "Missing credentials" the moment
// anything in that chain loads without a key set, which is a silly way for a
// route (or a unit test) to die. No key simply means no vision pass, and
// castForDesign falls through to the keyword match.
const openrouterClient = (): OpenAI | null =>
  process.env.OPENROUTER_API_KEY
    ? new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://imaginethisprinted.com',
          'X-Title': 'Imagine Studio - Step Flow Casting',
        },
      })
    : null

const openaiClient = (): OpenAI | null =>
  process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

const OPENROUTER_VISION_MODEL = 'google/gemini-2.5-flash'
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra'
/** gpt-5.x/o-series reject a non-default temperature and legacy max_tokens — same guard as brief.ts/inspiration.ts. */
const isReasoningModel = (m: string) => /^(o[1-9]|gpt-5)/.test(m)

// ---------------------------------------------------------------------------
// Deterministic keyword match — the fallback, and the tie-breaker the model's
// answer is validated against. Scores each castable archetype's keywords
// against the product name / idea / tags. Pure and exported for tests.
// ---------------------------------------------------------------------------

/**
 * Best keyword-matched subject for `text`, restricted to `audience`. Returns
 * null when nothing matches at all, so the caller can say "default" honestly
 * instead of dressing up a random pick as a decision.
 */
export function pickByKeywords(text: string, audience: GarmentAudience): ShotSubject | null {
  const haystack = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  let best: { subject: ShotSubject; score: number } | null = null
  for (const subject of listShotSubjects(audience)) {
    let score = 0
    for (const keyword of subject.keywords) {
      // Word-boundary match on a normalized haystack: "art" must not fire on
      // "heart", and "kid" must not fire on "kidney".
      if (haystack.includes(` ${keyword.toLowerCase()} `)) score += keyword.includes(' ') ? 3 : 2
    }
    if (score > 0 && (!best || score > best.score)) best = { subject, score }
  }
  return best?.subject ?? null
}

/** The subject used when neither Mrs. Imagine nor the keywords have an opinion. */
function defaultSubject(audience: GarmentAudience): ShotSubject {
  const all = listShotSubjects(audience)
  // 'classic' (adult) and 'kid' (youth) are the deliberately plain ones.
  return all.find((s) => s.id === 'classic' || s.id === 'kid') ?? all[0]
}

// ---------------------------------------------------------------------------
// The vision call.
// ---------------------------------------------------------------------------

const systemPrompt = (subjects: ShotSubject[], audience: GarmentAudience, garmentLabel: string): string =>
  `You are Mrs. Imagine, Imagine This Printed's art director. You are casting the model for ONE product photo: a ${garmentLabel} printed with the artwork you are shown.

Your job is to pick who should be wearing it, so that the person in the photo makes sense with the design. A cute cartoon ghost tee should not be modelled by a middle-aged man; a heavy-metal skull tee should not be modelled by a schoolteacher.

THE GARMENT IS A ${audience === 'youth' ? 'YOUTH (CHILD) SIZE' : 'ADULT SIZE'} GARMENT. You may ONLY pick from this list:
${subjects.map((s) => `- ${s.id}: ${s.label} — ${s.persona}`).join('\n')}

Also tell me who the ARTWORK itself is aimed at, honestly, even if that does not match the garment — "kids" for a design clearly made for children, "teen", "adult", or "any" when it genuinely suits anyone.

Respond with STRICT JSON and nothing else, in exactly this shape:
{"subjectId": string, "audience": "kids"|"teen"|"adult"|"any", "subjectMatter": string, "vibe": string, "reason": string}

- "subjectId": one id from the list above, exactly as spelled.
- "audience": who the ARTWORK is for.
- "subjectMatter": what the design depicts, one short phrase.
- "vibe": 1-3 words.
- "reason": ONE short sentence, addressed to a shop owner, saying why this person suits this design. Name something you actually see in the artwork.`

/** Strip ``` fences / stray prose and parse the first JSON object. Mirrors inspiration.ts's parseJsonLoose. */
function parseJsonLoose(raw: string | null | undefined): any {
  if (!raw) return null
  const txt = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = txt.indexOf('{')
  const end = txt.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(txt.slice(start, end + 1))
  } catch {
    return null
  }
}

async function callVisionModel(
  client: OpenAI,
  model: string,
  imageUrl: string,
  context: string,
  subjects: ShotSubject[],
  audience: GarmentAudience,
  garmentLabel: string
): Promise<any> {
  const completion = await client.chat.completions.create({
    model,
    ...(isReasoningModel(model) ? { max_completion_tokens: 500 } : { max_tokens: 500, temperature: 0.4 }),
    messages: [
      { role: 'system', content: systemPrompt(subjects, audience, garmentLabel) },
      {
        role: 'user',
        content: [
          { type: 'text', text: context ? `Cast this design. Listing context: ${context}` : 'Cast this design.' },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
  })
  return parseJsonLoose(completion.choices[0]?.message?.content)
}

/** Never throws — null when every configured vision path fails. */
async function requestCastFromModel(
  imageUrl: string,
  context: string,
  subjects: ShotSubject[],
  audience: GarmentAudience,
  garmentLabel: string
): Promise<any> {
  const viaOpenRouter = openrouterClient()
  if (viaOpenRouter) {
    try {
      const parsed = await callVisionModel(viaOpenRouter, OPENROUTER_VISION_MODEL, imageUrl, context, subjects, audience, garmentLabel)
      if (parsed) return parsed
    } catch (err: any) {
      console.warn('[step-flow/casting] OpenRouter vision call failed, falling back to OpenAI:', err?.message || err)
    }
  }
  const viaOpenAI = openaiClient()
  if (!viaOpenAI) return null
  try {
    return await callVisionModel(viaOpenAI, OPENAI_VISION_MODEL, imageUrl, context, subjects, audience, garmentLabel)
  } catch (err: any) {
    console.warn('[step-flow/casting] OpenAI vision call failed:', err?.message || err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Coercion + the mismatch nudge.
// ---------------------------------------------------------------------------

const clean = (raw: unknown, maxLen: number): string =>
  typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, maxLen) : ''

const DESIGN_AUDIENCES = new Set(['kids', 'teen', 'adult', 'any'])

/** Parse the model's audience read; anything unrecognized becomes 'any' (no opinion). */
export function coerceDesignRead(raw: any): DesignRead | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const audience = clean(raw.audience, 12).toLowerCase()
  const subjectMatter = clean(raw.subjectMatter, 160)
  const vibe = clean(raw.vibe, 60)
  if (!subjectMatter && !vibe && !DESIGN_AUDIENCES.has(audience)) return undefined
  return {
    audience: (DESIGN_AUDIENCES.has(audience) ? audience : 'any') as DesignRead['audience'],
    subjectMatter,
    vibe,
  }
}

/**
 * The nudge, when the artwork is clearly for kids but the listing is an adult
 * garment. Deliberately one-directional: an adult design on a youth tee is the
 * admin deliberately making a kids' version of something, which is fine, while
 * a kids' design on an adult tee is the exact thing David caught.
 */
export function mismatchNote(read: DesignRead | undefined, audience: GarmentAudience): string | undefined {
  if (!read || audience === 'youth') return undefined
  if (read.audience !== 'kids') return undefined
  return (
    'This design reads as a kids\' design, but the garment is an adult size, so the photo has to show an adult. ' +
    'Switch the garment to the Youth T-Shirt to have it modelled by a kid (and to sell youth sizes).'
  )
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export interface CastForDesignOpts {
  /** The artwork the shot will print. No image → keyword-only casting. */
  designUrl?: string | null
  garment: GarmentId
  /** Listing context the keywords also search: product name, the Step Flow idea, Etsy tags. */
  productName?: string
  idea?: string
  tags?: string[]
}

/**
 * Decide who wears this design. Never throws: every failure degrades to the
 * keyword match, and then to the plainest subject in the garment's band.
 */
export async function castForDesign(opts: CastForDesignOpts): Promise<CastingDecision> {
  const audience = audienceForGarment(opts.garment)
  const garmentLabel = getGarment(opts.garment)?.label ?? 'T-Shirt'
  const subjects = listShotSubjects(audience)
  const context = [opts.productName, opts.idea, (opts.tags ?? []).join(' ')].filter(Boolean).join(' — ').slice(0, 500)

  let read: DesignRead | undefined
  if (opts.designUrl) {
    const raw = await requestCastFromModel(opts.designUrl, context, subjects, audience, garmentLabel)
    read = coerceDesignRead(raw)
    const wanted = clean(raw?.subjectId, 40)
    const match = subjects.find((s) => s.id === wanted)
    if (match) {
      const reason = clean(raw?.reason, 240)
      return {
        subjectId: match.id,
        label: match.label,
        audience,
        source: 'mrs-imagine',
        reason: reason || `${match.label} suits this design.`,
        read,
        mismatch: mismatchNote(read, audience),
      }
    }
    // The model answered but named a subject that isn't castable here (or
    // didn't answer at all). Its READ of the design is still useful, so feed
    // it to the keyword pass below rather than throwing it away.
    if (wanted) console.warn(`[step-flow/casting] model picked "${wanted}", not castable on a ${audience} garment — falling back to keywords`)
  }

  const searchText = [context, read?.subjectMatter, read?.vibe].filter(Boolean).join(' ')
  const byKeyword = pickByKeywords(searchText, audience)
  if (byKeyword) {
    return {
      subjectId: byKeyword.id,
      label: byKeyword.label,
      audience,
      source: 'keywords',
      reason: `Matched the ${byKeyword.label} look from this listing's wording.`,
      read,
      mismatch: mismatchNote(read, audience),
    }
  }

  const fallback = defaultSubject(audience)
  return {
    subjectId: fallback.id,
    label: fallback.label,
    audience,
    source: 'default',
    reason:
      audience === 'youth'
        ? 'Nothing specific to go on, so this is an everyday kid.'
        : 'Nothing specific to go on, so this is an everyday adult.',
    read,
    mismatch: mismatchNote(read, audience),
  }
}
