import { describe, it, expect } from 'vitest'
import {
  checkSeo,
  checkPricing,
  checkMockupQuality,
  checkSharpness,
  priceBandFor,
  MIN_SHORT_EDGE_PX,
  WARN_SHORT_EDGE_PX,
  MIN_SHARPNESS,
  WARN_SHARPNESS,
  DESCRIPTION_MIN_CHARS,
  isGarment,
  type Channel
} from './presentation-qa.js'
import { coverageIsExempt } from './mockup-qa.js'
import { laplacianStats } from './image-metrics.js'

// ---------------------------------------------------------------------------
// The presentation QA gate, deterministic half. The vision-judged criteria
// (realism, centring, typography) are exercised through mockup-qa.test.ts's
// sibling contract; what is tested here is everything that must hold WITHOUT a
// model in the loop, because that is what makes the gate reproducible.
//
// The properties that matter:
//   1. A blocking finding fails the criterion; a warning never does. If a warn
//      could block, every listing in the catalogue would be held back over
//      Etsy's 2000px recommendation, and the gate would be turned off within a
//      day.
//   2. Every failure carries a FIX, not just a complaint. The whole point is a
//      feedback loop an agent can act on unattended.
//   3. Thresholds come from the exported constants, so a retuned threshold
//      cannot silently disagree with its own tests.
// ---------------------------------------------------------------------------

const good = {
  channel: 'etsy' as Channel,
  title: 'Simply Be You Retro Varsity Tee | Unisex Graphic Shirt',
  description:
    'A retro varsity graphic for anyone who would rather be themselves than blend in.\n' +
    'THE DESIGN: bold collegiate lettering with a soft distressed finish.\n' +
    'THE SHIRT: soft unisex tee with a vibrant DTF print that will not crack.\n' +
    'SIZING: size up for the oversized fit everyone is wearing right now.\n' +
    'Made to order and printed in Rockmart, Georgia.\n' +
    'CARE: machine wash cold, inside out, tumble dry low.',
  tags: [
    'retro varsity tee', 'vintage graphic top', 'collegiate style', 'oversized fit tee',
    'birthday gift her', 'self love shirt', 'y2k aesthetic', 'trendy college wear',
    'aesthetic clothing', 'gift for teen', 'soft cotton tee', 'statement top', 'preppy outfit'
  ]
}

const blocks = (verdict: { findings: Array<{ severity: string; issue: string }> }) =>
  verdict.findings.filter(f => f.severity === 'block').map(f => f.issue)

