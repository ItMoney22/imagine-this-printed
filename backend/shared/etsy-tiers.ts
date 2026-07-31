// ---------------------------------------------------------------------------
// Etsy selling tiers — David 2026-07-31: "so its a 3 tier shirt or transfer or
// download".
//
// One ITP design can be sold on Etsy three ways. Etsy sets BOTH `type`
// (physical vs download) and `taxonomy_id` at the LISTING level, so these can
// never be variations of one listing — each tier is its own Etsy listing, and
// etsy_listings is keyed (product_id, tier) rather than product_id alone
// (migration 20260731_etsy_listing_tiers.sql).
//
//   primary   the product as catalogued — the tee (482) or the metal panel
//             (119). Unchanged behaviour; every listing posted before
//             2026-07-31 is this tier.
//   transfer  the printed DTF film, mailed. Buyer presses it themselves.
//             Taxonomy 6617 (Image Transfers), priced by sheet size.
//   download  the design file itself, delivered by Etsy instantly. Taxonomy
//             6844 (Clip Art & Image Files), type=download, personal use only.
//
// PRICES ARE ANCHORS. David runs a standing 40% shop sale in Shop Manager
// (Etsy has no API for sale events), so every number here is what the listing
// shows struck through — the shopper pays 60% of it. $5 download → $3 paid,
// which is where David landed after seeing that Etsy's fixed ~$0.45 per sale
// eats over half of a $1 listing. Everything is env-overridable so pricing
// never needs a deploy.
//
// Taxonomy ids were resolved against the LIVE Etsy taxonomy (3,065 nodes,
// 2026-07-31) rather than guessed:
//   6617  Craft Supplies & Tools > Canvas & Surfaces > Stencils, Templates &
//         Transfers > Image Transfers
//   6844  Craft Supplies & Tools > Canvas & Surfaces > Stencils, Templates &
//         Transfers > Clip Art & Image Files
// ---------------------------------------------------------------------------

export const ETSY_TIERS = ['primary', 'transfer', 'download'] as const
export type EtsyTier = typeof ETSY_TIERS[number]

export const isEtsyTier = (v: unknown): v is EtsyTier =>
  typeof v === 'string' && (ETSY_TIERS as readonly string[]).includes(v)

/** Categories whose design can also be sold as a pressable transfer / a file.
 *  Metal art is deliberately absent: a wall panel has no transfer tier, and its
 *  artwork is sold as a print, not a press-ready DTF file. */
const TRANSFERABLE_CATEGORIES = new Set(['shirts', 't-shirts', 'hoodies', 'dtf-transfers'])

/** Which tiers a product in this category may be posted as. `primary` is
 *  always allowed — that is just "list the product itself". */
export function tiersForCategory(category: string | null): EtsyTier[] {
  const c = String(category ?? '')
  return TRANSFERABLE_CATEGORIES.has(c)
    ? ['primary', 'transfer', 'download']
    : ['primary']
}

// --- Sheet sizes -----------------------------------------------------------
// The three sizes ITP already sells on the storefront (see the DTF entry in
// AdminDashboard.tsx's size map). Anchors ladder roughly with film area; the
// shown column is what the 40% sale puts in front of the buyer.
//
//   8.5x11  $12 anchor -> $7.20 shown
//   11x17   $20 anchor -> $12.00 shown
//   13x19   $28 anchor -> $16.80 shown
export interface TransferSheetSize {
  key: string
  label: string
  price: number
}

export const TRANSFER_SHEET_SIZES: TransferSheetSize[] = [
  { key: '8.5x11', label: '8.5x11 inches', price: Number(process.env.ETSY_TRANSFER_PRICE_8_5X11 || 12) },
  { key: '11x17', label: '11x17 inches', price: Number(process.env.ETSY_TRANSFER_PRICE_11X17 || 20) },
  { key: '13x19', label: '13x19 inches', price: Number(process.env.ETSY_TRANSFER_PRICE_13X19 || 28) }
]

/** Listing base price = the cheapest size, so the listing reads "from $12". */
export const TRANSFER_BASE_PRICE = Math.min(...TRANSFER_SHEET_SIZES.map(s => s.price))

/** $5 anchor -> $3 paid under the standing 40% sale (David, 2026-07-31). */
export const DOWNLOAD_PRICE = Number(process.env.ETSY_DOWNLOAD_PRICE || 5)

// --- Per-tier listing shape ------------------------------------------------

export interface EtsyTierConfig {
  tier: EtsyTier
  label: string
  /** Etsy listing type. `download` listings take no shipping profile and no
   *  readiness state, and must have a file attached before they can activate. */
  listingType: 'physical' | 'download'
  /** Taxonomy id, or null to fall back to the category map (primary tier). */
  taxonomyId: number | null
  /** Listing price, or null to use the composed pack's price (primary tier). */
  price: number | null
  /** A digital listing sells the raw design; a mockup would be a lie. */
  requiresSourceFile: boolean
}

