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
//   • The CATALOGUE decides which age bands are even possible — a photo may
//     never advertise a size we don't sell. That is a capability fact
//     (`photographableAudiences` in shared/catalog-capability.ts), enforced
//     again in etsy-model-shots.ts's resolveCast, and nothing in this file can
//     override it.
//   • The DESIGN decides who, within what the catalogue allows — the goth for
//     horror art, the mom for a mama tee, the playful kid for a cute ghost.
//     That is this file's job.
//
// Those two used to collapse into "the GARMENT decides the age band", which
// meant a kids' design on an adult tee got the best available adult plus a
// `mismatch` note telling the admin to go switch garments. That rule expired
// on 2026-09-07, when shirts and hoodies gained a youth cut sold on the SAME
// listing: the adult tee ships YXS-YXL on a 5000B, so a child in its photo is
// a real buyable variant, not a false promise. David 2026-09-08, looking at
// that stale warning on his ghost tee: "it saying i gotta switch the garment
// size but where do i do that plus an adult can buy it too tho so lets make
// sure i can reshoot with a kid." So the age band now follows the ARTWORK
// wherever the listing sells both bands, and the admin can override the pick
// outright (see manualCast). The mismatch note survives only for a listing
// that genuinely sells no youth size — where the old warning is still true.
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
  photographableAudiences,
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
  /**
   * The age band of the person in the photo — the CAST's, which on a listing
   * that sells both bands may be the youth one even though the blank is an
   * adult cut. Always one of `photographableAudiences(garment)`, so it can
   * never name a band this listing doesn't sell.
   */
  audience: GarmentAudience
  /** One plain sentence for the panel: why this person is wearing this design. */
  reason: string
  /** Where the decision came from, so a bad cast is explainable. */
  source: 'mrs-imagine' | 'keywords' | 'default' | 'manual'
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
 * Best keyword-matched subject for `text`, restricted to `audience` — a single
 * band, or every band this listing may be photographed on. Returns null when
 * nothing matches at all, so the caller can say "default" honestly instead of
 * dressing up a random pick as a decision.
 */