describe('checkSeo', () => {
  it('passes a well-formed Etsy listing', () => {
    const verdict = checkSeo(good)
    expect(blocks(verdict)).toEqual([])
    expect(verdict.ok).toBe(true)
  })

  it('blocks a comma-stacked keyword title — the thing Etsy penalises', () => {
    const verdict = checkSeo({
      ...good,
      title: 'Retro Tee, Varsity Shirt, Vintage Top, College Tee, Graphic Shirt, Gift Tee'
    })
    expect(verdict.ok).toBe(false)
    expect(blocks(verdict).join(' ')).toMatch(/comma-stacked/i)
  })

  it('blocks emoji in the title', () => {
    const verdict = checkSeo({ ...good, title: 'Simply Be You Retro Varsity Tee 🔥 Unisex Graphic Shirt' })
    expect(blocks(verdict).join(' ')).toMatch(/emoji/i)
  })

  it('warns but does not block on ALL-CAPS words, and never on DTF', () => {
    const shouty = checkSeo({ ...good, title: 'Simply Be You RETRO Varsity Tee | Unisex Graphic Shirt' })
    expect(shouty.findings.some(f => f.severity === 'warn' && /shouts/i.test(f.issue))).toBe(true)
    expect(blocks(shouty)).toEqual([])

    const dtf = checkSeo({ ...good, title: 'Simply Be You Retro Varsity DTF Tee | Unisex Graphic Shirt' })
    expect(dtf.findings.some(f => /shouts/i.test(f.issue))).toBe(false)
  })

  it('blocks duplicate tags, including ones that differ only by case or punctuation', () => {
    const verdict = checkSeo({ ...good, tags: [...good.tags.slice(0, 12), 'Retro Varsity Tee!'] })
    expect(verdict.ok).toBe(false)
    expect(blocks(verdict).join(' ')).toMatch(/duplicate/i)
  })

  it('blocks filler tags that rank for nothing', () => {
    const verdict = checkSeo({ ...good, tags: [...good.tags.slice(0, 12), 'shirt'] })
    expect(blocks(verdict).join(' ')).toMatch(/filler/i)
  })

  it('blocks tags over ETSY\'s character limit — the platform rejects them', () => {
    const verdict = checkSeo({ ...good, tags: [...good.tags.slice(0, 12), 'extremely long tag phrase here'] })
    expect(blocks(verdict).join(' ')).toMatch(/exceed/i)
  })

  it('does NOT apply Etsy\'s tag limit to the storefront', () => {
    // Caught on live data: real storefront keywords like
    // "neon y2k glitch ghost shirt" (27 chars) are fine, and blocking them was
    // a false failure that would have held back most of the catalogue.
    const long = { ...good, channel: 'storefront' as Channel, tags: ['neon y2k glitch ghost shirt', 'kawaii halloween t shirt', 'glow under blacklight', 'cute cartoon ghost', 'pixel art candy'] }
    expect(checkSeo(long).ok).toBe(true)
  })

  it('warns on storefront keywords that have become sentences', () => {
    const rambling = {
      ...good,
      channel: 'storefront' as Channel,
      tags: ['a keyword phrase so long that it is really just a whole sentence', 'retro varsity tee', 'oversized fit tee', 'y2k aesthetic', 'gift for teen']
    }
    const verdict = checkSeo(rambling)
    expect(verdict.ok).toBe(true)
    expect(verdict.findings.some(f => f.severity === 'warn' && /sentences/i.test(f.issue))).toBe(true)
  })

  it('blocks a description that is too thin to sell anything', () => {
    const verdict = checkSeo({ ...good, description: 'A cool retro shirt.' })
    expect(verdict.ok).toBe(false)
    expect(blocks(verdict).join(' ')).toContain(String(DESCRIPTION_MIN_CHARS))
  })

  it('applies looser rules on the storefront than on Etsy', () => {
    const short = { ...good, title: 'Simply Be You Retro Tee', tags: good.tags.slice(0, 6) }
    expect(checkSeo({ ...short, channel: 'etsy' }).ok).toBe(false)
    expect(checkSeo({ ...short, channel: 'storefront' }).ok).toBe(true)
  })

  it('every blocking finding carries an actionable fix', () => {
    const verdict = checkSeo({ channel: 'etsy', title: '', description: '', tags: [] })
    expect(verdict.findings.length).toBeGreaterThan(0)
    for (const f of verdict.findings) expect(f.fix.length).toBeGreaterThan(10)
  })
})

describe('checkPricing', () => {
  it('passes a normal shirt price', () => {
    expect(checkPricing({ category: 'shirts', price: 25 }).ok).toBe(true)
  })

  it('blocks a slipped decimal in either direction', () => {
    expect(checkPricing({ category: 'shirts', price: 2.5 }).ok).toBe(false)
    expect(checkPricing({ category: 'shirts', price: 250 }).ok).toBe(false)
  })

  it('blocks a free or negative listing', () => {
    expect(checkPricing({ category: 'shirts', price: 0 }).ok).toBe(false)
    expect(checkPricing({ category: 'shirts', price: -5 }).ok).toBe(false)
  })

  it('blocks a missing price rather than treating it as zero', () => {
    const verdict = checkPricing({ category: 'shirts', price: NaN })
    expect(verdict.ok).toBe(false)
    expect(blocks(verdict).join(' ')).toMatch(/missing|not a number/i)
  })

  it('blocks a price at or below the recorded cost', () => {
    const verdict = checkPricing({ category: 'shirts', price: 16, costFloor: 16 })
    expect(verdict.ok).toBe(false)
    expect(blocks(verdict).join(' ')).toMatch(/loses money/i)
  })

  it('uses a different band per category, and a default for unknown ones', () => {
    // $30 is fine on a shirt and fine on a hoodie; $18 is fine on a shirt and
    // too cheap for a hoodie. The bands are doing real work, not decorating.
    expect(checkPricing({ category: 'shirts', price: 18 }).ok).toBe(true)
    expect(checkPricing({ category: 'hoodies', price: 18 }).ok).toBe(false)
    expect(priceBandFor('not-a-real-category')).toEqual(priceBandFor(null))
  })
})

// --- image criteria --------------------------------------------------------
const metric = (over: Partial<{ width: number; height: number; sharpness: number }> = {}) => ({
  url: 'https://example.test/shot.png',
  ok: true as const,
  width: over.width ?? 2048,
  height: over.height ?? 2048,
  shortEdge: Math.min(over.width ?? 2048, over.height ?? 2048),
  longEdge: Math.max(over.width ?? 2048, over.height ?? 2048),
  format: 'png',
  bytes: 1234,
  sharpness: over.sharpness ?? 900,
  edgeEnergy: 20
})

