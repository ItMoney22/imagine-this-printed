// Tests for garment-aware wording in the on-model shot prompt builders
// (David 2026-09-01: hoodies were being shot as a "crew neck t-shirt" because
// the wording was hardcoded in both the gpt-image and nano-banana prompt
// builders — garment-true mockups only, going forward).
//
// mrs-imagine.ts/etsy-model-shots.ts pull in the real Supabase client at
// import time, which throws without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// set — same stub-mock pattern as design-qa-gate.test.ts / mrs-imagine.test.ts,
// needed here purely so the module graph imports cleanly for these
// pure-function tests.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => ({}), rpc: async () => ({ data: 1 }) } }))

import { buildGptPrompt, buildNanoPrompt, resolveCast, composeSubject, listShotSubjects, ShotCastError, type ShotPlan } from './etsy-model-shots.js'

function plan(over: Partial<ShotPlan> = {}): ShotPlan {
  return {
    key: 'shot1',
    label: 'classic',
    persona: 'a mid-thirties average-build white person with an easy everyday style, loose wavy hair, with light freckles across the nose, a calm neutral look straight down the lens, hands in their pockets',
    scene: 'in a clean bright studio with soft even daylight, front-facing, relaxed confident pose',
    treatment: 'shot on a 50mm lens at f/2.8 in natural window light',
    signature: 'classic · mid-thirties · average-build · white',
    variant: 'ABCD12',
    ...over,
  }
}

describe('buildGptPrompt — garment-aware wearing clause', () => {
  it('uses the supplied garment noun instead of the old hardcoded shirt', () => {
    const p = buildGptPrompt(plan(), 'black', 'front-center', 11, 'pullover hoodie')
    expect(p).toMatch(/wearing a black pullover hoodie/i)
    expect(p).not.toMatch(/crew neck t-shirt/i)
  })

  it('defaults to "crew neck t-shirt" when no noun is supplied (back-compat for existing callers)', () => {
    const p = buildGptPrompt(plan(), 'black', 'front-center', 11)
    expect(p).toMatch(/crew neck t-shirt/i)
  })

  it('takes the metal-art (no-persona) branch untouched by the garment noun', () => {
    const metalPlan = plan({ persona: null, metalSize: '4x6' })
    const p = buildGptPrompt(metalPlan, 'black', 'front-center', 11, 'pullover hoodie')
    expect(p).not.toMatch(/hoodie/i)
    expect(p).toMatch(/metal print panel/i)
  })
})

describe('buildNanoPrompt — garment-aware wearing clause', () => {
  it('uses the supplied garment noun instead of the old hardcoded shirt', () => {
    const p = buildNanoPrompt(plan(), 'black', 'front-center', 11, 'pullover hoodie')
    expect(p).toMatch(/wearing a black pullover hoodie/i)
    expect(p).not.toMatch(/crew neck t-shirt/i)
  })

  it('defaults to "crew neck t-shirt" when no noun is supplied', () => {
    const p = buildNanoPrompt(plan(), 'black', 'front-center', 11)
    expect(p).toMatch(/crew neck t-shirt/i)
  })

  it('still discards the stock reference photo\'s identity regardless of garment', () => {
    const p = buildNanoPrompt(plan(), 'white', 'front-center', 11, 'pullover hoodie')
    expect(p).toMatch(/DISCARD the person in INPUT 1/i)
  })
})