export function pickByKeywords(
  text: string,
  audience: GarmentAudience | GarmentAudience[]
): ShotSubject | null {
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

/**
 * Skip Mrs. Imagine entirely — the admin already knows who they want (David
 * 2026-09-08: "I should be able to say who I want the mock up to be").
 * Still bound by the same garment-audience wall as every other path here: a
 * youth subject can never be forced onto an adult garment or vice versa, so
 * an id outside `garment`'s castable list returns null and the caller
 * decides how to handle that (reject the request rather than silently
 * falling back to a random cast — the admin asked for a SPECIFIC person).
 */
export function manualCast(subjectId: string, garment: GarmentId): CastingDecision | null {
  const subject = listShotSubjects(photographableAudiences(garment)).find((s) => s.id === subjectId)
  if (!subject) return null
  return {
    subjectId: subject.id,
    label: subject.label,
    audience: subject.audience,
    source: 'manual',
    reason: `${subject.label} — you picked this person for the shot.`,
  }
}

// ---------------------------------------------------------------------------
// The vision call.
// ---------------------------------------------------------------------------

/** What the listing sells, in the one sentence the model needs to cast it. */
const bandSentence = (bands: GarmentAudience[]): string => {
  const youth = bands.includes('youth')
  const adult = bands.includes('adult')
  if (youth && adult) {
    return (
      'THIS LISTING SELLS BOTH ADULT SIZES AND YOUTH (KID) SIZES, so it may be modelled by an adult OR by a ' +
      'child — whichever the artwork is really for. If the design is plainly made for children, cast a kid.'
    )
  }
  if (youth) return 'THE GARMENT IS A YOUTH (CHILD) SIZE GARMENT, so it must be modelled by a child.'
  return 'THE GARMENT IS AN ADULT SIZE GARMENT, so it must be modelled by an adult.'
}

const systemPrompt = (subjects: ShotSubject[], bands: GarmentAudience[], garmentLabel: string): string =>
  `You are Mrs. Imagine, Imagine This Printed's art director. You are casting the model for ONE product photo: a ${garmentLabel} printed with the artwork you are shown.

Your job is to pick who should be wearing it, so that the person in the photo makes sense with the design. A cute cartoon ghost tee should not be modelled by a middle-aged man; a heavy-metal skull tee should not be modelled by a schoolteacher.

${bandSentence(bands)} You may ONLY pick from this list:
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
  bands: GarmentAudience[],
  garmentLabel: string
): Promise<any> {
  const completion = await client.chat.completions.create({
    model,
    ...(isReasoningModel(model) ? { max_completion_tokens: 500 } : { max_tokens: 500, temperature: 0.4 }),
    messages: [
      { role: 'system', content: systemPrompt(subjects, bands, garmentLabel) },
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
  bands: GarmentAudience[],
  garmentLabel: string
): Promise<any> {
  const viaOpenRouter = openrouterClient()
  if (viaOpenRouter) {
    try {
      const parsed = await callVisionModel(viaOpenRouter, OPENROUTER_VISION_MODEL, imageUrl, context, subjects, bands, garmentLabel)
      if (parsed) return parsed
    } catch (err: any) {
      console.warn('[step-flow/casting] OpenRouter vision call failed, falling back to OpenAI:', err?.message || err)
    }
  }
  const viaOpenAI = openaiClient()
  if (!viaOpenAI) return null
  try {
    return await callVisionModel(viaOpenAI, OPENAI_VISION_MODEL, imageUrl, context, subjects, bands, garmentLabel)
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
 * The nudge, for the ONE case that is still a real dead end: the artwork is
 * clearly for kids and this listing sells no youth size at all, so a child
 * genuinely cannot be photographed in it.
 *
 * Every garment ITP sells today carries a youth cut (2026-09-07), so in
 * practice this no longer fires — a kids' design now simply gets a kid, and
 * the admin can pick one by hand regardless. It stays because the rule it
 * encodes ("never photograph a size we don't sell") is permanent even though
 * today's catalogue happens to satisfy it everywhere.
 */
export function mismatchNote(
  read: DesignRead | undefined,
  bands: GarmentAudience[]
): string | undefined {
  if (!read || bands.includes('youth')) return undefined
  if (read.audience !== 'kids') return undefined
  return (
    "This design reads as a kids' design, but this listing sells no youth size, so the photo has to show an " +
    'adult. Add a youth cut to this garment if you want a kid in the picture.'
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
 * keyword match, and then to the plainest subject in the garment's OWN band.
 *
 * The vision pass and the keyword pass both see every band this listing sells,
 * so a kids' design on a shirt that also sells youth sizes casts a kid. The
 * final no-signal fallback deliberately does NOT: with nothing to go on, the
 * everyday adult is the answer that never puts a child in a photo by accident.
 */
export async function castForDesign(opts: CastForDesignOpts): Promise<CastingDecision> {
  const bands = photographableAudiences(opts.garment)
  const garmentLabel = getGarment(opts.garment)?.label ?? 'T-Shirt'
  const subjects = listShotSubjects(bands)
  const context = [opts.productName, opts.idea, (opts.tags ?? []).join(' ')].filter(Boolean).join(' — ').slice(0, 500)

  let read: DesignRead | undefined
  if (opts.designUrl) {
    const raw = await requestCastFromModel(opts.designUrl, context, subjects, bands, garmentLabel)
    read = coerceDesignRead(raw)
    const wanted = clean(raw?.subjectId, 40)
    const match = subjects.find((s) => s.id === wanted)
    if (match) {
      const reason = clean(raw?.reason, 240)
      return {
        subjectId: match.id,
        label: match.label,
        audience: match.audience,
        source: 'mrs-imagine',
        reason: reason || `${match.label} suits this design.`,
        read,
        mismatch: mismatchNote(read, bands),
      }
    }
    // The model answered but named a subject that isn't castable here (or
    // didn't answer at all). Its READ of the design is still useful, so feed
    // it to the keyword pass below rather than throwing it away.
    if (wanted) console.warn(`[step-flow/casting] model picked "${wanted}", not castable on this listing (${bands.join('/')}) — falling back to keywords`)
  }

  const searchText = [context, read?.subjectMatter, read?.vibe].filter(Boolean).join(' ')
  const byKeyword = pickByKeywords(searchText, bands)
  if (byKeyword) {
    return {
      subjectId: byKeyword.id,
      label: byKeyword.label,
      audience: byKeyword.audience,
      source: 'keywords',
      reason: `Matched the ${byKeyword.label} look from this listing's wording.`,
      read,
      mismatch: mismatchNote(read, bands),
    }
  }

  const ownBand = audienceForGarment(opts.garment)
  const fallback = defaultSubject(ownBand)
  return {
    subjectId: fallback.id,
    label: fallback.label,
    audience: fallback.audience,
    source: 'default',
    reason:
      ownBand === 'youth'
        ? 'Nothing specific to go on, so this is an everyday kid.'
        : 'Nothing specific to go on, so this is an everyday adult.',
    read,
    mismatch: mismatchNote(read, bands),
  }
}
