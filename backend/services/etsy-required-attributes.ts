// ---------------------------------------------------------------------------
// Etsy-required listing attributes — Christina 2026-08-22: "the created
// products require a 'craft type' as a mandatory field. This needs to either
// be optional or more craft types need to be added. none of them fit what we
// do".
//
// Craft type is ETSY's field, not ours. Read live 2026-10-13 with
// `node backend/scripts/etsy-poc.mjs properties --ids 6617,6844 --raw`:
//
//   property 47626759760 "Craft type" — is_required: true, multi-valued, max 5
//   6617 Image Transfers (the DTF tier):  Calligraphy, Card making & stationery,
//        Ceramics & pottery, Cross stitch, Embroidery, Enameling, Glass fusing,
//        Kids' crafts, Painting, Party & gifting, Sewing, Woodworking & carpentry
//   6844 Clip Art & Image Files (the PNG tier): Card making & stationery,
//        Collage, Kids' crafts, Scrapbooking
//
// The tee (482), metal art (119) and 3D print (1799) nodes have no required
// attribute at all; hoodies (1853) require "Clothing closure", which nothing
// here fills (no hoodie is listed on Etsy yet).
//
// So neither fix the card asked for is possible on Etsy's side: a seller cannot
// skip a required attribute, and the value list is Etsy's (there is no "DTF" or
// "Apparel printing" to pick, and no way to add one). What we CAN do is never
// make a person pick: the publisher writes the closest real values onto every
// draft, so the field is already filled when Christina opens it. All six DTF
// and PNG drafts in the shop on 2026-10-13 had it blank.
//
// The picks (judgment, not an Etsy rule; edit CRAFT_TYPES to change them):
//   transfer  a DTF film pressed onto fabric -> Sewing (Etsy's fabric/garment
//             bucket) + Party & gifting (custom shirts for events and gifts).
//             Never Embroidery: ITP does not embroider.
//   download  a transparent PNG design -> the three paper-craft printables the
//             node offers. Not Kids' crafts.
//
// Kept free of Supabase/env imports so it can be driven by the live publisher
// (etsy.ts, through etsyFetch) and by the local backfill script alike.
// ---------------------------------------------------------------------------

export type CraftKind = 'transfer' | 'download'

export const CRAFT_TYPES: Record<CraftKind, readonly string[]> = {
  transfer: ['Sewing', 'Party & gifting'],
  download: ['Card making & stationery', 'Scrapbooking', 'Collage']
}

/** What the listing physically is decides its craft type, not the tier label:
 *  a primary-tier listing of a `dtf-transfers` product sits on 6617 too. */
export function craftKindFor(listingType: string | null | undefined): CraftKind {
  return listingType === 'download' ? 'download' : 'transfer'
}

export interface TaxonomyPropertyValue { value_id: number; name: string }

/** One entry of GET /application/seller-taxonomy/nodes/{id}/properties. */
export interface TaxonomyProperty {
  property_id: number
  name: string
  display_name?: string
  is_required?: boolean
  is_multivalued?: boolean
  max_values_allowed?: number | null
  possible_values?: TaxonomyPropertyValue[]
}

/** One entry of GET /application/shops/{shop}/listings/{id}/properties. */
export interface ListingPropertyValue {
  property_id: number
  value_ids?: number[]
  values?: string[]
}

export interface AttributeWrite {
  property_id: number
  name: string
  value_ids: number[]
  values: string[]
}

export interface AttributePlan {
  /** Required attributes this call will write. */
  writes: AttributeWrite[]
  /** Required attributes still blank afterwards — a person has to set them. */
  unfilled: string[]
}

const isCraftType = (p: TaxonomyProperty) =>
  /^craft type$/i.test(String(p.name ?? '').trim()) || /^craft type$/i.test(String(p.display_name ?? '').trim())

