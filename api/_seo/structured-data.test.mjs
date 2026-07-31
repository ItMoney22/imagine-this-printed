// Structured data is only useful if it PARSES. Every assertion here goes
// through the rendered <script> text and JSON.parse, not the object literal —
// malformed JSON-LD is worse than none (Google flags it), and the failure mode
// we care about is serialization, not construction.
import { describe, it, expect } from 'vitest'
import {
  SITE_URL,
  availabilityFor,
  buildProductJsonLd,
  buildBreadcrumbJsonLd,
  buildOrganizationJsonLd,
  buildCollectionPageJsonLd,
  buildMetaTags,
  normalizeImages,
  injectHead,
  jsonLdScript,
  clip
} from './structured-data.mjs'

/** Render → extract → parse, exactly as a crawler would. */
function parseRendered(data) {
  const html = jsonLdScript(data)
  const inner = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
  return JSON.parse(inner)
}

const baseProduct = {
  id: '11111111-2222-3333-4444-555555555555',
  slug: 'galaxy-cat-tee',
  name: 'Galaxy Cat Tee',
  description: 'A cat. In space. On a shirt.',
  price: 24.5,
  images: ['/uploads/cat.png', 'https://cdn.example.com/cat2.png'],
  category: 'shirts',
  sku: 'ITP-CAT-01'
}

describe('jsonLdScript', () => {
  it('round-trips through JSON.parse', () => {
    expect(parseRendered({ a: 1, b: 'two' })).toEqual({ a: 1, b: 'two' })
  })

  it('cannot be broken out of by a </script> in product copy', () => {
    const html = jsonLdScript({ description: 'oops </script><script>alert(1)</script>' })
    expect(html.toLowerCase()).not.toContain('</script><script>')
    expect(html.match(/<\/script>/gi)).toHaveLength(1)
    // ...and the data still survives intact
    const inner = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
    expect(JSON.parse(inner).description).toBe('oops </script><script>alert(1)</script>')
  })
})

