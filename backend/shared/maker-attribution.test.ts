import { describe, it, expect } from 'vitest'
import {
  MAKER_AGENTS,
  normalizeMakerAgentId,
  isValidMakerAgentId,
  makerAgentName,
  clampMetadataValue,
  makerStamp,
  STRIPE_METADATA_VALUE_MAX,
} from './maker-attribution'

describe('normalizeMakerAgentId', () => {
  it('accepts a roster id', () => {
    expect(normalizeMakerAgentId('amelia-chan')).toBe('amelia-chan')
  })

  it('trims and lowercases what an admin form hands it', () => {
    expect(normalizeMakerAgentId('  Amelia-Chan \n')).toBe('amelia-chan')
  })

  it('reads blank, null-ish and non-string values as no maker', () => {
    for (const v of ['', '   ', 'null', 'undefined', null, undefined, 42, {}, []]) {
      expect(normalizeMakerAgentId(v as unknown)).toBeNull()
    }
  })

  it('rejects a slug that is not on the roster', () => {
    // The whole point: an unrecognised stamp makes creditDecision return
    // `unknown_agent`, which credits NOBODY — strictly worse than no stamp.
    expect(normalizeMakerAgentId('amelia-chen')).toBeNull()
    expect(normalizeMakerAgentId('someone-new')).toBeNull()
  })

  it('rejects ids that are not kebab slugs', () => {
    for (const v of ['Amelia Chan', 'amelia_chan', 'amelia--chan', '-amelia', 'amelia-', 'amelia.chan']) {
      expect(normalizeMakerAgentId(v)).toBeNull()
    }
  })

  it('isValidMakerAgentId mirrors it', () => {
    expect(isValidMakerAgentId('sifu')).toBe(true)
    expect(isValidMakerAgentId('sifuu')).toBe(false)
  })
})

describe('the roster itself', () => {
  it('has no duplicate ids', () => {
    const ids = MAKER_AGENTS.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is entirely made of ids it would itself accept', () => {
    for (const a of MAKER_AGENTS) expect(normalizeMakerAgentId(a.id)).toBe(a.id)
  })

  it('carries the agents this work was filed for', () => {
    const ids = MAKER_AGENTS.map(a => a.id)
    expect(ids).toContain('amelia-chan')
    expect(ids).toContain('rico-fernandez')
  })

  it('names an agent, and falls back to the id for one it does not know', () => {
    expect(makerAgentName('amelia-chan')).toBe('Amelia Chan')
    expect(makerAgentName('who-dis')).toBe('who-dis')
  })
})

