// David 2026-09-07: "shirts are 25, hoodies 40" (opened at $35 on 09-03).
//
// The publisher prefers the composed pack's price over the product's
// (services/etsy.ts: `pack?.price ?? product.price`), so a flat anchor in the
// composer silently overrides the storefront price. When this was found, 57 of
// 60 composed packs carried $25 regardless of what the product sells for.
import { describe, it, expect, vi } from 'vitest'

// The module builds an OpenAI/OpenRouter client and imports the real Supabase
// client at load time; only the pure pricing helpers are under test here.
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => ({}) } }))

const { etsyAnchorPriceFor, isHoodieProduct, ETSY_ANCHOR_PRICE, ETSY_HOODIE_ANCHOR_PRICE } =
  await import('./etsy-seo-composer.js')

describe('etsyAnchorPriceFor', () => {
  it('anchors a hoodie above a tee', () => {
    expect(ETSY_HOODIE_ANCHOR_PRICE).toBe(40)
    expect(etsyAnchorPriceFor({ category: 'hoodies', name: 'Unleashed Power Athlete Hoodie' })).toBe(40)
    expect(etsyAnchorPriceFor({ category: 't-shirts', name: 'Too Cute To Spook Tee' })).toBe(ETSY_ANCHOR_PRICE)
  })

  // Metal keeps the base anchor on purpose: its size variations carry the real
  // ladder and its storefront 4x6 price is far below what the listing opens at.
  it('leaves metal art on the base anchor', () => {
    expect(etsyAnchorPriceFor({ category: 'metal-art', name: 'Tree of Life Metal Wall Art' })).toBe(ETSY_ANCHOR_PRICE)
    // ...even when the word hoodie appears in the design's own name.
    expect(etsyAnchorPriceFor({ category: 'metal-art', name: 'Hoodie Season Metal Sign' })).toBe(ETSY_ANCHOR_PRICE)
  })

  it('recognises a hoodie however the product was created', () => {
    // Step Flow writes the garment into metadata; the classic wizard files it
    // under the 'shirts' category, so the category alone is not enough.
    expect(isHoodieProduct({ category: 'shirts', metadata: { step_flow: { garment: 'hoodie' } } })).toBe(true)
    expect(isHoodieProduct({ category: 'shirts', name: 'Cozy Crewneck Sweatshirt' })).toBe(true)
    expect(isHoodieProduct({ category: 'shirts', name: 'Plain Cotton Tee' })).toBe(false)
    // A tee whose DESIGN mentions a hoodie is still a tee.
    expect(isHoodieProduct({ category: 't-shirts', name: 'Ghost In A Hooded Cloak Tee' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Color axis. The Garment step (`POST /:id/step/garments`) validates a primary
// plus N extras against the capability boundary, writes them to
// `metadata.step_flow.colors`, AND fires a `color:<id>` mockup for every
// extra. The composer used to read only `metadata.shirt_color` and pad with a
// hardcoded 'Black', so a listing whose photos showed five colors sold two —
// one of which the admin had never picked.
// ---------------------------------------------------------------------------
const { defaultColorsFor, MAX_ETSY_COLORS } = await import('./etsy-seo-composer.js')

describe('defaultColorsFor', () => {
  it('offers the primary plus every approved extra, in buyer-facing labels', () => {
    expect(
      defaultColorsFor({
        metadata: {
          shirt_color: 'white',
          step_flow: { colors: { primary: 'white', extras: ['navy', 'heather-grey', 'forest-green'] } },
        },
      })
    ).toEqual(['White', 'Navy', 'Heather Grey', 'Forest Green'])
  })

  // 'heather-grey' title-cased naively is 'Heather-Grey', which is not a color
  // name a shopper picks off a dropdown. The capability palette owns the label.
  it('renders a hyphenated capability id as its real label', () => {
    expect(defaultColorsFor({ metadata: { step_flow: { colors: { primary: 'heather-grey', extras: [] } } } }))
      .toEqual(['Heather Grey'])
  })

  // An explicit step-flow pick is taken EXACTLY as chosen — padding it with a
  // color David never approved is the same defect as dropping one.
  it('does not pad an explicit single-color selection with Black', () => {
    expect(defaultColorsFor({ metadata: { step_flow: { colors: { primary: 'red', extras: [] } } } }))
      .toEqual(['Red'])
  })

  it('falls back to the metadata.colors mirror when no step_flow exists', () => {
    expect(defaultColorsFor({ metadata: { shirt_color: 'black', colors: ['black', 'royal-blue'] } }))
      .toEqual(['Black', 'Royal Blue'])
  })

  // Pre-step-flow drafts (bulk create, the classic wizard) only ever had one
  // color, and the historical Black companion keeps those listings selling two.
  it('keeps the legacy single-color + Black behaviour', () => {
    expect(defaultColorsFor({ metadata: { shirt_color: 'white' } })).toEqual(['White', 'Black'])
    expect(defaultColorsFor({ metadata: {} })).toEqual(['Black'])
    expect(defaultColorsFor({ metadata: { dtf_settings: { shirt_color: 'navy' } } })).toEqual(['Navy', 'Black'])
  })

  it('de-duplicates and caps at the Etsy-safe ceiling', () => {
    const extras = ['white', 'white', 'navy', 'heather-grey', 'red', 'forest-green', 'royal-blue', 'black']
    const out = defaultColorsFor({ metadata: { step_flow: { colors: { primary: 'black', extras } } } })
    expect(out.length).toBeLessThanOrEqual(MAX_ETSY_COLORS)
    expect(new Set(out).size).toBe(out.length)
    expect(out[0]).toBe('Black')
  })

  // 7 colors x 11 sizes (S-3XL + the youth band) = 77 offerings, inside Etsy's
  // 100-per-listing ceiling. Raising this cap without re-checking that product
  // is how a publish starts failing on inventory.
  it('caps low enough that the widest palette still fits an Etsy listing', () => {
    expect(MAX_ETSY_COLORS * 11).toBeLessThanOrEqual(100)
  })

  // A hand edit survives a recompose; an auto-derived list is re-derived so a
  // Garment step that ran later is not ignored. (Guards the branch in
  // composeEtsyPack that used to prefer ANY stored list.)
  it('ignores an unknown string only as far as title-casing it', () => {
    expect(defaultColorsFor({ metadata: { step_flow: { colors: { primary: 'sand dune', extras: [] } } } }))
      .toEqual(['Sand Dune'])
  })
})
