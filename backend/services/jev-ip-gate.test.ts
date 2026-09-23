import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  decide,
  combine,
  classifyIpBatch,
  runCopyrightGateWithJev,
  listingText,
  designPromptOf,
  resetJevIpCache,
  type JevFetch
} from './jev-ip-gate.js'
import { runCopyrightGate } from './etsy-copyright-gate.js'

type Probs = Partial<Record<'clean' | 'generic_theme' | 'likely_ip_reference' | 'definite_brand_or_character', number>>
const answer = (choice: string, confidence: number, probabilities?: Probs) => ({ type: 'choice' as const, choice, confidence, probabilities })

/** A fake Jev that answers from a title → answer map, the way the live lane would. */
function fakeJev(byTitle: Record<string, ReturnType<typeof answer>>): JevFetch & { calls: number } {
  const fn: any = vi.fn(async (state: Record<string, string>) => {
    fn.calls++
    const out: Record<string, any> = {}
    for (const [label, text] of Object.entries(state)) {
      const hit = Object.entries(byTitle).find(([t]) => text.includes(`title: ${t}`))
      if (hit) out[label] = hit[1]
    }
    return out
  })
  fn.calls = 0
  return fn
}

beforeEach(() => resetJevIpCache())

describe('decide — the confidence gate', () => {
  it('passes a confidently generic theme', () => {
    const d = decide(answer('generic_theme', 0.96, { clean: 0.02, generic_theme: 0.96, likely_ip_reference: 0.02 }))
    expect(d.verdict).toBe('pass')
    expect(d.safeProbability).toBeCloseTo(0.98)
  })

  it('passes when clean vs generic is split but the SAFE mass is high', () => {
    // "Taco Tuesday Squad" measured live: clean 0.46 — mushy between the two safe tiers, not unsafe.
    const d = decide(answer('clean', 0.46, { clean: 0.46, generic_theme: 0.44, likely_ip_reference: 0.1 }))
    expect(d.verdict).toBe('pass')
  })

  it('routes a low-confidence clean answer to a human', () => {
    const d = decide(answer('clean', 0.55, { clean: 0.55, generic_theme: 0.1, likely_ip_reference: 0.3, definite_brand_or_character: 0.05 }))
    expect(d.verdict).toBe('review')
    expect(d.reason).toMatch(/human/)
  })

  it('flags a paraphrase for review at any confidence', () => {
    expect(decide(answer('likely_ip_reference', 0.98)).verdict).toBe('review')
    expect(decide(answer('likely_ip_reference', 0.41)).verdict).toBe('review')
  })

  it('blocks a confident named brand, reviews an unsure one', () => {
    expect(decide(answer('definite_brand_or_character', 0.98)).verdict).toBe('block')
    expect(decide(answer('definite_brand_or_character', 0.63)).verdict).toBe('review')
  })

  it('treats a missing / off-menu / malformed answer as unavailable, never as a default', () => {
    expect(decide(undefined).verdict).toBe('unavailable')
    expect(decide(answer('probably_fine', 0.99)).verdict).toBe('unavailable')
    expect(decide({ type: 'choice', choice: 'clean' } as any).verdict).toBe('unavailable')
  })

  it('honours a custom bar', () => {
    const a = answer('generic_theme', 0.82, { generic_theme: 0.82, likely_ip_reference: 0.18 })
    expect(decide(a, 0.8).verdict).toBe('pass')
    expect(decide(a, 0.9).verdict).toBe('review')
  })
})

