// Tests for design-aware casting (David 2026-09-03: "Mrs. Imagine … should
// adjust what our model looks like based on the design so the person matches
// what they wearing").
//
// These run against the REAL archetype catalog in etsy-model-shots.ts — the
// whole value of this file is "does a cute ghost tee actually find a kid" and
// a fake catalog would test nothing. That module pulls in the real Supabase
// client at import time, so it gets the same stub mock the other suites use
// (etsy-model-shots.test.ts / mrs-imagine.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => ({}), rpc: async () => ({ data: 1 }) } }))

// The vision call, driven per-test. casting.ts builds its client lazily, so
// setting/clearing the API keys below is enough to switch the pass on and off.
const create = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: (...args: any[]) => create(...args) } }
  },
}))

// Jev (services/jev.ts) talks to OpenRouter's decisions endpoint over plain
// fetch — stubbed per test so nothing here ever reaches the network. The
// default is a transport failure, which is what every pre-Jev test expects:
// Jev silent, the old chain casting.
const jevFetch = vi.fn()
vi.stubGlobal('fetch', (...args: any[]) => jevFetch(...args))

const {
  castForDesign,
  pickByKeywords,
  coerceDesignRead,
  mismatchNote,
  manualCast,
  evaluateJevCast,
  buildJevCastQuestions,
  JEV_YOUTH_CAST_MIN_CONFIDENCE,
} = await import('./casting.js')
const { listShotSubjects } = await import('../etsy-model-shots.js')

/** One vision reply, in the shape the model is asked for. */
const reply = (body: Record<string, unknown>) => ({
  choices: [{ message: { content: JSON.stringify(body) } }],
})

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  create.mockReset()
  jevFetch.mockReset()
  jevFetch.mockRejectedValue(new Error('offline'))
  delete process.env.STEP_FLOW_CASTING_JEV
  process.env.OPENROUTER_API_KEY = 'test-key'
  delete process.env.OPENAI_API_KEY
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('pickByKeywords', () => {
  it('matches an adult archetype from the listing wording', () => {
    expect(pickByKeywords('Grill Master Dad BBQ Tee', 'adult')?.id).toBe('dad')
    expect(pickByKeywords('Vintage Skull Horror Halloween Tee', 'adult')?.id).toBe('goth')
  })

  it('stays inside the requested audience', () => {
    // "kid"/"halloween" are youth keywords, but an ADULT garment can never
    // return a youth subject — the photo would advertise a size we don't sell.
    const adult = pickByKeywords('Cute Kids Halloween Ghost Tee', 'adult')
    expect(adult?.audience).toBe('adult')

    const youth = pickByKeywords('Soccer Star Little League Tee', 'youth')
    expect(youth?.id).toBe('kid-sporty')
    expect(youth?.audience).toBe('youth')
  })

  it('returns null when nothing matches, rather than inventing a match', () => {
    expect(pickByKeywords('Zzz Qqq Xyz', 'adult')).toBeNull()
  })

  it('does not fire on a keyword buried inside another word', () => {
    // 'art' must not match "heart", 'kid' must not match "kidney".
    expect(pickByKeywords('Heart Kidney Anatomy Poster', 'adult')).toBeNull()
  })
})

describe('manualCast — the admin picks the model directly', () => {
  it('builds a decision from the id without calling the vision model', () => {
    const decision = manualCast('kid-playful', 'youth-tshirt')
    expect(decision).toMatchObject({ subjectId: 'kid-playful', audience: 'youth', source: 'manual' })
    expect(decision?.reason).toContain('you picked')
    expect(create).not.toHaveBeenCalled()
  })

  it('returns null for a subject the listing cannot sell', () => {
    // 'goth' is a real archetype, but an ADULT one — never castable on a
    // youth tee, admin pick or not.
    expect(manualCast('goth', 'youth-tshirt')).toBeNull()
  })

  // David 2026-09-08: "an adult can buy it too tho so lets make sure i can
  // reshoot with a kid." The shirt sells a youth cut on the same listing, so
  // the kid is a real variant and the admin may cast one.
  it('lets the admin cast a kid on a shirt that also sells youth sizes', () => {
    const decision = manualCast('kid-playful', 'tshirt')
    expect(decision).toMatchObject({ subjectId: 'kid-playful', audience: 'youth', source: 'manual' })
  })

  it('returns null for an unknown id', () => {
    expect(manualCast('not-a-real-subject', 'tshirt')).toBeNull()
  })
})

