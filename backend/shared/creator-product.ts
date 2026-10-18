// Creator apparel: a creator's own merch line, published INTO ITP by their
// storefront (backend/routes/storefront.ts POST /products — Darrell
// McCutchen's Merch Studio is the first). David's 2026-10-07 phone walk of
// Darrell's "Walk By Faith": these sell as the creator's apparel, so
//   - no digital download of the print files (it undercut his $24.99 shirt
//     and handed his art out),
//   - no "Upload Your Own Design" / "Add to Imagination Sheet" tools,
//   - lead with his own garment photos, never the bare art on white,
//   - credit the creator by name,
//   - keep creator and faith products out of the generic recommendation rows.
//
// Identified by metadata.source 'merch-studio', the publish route's stamp.
// NOT by metadata.creator_id alone: user designs, Imagination Station and the
// Step Flow admin path all write creator_id as well.
//
// Shared by the storefront (src/lib/product-kind.ts, the recommender) and the
// API (digital purchase refusal, approval, storefront checkout) so the page
// and the server can never disagree about what a creator product is.

type Meta = Record<string, any> | null | undefined

export const CREATOR_PRODUCT_SOURCE = 'merch-studio'

export function isCreatorProductMeta(metadata: Meta): boolean {
  return metadata?.source === CREATOR_PRODUCT_SOURCE
}

/** The creator's ITP user id (for "more from this creator"); null when not a creator product. */
export function creatorIdOf(product: { metadata?: Meta; created_by_user_id?: string | null } | null | undefined): string | null {
  if (!isCreatorProductMeta(product?.metadata)) return null
  const id = product?.metadata?.creator_id ?? product?.created_by_user_id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

/** The public credit name ("Design by Darrell McCutchen"); null when unrecorded. */
export function creatorNameOf(product: { metadata?: Meta } | null | undefined): string | null {
  const m = product?.metadata
  if (!isCreatorProductMeta(m)) return null
  const name = typeof m?.creator_name === 'string' ? m.creator_name.trim() : ''
  return name ? name.slice(0, 80) : null
}

/**
 * Which placements ('front', 'back') carry a print-ready file. The files
 * themselves live in a private bucket, recorded in product_print_files
 * (service role only, backend/services/print-files.ts); the public row keeps
 * only this list in metadata.print_file_placements, because products is
 * readable by anyone (task b312de9c). A row still holding the old public
 * metadata.print_files URLs counts too.
 */
export function printFilePlacementsOf(metadata: Meta): string[] {
  const listed = Array.isArray(metadata?.print_file_placements)
    ? metadata.print_file_placements.filter((p: unknown): p is string => typeof p === 'string')
    : []
  const legacy = metadata?.print_files && typeof metadata.print_files === 'object'
    ? Object.keys(metadata.print_files).filter(k => typeof metadata.print_files[k] === 'string' && metadata.print_files[k])
    : []
  return [...new Set([...listed, ...legacy])]
}

/**
 * The garment colour the creator designed the art on (Merch Studio records it
 * as placement.colorName + placement.color). Used for the swatch so it matches
 * the photos rather than a CSS named colour.
 */
export function creatorGarmentColor(metadata: Meta): { name: string; hex: string | null } | null {
  if (!isCreatorProductMeta(metadata)) return null
  const p = metadata?.placement
  const name = typeof p?.colorName === 'string' ? p.colorName.trim() : ''
  if (!name) return null
  const hex = typeof p?.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : null
  return { name, hex }
}

// Faith vocabulary, matched as whole words on the listing's own name, search
// keywords and tags (not its long-form description, which is written loosely).
// Kept to unambiguous words: no bare "cross" (crossfit) or "holy" (puns).
const FAITH_WORDS = /\b(faith|faithful|jesus|christ|christian|christians|god|lord|bible|biblical|scripture|scriptures|church|pray|prayer|prayers|praying|blessed|gospel|amen|psalms?|proverbs|savior|saviour|holy spirit|holy bible|worship|ministry|religious|spiritual)\b/i

/** The fields a recommendation row can classify a listing on — a full product row or a slim select. */
export interface RecCandidate {
  id?: string
  name?: string | null
  search_keywords?: string | null
  meta_title?: string | null
  created_by_user_id?: string | null
  metadata?: Meta
}

function tagsOf(c: RecCandidate): string[] {
  const tags = c?.metadata?.etsy_pack?.tags
  return Array.isArray(tags) ? tags.filter((t: unknown): t is string => typeof t === 'string') : []
}

/** True when the listing is a faith product (by its name, keywords or tags). */
export function isFaithListing(c: RecCandidate | null | undefined): boolean {
  if (!c) return false
  const text = [c.name, c.search_keywords, c.meta_title, ...tagsOf(c)].filter(Boolean).join(' \n ')
  return FAITH_WORDS.test(text)
}

/**
 * Which listings may sit in a recommendation row beside the anchor:
 *   creator — the anchor is a creator product: only that creator's own work,
 *   faith   — the anchor is a faith product: only other (non-creator) faith products,
 *   generic — everything else: no creator products and no faith products.
 * No anchor (home page, cart) = generic.
 */
export type RecLane =
  | { kind: 'creator'; creatorId: string }
  | { kind: 'faith' }
  | { kind: 'generic' }

export function recommendationLane(anchor: RecCandidate | null | undefined): RecLane {
  const creatorId = anchor ? creatorIdOf(anchor) : null
  if (creatorId) return { kind: 'creator', creatorId }
  if (anchor && isCreatorProductMeta(anchor.metadata)) return { kind: 'creator', creatorId: '' }
  if (isFaithListing(anchor)) return { kind: 'faith' }
  return { kind: 'generic' }
}

export function fitsRecommendationLane(lane: RecLane, c: RecCandidate): boolean {
  const creator = isCreatorProductMeta(c?.metadata)
  switch (lane.kind) {
    case 'creator':
      return creator && !!lane.creatorId && creatorIdOf(c) === lane.creatorId
    case 'faith':
      return !creator && isFaithListing(c)
    default:
      return !creator && !isFaithListing(c)
  }
}
