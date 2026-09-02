// Tests for the pure brief-JSON → DesignBrief[] mapping (David 2026-09-01: no
// more polo — Mrs. Imagine's brief parser must coerce ANY garment value the
// brain hands back that isn't in the capability module's offered set down to
// 'tshirt', not just drop the request). `parseBriefsResponse` is split out of
// `writeBriefs` specifically so this is testable without an OpenAI/OpenRouter
// call — see the doc comment on it in mrs-imagine.ts.
import { describe, it, expect, vi } from 'vitest'

// mrs-imagine.ts pulls in a long chain of services (design-qa-gate,
// etsy-model-shots, etc.) that all import the real Supabase client, which
// throws at construction time without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// set. This test only exercises the pure `parseBriefsResponse` mapping, so
// the module graph just needs to import cleanly — same stub-mock pattern as
// design-qa-gate.test.ts / product-files.test.ts.
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => ({}), rpc: async () => ({ data: 1 }) } }))

import { parseBriefsResponse, type DesignBrief } from './mrs-imagine.js'

// Real prompt text is 60-120 words; the filter in parseBriefsResponse drops
// anything under 40 characters, so test prompts stay comfortably above that.
const LONG_PROMPT =
  'A hip-hop street monkey wearing gold chains and a snapback, spray-paint ' +
  'texture, bold graffiti outline, isolated emblem with dead air around it.'

function garmentBrief(over: Record<string, unknown> = {}) {
  return {
    key: 'street-monkey',
    garment: 'tshirt',
    buyer: 'streetwear fans in their 20s',
    prompt: LONG_PROMPT,
    priceUsd: 24.99,
    trendBasis: 'top tag this week',
    ...over,
  }
}

describe('parseBriefsResponse — garment coercion (no polo, ever)', () => {
  it('coerces a "polo" garment value from the brain down to tshirt', () => {
    const out = parseBriefsResponse({ garments: [garmentBrief({ garment: 'polo' })], metal: [] }, { garments: 1, metal: 0 })
    expect(out).toHaveLength(1)
    expect(out[0].garment).toBe('tshirt')
  })

  it('keeps a legitimate hoodie value', () => {
    const out = parseBriefsResponse({ garments: [garmentBrief({ garment: 'hoodie' })], metal: [] }, { garments: 1, metal: 0 })
    expect(out[0].garment).toBe('hoodie')
  })

  it('coerces any other unrecognized garment string (tank, sublimation, garbage) to tshirt', () => {
    for (const bad of ['tank', 'sublimation-garment', 'embroidery', '', 'TSHIRT', undefined]) {
      const out = parseBriefsResponse({ garments: [garmentBrief({ garment: bad })], metal: [] }, { garments: 1, metal: 0 })
      expect(out[0].garment, `garment "${bad}" should coerce to tshirt`).toBe('tshirt')
    }
  })

  it('respects the garments/metal counts and drops briefs under the 40-char prompt floor', () => {
    const parsed = {
      garments: [garmentBrief({ key: 'a' }), garmentBrief({ key: 'b' }), garmentBrief({ key: 'c', prompt: 'too short' })],
      metal: [{ key: 'wall-art', buyer: 'cabin owners', prompt: LONG_PROMPT, priceUsd: 45, trendBasis: 'x' }],
    }
    const out = parseBriefsResponse(parsed, { garments: 2, metal: 1 })
    // 'c' never survives the slice(0, counts.garments) at 2, so only a+b+metal remain.
    expect(out.map((b) => b.key)).toEqual(['a', 'b', 'wall-art'])
    expect(out.filter((b) => b.kind === 'metal')).toHaveLength(1)
  })

  it('clamps hoodie price into the hoodie band and tee price into the tee band', () => {
    const out = parseBriefsResponse(
      {
        garments: [
          garmentBrief({ key: 'cheap-hoodie', garment: 'hoodie', priceUsd: 5 }),
          garmentBrief({ key: 'pricey-tee', garment: 'tshirt', priceUsd: 999 }),
        ],
        metal: [],
      },
      { garments: 2, metal: 0 }
    )
    const hoodie = out.find((b) => b.key === 'cheap-hoodie') as DesignBrief
    const tee = out.find((b) => b.key === 'pricey-tee') as DesignBrief
    expect(hoodie.priceUsd).toBe(34.99) // clamped to the hoodie band floor
    expect(tee.priceUsd).toBe(34.99) // clamped to the tee band ceiling
  })

  it('never throws on a malformed/empty response — returns an empty array', () => {
    expect(parseBriefsResponse({}, { garments: 3, metal: 2 })).toEqual([])
    expect(parseBriefsResponse({ garments: 'not-an-array' }, { garments: 3, metal: 2 })).toEqual([])
  })
})