describe('castForDesign — the catalogue decides the age band', () => {
  it('casts a KID for a kids design on the youth tee', async () => {
    create.mockResolvedValue(
      reply({
        subjectId: 'kid-playful',
        audience: 'kids',
        subjectMatter: 'a smiling cartoon ghost holding a jack-o-lantern candy bucket',
        vibe: 'cute spooky',
        reason: 'The googly-eyed ghost and candy bucket are aimed squarely at trick-or-treaters.',
      })
    )

    const decision = await castForDesign({
      designUrl: 'https://cdn/ghost.png',
      garment: 'youth-tshirt',
      productName: 'Too Cute To Spook Ghost T-Shirt',
    })

    expect(decision.subjectId).toBe('kid-playful')
    expect(decision.audience).toBe('youth')
    expect(decision.source).toBe('mrs-imagine')
    expect(decision.reason).toContain('trick-or-treaters')
    expect(decision.mismatch).toBeUndefined()
  })

  // The exact photo David complained about, twice. The shirt sells a youth cut
  // on the same listing (2026-09-07), so a kid is a real buyable variant and
  // Mrs. Imagine is now allowed to cast one — no warning, no garment swap.
  it('casts a KID for a kids design on a shirt that also sells youth sizes', async () => {
    create.mockResolvedValue(
      reply({
        subjectId: 'kid-playful',
        audience: 'kids',
        subjectMatter: 'a smiling cartoon ghost holding a candy bucket',
        vibe: 'cute spooky',
        reason: 'The googly-eyed ghost and candy bucket are aimed at trick-or-treaters.',
      })
    )

    const decision = await castForDesign({
      designUrl: 'https://cdn/ghost.png',
      garment: 'tshirt',
      productName: 'Too Cute To Spook Ghost T-Shirt',
    })

    expect(decision.subjectId).toBe('kid-playful')
    expect(decision.audience).toBe('youth')
    expect(decision.mismatch).toBeUndefined()
  })

  it('rejects a subject the model picked that is not castable on this garment', async () => {
    // 'goth' is real, but it is an ADULT archetype — asking for it on the
    // youth tee must not sneak an adult into a kids listing.
    create.mockResolvedValue(
      reply({ subjectId: 'goth', audience: 'kids', subjectMatter: 'a soccer ball', vibe: 'sporty', reason: 'x' })
    )

    const decision = await castForDesign({
      designUrl: 'https://cdn/soccer.png',
      garment: 'youth-tshirt',
      productName: 'Soccer Season Tee',
    })

    expect(decision.audience).toBe('youth')
    expect(decision.subjectId).toBe('kid-sporty')
    // Fell through to keywords — and the model's READ of the design was still
    // used, rather than thrown away with its bad pick.
    expect(decision.source).toBe('keywords')
    expect(decision.read?.subjectMatter).toBe('a soccer ball')
  })
})

describe('castForDesign — degrading without a vision pass', () => {
  it('falls back to keywords when the vision call fails', async () => {
    create.mockRejectedValue(new Error('502 upstream'))

    const decision = await castForDesign({
      designUrl: 'https://cdn/art.png',
      garment: 'tshirt',
      productName: 'Grill Master Dad Tee',
    })

    expect(decision.subjectId).toBe('dad')
    expect(decision.source).toBe('keywords')
  })

  it('falls back to keywords when there is no design image to look at', async () => {
    const decision = await castForDesign({ garment: 'tshirt', productName: 'Gym Lift Heavy Tee' })
    expect(decision.subjectId).toBe('gym')
    expect(decision.source).toBe('keywords')
    expect(create).not.toHaveBeenCalled()
  })

  it('lands on the plainest subject in the right band when nothing matches at all', async () => {
    const adult = await castForDesign({ garment: 'tshirt', productName: 'Zzz Qqq' })
    expect(adult).toMatchObject({ subjectId: 'classic', source: 'default', audience: 'adult' })

    const youth = await castForDesign({ garment: 'youth-tshirt', productName: 'Zzz Qqq' })
    expect(youth).toMatchObject({ subjectId: 'kid', source: 'default', audience: 'youth' })
  })

  it('never throws — a garbled reply is just another fallback', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: 'sorry, I cannot do that' } }] })
    const decision = await castForDesign({ designUrl: 'https://cdn/art.png', garment: 'tshirt', productName: 'Zzz' })
    expect(decision.source).toBe('default')
  })
})

