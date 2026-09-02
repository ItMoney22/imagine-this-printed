// The ITP blank line — the single identity table for the four garment tiers.
//
// Read by BOTH sides of the build boundary (like backend/shared/promos.ts):
//   - src/lib/garment-tiers.ts        → printed-apparel quality upsell picker
//   - src/pages/BlankShirts.tsx        → the /blanks lane (cards + spec table)
//   - backend/scripts/seed-blanks.ts   → the four blank products in `products`
//
// David 2026-09-02: "we brand our shirts so we rip the tags and put our tags
// ... good better best quality and the top line ... dont use the word gilden
// next level etc but you can put compared to. make sure it has the stats ...
// with a 10% markup from jiffy to us."
//
// House names carry NO manufacturer brand. The manufacturer + style number
// live in `compareTo` and may only ever be rendered as "Compared to …".
//
// COST BASIS. `cost.account` is what David's signed-in Jiffy account actually
// pays (captured 2026-09-02 from jiffy.com — the page showed "Deliver To
// David, Rockmart 30153"); `cost.list` is the public list price on the same
// pages, 34–45% higher. Prices are built from `account` by default
// (scripts/seed-blanks.ts --basis list switches). Per-size costs are the
// S-XL band normalised to the band's HIGHEST size price — Jiffy runs odd
// one-size promos (Good tier White S was $1.86 while M-XL were $2.79) that
// must not become the customer's price.

export type BlankSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | '2XL' | '3XL' | '4XL' | '5XL'
export const BLANK_SIZE_ORDER: BlankSize[] = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']

export type BlankTierId = 'standard' | 'soft' | 'premium' | 'heavyweight'
export type BlankGrade = 'Good' | 'Better' | 'Best' | 'Top Line'

export type SizeCostTable = Partial<Record<BlankSize, number>>

export interface BlankColor {
  /** Jiffy's colour name — products.colors + blank_inventory.color use this verbatim. */
  name: string
  /** Swatch hex for the storefront (approximation of the mill's swatch). */
  hex: string
}

export interface BlankTierSpec {
  id: BlankTierId
  rank: 1 | 2 | 3 | 4
  grade: BlankGrade
  /** House name — never contains a manufacturer brand. */
  name: string
  slug: string
  tagline: string
  description: string
  /** Manufacturer + style — render ONLY as "Compared to <brand> <style>". */
  compareTo: { brand: string; style: string }
  supplier: { name: 'Jiffy'; url: string }
  specs: {
    weightOz: number
    fabric: string
    fit: string
    seams: 'tubular' | 'side-seamed'
    collar: string
    construction: string[]
    label: string
    bestFor: string
  }
  sizes: BlankSize[]
  colors: BlankColor[]
  /** Colour names priced from cost.*.white instead of cost.*.default. */
  whiteColors: string[]
  cost: {
    capturedAt: string
    account: { default: SizeCostTable; white: SizeCostTable }
    list: { default: SizeCostTable; white: SizeCostTable }
  }
  /** Public image path (public/blanks/…), served by Vercel — no bucket write. */
  image: string
  /** Colour the hero image shows. */
  heroColor: string
}

export const BLANK_MARKUP_PCT = 10

/** "Our label" story shared by every tier's copy. */
export const BLANK_LABEL_NOTE =
  'The manufacturer tag is removed and replaced with the Imagine This Printed label — the same blanks we print on, sold plain.'

function band(sizes: BlankSize[], price: number): SizeCostTable {
  const t: SizeCostTable = {}
  for (const s of sizes) t[s] = price
  return t
}

const S_XL: BlankSize[] = ['S', 'M', 'L', 'XL']
const XS_XL: BlankSize[] = ['XS', 'S', 'M', 'L', 'XL']

