// Etsy pet ornament order -> print files (task 5d007181, 2026-11-01).
//
//   cd backend && npx tsx --env-file=<backend .env> scripts/etsy-pet-order.ts --receipt <id> --out <dir>
//     [--transaction <id>]       just that transaction (default: every pet-ornament line on the receipt)
//     [--receipt-file <json>]    a receipt in Etsy's own shape instead of --receipt (a test order; no Etsy call)
//     [--product <uuid>]         the ornament product, when the listing is not in the etsy_listings ledger
//   Team re-runs after messaging the buyer (the receipt poller wrote a held line):
//     [--photo <file>]           draw this photo instead of the one on the order
//     [--pet cat|dog|bunny]      the pet type, instead of reading it off the photo
//     [--stock]                  the stock design for the pet, no photo (the buyer agreed)
//     [--apply]                  also fix the live order (task 4ef9db82): write the line onto order
//                                ETSY-<receipt>'s order_items row (matched by metadata.etsy_transaction_id)
//                                and re-queue it, so the print bridge sends it to the factory again
//                                although the order was already pulled. Only a line that BUILT is
//                                written; a line held again leaves the row as it was. Without --apply
//                                the order is never touched (files + local copies only).
//
// It runs the receipt poller's own code (services/pet-ornament/etsy-order.ts ->
// portrait.ts -> store.ts, the checkout pipeline unchanged) and writes, per
// pet-ornament transaction, <out>/<transaction id>/:
//   <part>.stl          one per colour, read back from storage: the exact bytes the printer is sent
//   print_spec.json     what assets/itp-print-picks/lib/print_check.py slices
//   bridge-line.json    the line the print bridge sends for this order item (petOrnamentParts)
//   order-line.json     order_items.metadata as the poller writes it, with what was read and decided
// Exits 1 when a line is held (or --apply could not write it); the reason is printed.
//
// Etsy: GETs only (the receipt, the photo). The token is read from etsy_connection and NEVER refreshed
// here: production's worker owns the rotating refresh token, so this refuses when <3 minutes are left.
// ITP: reads only, unless --apply (one order_items update per built line).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { supabase } from '../lib/supabase.js'
import { etsyApiKey, getShopReceipt, type EtsyReceipt } from '../services/etsy.js'
import { parsePetOrnament, type PetOrnamentTemplate } from '../shared/pet-ornament.js'
import { applyEtsyPetLine, buildEtsyPetLine, petLineMeta } from '../services/pet-ornament/etsy-order.js'
import { blobStore, printCheckSpec, signedPetParts } from '../services/pet-ornament/store.js'

function args(argv: string[]) {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}"`)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true
    else { out[a.slice(2)] = next; i++ }
  }
  return out
}

const opt = args(process.argv.slice(2))
const str = (k: string) => (typeof opt[k] === 'string' ? (opt[k] as string) : undefined)
const outRoot = str('out')
if (!outRoot || (!str('receipt') && !str('receipt-file'))) {
  console.error('usage: etsy-pet-order.ts (--receipt <id> | --receipt-file <json>) --out <dir> [--transaction <id>] [--product <uuid>] [--photo <file>] [--pet <id>] [--stock] [--apply]')
  process.exit(2)
}
const apply = opt.apply === true

/** The live token, read only. */
async function etsyToken(): Promise<{ token: string; shopId: number; headers: Record<string, string> }> {
  const { data, error } = await supabase.from('etsy_connection').select('access_token, access_token_expires_at, shop_id').eq('id', 1).maybeSingle()
  if (error || !data) throw new Error(`etsy_connection unreadable: ${error?.message ?? 'no row'}`)
  const left = new Date(data.access_token_expires_at).getTime() - Date.now()
  if (left < 3 * 60_000) throw new Error(`the Etsy token has ${Math.round(left / 1000)} s left; production refreshes it hourly, try again in a few minutes (never refreshed from here)`)
  return { token: data.access_token, shopId: data.shop_id, headers: { 'x-api-key': etsyApiKey(), Authorization: `Bearer ${data.access_token}` } }
}

let etsy: Awaited<ReturnType<typeof etsyToken>> | null = null
const etsyHeaders = async () => (etsy ??= await etsyToken()).headers

let receipt: EtsyReceipt
if (str('receipt-file')) {
  receipt = JSON.parse(readFileSync(str('receipt-file')!, 'utf8'))
} else {
  etsy = await etsyToken()
  receipt = await getShopReceipt(Number(str('receipt')), { token: etsy.token, shopId: etsy.shopId })
}
if (!receipt?.transactions?.length) throw new Error(`receipt ${receipt?.receipt_id} has no transactions`)