export function etsyTierConfig(tier: EtsyTier): EtsyTierConfig {
  switch (tier) {
    case 'transfer':
      return {
        tier,
        label: 'Physical transfer',
        listingType: 'physical',
        taxonomyId: Number(process.env.ETSY_TRANSFER_TAXONOMY_ID || 6617),
        price: TRANSFER_BASE_PRICE,
        requiresSourceFile: false
      }
    case 'download':
      return {
        tier,
        label: 'Digital download',
        listingType: 'download',
        taxonomyId: Number(process.env.ETSY_DOWNLOAD_TAXONOMY_ID || 6844),
        price: DOWNLOAD_PRICE,
        requiresSourceFile: true
      }
    default:
      return {
        tier: 'primary',
        label: 'Product listing',
        listingType: 'physical',
        taxonomyId: null,
        price: null,
        requiresSourceFile: false
      }
  }
}

// --- Copy -------------------------------------------------------------------
// The composed pack (etsy-seo-composer.ts) describes the DESIGN, and that copy
// is identical across tiers — only the framing of what ships differs. So the
// tier copy is a deterministic transform of the pack rather than three separate
// model calls: same design voice, no extra spend, and no risk of three LLM runs
// describing the same artwork three different ways.

const SIZE_LIST = TRANSFER_SHEET_SIZES.map(s => `${s.key}" ($${s.price})`).join(', ')

/** Strip apparel words the other tiers must not inherit — the pack title was
 *  written for a tee, and "T-Shirt" on a download listing is a false promise
 *  that Etsy treats as a mis-listing. */
function stripGarmentWords(title: string): string {
  return title
    .replace(/\s*\|\s*[^|]*\b(tee|t-?shirt|shirt|hoodie|sweatshirt|apparel)\b[^|]*$/i, '')
    .replace(/\b(unisex\s+)?(graphic\s+)?(t-?shirt|tee|hoodie|sweatshirt)s?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*\|\s*$/, '')
    .trim()
}

export interface TierCopy {
  title: string
  description: string
  tags: string[]
}

/**
 * Adapt a composed pack into tier-appropriate listing copy.
 * `maxTitleLen` / `maxTags` are passed in so this module stays free of the
 * publisher's import graph; both come from etsy-listing-fields.ts.
 */
export function tierCopy(
  tier: EtsyTier,
  pack: { title: string; description: string; tags: string[] },
  limits: { maxTitleLen: number; maxTags: number }
): TierCopy {
  if (tier === 'primary') return { title: pack.title, description: pack.description, tags: pack.tags }

  const core = stripGarmentWords(pack.title) || pack.title
  const clamp = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, limits.maxTitleLen)

  if (tier === 'transfer') {
    const title = clamp(`${core} DTF Transfer | Ready to Press Heat Transfer`)
    const description = [
      `Ready-to-press DTF transfer of the ${core} design. You press it, you keep the shirt you already love.`,
      '',
      'WHAT YOU GET',
      'A single full-color DTF (direct-to-film) transfer, printed and shipped from Rockmart, Georgia.',
      'This is the transfer only — no garment is included.',
      '',
      'SIZES',
      SIZE_LIST.replace(/\$(\d+)/g, '$$$1') + ' — pick your size at checkout.',
      '',
      'HOW TO PRESS',
      'Heat press at 300-320F for 10-15 seconds with medium pressure, peel warm or cold, then press again for 5 seconds under a cover sheet.',
      'A household iron will not hold even heat or pressure — a heat press gives the durable result.',
      '',
      'WORKS ON',
      'Cotton, polyester, and blends. Light or dark garments — the white underbase is printed for you.',
      '',
      pack.description
    ].join('\n')
    const tags = retagged(pack.tags, ['dtf transfer', 'heat transfer', 'ready to press', 'dtf print'], limits.maxTags)
    return { title, description, tags }
  }

  // download
  const title = clamp(`${core} PNG | Digital Download Sublimation DTF Design`)
  const description = [
    `Instant digital download of the ${core} design. Print it yourself, as many times as you like.`,
    '',
    'WHAT YOU GET',
    'One high-resolution 300 DPI PNG with a transparent background, ready for DTF, sublimation, HTV, or print-and-cut.',
    'Delivered by Etsy the moment your payment clears — nothing is shipped.',
    '',
    'LICENSE — PERSONAL USE ONLY',
    'Print this design for yourself as many times as you like.',
    'You may NOT resell, share, or redistribute the file, and you may NOT sell finished items made with it.',
    'Want to sell what you make? Message us about a commercial license.',
    '',
    'NOTE',
    'This is a digital file, not a physical item. Because downloads cannot be returned, all sales are final — but message us if anything is wrong with your file and we will fix it.',
    '',
    pack.description
  ].join('\n')
  const tags = retagged(pack.tags, ['digital download', 'png sublimation', 'dtf design', 'instant download'], limits.maxTags)
  return { title, description, tags }
}

/** Lead with the tier's own buyer phrases, then keep as much of the design's
 *  original tag research as still fits. */
function retagged(packTags: string[], lead: string[], maxTags: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of [...lead, ...packTags]) {
    const key = t.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(t.trim())
    if (out.length >= maxTags) break
  }
  return out
}