// David 2026-09-03 — the youth lane. A kids' design is now photographed on a
// kid (on the youth tee, which the catalogue actually sells), so the prompt
// tail can no longer just assert "the model is clearly an adult" for every
// shot. These pin the wording that keeps a youth render a children's-catalog
// photograph and nothing else.
describe('youth shots — audience-aware prompt wording', () => {
  const youthPlan = (over: Partial<ShotPlan> = {}) =>
    plan({
      label: 'kid',
      audience: 'youth',
      persona: 'an eight-year-old small-framed Black girl with easy everyday kid energy, two braids and a bucket hat pushed back, with freckles across the nose, a big unguarded grin, hands in their pockets',
      scene: 'in a sunny back yard with the fence softly out of focus behind them',
      ...over,
    })

  it('drops the adult assertion and states the child/youth-size framing instead', () => {
    const p = buildGptPrompt(youthPlan(), 'black', 'front-center', 8, 'youth crew neck t-shirt')
    expect(p).toMatch(/school-age child/i)
    expect(p).toMatch(/youth-size t-shirt/i)
    expect(p).not.toMatch(/clearly an adult/i)
  })

  it('carries the children\'s-catalog framing and its explicit exclusions', () => {
    const p = buildGptPrompt(youthPlan(), 'black', 'front-center', 8, 'youth crew neck t-shirt')
    expect(p).toMatch(/children's clothing catalog/i)
    expect(p).toMatch(/fully and modestly dressed/i)
    expect(p).toMatch(/no swimwear or underwear/i)
    expect(p).toMatch(/no suggestive pose/i)
    // The adult "everyday people" pool talks about jawlines and beauty
    // filters — not language to point at a child.
    expect(p).not.toMatch(/impossible jawline/i)
  })

  it('scales the print to the youth body, not the adult 11 inches', () => {
    const p = buildGptPrompt(youthPlan(), 'black', 'front-center', 8, 'youth crew neck t-shirt')
    expect(p).toMatch(/8-inch youth front print/i)
    expect(p).not.toMatch(/adult front print/i)
  })

  it('keeps the adult wording untouched for an adult shot', () => {
    const p = buildGptPrompt(plan(), 'black', 'front-center', 11)
    expect(p).toMatch(/clearly an adult/i)
    expect(p).toMatch(/11-inch adult front print/i)
    expect(p).not.toMatch(/children's clothing catalog/i)
  })

  it('gives a youth nano-banana shot no adult stock anchor to copy', () => {
    const p = buildNanoPrompt(youthPlan(), 'black', 'front-center', 8, 'youth crew neck t-shirt')
    // The two stock anchors are adults; the youth branch is design-only, so
    // there is no INPUT 1 person to discard in the first place.
    expect(p).not.toMatch(/INPUT 1/i)
    expect(p).toMatch(/children's-apparel catalog photograph/i)
  })

  it('renders the empty-garment fallback with nobody in frame at all', () => {
    // Both engines declining a child subject must not produce an adult — it
    // produces the shirt on its own (see generateOneShot).
    const p = buildGptPrompt(youthPlan({ noModel: true }), 'black', 'front-center', 8, 'youth crew neck t-shirt')
    expect(p).toMatch(/EMPTY, with nobody wearing it/i)
    expect(p).toMatch(/No model, no mannequin, no hands/i)
    expect(p).not.toMatch(/eight-year-old/i)
    // Still the same design-fidelity contract as every other shot.
    expect(p).toMatch(/DESIGN FIDELITY/)
  })
})

// The hard boundary: WHO may be photographed is decided by the garment, not
// by the design, the prompt or a random draw. resolveCast is the server-side
// enforcement point every shoot entry passes through.
describe('resolveCast — the garment decides the age band', () => {
  it('refuses a youth subject on an adult garment, and explains why', () => {
    expect(() => resolveCast({ subjects: ['kid'] }, 'adult')).toThrow(ShotCastError)
    expect(() => resolveCast({ subjects: ['kid'] }, 'adult')).toThrow(/Youth T-Shirt/)
  })

  it('refuses an adult subject on a youth garment', () => {
    expect(() => resolveCast({ subjects: ['goth'] }, 'youth')).toThrow(ShotCastError)
  })

  it('accepts a matching subject on each side', () => {
    expect(resolveCast({ subjects: ['goth'] }, 'adult')[0].label).toBe('goth')
    expect(resolveCast({ subjects: ['kid-sporty'] }, 'youth')[0].label).toBe('sporty kid')
  })

  it('defaults to adult when no audience is given (every pre-youth caller)', () => {
    expect(resolveCast({ subjects: ['dad'] })[0].label).toBe('dad')
    expect(() => resolveCast({ subjects: ['kid'] })).toThrow(ShotCastError)
  })

  it('never lets free text describe a child, on either garment', () => {
    expect(() => resolveCast({ custom: 'a 7 year old boy in a park' }, 'adult')).toThrow(/adult/i)
    // Even on the youth tee: the only path to a child render is the curated,
    // fixed-wording archetypes.
    expect(() => resolveCast({ custom: 'a cheerful young girl' }, 'youth')).toThrow(ShotCastError)
    expect(() => resolveCast({ custom: 'a woman in her thirties' }, 'youth')).toThrow(/adults only/i)
  })
})

describe('youth casting pools', () => {
  it('offers kid subjects only for youth and adult subjects only for adults', () => {
    const youth = listShotSubjects('youth').map((s) => s.id)
    const adult = listShotSubjects('adult').map((s) => s.id)
    expect(youth).toContain('kid')
    expect(youth).not.toContain('goth')
    expect(adult).toContain('goth')
    expect(adult).not.toContain('kid')
    // No argument = the full catalog, which the Etsy panel still lists.
    expect(listShotSubjects().length).toBe(youth.length + adult.length)
  })

  it('dresses a kid from the youth trait pools, never the adult ones', () => {
    const archetype = (listShotSubjects('youth').find((s) => s.id === 'kid')!)
    // composeSubject takes the internal CastMember shape; rebuild it the way
    // resolveCast does so this exercises the real pools.
    const member = resolveCast({ subjects: [archetype.id] }, 'youth')[0]
    for (let i = 0; i < 40; i++) {
      const { persona } = composeSubject(member)
      expect(persona).toMatch(/year-old/)
      // Adult-only trait pools that would be grotesque on a child.
      expect(persona).not.toMatch(/tattoo|piercing|acne|farmer tan|wedding band|stubble/i)
    }
  })
})
