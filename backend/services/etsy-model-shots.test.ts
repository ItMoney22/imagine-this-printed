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

import sharp from 'sharp'

import { buildGptPrompt, buildNanoPrompt, ensureListingResolution, resolveCast, composeSubject, listShotSubjects, ShotCastError, asksForAMissingBackground, comparePrintedText, DESIGN_FIDELITY_QA_PROMPT, type ShotPlan } from './etsy-model-shots.js'

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

// ---------------------------------------------------------------------------
// Listing-photo resolution floor. presentation-qa.ts BLOCKS a listing whose
// shortest edge is under 1000px, and nano-banana-2-lite's 3:4 output is
// 896x1200 with no resolution knob — so every shot from the fallback engine
// hard-failed the design review, which is what dead-ended the Step Flow's
// Etsy step for David on 2026-09-03.
// ---------------------------------------------------------------------------
const solid = (width: number, height: number, format: 'png' | 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: { r: 20, g: 90, b: 160 } } })
    .toFormat(format)
    .toBuffer()

describe('ensureListingResolution', () => {
  it('lifts the nano-banana 896x1200 shot above the 1000px review floor, keeping the 3:4 ratio', async () => {
    const out = await ensureListingResolution(await solid(896, 1200, 'png'), 'test shot')
    const meta = await sharp(out).metadata()
    expect(Math.min(meta.width!, meta.height!)).toBeGreaterThanOrEqual(1000)
    expect(meta.width).toBe(1024)
    expect(meta.height).toBe(1371) // round(1200 * 1024/896) — ratio held to a pixel
  })

  it('leaves the gpt-image path (1024x1536) byte-for-byte alone', async () => {
    const original = await solid(1024, 1536, 'png')
    expect(await ensureListingResolution(original, 'test shot')).toBe(original)
  })

  it('preserves the encoding, because the caller sniffs the bytes to set the content type', async () => {
    const out = await ensureListingResolution(await solid(896, 1200, 'jpeg'), 'test shot')
    expect((await sharp(out).metadata()).format).toBe('jpeg')
  })

  it('returns the shot as rendered rather than losing it when the bytes are not an image', async () => {
    const notAnImage = Buffer.from('this is not an image')
    expect(await ensureListingResolution(notAnImage, 'test shot')).toBe(notAnImage)
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

// The hard boundary: WHO may be photographed is decided by what the listing
// SELLS, not by the design, the prompt or a random draw. resolveCast is the
// server-side enforcement point every shoot entry passes through.
describe('resolveCast — the catalogue decides the age band', () => {
  it('refuses a youth subject when the listing sells no youth size, and explains why', () => {
    expect(() => resolveCast({ subjects: ['kid'] }, 'adult')).toThrow(ShotCastError)
    expect(() => resolveCast({ subjects: ['kid'] }, 'adult')).toThrow(/sells no youth size/)
  })

  // David 2026-09-08: a shirt sells BOTH bands on one listing, so a kid in its
  // photo advertises a size that really ships (a 5000B youth cut). Passing both
  // bands is how a caller says exactly that.
  it('accepts a youth subject when the listing sells both bands', () => {
    expect(resolveCast({ subjects: ['kid-playful'] }, ['adult', 'youth'])[0].label).toBe('playful kid')
    expect(resolveCast({ subjects: ['goth'] }, ['adult', 'youth'])[0].label).toBe('goth')
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
    // No argument = the full catalog, which the Etsy panel still lists. It is
    // BIGGER than the two single-band lists combined, because a group shot
    // (the family) needs both bands and so appears in neither of them.
    expect(listShotSubjects().length).toBeGreaterThan(youth.length + adult.length)
    expect(youth).not.toContain('family')
    expect(adult).not.toContain('family')
  })

  // A family puts adults AND children in one frame, so it is castable only
  // where the listing sells a size for both (David 2026-09-08).
  it('offers a family only when both bands are sellable', () => {
    const both = listShotSubjects(['adult', 'youth']).map((s) => s.id)
    expect(both).toContain('family')
    expect(both).toContain('couple')
    // A couple is two adults, so an adult-only listing can still shoot one.
    expect(listShotSubjects('adult').map((s) => s.id)).toContain('couple')
    // ...but never on a youth-only listing: the adults would be wearing a
    // size that listing doesn't sell.
    expect(listShotSubjects('youth').map((s) => s.id)).not.toContain('couple')
  })

  it('refuses a group the listing cannot dress', () => {
    expect(() => resolveCast({ subjects: ['family'] }, 'adult')).toThrow(/youth size/)
    expect(() => resolveCast({ subjects: ['couple'] }, 'youth')).toThrow(ShotCastError)
    expect(resolveCast({ subjects: ['family'] }, ['adult', 'youth'])[0].label).toBe('family')
  })

  it('offers both pools to a listing that sells both bands', () => {
    const both = listShotSubjects(['adult', 'youth']).map((s) => s.id)
    expect(both).toContain('kid')
    expect(both).toContain('goth')
    expect(both.length).toBe(listShotSubjects().length)
  })

  // David 2026-09-08: "The lower portion of the owl artwork is hidden behind
  // the model's crossed arms." The cast description was instructing the exact
  // pose fidelity rule 5 forbids, so the shot failed QA and the render was
  // wasted. Nothing drawn into a persona may sit across the printed chest.
  it('never describes a pose or prop that covers the chest print', () => {
    const OCCLUDING = /crossed arms|arms crossed|under (the|one) arm|over one shoulder|on a hip|in one hand(?! held)/i
    const ids = listShotSubjects().map((s) => s.id)
    for (const id of ids) {
      const member = resolveCast({ subjects: [id] }, ['adult', 'youth'])[0]
      for (let i = 0; i < 30; i++) {
        const { persona } = composeSubject(member)
        expect(persona, `${id}: "${persona}"`).not.toMatch(OCCLUDING)
      }
    }
  })

  it('composes a family as a group, and never as one person', () => {
    const member = resolveCast({ subjects: ['family'] }, ['adult', 'youth'])[0]
    for (let i = 0; i < 20; i++) {
      const { persona } = composeSubject(member)
      expect(persona).toMatch(/family/)
      // Adults AND children are named, which is the whole point of the shot.
      expect(persona).toMatch(/mother|father|parents|mom|dad/)
      expect(persona).toMatch(/child|children|girl|boy/)
      // Never the adult-only trait pools that would be wrong around kids.
      expect(persona).not.toMatch(/tattoo|piercing|stubble|wedding band/i)
    }
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

// ---------------------------------------------------------------------------
// The QA gate manufactured the boxed print (David 2026-09-09)
// ---------------------------------------------------------------------------
// Render logs, product 92dd5bb9, both redos: nano-banana rendered the shirt
// correctly, the inspector failed it for a background the transparent source
// does not have, retryPreamble quoted that back as an instruction, and the
// retry painted the box. Both reasons below are the VERBATIM production text.

const PROD_REASON_1 = "The source artwork's dark multicolor gradient background is missing from the shirt print."
const PROD_REASON_2 =
  'The dark purple-to-orange background from the source artwork is missing, leaving a white shirt background around the illustration.'

describe('asksForAMissingBackground', () => {
  it('catches both reasons that actually produced the boxed print in production', () => {
    expect(asksForAMissingBackground(PROD_REASON_1)).toBe(true)
    expect(asksForAMissingBackground(PROD_REASON_2)).toBe(true)
  })

  it('catches the other ways an inspector phrases the same hallucination', () => {
    expect(asksForAMissingBackground('The artwork’s background was removed.')).toBe(true)
    expect(asksForAMissingBackground('The print lacks the dark backdrop of the source.')).toBe(true)
    expect(asksForAMissingBackground('The source background is not reproduced on the shirt.')).toBe(true)
    expect(asksForAMissingBackground('The gradient behind the design is absent.')).toBe(true)
  })

  it('does NOT swallow a real defect that merely mentions the background', () => {
    // These must still buy a retry — the whole point of the gate.
    expect(asksForAMissingBackground('The text is misspelled as "WHICH" instead of "WITCH".')).toBe(false)
    expect(asksForAMissingBackground('The witch was redrawn in a different style.')).toBe(false)
    expect(asksForAMissingBackground('The print is hidden behind the model’s arm.')).toBe(false)
    expect(asksForAMissingBackground('A watermark was added over the artwork.')).toBe(false)
    expect(asksForAMissingBackground('The colors are washed out compared to the source.')).toBe(false)
  })

  it('is safe on empty or undefined reasons', () => {
    expect(asksForAMissingBackground('')).toBe(false)
    expect(asksForAMissingBackground(undefined)).toBe(false)
  })
})

describe('DESIGN_FIDELITY_QA_PROMPT', () => {
  it('tells the inspector the source is cut-out art with a transparent background', () => {
    expect(DESIGN_FIDELITY_QA_PROMPT).toMatch(/CUT-OUT artwork/i)
    expect(DESIGN_FIDELITY_QA_PROMPT).toMatch(/TRANSPARENT/)
    // The exact misreading the logs caught: alpha decoded as a coloured field.
    expect(DESIGN_FIDELITY_QA_PROMPT).toMatch(/checkerboard/i)
  })

  it('forbids the verdict that caused this, in the inspector’s own terms', () => {
    expect(DESIGN_FIDELITY_QA_PROMPT).toMatch(/NEVER fail the photo because a background/i)
    expect(DESIGN_FIDELITY_QA_PROMPT).toMatch(/never ask for one to be added/i)
  })

  it('fails a print that carries a panel, frame or backdrop the source lacks', () => {
    expect(DESIGN_FIDELITY_QA_PROMPT).toMatch(/printed as a framed picture/i)
  })

  it('no longer excuses "the background" wholesale, only the photographic scene', () => {
    expect(DESIGN_FIDELITY_QA_PROMPT).not.toMatch(/the model, the background,/i)
    expect(DESIGN_FIDELITY_QA_PROMPT).toMatch(/scene behind/i)
  })

  it('keeps every criterion it already had, so this is an addition not a rewrite', () => {
    expect(DESIGN_FIDELITY_QA_PROMPT).toMatch(/misspelled/i)
    expect(DESIGN_FIDELITY_QA_PROMPT).toMatch(/restyled, redrawn/i)
    expect(DESIGN_FIDELITY_QA_PROMPT).toMatch(/"matches": true\|false/)
  })
})

// ---------------------------------------------------------------------------
// Text fidelity is checked by TRANSCRIBING, not by asking for a verdict
// ---------------------------------------------------------------------------
// David 2026-09-09, on a family shot that printed "FURRY FINNANCE" where the
// design says "TREE TRIMMING": the holistic gate passed it twice. Asked
// "does this match?", the inspector says yes; asked "read the words", it reads
// them correctly. So we do the perception with the model and the judgement in
// code. Every fixture below is VERBATIM transcription output from the real
// images (product 5a846616).

const DESIGN_WORDS = ['TIDINGS', 'of', 'TREE', 'TRIMMING', 'Make', 'It', 'a', 'WILDERNESS', 'HOLIDAY']

describe('comparePrintedText', () => {
  it('passes the composite, which reproduced every word', () => {
    expect(comparePrintedText(DESIGN_WORDS, [...DESIGN_WORDS]).ok).toBe(true)
  })

  // The live regression (David 2026-09-11, "the on person is failing"): a
  // graffiti-lettered crest reading HOLY HANDY FATHER transcribed as HAND off
  // the flattened design and HANDY off the photo, and exact-token matching
  // killed the listing's only on-person shot over it. The photo was correct.
  it('handles the design transcribing as one run-on token', () => {
    expect(comparePrintedText(['HOLYHANDYFATHER'], ['HOLY', 'HANDY', 'FATHER']).ok).toBe(true)
  })

  // Prefix/suffix, never arbitrary substring — STREET contains TREE, and
  // accepting that would wave through exactly what this gate exists to catch.
  it('does not let STREET stand in for TREE', () => {
    expect(comparePrintedText(['TREE', 'TRIMMING'], ['STREET', 'SIGNS']).ok).toBe(false)
  })

  it('needs four characters before a partial word counts, so AND is not HANDY', () => {
    expect(comparePrintedText(['AND', 'DAD', 'LIFE'], ['HANDY', 'DADS', 'LIFE']).ok).toBe(false)
  })

  it('does not fail a correct print over a dropped final letter', () => {
    expect(comparePrintedText(['HOLY', 'HAND', 'FATHER'], ['HOLY', 'HANDY', 'FATHER']).ok).toBe(true)
  })

  it('fails the family shot that invented "FURRY FINNANCE"', () => {
    const shot = ['Make', 'It', 'a', 'FURRY', 'FINNANCE', 'Make', 'It', 'a', 'WILDERNESS', 'SEASON']
    const v = comparePrintedText(DESIGN_WORDS, shot)
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/TIDINGS|TREE|TRIMMING|HOLIDAY/i)
  })

  it('fails the solo shot that swapped TIDINGS->TRADITIONS and WILDERNESS->WONDERFUL', () => {
    const shot = ['TRADITIONS', 'of', 'TREE', 'TRIMMING', 'Make', 'It', 'A', 'WONDERFUL', 'HOLIDAY']
    expect(comparePrintedText(DESIGN_WORDS, shot).ok).toBe(false)
  })

  it('is case- and punctuation-insensitive, so styling is not a defect', () => {
    const shot = ['tidings', 'OF', 'Tree', 'trimming!', 'make', 'it', 'a', '"WILDERNESS"', 'holiday.']
    expect(comparePrintedText(DESIGN_WORDS, shot).ok).toBe(true)
  })

  it('fails when the print is not legible enough to read', () => {
    const shot = ['TIDINGS', '<UNREADABLE>', 'TREE', '<UNREADABLE>']
    const v = comparePrintedText(DESIGN_WORDS, shot)
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/legib|read/i)
  })

  it('passes a design with NO text at all, whatever the shot reads', () => {
    // The witch design carries no words; a stray sign in the scene must not
    // fail the shot.
    expect(comparePrintedText([], ['OPEN']).ok).toBe(true)
  })

  it('ignores extra words the photo picks up outside the print', () => {
    // The transcription is asked for artwork words only, but a street sign or
    // a hoodie label can still slip in. Missing words are the defect; extra
    // ones are not.
    expect(comparePrintedText(DESIGN_WORDS, [...DESIGN_WORDS, 'GILDAN']).ok).toBe(true)
  })

  it('tolerates one dropped short filler word but not a dropped headline word', () => {
    expect(comparePrintedText(DESIGN_WORDS, DESIGN_WORDS.filter((w) => w !== 'a')).ok).toBe(true)
    expect(comparePrintedText(DESIGN_WORDS, DESIGN_WORDS.filter((w) => w !== 'TRIMMING')).ok).toBe(false)
  })
})
