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

import { parseBriefsResponse, dtfPrompt, metalPrompt, isAlreadyCutOut, type DesignBrief } from './mrs-imagine.js'
import sharp from 'sharp'

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

// David 2026-09-03: "she needs to design this knowing its going to be done on a
// shirt ... but i dont want to change she makes the metal art".
describe('dtfPrompt', () => {
  const brief = { ...garmentBrief(), priceUsd: 24, trendBasis: 'streetwear' } as unknown as DesignBrief

  it('never tells her to fill the frame', () => {
    // The line this replaced ended "The artwork fills the frame edge to edge",
    // which contradicts GARMENT_BRIEF_RULES, prints as a rectangle of ink on a
    // shirt, and runs art off the frame where the background keyer cannot see
    // the field.
    const p = dtfPrompt(brief).toLowerCase()
    expect(p).not.toContain('edge to edge')
    expect(p).not.toContain('fills the frame')
    expect(p).toContain('contained subject')
    expect(p).toContain('not a full-bleed scene')
  })

  it('tells her what the design is physically for', () => {
    const p = dtfPrompt(brief).toLowerCase()
    expect(p).toContain('dtf transfer')
    expect(p).toContain('11 inches')
    expect(p).toContain('black')          // the garment she is designing against
    expect(p).toContain('t-shirt')        // ...and which garment it is
  })

  it('rules out the things that wreck a transfer', () => {
    const p = dtfPrompt(brief).toLowerCase()
    expect(p).toContain('transparent background')
    expect(p).toContain('no mockup')
    expect(p).toContain('drop shadows')   // print as a grey smear over the underbase
    expect(p).toContain('checkerboard')   // the painted fake-transparency defect
    expect(p).toContain('one-fiftieth')   // detail floor that survives the press
  })

  it('names the actual garment', () => {
    const hoodie = { ...brief, garment: 'hoodie' } as DesignBrief
    expect(dtfPrompt(hoodie).toLowerCase()).toContain('hoodie')
  })

  // Metal is a different product with the opposite rule, and David asked for it
  // to be left exactly alone.
  it('leaves metal art full-bleed', () => {
    const metal = { ...brief, kind: 'metal' } as DesignBrief
    const p = metalPrompt(metal).toLowerCase()
    expect(p).toContain('full-bleed edge-to-edge')
    expect(p).not.toContain('transparent background')
    expect(p).not.toContain('contained subject')
  })
})

// ---------------------------------------------------------------------------
// The rembg pass is redundant when the design is already keyed (David 2026-09-09)
// ---------------------------------------------------------------------------
// GPT Image 2.5 honours background:'transparent' and returns real alpha, so
// every garment design was paying a Replicate round-trip (and up to a 4-minute
// wait) to reproduce a file it already had — proven on product 92dd5bb9, whose
// `source` and `nobg` assets were byte-identical. This gate is what skips it.
//
// It must bias toward RUNNING the keyer: a false "already cut out" ships a
// backgrounded design to print, while a false "needs keying" only costs what
// we were paying anyway.

const solid = (w = 64, h = 64, alpha = 1) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 30, alpha } } }).png().toBuffer()

/** A cut-out: an opaque blob on a transparent field, `coverPct` of the frame. */
async function cutOut(coverPct: number): Promise<Buffer> {
  const size = 100
  const side = Math.round(size * Math.sqrt(coverPct / 100))
  const blob = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 120, b: 0, alpha: 1 } } }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: blob, left: 0, top: 0 }])
    .png()
    .toBuffer()
}

describe('isAlreadyCutOut', () => {
  it('says NO for a flattened image with no alpha channel at all', async () => {
    const opaque = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer()
    expect(await isAlreadyCutOut(opaque)).toBe(false)
  })

  it('says NO for an alpha channel that is fully OPAQUE', async () => {
    // The trap: hasAlpha === true proves nothing. A PNG can carry a completely
    // opaque alpha channel, and that design still has a background to strip.
    expect(await isAlreadyCutOut(await solid(64, 64, 1))).toBe(false)
  })

  it('says YES for a real cut-out with a transparent surround', async () => {
    // ~36% opaque / 64% clear — the shape of a genuine DTF design.
    expect(await isAlreadyCutOut(await cutOut(36))).toBe(true)
  })

  it('says YES for a near-full-bleed design that still clears its edges', async () => {
    // David's witch measured 39% transparent; a denser design must still pass.
    expect(await isAlreadyCutOut(await cutOut(90))).toBe(true)
  })

  it('says NO when transparency is only a sliver, so the keyer still runs', async () => {
    // Under the floor: treat as effectively opaque and pay for the keyer.
    expect(await isAlreadyCutOut(await cutOut(99.5))).toBe(false)
  })

  it('says NO on unreadable bytes rather than throwing', async () => {
    // Fails toward running the keyer — never toward printing a background.
    expect(await isAlreadyCutOut(Buffer.from('not an image'))).toBe(false)
  })
})