describe('coerceDesignRead / mismatchNote', () => {
  it('treats an unrecognized audience as no opinion', () => {
    expect(coerceDesignRead({ audience: 'grandparents', subjectMatter: 'a cat', vibe: 'cozy' })?.audience).toBe('any')
  })

  it('returns undefined for an empty reply', () => {
    expect(coerceDesignRead(null)).toBeUndefined()
    expect(coerceDesignRead({})).toBeUndefined()
  })

  it('only nudges when the listing genuinely cannot sell a youth size', () => {
    const kids = { audience: 'kids' as const, subjectMatter: 'a ghost', vibe: 'cute' }
    const adultRead = { audience: 'adult' as const, subjectMatter: 'a skull', vibe: 'dark' }

    // The permanent rule: no youth size on the listing → no child in the photo.
    expect(mismatchNote(kids, ['adult'])).toMatch(/no youth size/)
    // ...but a listing that sells both bands just casts the kid instead of
    // warning about it (David 2026-09-08), so there is nothing to say.
    expect(mismatchNote(kids, ['adult', 'youth'])).toBeUndefined()
    // An adult-leaning design deliberately made into a kids' tee is fine.
    expect(mismatchNote(adultRead, ['youth'])).toBeUndefined()
    expect(mismatchNote(kids, ['youth'])).toBeUndefined()
    expect(mismatchNote(undefined, ['adult'])).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Jev — the typed decision pass (David 2026-09-23).
// ---------------------------------------------------------------------------

/** One decisions-endpoint body, in the shape Jev returns. */
const jevBody = (subject: [string, number] | null, audience: [string, number] | null) => ({
  model: 'typesafe/jev-1.13',
  answers: {
    ...(subject ? { cast_subject: { type: 'choice', choice: subject[0], confidence: subject[1] } } : {}),
    ...(audience ? { design_audience: { type: 'choice', choice: audience[0], confidence: audience[1] } } : {}),
  },
})
const jevReplies = (subject: [string, number] | null, audience: [string, number] | null) =>
  jevFetch.mockResolvedValue({ ok: true, json: async () => jevBody(subject, audience) })

describe('buildJevCastQuestions — multi-option, described, never yes/no', () => {
  it('offers exactly the castable archetypes, each with a written description', () => {
    const subjects = listShotSubjects(['adult', 'youth'])
    const q = buildJevCastQuestions(subjects)
    expect(q.cast_subject.type).toBe('choice')
    expect(Object.keys(q.cast_subject.criteria).sort()).toEqual(subjects.map((s) => s.id).sort())
    for (const text of Object.values(q.cast_subject.criteria)) expect(String(text).length).toBeGreaterThan(20)
  })

  it('asks design_audience as a three-way choice: adult | youth | either', () => {
    const q = buildJevCastQuestions(listShotSubjects('adult'))
    expect(q.design_audience.type).toBe('choice')
    expect(Object.keys(q.design_audience.criteria).sort()).toEqual(['adult', 'either', 'youth'])
  })

  it('never offers a youth archetype on an adult-only listing', () => {
    const q = buildJevCastQuestions(listShotSubjects('adult'))
    expect(Object.keys(q.cast_subject.criteria)).not.toContain('kid-playful')
  })
})

describe('evaluateJevCast — the confidence gate and the deterministic floor', () => {
  const both = listShotSubjects(['adult', 'youth'])
  const adultOnly = listShotSubjects('adult')
  const floorOf = (id: string) => both.find((s) => s.id === id)!

  it('accepts a confident, consistent pick', () => {
    const { verdict, subject } = evaluateJevCast(jevBody(['dad', 0.93], ['adult', 0.9]) as any, both, floorOf('dad'), 'on')
    expect(subject?.id).toBe('dad')
    expect(verdict).toMatchObject({ verdict: 'accepted', designAudience: 'adult' })
  })

  it('treats a low-confidence pick as no opinion', () => {
    const { verdict, subject } = evaluateJevCast(jevBody(['dad', 0.52], ['adult', 0.9]) as any, both, null, 'on')
    expect(subject).toBeNull()
    expect(verdict.verdict).toBe('low-confidence')
    expect(verdict.note).toMatch(/0\.52/)
  })

  it('rejects an archetype that is not castable on this listing', () => {
    // A kid on an adult-only listing is not in listShotSubjects('adult'), so
    // it is off-menu no matter how sure Jev is.
    const { verdict, subject } = evaluateJevCast(jevBody(['kid-playful', 0.99], ['youth', 0.99]) as any, adultOnly, null, 'on')
    expect(subject).toBeNull()
    expect(verdict.verdict).toBe('rejected')
    expect(verdict.subjectId).toBeUndefined()
  })

  it('drops an unrecognized design_audience rather than inventing one', () => {
    const { verdict } = evaluateJevCast(jevBody(['dad', 0.9], ['grandparents', 0.99]) as any, both, null, 'on')
    expect(verdict.designAudience).toBeUndefined()
  })

  it('needs a CONFIDENT youth design read before casting a child', () => {
    const unsure = evaluateJevCast(
      jevBody(['kid-playful', 0.95], ['youth', JEV_YOUTH_CAST_MIN_CONFIDENCE - 0.05]) as any,
      both,
      null,
      'on'
    )
    expect(unsure.subject).toBeNull()
    expect(unsure.verdict.verdict).toBe('low-confidence')

    const sure = evaluateJevCast(jevBody(['kid-playful', 0.95], ['youth', 0.95]) as any, both, floorOf('kid-playful'), 'on')
    expect(sure.subject?.id).toBe('kid-playful')
  })

  // Jev reads words, not pixels, and a child in the wrong photo is the costly
  // mistake — so even a 1.00/1.00 child pick needs kids' wording behind it.
  it('never casts a child on Jev alone — the wording must point at kids too', () => {
    const { verdict, subject } = evaluateJevCast(jevBody(['kid-sporty', 1], ['youth', 1]) as any, both, null, 'on')
    expect(subject).toBeNull()
    expect(verdict.verdict).toBe('low-confidence')
    expect(verdict.note).toMatch(/wording points at kids/)
  })

  it('rejects an adult pick for a design Jev itself reads as for kids', () => {
    const { verdict } = evaluateJevCast(jevBody(['dad', 0.95], ['youth', 0.95]) as any, both, null, 'on')
    expect(verdict.verdict).toBe('rejected')
  })

  it('keeps the keyword floor: never crosses the age band the wording matched', () => {
    const { verdict, subject } = evaluateJevCast(jevBody(['kid-playful', 0.95], ['youth', 0.95]) as any, both, floorOf('dad'), 'on')
    expect(subject).toBeNull()
    expect(verdict.verdict).toBe('rejected')
    expect(verdict.note).toMatch(/wording matched/)
  })

  it('may pick a different archetype in the SAME band as the keyword floor', () => {
    const { subject } = evaluateJevCast(jevBody(['goth', 0.9], ['adult', 0.9]) as any, both, floorOf('dad'), 'on')
    expect(subject?.id).toBe('goth')
  })

  it('reports unavailable when Jev did not answer', () => {
    expect(evaluateJevCast(null, both, null, 'on').verdict.verdict).toBe('unavailable')
  })
})

describe('castForDesign — STEP_FLOW_CASTING_JEV=on', () => {
  beforeEach(() => {
    process.env.STEP_FLOW_CASTING_JEV = 'on'
  })

  it('casts from Jev when it is confident, without spending a vision call', async () => {
    jevReplies(['dad', 0.94], ['adult', 0.91])
    const decision = await castForDesign({ designUrl: 'https://cdn/bbq.png', garment: 'tshirt', productName: 'Grill Master Dad Tee' })
    expect(decision).toMatchObject({ subjectId: 'dad', source: 'jev', audience: 'adult', designAudience: 'adult' })
    expect(decision.jev?.verdict).toBe('accepted')
    expect(decision.needsReview).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
  })

  it('every archetype Jev casts belongs to listShotSubjects(bands)', async () => {
    const subjects = listShotSubjects(['adult', 'youth'])
    const castable = new Set(subjects.map((s) => s.id))
    for (const s of subjects) {
      jevReplies([s.id, 0.97], [s.audience === 'youth' ? 'youth' : 'either', 0.97])
      const decision = await castForDesign({ garment: 'tshirt', productName: 'Zzz Qqq' })
      // No kids' wording in 'Zzz Qqq', so a child pick falls back (see the
      // keyword-floor rule) — either way the cast is on the menu.
      expect(decision.source).toBe(s.audience === 'youth' ? 'default' : 'jev')
      expect(castable.has(decision.subjectId)).toBe(true)
      if (decision.source === 'jev') expect(['adult', 'youth', 'either']).toContain(decision.designAudience)
    }
    // ...and an off-menu id never gets through.
    jevReplies(['not-a-real-subject', 0.99], ['adult', 0.99])
    const offMenu = await castForDesign({ garment: 'tshirt', productName: 'Zzz Qqq' })
    expect(castable.has(offMenu.subjectId)).toBe(true)
    expect(offMenu.source).toBe('default')
  })

  it('low confidence falls back to the vision pass and flags the row for review', async () => {
    jevReplies(['dad', 0.4], ['adult', 0.5])
    create.mockResolvedValue(
      reply({ subjectId: 'goth', audience: 'adult', subjectMatter: 'a skull', vibe: 'dark', reason: 'Skull art suits the goth look.' })
    )
    const decision = await castForDesign({ designUrl: 'https://cdn/skull.png', garment: 'tshirt', productName: 'Midnight Tee' })
    expect(decision.source).toBe('mrs-imagine')
    expect(decision.subjectId).toBe('goth')
    expect(decision.jev?.verdict).toBe('low-confidence')
    expect(decision.needsReview).toMatch(/pick the model yourself/)
    expect(decision.designAudience).toBe('adult')
  })

  it('low confidence with no image falls to the keyword floor, still flagged', async () => {
    jevReplies(['goth', 0.3], null)
    const decision = await castForDesign({ garment: 'tshirt', productName: 'Gym Lift Heavy Tee' })
    expect(decision).toMatchObject({ subjectId: 'gym', source: 'keywords' })
    expect(decision.needsReview).toBeTruthy()
  })

  it('a nameless, tagless design never asks Jev — it goes straight to vision', async () => {
    create.mockResolvedValue(
      reply({ subjectId: 'kid-playful', audience: 'kids', subjectMatter: 'a cartoon ghost', vibe: 'cute', reason: 'A cute ghost for kids.' })
    )
    const decision = await castForDesign({ designUrl: 'https://cdn/ghost.png', garment: 'tshirt', tags: ['  '] })
    expect(jevFetch).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
    expect(decision).toMatchObject({ subjectId: 'kid-playful', source: 'mrs-imagine', designAudience: 'youth' })
    expect(decision.jev).toBeUndefined()
  })

  it('a Jev outage degrades to the old chain without throwing', async () => {
    jevFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const decision = await castForDesign({ garment: 'tshirt', productName: 'Grill Master Dad Tee' })
    expect(decision).toMatchObject({ subjectId: 'dad', source: 'keywords' })
    expect(decision.jev?.verdict).toBe('unavailable')
  })
})

describe('castForDesign — shadow (the default) and off', () => {
  it('shadow: the old chain casts, Jev is only recorded', async () => {
    jevReplies(['goth', 0.95], ['adult', 0.95])
    const decision = await castForDesign({ garment: 'tshirt', productName: 'Grill Master Dad Tee' })
    expect(decision).toMatchObject({ subjectId: 'dad', source: 'keywords' })
    expect(decision.jev).toMatchObject({ verdict: 'accepted', subjectId: 'goth', mode: 'shadow' })
    expect(decision.needsReview).toBeUndefined()
  })

  it('off: Jev is never called', async () => {
    process.env.STEP_FLOW_CASTING_JEV = 'off'
    const decision = await castForDesign({ garment: 'tshirt', productName: 'Grill Master Dad Tee' })
    expect(jevFetch).not.toHaveBeenCalled()
    expect(decision.jev).toBeUndefined()
  })

  it('JEV=off is the fleet-wide kill switch, even with casting set to on', async () => {
    process.env.STEP_FLOW_CASTING_JEV = 'on'
    process.env.JEV = 'off'
    const decision = await castForDesign({ garment: 'tshirt', productName: 'Grill Master Dad Tee' })
    expect(jevFetch).not.toHaveBeenCalled()
    expect(decision.source).toBe('keywords')
  })
})

describe('mismatchNote — also reads the three-way design_audience', () => {
  it('nudges on a youth design_audience only when the listing sells no youth size', () => {
    expect(mismatchNote(undefined, ['adult'], 'youth')).toMatch(/no youth size/)
    expect(mismatchNote(undefined, ['adult', 'youth'], 'youth')).toBeUndefined()
    expect(mismatchNote(undefined, ['adult'], 'either')).toBeUndefined()
  })
})