// Which product each listing sells: the same ledger the poller uses, or --product.
const listingIds = [...new Set(receipt.transactions.map((t) => t.listing_id))]
const { data: ledger, error: ledgerErr } = await supabase.from('etsy_listings').select('listing_id, product_id').in('listing_id', listingIds)
if (ledgerErr) throw new Error(`etsy_listings lookup failed: ${ledgerErr.message}`)
const productByListing = new Map<number, string>((ledger || []).map((r: any) => [Number(r.listing_id), String(r.product_id)]))
const productIds = [...new Set([...productByListing.values(), ...(str('product') ? [str('product')!] : [])])]
const { data: products, error: prodErr } = await supabase.from('products').select('id, name, metadata').in('id', productIds.length ? productIds : ['00000000-0000-0000-0000-000000000000'])
if (prodErr) throw new Error(`products lookup failed: ${prodErr.message}`)
const productById = new Map<string, { id: string; name: string; template: PetOrnamentTemplate | null }>(
  (products || []).map((p: any) => [String(p.id), { id: String(p.id), name: p.name, template: parsePetOrnament(p.metadata) }])
)

const { data: order, error: orderErr } = await supabase.from('orders').select('id, order_number').eq('etsy_receipt_id', receipt.receipt_id).maybeSingle()
if (apply && (orderErr || !order)) {
  // Before any paid drawing: there is nothing to fix without the order.
  console.error(`--apply: no ITP order for Etsy receipt ${receipt.receipt_id} (ETSY-${receipt.receipt_id})${orderErr ? `: ${orderErr.message}` : ''}; the receipt poller makes it. Nothing was built or changed.`)
  process.exit(2)
}
const wantTxn = str('transaction') ? Number(str('transaction')) : null
const photo = str('photo') ? readFileSync(str('photo')!) : undefined
let held = 0
let built = 0
let applied = 0

for (const txn of receipt.transactions) {
  if (wantTxn && txn.transaction_id !== wantTxn) continue
  const product = productById.get(productByListing.get(txn.listing_id) ?? str('product') ?? '')
  if (!product?.template) {
    console.log(`txn ${txn.transaction_id} (listing ${txn.listing_id}): not a pet ornament${productByListing.has(txn.listing_id) ? '' : ' (listing not in etsy_listings; pass --product)'} - skipped`)
    continue
  }
  const t0 = Date.now()
  const line = await buildEtsyPetLine(txn, product.template, {
    etsyHeaders,
    pet: str('pet'),
    photo,
    stock: opt.stock === true,
  })
  const dir = path.join(outRoot, String(txn.transaction_id))
  mkdirSync(dir, { recursive: true })
  const meta = { ...petLineMeta(line), etsy_transaction_id: txn.transaction_id, etsy_listing_id: txn.listing_id }
  writeFileSync(path.join(dir, 'order-line.json'), JSON.stringify(meta, null, 1))
  if (line.status !== 'ready' || !line.path || !line.stored) {
    held++
    console.error(`txn ${txn.transaction_id}: HELD - ${line.error}${apply ? ' (--apply: the order was not changed)' : ''}`)
    continue
  }

  // The exact files in storage, read back: what the print bridge links the printer to.
  const parts = line.stored.spec.parts
  for (const part of parts) writeFileSync(path.join(dir, `${part.key}.stl`), await blobStore.read(part.stl))
  writeFileSync(path.join(dir, 'print_spec.json'), JSON.stringify(printCheckSpec(parts, line.values[product.template.field.key], (k) => `${k}.stl`), null, 1))

  // The order item as the print bridge's /queue sends it (routes/print-bridge.ts, pet branch).
  const bridgeLine = {
    itpOrderId: order?.id ?? null,
    lineItemId: `${product.id}:${line.path.split('/').slice(-2, -1)[0]}`,
    line: 'custom-toy',
    title: txn.title,
    concept: product.name,
    quantity: txn.quantity || 1,
    personalization: line.values,
    petOrnamentParts: await signedPetParts(line.path),
    printFileError: undefined,
    material: 'PLA',
  }
  writeFileSync(path.join(dir, 'bridge-line.json'), JSON.stringify(bridgeLine, null, 1))
  built++

  // --apply, once the parts are proven readable above: the live order gets the
  // line, and the print bridge sends it to the factory again.
  let appliedTo: { orderItemId: string; requeuedAt: string } | null = null
  if (apply) {
    try {
      const done = await applyEtsyPetLine(supabase, order!.id, txn.transaction_id, line)
      appliedTo = { orderItemId: done.orderItemId, requeuedAt: done.requeuedAt }
      applied++
    } catch (err: any) {
      held++
      console.error(`txn ${txn.transaction_id}: built, but --apply failed - ${err?.message ?? err}`)
    }
  }
  console.log(JSON.stringify({
    transaction: txn.transaction_id,
    name: line.values[product.template.field.key],
    pet: line.etsy.pet,
    photo: line.etsy.photo && { ...line.etsy.photo, url: line.etsy.photoUrl },
    portraitId: line.etsy.portraitId,
    printSpec: line.path,
    builtNow: line.stored.built,
    parts: parts.map((p) => `${p.key}.stl slot ${p.slot} ${p.filamentName}`),
    flags: line.flags ?? [],
    applied: appliedTo,
    out: dir,
    ms: Date.now() - t0,
  }, null, 1))
}

console.log(
  `${built} pet ornament line(s) built, ${held} held${order ? ` (order ${order.order_number})` : ''}` +
    (apply ? `; ${applied} written to the order and re-queued to the print bridge` : built && order ? '; order not changed (add --apply to fix it and re-queue the line)' : '')
)
process.exit(held ? 1 : 0)
