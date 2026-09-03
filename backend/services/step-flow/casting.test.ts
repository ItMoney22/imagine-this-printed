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

const { castForDesign, pickByKeywords, coerceDesignRead, mismatchNote } = await import('./casting.js')

/** One vision reply, in the shape the model is asked for. */
const reply = (body: Record<string, unknown>) => ({
  choices: [{ message: { content: JSON.stringify(body) } }],
})

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  create.mockReset()
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

describe('castForDesign — the garment decides the age band', () => {
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

  it('never casts a kid on an adult garment, and says so instead', async () => {
    create.mockResolvedValue(
      reply({
        subjectId: 'classic',
        audience: 'kids',
        subjectMatter: 'a smiling cartoon ghost',
        vibe: 'cute spooky',
        reason: 'Soft and friendly.',
      })
    )

    const decision = await castForDesign({
      designUrl: 'https://cdn/ghost.png',
      garment: 'tshirt',
      productName: 'Too Cute To Spook Ghost T-Shirt',
    })

    expect(decision.audience).toBe('adult')
    // The nudge David actually needs: the flow tells him to switch garments
    // rather than silently shooting the wrong person (or the wrong size).
    expect(decision.mismatch).toMatch(/Youth T-Shirt/)
    expect(decision.mismatch).toMatch(/kids/)
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

  it('only nudges for a kids design on an adult garment', () => {
    const kids = { audience: 'kids' as const, subjectMatter: 'a ghost', vibe: 'cute' }
    const adultRead = { audience: 'adult' as const, subjectMatter: 'a skull', vibe: 'dark' }

    expect(mismatchNote(kids, 'adult')).toBeTruthy()
    // An adult-leaning design deliberately made into a kids' tee is fine.
    expect(mismatchNote(adultRead, 'youth')).toBeUndefined()
    expect(mismatchNote(kids, 'youth')).toBeUndefined()
    expect(mismatchNote(undefined, 'adult')).toBeUndefined()
  })
})