describe('combine — regex is a floor', () => {
  const regexPass = runCopyrightGate({ name: 'Stoic Samurai Cherry Blossom Tee' })
  const regexFail = runCopyrightGate({ name: 'Pikachu Birthday Shirt' })
  const flagged = decide(answer('likely_ip_reference', 0.97))
  const clean = decide(answer('generic_theme', 0.97, { generic_theme: 0.97 }))

  it('Jev can never unblock a regex hit', () => {
    const r = combine(regexFail, clean, 'enforce')
    expect(r.pass).toBe(false)
    expect(r.matchedTerms).toContain('pikachu')
  })

  it('enforce: a Jev flag blocks a regex pass and says why', () => {
    const r = combine(regexPass, flagged, 'enforce')
    expect(r.pass).toBe(false)
    expect(r.jevFlagged).toBe(true)
    expect(r.reasons.join(' ')).toMatch(/Jev/)
  })

  it('shadow: the flag is recorded but does not change the outcome', () => {
    const r = combine(regexPass, flagged, 'shadow')
    expect(r.pass).toBe(true)
    expect(r.jevFlagged).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('an unavailable lane fails open to the regex result', () => {
    const r = combine(regexPass, decide(undefined), 'enforce')
    expect(r.pass).toBe(true)
    expect(r.jevFlagged).toBe(false)
  })
})

describe('runCopyrightGateWithJev', () => {
  it('does not ask Jev when the regex already blocked', async () => {
    const jev = fakeJev({})
    const r = await runCopyrightGateWithJev({ name: 'FIFA World Cup 2026 Tee' }, { fetchImpl: jev, mode: 'enforce' })
    expect(r.pass).toBe(false)
    expect(jev.calls).toBe(0)
    expect(r.jev).toBeUndefined()
  })

  it('catches the paraphrases the denylist misses (regression set)', async () => {
    const jev = fakeJev({
      'Wizard School Sorting Hat Tee': answer('likely_ip_reference', 0.98),
      'Yellow Electric Mouse Catch Em All Shirt': answer('likely_ip_reference', 0.89),
      'Mouse Ears Castle Magic Kingdom Family Trip': answer('likely_ip_reference', 0.97),
      'Just Do It Swoosh Running Tee': answer('definite_brand_or_character', 0.63),
      'Swiftie Eras Friendship Bracelet Tee': answer('definite_brand_or_character', 0.96)
    })
    for (const name of [
      'Wizard School Sorting Hat Tee',
      'Yellow Electric Mouse Catch Em All Shirt',
      'Mouse Ears Castle Magic Kingdom Family Trip',
      'Just Do It Swoosh Running Tee',
      'Swiftie Eras Friendship Bracelet Tee'
    ]) {
      // The floor really does miss every one of these — that is the gap.
      expect(runCopyrightGate({ name }).pass).toBe(true)
      const r = await runCopyrightGateWithJev({ name }, { fetchImpl: jev, mode: 'enforce' })
      expect(r.pass, name).toBe(false)
    }
  })

  it('passes clean originals', async () => {
    const jev = fakeJev({ 'Graffiti Roaring Lion Face': answer('generic_theme', 0.9, { clean: 0.05, generic_theme: 0.9, likely_ip_reference: 0.05 }) })
    const r = await runCopyrightGateWithJev({ name: 'Graffiti Roaring Lion Face' }, { fetchImpl: jev, mode: 'enforce' })
    expect(r.pass).toBe(true)
    expect(r.jev?.verdict).toBe('pass')
  })

  it('fails open when the lane is down', async () => {
    const down: JevFetch = async () => null
    const r = await runCopyrightGateWithJev({ name: 'Retro Sunset Mountain Tee' }, { fetchImpl: down, mode: 'enforce' })
    expect(r.pass).toBe(true)
    expect(r.jev?.verdict).toBe('unavailable')
  })

  it('off mode never calls Jev', async () => {
    const jev = fakeJev({})
    await runCopyrightGateWithJev({ name: 'Anything' }, { fetchImpl: jev, mode: 'off' })
    expect(jev.calls).toBe(0)
  })
})

describe('classifyIpBatch', () => {
  it('batches listings and maps answers back to ids', async () => {
    const jev = fakeJev({ A: answer('generic_theme', 0.95, { generic_theme: 0.95 }), B: answer('likely_ip_reference', 0.9) })
    const out = await classifyIpBatch({ id1: { name: 'A' }, id2: { name: 'B' }, id3: { name: 'C' } }, { fetchImpl: jev, batchSize: 2 })
    expect(jev.calls).toBe(2)
    expect(out.id1.verdict).toBe('pass')
    expect(out.id2.verdict).toBe('review')
    expect(out.id3.verdict).toBe('unavailable')
  })
})

describe('helpers', () => {
  it('listingText includes the design prompt and clips long fields', () => {
    const t = listingText({ name: 'X', tags: ['a', 'b'], designPrompt: 'p'.repeat(2000), description: 'd' })
    expect(t).toContain('title: X')
    expect(t).toContain('tags: a, b')
    expect(t).toContain('design prompt: ' + 'p'.repeat(600) + ' |')
  })

  it('designPromptOf reads whichever key the pipeline used', () => {
    expect(designPromptOf({ image_prompt: 'lion' })).toBe('lion')
    expect(designPromptOf({ original_prompt: 'a', image_prompt: 'b' })).toBe('a')
    expect(designPromptOf(null)).toBeUndefined()
  })
})
