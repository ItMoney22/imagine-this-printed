// Step Flow product slugs: a draft's slug is set once, at /step/upload, and
// when nobody typed a name it comes from the upload's FILE NAME. The Listing
// step later gives the product its real name but never touched the slug, so
// the live Folgers tee (9c3b3d19) sold at /product/1d2b8a23-0cdd-4dd3-b010-...
// — its upload's file name (task 62822de3, found in ebf7dec0's share-link
// work). This module decides when a product's slug should follow its final
// name, and records the old slug in metadata.replaces so links already sent
// still land (the SPA and bot renderer both walk api/_seo/share-link.mjs
// lookupPlan: id -> slug -> metadata.replaces).
//
// What counts as a file-name slug (deliberately conservative; a product whose
// slug came from a real name is never re-slugged):
//   1. uuid-shaped: strict 8-4-4-4-12 hex, optionally with the "-N"
//      generateUniqueSlug adds. Bare hex or hash-like stems are NOT caught here.
//   2. metadata.slug_source === 'filename', stamped by /step/upload when no
//      name was typed (the slug came from nameFromFilename or 'Custom Design').
//   3. an upload from before that stamp (import_source 'upload', no
//      slug_source) whose slug is exactly what the upload derived from its
//      file name (fileSlugBase), with or without a "-N".
import { slugify, generateUniqueSlug } from '../../utils/slugify.js'

/** "spartans-warrior_FINAL.png" -> "Spartans Warrior Final". A working name
 *  only, replaced by describeUpload() once the design has been looked at.
 *  Machine names come back empty: David's Folgers upload was
 *  "1d2b8a23-0cdd-4dd3-b010-ba2ce3a7bc77.png", and that string went straight
 *  onto the product details card as the shirt's title. */
export function nameFromFilename(filename: unknown): string {
  if (typeof filename !== 'string') return ''
  const stem = filename.replace(/\.[a-z0-9]+$/i, '').trim()
  const machineMade =
    /^[0-9a-f-]{12,}$/i.test(stem) || // uuids, hashes
    !/[a-z]{2}/i.test(stem) || // no word in it at all
    /^(img|image|dsc|pxl|photo|screenshot|screen shot|download|untitled|file|chatgpt image)[\s_\-]*[\d\s_\-.,:apm]*$/i.test(stem)
  if (machineMade) return ''
  return stem
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** The slug base /step/upload gives a draft nobody typed a name for. */
export function fileSlugBase(filename: unknown): string {
  return slugify(nameFromFilename(filename) || 'Custom Design') || 'custom-design'
}

const UUID_SLUG_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-\d+)?$/i
const MAX_SLUG_CHARS = 80

export function isUuidShapedSlug(slug: unknown): boolean {
  return typeof slug === 'string' && UUID_SLUG_RE.test(slug.trim())
}

/** `slug` is `base` itself or `base` with generateUniqueSlug's "-N" (a slugify base is only [a-z0-9-]). */
function isSlugOf(base: string, slug: string): boolean {
  return slug === base || new RegExp(`^${base}-\\d+$`).test(slug)
}

/**
 * "Folgers Coffee Racing Legend T-Shirt | Vintage Stock Car Tee" ->
 * "folgers-coffee-racing-legend-t-shirt". Listing titles carry an Etsy-style
 * " | keywords" tail; the slug takes the name before it (the same split the
 * share card uses, share-link.mjs shareName), capped at a word boundary.
 * Empty when the name has nothing a slug can be made of.
 */
export function slugFromName(name: unknown): string {
  const full = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : ''
  const lead = full.split(' | ')[0].trim() || full
  let slug = slugify(lead.normalize('NFKD').replace(/[̀-ͯ]/g, ''))
  if (slug.length > MAX_SLUG_CHARS) {
    const cut = slug.slice(0, MAX_SLUG_CHARS)
    slug = (cut.lastIndexOf('-') > 0 ? cut.slice(0, cut.lastIndexOf('-')) : cut).replace(/-+$/, '')
  }
  return isUuidShapedSlug(slug) ? '' : slug
}

type SlugRow = { slug?: string | null; metadata?: Record<string, any> | null }

/** True when the product's slug came from a file name, not a real name (rules at the top). */
export function slugCameFromFile(product: SlugRow): boolean {
  const slug = typeof product.slug === 'string' ? product.slug : ''
  if (!slug) return false
  if (isUuidShapedSlug(slug)) return true
  const meta = product.metadata ?? {}
  if (meta.slug_source === 'filename') return true
  if (meta.import_source === 'upload' && meta.slug_source == null) {
    return isSlugOf(fileSlugBase(meta.original_filename), slug)
  }
  return false
}

/**
 * Mirror of api/_seo/share-link.mjs replacesEntriesFor (the backend's tsc
 * rootDir can't reach api/; product-slug.test.ts holds the two to parity).
 * What a product records in metadata.replaces for a row or slug it takes
 * over, so every link handed out for it lands here instead of the catalog.
 */
export function replacesEntriesFor(oldRow: { id?: string | null; slug?: string | null } | null | undefined): string[] {
  const id = String(oldRow?.id ?? '').toLowerCase()
  return [id, id.slice(0, 8), oldRow?.slug].filter((v, i, all): v is string => !!v && all.indexOf(v) === i)
}

export interface ReslugPlan {
  slug: string
  /** The product's full metadata.replaces after the change (old entries kept). */
  replaces: string[]
}

/**
 * The slug a product should take for its final name, or null to leave it
 * alone: its slug already came from a real name, the name gives no slug, or
 * the slug already is that name's. `takenSlugs` are other products' slugs
 * starting with the name's base (the products_slug_key unique index).
 */
export function planReslug(product: SlugRow, finalName: unknown, takenSlugs: string[]): ReslugPlan | null {
  if (!slugCameFromFile(product)) return null
  const base = slugFromName(finalName)
  const current = String(product.slug)
  if (!base || isSlugOf(base, current)) return null
  const slug = generateUniqueSlug(base, takenSlugs.filter((s) => s && s !== current))
  const kept = Array.isArray(product.metadata?.replaces) ? product.metadata!.replaces.filter((v: unknown) => typeof v === 'string' && v) : []
  // Same product, so only its old slug is new to the list: its id still resolves by itself.
  const replaces = [...kept, ...replacesEntriesFor({ slug: current })].filter((v, i, all) => all.indexOf(v) === i)
  return { slug, replaces }
}

type SlugReader = {
  from: (table: 'products') => {
    select: (cols: string) => { like: (col: string, pattern: string) => PromiseLike<{ data: any[] | null; error: any }> }
  }
}

/** planReslug with the taken-slug read done against `db` (the service client in the route and the one-off script). */
export async function findReslug(db: SlugReader, product: SlugRow, finalName: unknown): Promise<ReslugPlan | null> {
  if (!slugCameFromFile(product)) return null
  const base = slugFromName(finalName)
  if (!base) return null
  const { data, error } = await db.from('products').select('slug').like('slug', `${base}%`)
  if (error) throw new Error(`slug lookup failed: ${error.message || error}`)
  return planReslug(product, finalName, (data || []).map((r: any) => r.slug).filter(Boolean))
}
