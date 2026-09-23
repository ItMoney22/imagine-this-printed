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

const { etsyAnchorPriceFor, isHoodieProduct, defaultColorsFor, ETSY_ANCHOR_PRICE, ETSY_HOODIE_ANCHOR_PRICE } =
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

describe('defaultColorsFor', () => {
  // The composer used to only ever see `metadata.shirt_color` — a Step Flow
  // product's approved `colors.extras` (GarmentStep) were silently dropped,
  // so a listing that actually sells in three colors composed an Etsy pack
  // advertising only one.
  it('lists every Step Flow color — primary plus every approved extra', () => {
    const product = { metadata: { step_flow: { colors: { primary: 'black', extras: ['white', 'navy'] } } } }
    expect(defaultColorsFor(product)).toEqual(['Black', 'White', 'Navy'])
  })

  it('lists just the primary when Step Flow has no extras selected', () => {
    const product = { metadata: { step_flow: { colors: { primary: 'heather-grey', extras: [] } } } }
    expect(defaultColorsFor(product)).toEqual(['Heather Grey'])
  })

  it('de-duplicates if an extra somehow repeats the primary', () => {
    const product = { metadata: { step_flow: { colors: { primary: 'black', extras: ['black', 'red'] } } } }
    expect(defaultColorsFor(product)).toEqual(['Black', 'Red'])
  })

  // Non-Step-Flow products (the classic wizard) never had `step_flow.colors`
  // at all — same fallback pair as before this change.
  it('falls back to metadata.shirt_color + the default second color with no Step Flow colors', () => {
    const product = { metadata: { shirt_color: 'royal-blue' } }
    expect(defaultColorsFor(product)).toEqual(['Royal-Blue', 'Black'])
  })

  it('falls back to Black + Black-deduped when nothing is set at all', () => {
    const product = { metadata: {} }
    expect(defaultColorsFor(product)).toEqual(['Black'])
  })
})