describe('clampMetadataValue', () => {
  it('leaves a value inside the limit alone', () => {
    expect(clampMetadataValue('short')).toBe('short')
  })

  it('cuts an over-long value to exactly the limit', () => {
    const out = clampMetadataValue('x'.repeat(900))
    expect(out).toHaveLength(STRIPE_METADATA_VALUE_MAX)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('makerStamp — the multi-maker policy', () => {
  it('stamps the maker when the whole cart is theirs', () => {
    // The 2026-09-21 case: candle holders by Amelia, nothing else.
    const stamp = makerStamp([{ makerAgentId: 'amelia-chan', weightCents: 4000 }])
    expect(stamp.agent_id).toBe('amelia-chan')
    expect(stamp.maker_agents).toBe('amelia-chan')
    expect(stamp.maker_split).toBe('amelia-chan:10000')
  })

  it('pools multiple lines by the same maker', () => {
    const stamp = makerStamp([
      { makerAgentId: 'amelia-chan', weightCents: 2000 },
      { makerAgentId: 'amelia-chan', weightCents: 2000 },
    ])
    expect(stamp.agent_id).toBe('amelia-chan')
    expect(stamp.maker_split).toBe('amelia-chan:10000')
  })

  it('stamps nothing at all for an all-house cart, so the account default applies', () => {
    const stamp = makerStamp([
      { makerAgentId: null, weightCents: 2500 },
      { makerAgentId: null, weightCents: 900 },
    ])
    expect(stamp).toEqual({})
  })

  it('stamps nothing for an empty or zero-value cart', () => {
    expect(makerStamp([])).toEqual({})
    expect(makerStamp([{ makerAgentId: 'sifu', weightCents: 0 }])).toEqual({})
    expect(makerStamp([{ makerAgentId: 'sifu', weightCents: Number.NaN }])).toEqual({})
  })

  it('gives the charge to the bigger maker and records both', () => {
    const stamp = makerStamp([
      { makerAgentId: 'rico-fernandez', weightCents: 1000 },
      { makerAgentId: 'amelia-chan', weightCents: 3000 },
    ])
    expect(stamp.agent_id).toBe('amelia-chan')
    expect(stamp.maker_agents).toBe('amelia-chan,rico-fernandez')
    expect(stamp.maker_split).toBe('amelia-chan:7500,rico-fernandez:2500')
  })

  it('lets the house win a cart it dominates, leaving agent_id off', () => {
    const stamp = makerStamp([
      { makerAgentId: 'amelia-chan', weightCents: 500 },
      { makerAgentId: null, weightCents: 19500 },
    ])
    expect(stamp.agent_id).toBeUndefined()
    // The maker is still on the record even though they did not win.
    expect(stamp.maker_agents).toBe('amelia-chan')
    expect(stamp.maker_split).toBe('house:9750,amelia-chan:250')
  })

  it('breaks a maker-vs-house tie in the maker\'s favour', () => {
    const stamp = makerStamp([
      { makerAgentId: 'amelia-chan', weightCents: 2000 },
      { makerAgentId: null, weightCents: 2000 },
    ])
    expect(stamp.agent_id).toBe('amelia-chan')
  })

  it('breaks a maker-vs-maker tie by cart order, every time', () => {
    const cart = [
      { makerAgentId: 'sifu', weightCents: 2000 },
      { makerAgentId: 'amelia-chan', weightCents: 2000 },
    ]
    expect(makerStamp(cart).agent_id).toBe('sifu')
    expect(makerStamp([...cart].reverse()).agent_id).toBe('amelia-chan')
    // Deterministic: the same cart must never produce two different answers.
    expect(makerStamp(cart)).toEqual(makerStamp(cart))
  })

  it('treats an off-roster maker id as house rather than stamping it', () => {
    const stamp = makerStamp([{ makerAgentId: 'ghost-agent', weightCents: 4000 }])
    expect(stamp).toEqual({})
  })

  it('always splits to exactly 10000 basis points, rounding and all', () => {
    const stamp = makerStamp([
      { makerAgentId: 'amelia-chan', weightCents: 333 },
      { makerAgentId: 'sifu', weightCents: 333 },
      { makerAgentId: 'levi-james', weightCents: 334 },
    ])
    const sum = (stamp.maker_split ?? '')
      .split(',')
      .reduce((acc, part) => acc + Number(part.split(':')[1]), 0)
    expect(sum).toBe(10000)
  })

  it('keeps every value inside Stripe\'s 500-character limit and flags a cut split', () => {
    // One line per agent on the roster is far past any real cart, but a
    // payload Stripe rejects is a checkout that cannot complete — so the
    // ceiling is enforced rather than assumed.
    const lines = MAKER_AGENTS.map((a, i) => ({
      makerAgentId: a.id,
      weightCents: 1000 + i,
    }))
    const stamp = makerStamp(lines)
    for (const value of Object.values(stamp)) {
      expect(value.length).toBeLessThanOrEqual(STRIPE_METADATA_VALUE_MAX)
    }
    expect(stamp.maker_split_truncated).toBe('1')
    // The winner is still correct despite the truncation.
    expect(stamp.agent_id).toBe(MAKER_AGENTS[MAKER_AGENTS.length - 1].id)
  })

  it('produces only keys Stripe will accept', () => {
    const stamp = makerStamp([
      { makerAgentId: 'amelia-chan', weightCents: 100 },
      { makerAgentId: null, weightCents: 50 },
    ])
    for (const key of Object.keys(stamp)) {
      expect(key.length).toBeLessThanOrEqual(40)
      expect(key).not.toMatch(/[[\]]/)
    }
  })
})