describe('buildProductJsonLd', () => {
  it('emits every field Google requires for a product rich result', () => {
    const canonical = `${SITE_URL}/product/galaxy-cat-tee`
    const ld = parseRendered(buildProductJsonLd(baseProduct, { canonical }))

    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@type']).toBe('Product')
    expect(ld.name).toBe('Galaxy Cat Tee')
    expect(ld.url).toBe(canonical)
    expect(ld.sku).toBe('ITP-CAT-01')
    expect(ld.brand).toEqual({ '@type': 'Brand', name: 'Imagine This Printed' })
    expect(Array.isArray(ld.image)).toBe(true)
    expect(ld.image.every((u) => /^https:\/\//.test(u))).toBe(true)

    expect(ld.offers['@type']).toBe('Offer')
    expect(ld.offers.price).toBe('24.50')
    expect(ld.offers.priceCurrency).toBe('USD')
    expect(ld.offers.availability).toBe('https://schema.org/InStock')
    expect(ld.offers.url).toBe(canonical)
  })

  it('omits offers rather than inventing a 0.00 price', () => {
    const ld = parseRendered(buildProductJsonLd({ ...baseProduct, price: null }, { canonical: `${SITE_URL}/product/x` }))
    expect(ld.offers).toBeUndefined()
    expect(ld.name).toBe('Galaxy Cat Tee')
  })

  it('never fabricates aggregateRating or review (no review source exists)', () => {
    const ld = parseRendered(buildProductJsonLd(baseProduct, { canonical: `${SITE_URL}/product/x` }))
    expect(ld.aggregateRating).toBeUndefined()
    expect(ld.review).toBeUndefined()
  })

  it('falls back to the logo when a product has no images', () => {
    const ld = parseRendered(buildProductJsonLd({ ...baseProduct, images: [] }, { canonical: `${SITE_URL}/product/x` }))
    expect(ld.image).toEqual([`${SITE_URL}/itp-logo-v3.png`])
  })
})

describe('availabilityFor', () => {
  it('treats made-to-order rows (no inventory tracking) as in stock', () => {
    expect(availabilityFor({ track_inventory: false, stock_quantity: 0 })).toBe('https://schema.org/InStock')
  })

  it('reports out of stock when inventory is tracked and empty', () => {
    expect(availabilityFor({ track_inventory: true, stock_quantity: 0 })).toBe('https://schema.org/OutOfStock')
  })

  it('reports in stock when inventory is tracked and present', () => {
    expect(availabilityFor({ track_inventory: true, stock_quantity: 7 })).toBe('https://schema.org/InStock')
  })

  it('honours an explicit in_stock=false', () => {
    expect(availabilityFor({ in_stock: false })).toBe('https://schema.org/OutOfStock')
  })

  it('uses BackOrder when the row allows backorders', () => {
    expect(availabilityFor({ in_stock: false, allow_backorder: true })).toBe('https://schema.org/BackOrder')
    expect(availabilityFor({ track_inventory: true, stock_quantity: 0, allow_backorder: true })).toBe(
      'https://schema.org/BackOrder'
    )
  })

  it('always reports digital products as in stock', () => {
    expect(availabilityFor({ is_digital: true, track_inventory: true, stock_quantity: 0 })).toBe(
      'https://schema.org/InStock'
    )
  })
})

describe('buildBreadcrumbJsonLd', () => {
  it('numbers positions from 1 and absolutizes every item url', () => {
    const ld = parseRendered(
      buildBreadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Catalog', url: '/catalog' },
        { name: 'Galaxy Cat Tee', url: `${SITE_URL}/product/galaxy-cat-tee` }
      ])
    )
    expect(ld['@type']).toBe('BreadcrumbList')
    expect(ld.itemListElement.map((i) => i.position)).toEqual([1, 2, 3])
    expect(ld.itemListElement.every((i) => i['@type'] === 'ListItem' && /^https:\/\//.test(i.item))).toBe(true)
    expect(ld.itemListElement[1].item).toBe(`${SITE_URL}/catalog`)
  })
})

describe('buildOrganizationJsonLd', () => {
  it('is an Organization with a contact point and no invented address', () => {
    const ld = parseRendered(buildOrganizationJsonLd())
    expect(ld['@type']).toBe('Organization')
    expect(ld.name).toBe('Imagine This Printed')
    expect(ld.logo).toBe(`${SITE_URL}/itp-logo-v3.png`)
    expect(ld.contactPoint['@type']).toBe('ContactPoint')
    expect(ld.address).toBeUndefined()
    expect(ld.sameAs).toBeUndefined()
  })
})

describe('buildCollectionPageJsonLd', () => {
  it('lists products as an ItemList with absolute urls', () => {
    const ld = parseRendered(
      buildCollectionPageJsonLd({
        name: 'Shirts',
        url: `${SITE_URL}/catalog/shirts`,
        items: [{ name: 'Galaxy Cat Tee', url: '/product/galaxy-cat-tee' }]
      })
    )
    expect(ld['@type']).toBe('CollectionPage')
    expect(ld.mainEntity['@type']).toBe('ItemList')
    expect(ld.mainEntity.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'Galaxy Cat Tee',
      url: `${SITE_URL}/product/galaxy-cat-tee`
    })
  })

  it('omits mainEntity when there are no items', () => {
    const ld = parseRendered(buildCollectionPageJsonLd({ name: 'Empty', url: `${SITE_URL}/catalog/none` }))
    expect(ld.mainEntity).toBeUndefined()
  })
})

describe('normalizeImages', () => {
  it('absolutizes, de-dupes and caps at six', () => {
    const out = normalizeImages(['/a.png', '/a.png', 'https://x.test/b.png', '/c.png', '/d.png', '/e.png', '/f.png', '/g.png'])
    expect(out).toHaveLength(6)
    expect(out[0]).toBe(`${SITE_URL}/a.png`)
    expect(out[1]).toBe('https://x.test/b.png')
  })
})

describe('buildMetaTags', () => {
  it('escapes quotes so an attribute cannot be broken out of', () => {
    const html = buildMetaTags({
      title: 'A "quoted" <b>title</b>',
      description: 'desc',
      canonical: `${SITE_URL}/product/x`
    })
    expect(html).toContain('&quot;quoted&quot;')
    expect(html).not.toContain('<b>title</b>')
    expect(html).toContain('<meta property="og:url" content="https://www.imaginethisprinted.com/product/x" />')
  })

  it('adds robots noindex only when asked', () => {
    expect(buildMetaTags({ title: 't', description: 'd', canonical: 'c' })).not.toContain('noindex')
    expect(buildMetaTags({ title: 't', description: 'd', canonical: 'c', noindex: true })).toContain(
      '<meta name="robots" content="noindex,follow" />'
    )
  })
})

describe('injectHead', () => {
  it('replaces the shell title/description instead of duplicating them', () => {
    const shell = '<!doctype html><html><head><title>Old</title><meta name="description" content="old" /></head><body></body></html>'
    const out = injectHead(shell, '<title>New</title><meta name="description" content="new" />')
    expect(out.match(/<title>/g)).toHaveLength(1)
    expect(out).toContain('<title>New</title>')
    expect(out).not.toContain('content="old"')
  })

  it('keeps <meta charset> inside the first 1024 bytes', () => {
    const shell = '<!doctype html><html><head><meta charset="UTF-8" /><title>Old</title></head><body></body></html>'
    const big = jsonLdScript(buildProductJsonLd(baseProduct, { canonical: `${SITE_URL}/product/x` })).repeat(4)
    const out = injectHead(shell, `<title>New</title>${big}`)
    expect(big.length).toBeGreaterThan(1024) // the injected block alone blows the budget
    expect(out.indexOf('charset=')).toBeLessThan(1024)
    expect(out.indexOf('charset=')).toBeLessThan(out.indexOf('<title>New</title>'))
  })

  it('still injects when the shell has no charset tag', () => {
    const out = injectHead('<html><head></head><body></body></html>', '<title>New</title>')
    expect(out).toContain('<title>New</title>')
  })
})

describe('clip', () => {
  it('collapses whitespace and adds an ellipsis past the limit', () => {
    expect(clip('  a   b  ', 20)).toBe('a b')
    expect(clip('abcdefghij', 5)).toBe('abcd…')
  })
})
