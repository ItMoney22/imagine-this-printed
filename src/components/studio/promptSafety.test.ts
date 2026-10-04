import { describe, it, expect } from 'vitest'
import { isSensitivityRefusal, softenPrompt } from './promptSafety'

describe('isSensitivityRefusal', () => {
  // The real shape the Design step receives: processImageJobInline aggregates
  // the roster's failures into one string, and the provider nests Replicate's
  // own message inside that (backend/services/image-flow/providers/replicate.ts).
  it('finds E005 nested inside the aggregated design-job error', () => {
    expect(
      isSensitivityRefusal(
        'All 1 models failed: GPT Image 2: replicate black-forest-labs/flux-2-pro failed: ' +
          'E005: Requested content is flagged as sensitive.'
      )
    ).toBe(true)
  })

  it('recognises the other engines\' wording too', () => {
    expect(isSensitivityRefusal('Your request was rejected as a result of our safety system.')).toBe(true)
    expect(isSensitivityRefusal('content_policy_violation')).toBe(true)
    expect(isSensitivityRefusal('NSFW content detected')).toBe(true)
    expect(isSensitivityRefusal('blocked by the safety filter')).toBe(true)
    expect(isSensitivityRefusal('flagged by safety checks (moderation)')).toBe(true)
  })

  // A technical failure must NOT offer a rephrase — rewording a prompt does
  // nothing about a timeout, and suggesting it sends the admin down a dead end.
  it('is false for a technical failure', () => {
    expect(isSensitivityRefusal('replicate google/imagen-4-fast: poll timeout')).toBe(false)
    expect(isSensitivityRefusal('replicate x/y 502: upstream error')).toBe(false)
    expect(isSensitivityRefusal('replicate x/y: no image URLs in output')).toBe(false)
    expect(isSensitivityRefusal('')).toBe(false)
    expect(isSensitivityRefusal(undefined)).toBe(false)
    expect(isSensitivityRefusal(null)).toBe(false)
  })
})

describe('softenPrompt', () => {
  // The brief that surfaced this (task 934dd6ed): refused on flux-2-pro for
  // the gangster framing, not for the genre. The genre has to SURVIVE — a
  // suggestion that deletes 'hip-hop' is not the same design.
  it('keeps the design intent and swaps only the crime framing', () => {
    const { prompt, changes } = softenPrompt('a gangsta hip-hop monkey with a gold chain, bold streetwear illustration')
    expect(prompt).toContain('hip-hop monkey')
    expect(prompt).toContain('gold chain')
    expect(prompt).not.toMatch(/gangsta/i)
    expect(prompt).toContain('streetwear')
    expect(changes).toEqual([{ from: 'gangsta', to: 'streetwear', why: expect.stringContaining('crime framing') }])
  })

  it('rewords the mascot-aggression family this repo already documents', () => {
    const { prompt, changes } = softenPrompt('a roaring lion mascot, fierce and aggressive, athletic team logo')
    expect(prompt).not.toMatch(/roaring|aggressive/i)
    expect(prompt).toContain('lion mascot')
    expect(prompt).toContain('athletic team logo')
    expect(changes.map((c) => c.from)).toContain('roaring')
    expect(changes.map((c) => c.from)).toContain('aggressive')
  })

  // A dropped word must take its trailing comma, or the suggestion reads as
  // broken punctuation and the admin has to clean up after us.
  it('leaves clean prose after dropping a word', () => {
    expect(softenPrompt('a sexy, bold cat in sunglasses').prompt).toBe('a bold cat in sunglasses')
    expect(softenPrompt('a skeleton holding a knife, neon outline').prompt).toBe('a skeleton holding a neon outline')
    expect(softenPrompt('blood everywhere').prompt).toBe('everywhere')
  })

  // Honest empty result. An invented "suggestion" on a prompt we have no
  // documented objection to is worse than admitting we have none.
  it('reports no changes when nothing in the vocabulary matched', () => {
    const { prompt, changes } = softenPrompt('a watercolor hummingbird over lavender, soft pastel palette')
    expect(changes).toEqual([])
    expect(prompt).toBe('a watercolor hummingbird over lavender, soft pastel palette')
  })

  // Vocabulary that is deliberately ABSENT. These are normal, sellable ITP
  // design words; softening them would quietly rewrite good briefs. If a future
  // refusal proves one of them is a real trigger, this test is the place to
  // record the decision to add it.
  it('leaves normal ITP design vocabulary alone', () => {
    const brief = 'Day of the Dead sugar skull with a sword and a cold beer, battle-worn texture'
    expect(softenPrompt(brief).prompt).toBe(brief)
    expect(softenPrompt(brief).changes).toEqual([])
  })

  it('is word-bounded, so a substring inside a longer word is untouched', () => {
    // 'gun' inside 'gunmetal', '420' inside '4200'.
    const brief = 'a gunmetal grey typographic 4200 badge'
    expect(softenPrompt(brief).prompt).toBe(brief)
    expect(softenPrompt(brief).changes).toEqual([])
  })

  it('is case-insensitive and reports each distinct trigger once', () => {
    const { prompt, changes } = softenPrompt('A ROARING bear, roaring loud')
    expect(prompt).not.toMatch(/roaring/i)
    expect(changes).toHaveLength(1)
    expect(changes[0].from).toBe('roaring')
  })

  it('handles an empty or missing prompt without throwing', () => {
    expect(softenPrompt('')).toEqual({ prompt: '', changes: [] })
    expect(softenPrompt(undefined as unknown as string)).toEqual({ prompt: '', changes: [] })
  })
})
