// Reverse inventory sync: when a blank_inventory row's qty_on_hand changes
// because of a sale, mirror the new count onto every Etsy listing that sells
// that blank, so Etsy stops offering stock ITP no longer has (the "sold-out
// blanks stay listed forever" bug this task exists to close).
//
// Trigger: called from blank-inventory.ts's decrementBlanksForOrder right
// after each blank's decrement RPC succeeds — that is the single choke point
// where blank_inventory.qty_on_hand changes due to a sale, and it already
// runs for BOTH Stripe checkouts and Etsy-ingested orders (see
// worker/etsy-receipt-ingest.ts), so this one call site covers both without
// duplicating the trigger.
//
// Conflict rule: ITP's blank_inventory is always authoritative; Etsy is a
// mirror, never the other way. This always re-reads qty_on_hand fresh at push
// time (the caller passes the post-decrement row, not a value captured before
// the decrement) and PUTs that absolute number to Etsy. That makes the push
// safe to retry (pushing the same qty twice is a no-op) and safe under
// concurrent decrements (whichever push runs last simply reflects whatever
// Postgres says qty_on_hand is at that moment — Postgres is the concurrency
// arbiter for the number itself, this function only ever mirrors it outward).
//
// Product mapping: only products with an explicit products.metadata.blank_style
// matching this blank's style_code are synced — the same deterministic path
// blank-inventory.ts's pickBlank() prefers. Products relying on pickBlank's
// ambiguous color+size fallback (no blank_style set) are deliberately skipped
// here rather than guessed at, because guessing wrong on the WRITE side could
// zero out (or inflate) the wrong listing's Etsy inventory — worse than not
// syncing at all. See REMAINING in the handoff.
import { supabase } from '../lib/supabase.js'
import { getListingInventory, putListingInventory, isEtsyEnabled } from './etsy.js'

const SIZE_NAME_RE = /^size\b/i
const COLOR_NAME_RE = /colou?r/i

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

function moneyToNumber(m: any): number {
  if (m && typeof m === 'object') return m.divisor ? m.amount / m.divisor : m.amount
  return typeof m === 'number' ? m : 0
}

export interface BlankForSync {
  style_code: string
  color: string
  size: string
  qty_on_hand: number
}

/**
 * Push one blank's current qty_on_hand to every Etsy listing that sells it.
 * Best-effort and self-contained: every failure is caught and logged in here
 * so a listing-sync problem can never surface as an order or checkout
 * failure at the call site.
 */
export async function pushBlankQuantityToEtsy(blank: BlankForSync): Promise<void> {
  if (!isEtsyEnabled()) return
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, metadata')
      .eq('category', 'shirts')
    if (error) throw new Error(`product lookup failed: ${error.message}`)

    const matchingIds = (products || [])
      .filter((p: any) => p.metadata?.blank_style && norm(p.metadata.blank_style) === norm(blank.style_code))
      .map((p: any) => p.id)
    if (matchingIds.length === 0) return // no product deterministically maps to this blank — nothing to push

    const { data: listings, error: listingErr } = await supabase
      .from('etsy_listings')
      .select('product_id, listing_id')
      .in('product_id', matchingIds)
      .in('state', ['draft', 'active'])
      .not('listing_id', 'is', null)
    if (listingErr) throw new Error(`etsy_listings lookup failed: ${listingErr.message}`)
    if (!listings?.length) return

    for (const listing of listings as Array<{ product_id: string; listing_id: number }>) {
      try {
        await syncOneListing(listing.listing_id, blank)
      } catch (e: any) {
        console.error(`[etsy-inventory-sync] listing ${listing.listing_id} (product ${listing.product_id}) sync failed:`, e?.message)
      }
    }
  } catch (e: any) {
    console.error(`[etsy-inventory-sync] pushBlankQuantityToEtsy(${blank.style_code}/${blank.color}/${blank.size}) failed:`, e?.message)
  }
}

// GET the listing's current inventory, mutate quantity only on offerings whose
// SIZE (and COLOR, when the listing has a color axis) property_value matches
// this blank, then PUT the whole thing back. Every other field (price,
// is_enabled, other sizes/colors) round-trips unchanged — this never
// re-derives variation structure, it only ever edits what already exists.
async function syncOneListing(listingId: number, blank: BlankForSync): Promise<void> {
  const inventory = await getListingInventory(listingId)
  const products: any[] = inventory?.products
  if (!Array.isArray(products) || products.length === 0) return // no variation inventory on this listing

  let matched = false
  const payloadProducts = products.map((entry: any) => {
    const values: any[] = entry.property_values || []
    const sizeVal = values.find((v) => SIZE_NAME_RE.test(v.property_name || ''))
    const colorVal = values.find((v) => COLOR_NAME_RE.test(v.property_name || ''))
    const sizeMatches = sizeVal ? (sizeVal.values || []).some((v: string) => norm(v) === norm(blank.size)) : false
    // Only enforce a color match when this entry actually carries a color
    // axis — size-only listings (no pack.colors at creation) have none.
    const colorMatches = colorVal ? (colorVal.values || []).some((v: string) => norm(v) === norm(blank.color)) : true
    const isTarget = sizeMatches && colorMatches
    if (isTarget) matched = true

    return {
      ...entry,
      offerings: (entry.offerings || []).map((o: any) => ({
        ...o,
        price: moneyToNumber(o.price), // GET returns a Money object; PUT requires a plain number
        quantity: isTarget ? Math.max(0, Math.trunc(blank.qty_on_hand)) : o.quantity
      }))
    }
  })

  if (!matched) return // this listing doesn't carry this size/color — nothing to change, skip the PUT entirely

  await putListingInventory(listingId, {
    products: payloadProducts,
    price_on_property: inventory.price_on_property || [],
    quantity_on_property: inventory.quantity_on_property || [],
    sku_on_property: inventory.sku_on_property || []
  })
}