const hasValue = (v: ListingPropertyValue | undefined) =>
  !!v && ((v.value_ids?.length ?? 0) > 0 || (v.values?.length ?? 0) > 0)

/**
 * Decide which required attributes to write. Never overwrites a value already
 * on the listing (whatever Christina picked by hand wins), and never guesses a
 * required attribute it has no rule for: that one is reported as unfilled.
 */
export function planRequiredAttributes(
  nodeProperties: TaxonomyProperty[],
  current: ListingPropertyValue[],
  kind: CraftKind
): AttributePlan {
  const plan: AttributePlan = { writes: [], unfilled: [] }
  const byId = new Map(current.map(v => [Number(v.property_id), v]))

  for (const p of nodeProperties) {
    if (!p.is_required) continue
    if (hasValue(byId.get(Number(p.property_id)))) continue
    const label = p.display_name || p.name

    if (!isCraftType(p)) {
      plan.unfilled.push(label)
      continue
    }

    // Etsy's own spelling and ids, matched by name in OUR order of preference.
    // A name Etsy has since dropped is simply skipped.
    const offered = p.possible_values ?? []
    const cap = p.is_multivalued === false ? 1 : Math.max(1, Number(p.max_values_allowed) || 5)
    const picked: TaxonomyPropertyValue[] = []
    for (const want of CRAFT_TYPES[kind]) {
      const hit = offered.find(v => String(v.name).trim().toLowerCase() === want.toLowerCase())
      if (hit && !picked.includes(hit)) picked.push(hit)
      if (picked.length >= cap) break
    }

    if (!picked.length) {
      plan.unfilled.push(label)
      continue
    }
    plan.writes.push({
      property_id: Number(p.property_id),
      name: label,
      value_ids: picked.map(v => Number(v.value_id)),
      values: picked.map(v => v.name)
    })
  }
  return plan
}

/** The Etsy calls this needs, already authenticated (etsyFetch with a token in
 *  production, the etsy-poc token in the backfill script). */
export type EtsyCall = (path: string, opts?: { method?: string; json?: unknown }) => Promise<any>

export interface ApplyRequiredAttributesOptions {
  /** A listing created this run has nothing set yet, so skip reading it. */
  fresh?: boolean
  /** Plan only; write nothing. */
  dryRun?: boolean
}

export interface AppliedAttributes extends AttributePlan {
  /** Names actually written to Etsy (empty on a dry run). */
  filled: string[]
}

/**
 * Fill the Etsy-required attributes on one listing. Each write is a PUT of the
 * whole property (value_ids + values as JSON — proven live 2026-10-13 on the
 * Validation draft 4593902255; a repeated form key keeps only the LAST value).
 */
export async function applyRequiredAttributes(
  call: EtsyCall,
  shopId: number,
  listingId: number,
  taxonomyId: number,
  kind: CraftKind,
  opts: ApplyRequiredAttributesOptions = {}
): Promise<AppliedAttributes> {
  const nodeRes = await call(`/application/seller-taxonomy/nodes/${taxonomyId}/properties`)
  const nodeProperties: TaxonomyProperty[] = nodeRes?.results ?? []
  // Nothing required on this node (tees, metal, 3D prints): one read and done.
  if (!nodeProperties.some(p => p.is_required)) return { writes: [], unfilled: [], filled: [] }

  let current: ListingPropertyValue[] = []
  if (!opts.fresh) {
    const curRes = await call(`/application/shops/${shopId}/listings/${listingId}/properties`)
    current = curRes?.results ?? []
  }

  const plan = planRequiredAttributes(nodeProperties, current, kind)
  const filled: string[] = []
  if (!opts.dryRun) {
    for (const w of plan.writes) {
      await call(`/application/shops/${shopId}/listings/${listingId}/properties/${w.property_id}`, {
        method: 'PUT',
        json: { value_ids: w.value_ids, values: w.values }
      })
      filled.push(w.name)
    }
  }
  return { ...plan, filled }
}