export const BLANK_LINE: BlankTierSpec[] = [
  {
    id: 'standard',
    rank: 1,
    grade: 'Good',
    name: 'Classic Heavy Cotton Tee',
    slug: 'blank-classic-heavy-cotton-tee',
    tagline: 'The everyday workhorse — thick, durable, true to size.',
    description:
      'A 5.3 oz heavy-cotton crewneck with the boxy classic fit everyone knows. Preshrunk, taped at the neck and shoulders, and built to take a beating. Sold blank with our label — the exact shirt under most of our prints.',
    compareTo: { brand: 'Gildan', style: '5000' },
    supplier: { name: 'Jiffy', url: 'https://www.jiffy.com/gildan-g500.html' },
    specs: {
      weightOz: 5.3,
      fabric: '100% preshrunk cotton (heathers are cotton/poly blends)',
      fit: 'Classic, roomy',
      seams: 'tubular',
      collar: '7/8" seamless double-needle rib collar',
      construction: [
        'Taped neck and shoulders',
        'Double-needle sleeve and bottom hems',
        'Tubular body — no side seams',
        'Preshrunk jersey knit'
      ],
      label: 'Imagine This Printed label',
      bestFor: 'Events, teams, giveaways, work shirts'
    },
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    colors: [
      { name: 'White', hex: '#FFFFFF' },
      { name: 'Black', hex: '#141414' },
      { name: 'Sport Gray', hex: '#A9AAAD' },
      { name: 'Dark Heather', hex: '#4B4B50' },
      { name: 'Charcoal', hex: '#555555' },
      { name: 'Ash', hex: '#D9D9D6' },
      { name: 'Navy', hex: '#1B2A49' },
      { name: 'Royal', hex: '#2E4DA7' },
      { name: 'Sapphire', hex: '#1F5FA8' },
      { name: 'Indigo Blue', hex: '#2C3E7B' },
      { name: 'Light Blue', hex: '#A9C7E6' },
      { name: 'Carolina Blue', hex: '#7BAFD4' },
      { name: 'Red', hex: '#C8102E' },
      { name: 'Cardinal', hex: '#8C1D40' },
      { name: 'Maroon', hex: '#6A1B2C' },
      { name: 'Forest Green', hex: '#1F4D2E' },
      { name: 'Irish Green', hex: '#00A651' },
      { name: 'Military Green', hex: '#5B6236' },
      { name: 'Safety Green', hex: '#C6F542' },
      { name: 'Orange', hex: '#F26F21' },
      { name: 'Texas Orange', hex: '#C9541A' },
      { name: 'Gold', hex: '#F2B02F' },
      { name: 'Daisy', hex: '#FFD84D' },
      { name: 'Light Pink', hex: '#F7C6D4' },
      { name: 'Heliconia', hex: '#E4287C' },
      { name: 'Purple', hex: '#5B2C8F' },
      { name: 'Sand', hex: '#D7C9A5' },
      { name: 'Dark Chocolate', hex: '#3B2418' }
    ],
    whiteColors: ['White'],
    cost: {
      capturedAt: '2026-09-02',
      account: {
        default: { ...band(S_XL, 2.99), '2XL': 6.93, '3XL': 8.6, '4XL': 9.53, '5XL': 9.53 },
        white: { ...band(S_XL, 2.79), '2XL': 5.38, '3XL': 7.17, '4XL': 7.5, '5XL': 7.5 }
      },
      list: {
        default: { ...band(S_XL, 5.72), '2XL': 9.5, '3XL': 10.68, '4XL': 10.68, '5XL': 10.68 },
        white: { ...band(S_XL, 5.04), '2XL': 8.56, '3XL': 9.64, '4XL': 9.64, '5XL': 9.64 }
      }
    },
    image: '/blanks/classic-heavy-cotton-tee.webp',
    heroColor: 'White'
  },
  {
    id: 'soft',
    rank: 2,
    grade: 'Better',
    name: 'Soft Ring-Spun Tee',
    slug: 'blank-soft-ring-spun-tee',
    tagline: 'Lighter, softer, a touch slimmer — the modern everyday tee.',
    description:
      'A 4.5 oz ring-spun cotton crewneck that feels broken-in out of the bag. Slightly slimmer through the body than the heavy classic, with taped shoulders and a soft rib collar. Sold blank with our label.',
    compareTo: { brand: 'Gildan', style: '64000' },
    supplier: { name: 'Jiffy', url: 'https://www.jiffy.com/gildan-g640.html' },
    specs: {
      weightOz: 4.5,
      fabric: '100% preshrunk ring-spun cotton (heathers are cotton/poly blends)',
      fit: 'Modern, slightly slimmer',
      seams: 'tubular',
      collar: '5/8" rib collar',
      construction: [
        'Ring-spun yarn — softer hand than open-end cotton',
        'Taped neck and shoulders',
        'Double-needle stitched sleeves and bottom hem',
        'Tubular body — no side seams'
      ],
      label: 'Imagine This Printed label',
      bestFor: 'Everyday wear, small brands, softer feel on a budget'
    },
    sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    colors: [
      { name: 'White', hex: '#FFFFFF' },
      { name: 'Black', hex: '#141414' },
      { name: 'Sport Gray', hex: '#A9AAAD' },
      { name: 'Dark Heather', hex: '#4B4B50' },
      { name: 'Graphite Heather', hex: '#5A5B5E' },
      { name: 'Charcoal', hex: '#555555' },
      { name: 'Heather Navy', hex: '#2B3A55' },
      { name: 'Navy', hex: '#1B2A49' },
      { name: 'Royal', hex: '#2E4DA7' },
      { name: 'Heather Royal', hex: '#3F5FB0' },
      { name: 'Heather Indigo', hex: '#3D4C7A' },
      { name: 'Heather Sapphire', hex: '#3B6FB6' },
      { name: 'Light Blue', hex: '#A9C7E6' },
      { name: 'Sky', hex: '#8CC5E8' },
      { name: 'Red', hex: '#C8102E' },
      { name: 'Cherry Red', hex: '#B51E2B' },
      { name: 'Heather Red', hex: '#C4404E' },
      { name: 'Maroon', hex: '#6A1B2C' },
      { name: 'Heather Maroon', hex: '#7A3040' },
      { name: 'Forest Green', hex: '#1F4D2E' },
      { name: 'Irish Green', hex: '#00A651' },
      { name: 'Military Green', hex: '#5B6236' },
      { name: 'Sage', hex: '#9FAF8E' },
      { name: 'Mint Green', hex: '#A8E0CF' },
      { name: 'Orange', hex: '#F26F21' },
      { name: 'Gold', hex: '#F2B02F' },
      { name: 'Daisy', hex: '#FFD84D' },
      { name: 'Light Pink', hex: '#F7C6D4' },
      { name: 'Azalea', hex: '#F0679B' },
      { name: 'Heliconia', hex: '#E4287C' },
      { name: 'Purple', hex: '#5B2C8F' },
      { name: 'Heather Purple', hex: '#6E4A9E' },
      { name: 'Sand', hex: '#D7C9A5' },
      { name: 'Dark Chocolate', hex: '#3B2418' }
    ],
    whiteColors: ['White'],
    cost: {
      capturedAt: '2026-09-02',
      account: {
        default: { ...band(XS_XL, 3.92), '2XL': 6.91, '3XL': 8.92, '4XL': 10.53, '5XL': 10.53 },
        white: { ...band(XS_XL, 3.25), '2XL': 5.98, '3XL': 8.07, '4XL': 8.38, '5XL': 8.38 }
      },
      list: {
        default: { ...band(XS_XL, 6.96), '2XL': 10.1, '3XL': 12.74, '4XL': 12.74, '5XL': 12.74 },
        white: { ...band(XS_XL, 6.14), '2XL': 9.18, '3XL': 11.82, '4XL': 11.82, '5XL': 11.82 }
      }
    },
    image: '/blanks/soft-ring-spun-tee.webp',
    heroColor: 'Sport Gray'
  },
  {
    id: 'premium',
    rank: 3,
    grade: 'Best',
    name: 'Premium Retail-Fit Tee',
    slug: 'blank-premium-retail-fit-tee',
    tagline: 'Combed ring-spun cotton, side-seamed, the softest print base we carry.',
    description:
      'A 4.2 oz combed and ring-spun cotton crewneck with a true retail fit: side seams, shoulder taping, and a drape that reads boutique, not promo. The softest shirt in the line. Sold blank with our label.',
    compareTo: { brand: 'Bella+Canvas', style: '3001' },
    supplier: { name: 'Jiffy', url: 'https://www.jiffy.com/bellacanvas-3001C.html' },
    specs: {
      weightOz: 4.2,
      fabric: '100% combed and ring-spun cotton, 32 singles',
      fit: 'Retail — fitted through the body, runs slimmer',
      seams: 'side-seamed',
      collar: 'Rib collar with shoulder-to-shoulder taping',
      construction: [
        'Combed + ring-spun 32-singles yarn — the smoothest hand in the line',
        'Side-seamed for a tailored retail shape',
        'Shoulder-to-shoulder taping',
        'Preshrunk'
      ],
      label: 'Imagine This Printed label',
      bestFor: 'Brands and merch drops, fashion-fit customers, softest feel'
    },
    sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
    colors: [
      { name: 'White', hex: '#FFFFFF' },
      { name: 'Vintage White', hex: '#EDE9DF' },
      { name: 'Black', hex: '#101010' },
      { name: 'Vintage Black', hex: '#2B2B2B' },
      { name: 'Solid Athletic Gray', hex: '#9FA1A4' },
      { name: 'Dark Gray', hex: '#4B4B4B' },
      { name: 'Asphalt', hex: '#4E5155' },
      { name: 'Storm', hex: '#6B6E73' },
      { name: 'Slate', hex: '#6F7378' },
      { name: 'Ash', hex: '#D6D6D3' },
      { name: 'Navy', hex: '#1D2B4F' },
      { name: 'True Royal', hex: '#2A56C6' },
      { name: 'Vintage Navy', hex: '#2E3A57' },
      { name: 'Steel Blue', hex: '#4F7DA3' },
      { name: 'Ocean Blue', hex: '#2E7FB6' },
      { name: 'Light Blue', hex: '#A6C8E7' },
      { name: 'Baby Blue', hex: '#B9D6EF' },
      { name: 'Dusty Blue', hex: '#7F9FBF' },
      { name: 'Turquoise', hex: '#2FB4C8' },
      { name: 'Teal', hex: '#2E8B8B' },
      { name: 'Aqua', hex: '#5AC8D8' },
      { name: 'Red', hex: '#C41E3A' },
      { name: 'Cardinal', hex: '#8E1E3A' },
      { name: 'Maroon', hex: '#6B1F33' },
      { name: 'Oxblood', hex: '#4A1622' },
      { name: 'Berry', hex: '#A0245A' },
      { name: 'Pink', hex: '#F28CB1' },
      { name: 'Soft Pink', hex: '#F4C2D0' },
      { name: 'Lilac', hex: '#B9A4D8' },
      { name: 'Royal Purple', hex: '#5A2D91' },
      { name: 'Team Purple', hex: '#4B2C7F' },
      { name: 'Forest', hex: '#1F4A33' },
      { name: 'Military Green', hex: '#5B6B3F' },
      { name: 'Army', hex: '#5A5B3B' },
      { name: 'Kelly', hex: '#1EA84B' },
      { name: 'Sage', hex: '#A9B6A0' },
      { name: 'Olive', hex: '#6B6B3A' },
      { name: 'Mint', hex: '#B8E3CF' },
      { name: 'Orange', hex: '#F26B1D' },
      { name: 'Burnt Orange', hex: '#C6551E' },
      { name: 'Gold', hex: '#F0B22E' },
      { name: 'Mustard', hex: '#D6A22A' },
      { name: 'Yellow', hex: '#F8D84A' },
      { name: 'Peach', hex: '#F7BFA0' },
      { name: 'Tan', hex: '#C9B28E' },
      { name: 'Soft Cream', hex: '#F3E8CF' },
      { name: 'Toast', hex: '#B48A5A' },
      { name: 'Chestnut', hex: '#7A4B33' },
      { name: 'Brown', hex: '#5B3A29' }
    ],
    whiteColors: ['White'],
    cost: {
      capturedAt: '2026-09-02',
      account: {
        default: { ...band(XS_XL, 5.9), '2XL': 8.6, '3XL': 10.78, '4XL': 14.94, '5XL': 15.61 },
        white: { ...band(XS_XL, 4.78), '2XL': 7.53, '3XL': 10.78, '4XL': 14.18, '5XL': 15.03 }
      },
      list: {
        default: { ...band(XS_XL, 8.98), '2XL': 12.14, '3XL': 14.12, '4XL': 16.68, '5XL': 19.52 },
        white: { ...band(XS_XL, 8.98), '2XL': 12.14, '3XL': 14.12, '4XL': 16.68, '5XL': 19.52 }
      }
    },
    image: '/blanks/premium-retail-fit-tee.webp',
    heroColor: 'Black'
  },
  {
    id: 'heavyweight',
    rank: 4,
    grade: 'Top Line',
    name: 'Heavyweight Garment-Dyed Tee',
    slug: 'blank-heavyweight-garment-dyed-tee',
    tagline: 'Thick 6.1 oz ring-spun cotton, dyed after sewing for that lived-in vintage colour.',
    description:
      'The top of the line: a 6.1 oz ring-spun cotton crewneck that is garment-dyed and soft-washed after it is sewn, so every colour has that faded, lived-in depth and only gets better with washing. Relaxed boxy cut, thick 1" ribbed collar, twill-taped shoulders. Sold blank with our label.',
    compareTo: { brand: 'Comfort Colors', style: '1717' },
    supplier: { name: 'Jiffy', url: 'https://www.jiffy.com/comfortcolors-C1717.html' },
    specs: {
      weightOz: 6.1,
      fabric: '100% ring-spun cotton, garment-dyed and soft-washed',
      fit: 'Relaxed, boxy',
      seams: 'tubular',
      collar: '1" ribbed collar with double-needle topstitched neckline',
      construction: [
        'Garment-dyed after sewing — vintage, washed-down colour',
        'Preshrunk and soft-washed',
        'Twill taped shoulder-to-shoulder',
        'Double-needle stitched sleeves and bottom hem',
        'USA-grown cotton, dyed in Vermont'
      ],
      label: 'Imagine This Printed label',
      bestFor: 'Premium merch, vintage looks, heavyweight streetwear'
    },
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'],
    colors: [
      { name: 'White', hex: '#F5F5F2' },
      { name: 'Black', hex: '#1A1A1A' },
      { name: 'Pepper', hex: '#3F3F3F' },
      { name: 'Graphite', hex: '#5A5A5A' },
      { name: 'Grey', hex: '#8C8C8C' },
      { name: 'Granite', hex: '#6E7073' },
      { name: 'Ivory', hex: '#F1EBD9' },
      { name: 'Butter', hex: '#F4E39C' },
      { name: 'Sandstone', hex: '#D8C8A8' },
      { name: 'Khaki', hex: '#B9A67A' },
      { name: 'Mustard', hex: '#D3A331' },
      { name: 'Citrus', hex: '#F2C64B' },
      { name: 'Terracotta', hex: '#C06A45' },
      { name: 'Yam', hex: '#D9773A' },
      { name: 'Burnt Orange', hex: '#B95A2A' },
      { name: 'Melon', hex: '#F49D7A' },
      { name: 'Peachy', hex: '#F7C2A3' },
      { name: 'Watermelon', hex: '#E8607A' },
      { name: 'Crimson', hex: '#A52A3B' },
      { name: 'Red', hex: '#C0392B' },
      { name: 'Chili', hex: '#9E3A2D' },
      { name: 'Brick', hex: '#8A3B33' },
      { name: 'Berry', hex: '#8F3A6E' },
      { name: 'Blossom', hex: '#F1B1C8' },
      { name: 'Crunchberry', hex: '#E58BB3' },
      { name: 'Rose Quartz', hex: '#E9BFC8' },
      { name: 'Chalky Mint', hex: '#B7DBC8' },
      { name: 'Seafoam', hex: '#9FD2C0' },
      { name: 'Island Green', hex: '#7FB89A' },
      { name: 'Sage', hex: '#8FA58A' },
      { name: 'Moss', hex: '#7C8B5A' },
      { name: 'Blue Spruce', hex: '#4A7C74' },
      { name: 'Hemp', hex: '#8A9A6E' },
      { name: 'Emerald', hex: '#2F7D5B' },
      { name: 'Light Green', hex: '#B9D6A1' },
      { name: 'Washed Denim', hex: '#6C86A8' },
      { name: 'Denim', hex: '#4F6A8F' },
      { name: 'Chambray', hex: '#7F9BBF' },
      { name: 'Blue Jean', hex: '#5E7EA8' },
      { name: 'Lagoon Blue', hex: '#4C97C3' },
      { name: 'Flo Blue', hex: '#3B7BC2' },
      { name: 'Ice Blue', hex: '#A7C6DD' },
      { name: 'Periwinkle', hex: '#8A93C9' },
      { name: 'Hydrangea', hex: '#9AB6D6' },
      { name: 'China Blue', hex: '#5F7FA6' },
      { name: 'Midnight', hex: '#2C3E5C' },
      { name: 'True Navy', hex: '#22314F' },
      { name: 'Navy', hex: '#1F2E4D' },
      { name: 'Royal Caribe', hex: '#3A73B8' },
      { name: 'Orchid', hex: '#B58BC1' },
      { name: 'Violet', hex: '#7A5AA6' },
      { name: 'Grape', hex: '#5E3A8C' },
      { name: 'Wine', hex: '#5C2B3B' },
      { name: 'Espresso', hex: '#4B3227' }
    ],
    whiteColors: ['White'],
    cost: {
      capturedAt: '2026-09-02',
      account: {
        default: { ...band(S_XL, 7.53), '2XL': 11.65, '3XL': 13.98, '4XL': 16.62 },
        white: { ...band(S_XL, 7.49), '2XL': 10.5, '3XL': 12.62, '4XL': 14.26 }
      },
      list: {
        default: { ...band(S_XL, 11.78), '2XL': 15.22, '3XL': 18.36, '4XL': 18.36 },
        white: { ...band(S_XL, 11.78), '2XL': 15.22, '3XL': 18.36, '4XL': 18.36 }
      }
    },
    image: '/blanks/heavyweight-garment-dyed-tee.webp',
    heroColor: 'Blue Jean'
  }
]

export function blankTierById(id: string | null | undefined): BlankTierSpec | null {
  if (!id) return null
  return BLANK_LINE.find(t => t.id === id) ?? null
}

/** Display string for the one place a manufacturer name is allowed. */
export function compareToLabel(tier: Pick<BlankTierSpec, 'compareTo'>): string {
  return `Compared to ${tier.compareTo.brand} ${tier.compareTo.style}`
}

/** URL-safe slug for a colour name: "Sport Gray" -> "sport-gray". Used for
 *  public/blanks/<tier-slug>/<colour-slug>.webp (render-blank-colors.ts + seed). */
export function colorSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}
