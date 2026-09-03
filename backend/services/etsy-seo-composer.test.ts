// David 2026-09-03: "hoodies are also $35 so make sure thats on the etsy side".
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
    expect(ETSY_HOODIE_ANCHOR_PRICE).toBe(35)
    expect(etsyAnchorPriceFor({ category: 'hoodies', name: 'Unleashed Power Athlete Hoodie' })).toBe(35)
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
