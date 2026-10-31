import { describe, it, expect } from 'vitest'
import { memoryTokens, pickMemories } from './store-assistant-memory.js'

const now = Date.parse('2026-10-26T12:00:00Z')
const day = (n: number) => new Date(now - n * 86_400_000).toISOString()

describe('pickMemories', () => {
  const facts = [
    { fact: 'Crystal sells tumblers with leopard print and paw designs.', created_at: day(40) },
    { fact: 'Her best customers are teachers who buy matching class shirts.', created_at: day(30) },
    { fact: 'She hates pastel colors and likes bold purple and gold.', created_at: day(20) },
    { fact: 'Crystal plans a Mother’s Day line in April.', created_at: day(10) },
    { fact: 'She ships from her craft room in Rockmart on Fridays.', created_at: day(2) },
    { fact: 'Prefers Spanish when she is tired.', created_at: day(1) },
  ]
  it('brings the fact she is talking about, even an old one', () => {
    const got = pickMemories(facts, 'can you write a caption for my teacher shirts?', { max: 4, alwaysNewest: 1, everythingUnder: 0, now })
    expect(got).toContain('Her best customers are teachers who buy matching class shirts.')
  })
  it('matches Spanish and plurals, ignoring accents', () => {
    expect(memoryTokens('Mis camisas de maestras, ¡qué bonitas!')).toEqual(expect.arrayContaining(['camisa', 'maestra', 'bonita']))
    const got = pickMemories(facts, 'tumbler nuevo con huellas de leopardo', { max: 3, alwaysNewest: 1, everythingUnder: 0, now })
    expect(got[0] || got.join()).toBeTruthy()
    expect(got).toContain('Crystal sells tumblers with leopard print and paw designs.')
  })
  it('always keeps the newest few and stays under the cap', () => {
    const got = pickMemories(facts, 'hello', { max: 5, alwaysNewest: 2, everythingUnder: 0, now })
    expect(got).toContain('Prefers Spanish when she is tired.')
    expect(got).toContain('She ships from her craft room in Rockmart on Fridays.')
    const tight = pickMemories(facts, 'teacher shirts', { max: 8, alwaysNewest: 3, maxChars: 90, everythingUnder: 0, now })
    expect(tight.join('').length).toBeLessThanOrEqual(90)
  })
  it('hands over every fact while the shelf is short, so Spanish finds English (maestras / teachers)', () => {
    expect(pickMemories(facts, 'caption para las camisas de maestras', { now })).toHaveLength(facts.length)
  })
  it('returns nothing for no facts', () => { expect(pickMemories([], 'anything', { now })).toEqual([]) })
})
