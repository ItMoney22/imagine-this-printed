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

import { buildGptPrompt, buildNanoPrompt, type ShotPlan } from './etsy-model-shots.js'

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