describe('checkMockupQuality', () => {
  it('passes a full-size readable photo set', () => {
    const verdict = checkMockupQuality([metric(), metric(), metric()], 3)
    expect(verdict.ok).toBe(true)
    expect(verdict.findings).toEqual([])
  })

  it('blocks a photo below the resolution floor', () => {
    const small = MIN_SHORT_EDGE_PX - 1
    const verdict = checkMockupQuality([metric({ width: small, height: small })], 1)
    expect(verdict.ok).toBe(false)
    expect(blocks(verdict).join(' ')).toContain(String(MIN_SHORT_EDGE_PX))
  })

  it('only WARNS between the floor and Etsy\'s recommendation — the live catalogue sits here', () => {
    const verdict = checkMockupQuality([metric({ width: 1024, height: 1024 })], 1)
    expect(verdict.ok).toBe(true)
    expect(verdict.findings.some(f => f.severity === 'warn' && f.issue.includes(String(WARN_SHORT_EDGE_PX)))).toBe(true)
  })

  it('blocks a photo that could not be opened at all', () => {
    const verdict = checkMockupQuality([{ url: 'https://example.test/gone.png', ok: false, error: 'HTTP 404' }], 1)
    expect(verdict.ok).toBe(false)
    expect(blocks(verdict).join(' ')).toMatch(/could not be opened/i)
  })

  it('blocks a presentation with no photos at all', () => {
    expect(checkMockupQuality([], 0).ok).toBe(false)
  })
})

describe('checkSharpness', () => {
  it('passes shots above the calibrated floor', () => {
    expect(checkSharpness([metric({ sharpness: MIN_SHARPNESS + 1 })]).ok).toBe(true)
  })

  it('blocks a blurred or upscaled shot', () => {
    // 97 is what a real listing image measured at after being downsampled to
    // 200px and blown back up to 2000px — the exact failure a pixel-count check
    // waves through. See scripts/calibrate-qa-sharpness.ts.
    const verdict = checkSharpness([metric({ sharpness: 97 })])
    expect(verdict.ok).toBe(false)
    expect(blocks(verdict).join(' ')).toMatch(/blurry or upscaled/i)
  })

  it('warns on soft-but-usable shots without blocking them', () => {
    const verdict = checkSharpness([metric({ sharpness: WARN_SHARPNESS - 1 })])
    expect(verdict.ok).toBe(true)
    expect(verdict.findings.some(f => f.severity === 'warn')).toBe(true)
  })

  it('fails closed when nothing could be measured', () => {
    const verdict = checkSharpness([{ url: 'x', ok: false, error: 'HTTP 500' }])
    expect(verdict.ok).toBe(false)
    expect(verdict.unverified).toBe(true)
  })
})

describe('product kind', () => {
  it('treats printed garments and standalone products differently', () => {
    expect(isGarment('shirts')).toBe(true)
    expect(isGarment('hoodies')).toBe(true)
    expect(isGarment('metal-art')).toBe(false)
    expect(isGarment('3d-prints')).toBe(false)
    expect(isGarment(null)).toBe(false)
  })

  it('exempts a non-garment from the garment coverage rule', () => {
    // Live false failure this closes: a metal wall panel was reported as
    // "shown on a wall canvas instead of printed on a chest garment", which
    // describes the product rather than a defect.
    expect(coverageIsExempt('not-applicable')).toBe(true)
    expect(coverageIsExempt('front-center')).toBe(false)
  })
})

describe('laplacianStats', () => {
  const buf = (w: number, h: number, fn: (x: number, y: number) => number) => {
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = fn(x, y)
    return out
  }

  it('reports zero for a flat field', () => {
    expect(laplacianStats(buf(32, 32, () => 128), 32, 32).variance).toBe(0)
  })

  it('reports high variance for a hard checkerboard and low for a smooth ramp', () => {
    const checker = laplacianStats(buf(32, 32, (x, y) => ((x + y) % 2 ? 255 : 0)), 32, 32).variance
    const ramp = laplacianStats(buf(32, 32, x => x * 8), 32, 32).variance
    expect(checker).toBeGreaterThan(ramp)
    expect(checker).toBeGreaterThan(1000)
  })

  it('refuses a buffer that is too small for the stated dimensions', () => {
    // Guards the live bug this caught: sharp's .greyscale() on an RGBA source
    // emits grey+alpha, and reading that as one channel scores a crisp
    // transparent PNG as blurry.
    expect(laplacianStats(new Uint8Array(10), 32, 32)).toEqual({ variance: 0, meanAbs: 0 })
  })
})
