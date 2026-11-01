// Live proof: a held Etsy pet ornament line, re-run with --photo --apply, reaches the print
// bridge's queue although its order is behind the factory's cursor (task 4ef9db82, 2026-11-01).
//
//   cd backend && npx tsx --env-file=<backend .env> scripts/etsy-pet-requeue-proof.ts --photo <pet photo> --out <dir>
//     [--since <cursor>]   the factory's cursor (default: E:/memory/watchtower/projects/print-system/bridge-cursor.json)
//     [--keep]             leave the test order in the database (default: deleted at the end, pass or fail)
//
// Writes ONE test order to ITP's database (order ETSY-9000000202, no customer, nothing charged)
// and deletes it at the end. Its paid_at is backdated to 2026-09-01, behind the factory's
// cursor from birth, so the live factory (which polls production's /queue after that cursor)
// never sees it; this script serves the bridge router from THIS tree on a local port.
//
//   1. hold at ingest   worker/etsy-receipt-ingest.ts ingestReceipt, a receipt with no photo
//   2. queue (before)   GET /queue?since=<cursor> does not have it
//   3. re-run           scripts/etsy-pet-order.ts --photo (no --apply): the row is unchanged
//   4. re-run --apply   scripts/etsy-pet-order.ts --photo --apply: petLineMeta + print_file_path + stamp
//   5. queue (after)    GET /queue?since=<cursor> sends it with petOrnamentParts; the links download
//   6. printing         POST /status printing clears the stamp; the next pull no longer sends it
// Cost: one vision call per re-run (pet type off the photo); the drawing is cached by photo.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { supabase } from '../lib/supabase.js'
import { ingestReceipt } from '../worker/etsy-receipt-ingest.js'
import type { EtsyReceipt } from '../services/etsy.js'

const argv = process.argv.slice(2)
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined }
const photo = arg('photo')
const out = arg('out')
if (!photo || !out) {
  console.error('usage: etsy-pet-requeue-proof.ts --photo <pet photo> --out <dir> [--since <cursor>] [--keep]')
  process.exit(2)
}
const CURSOR_FILE = 'E:/memory/watchtower/projects/print-system/bridge-cursor.json'
const since = arg('since') ?? (existsSync(CURSOR_FILE) ? JSON.parse(readFileSync(CURSOR_FILE, 'utf8')).cursor : '2026-09-12T14:07:56.865516+00:00')
const keep = argv.includes('--keep')

const RECEIPT = 9000000202
const TXN = 9000000203
const LISTING = 4607572810 // the pet ornament listing (etsy_listings -> dff53dc2)
const BACKDATED_PAID_AT = '2026-09-01T00:00:00.000Z'
mkdirSync(out, { recursive: true })

const proof: Record<string, unknown> = { task: '4ef9db82', startedAt: new Date().toISOString(), since, receipt: RECEIPT, transaction: TXN }
const step = (name: string, data: unknown) => { proof[name] = data; console.log(`\n== ${name}\n${JSON.stringify(data, null, 1)}`) }
function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`FAILED: ${what}`)
  console.log(`  ok - ${what}`)
}

// Etsy's own receipt shape: a pet name, and NO photo, so the line is held at ingest.
const money = (amount: number) => ({ amount, divisor: 100, currency_code: 'USD' })
const receipt = {
  _note: 'TEST receipt for task 4ef9db82 (no photo answer: held at ingest). Not a real Etsy sale.',
  receipt_id: RECEIPT, name: 'Requeue Proof', first_line: '640 Goodyear Ave', second_line: null, city: 'Cedartown', state: 'GA', zip: '30125',
  country_iso: 'US', was_paid: true, message_from_buyer: null,
  subtotal: money(1999), total_price: money(2499), total_shipping_cost: money(500), total_tax_cost: money(0), discount_amt: money(0),
  created_timestamp: Math.floor(Date.now() / 1000), updated_timestamp: Math.floor(Date.now() / 1000),
  transactions: [{
    transaction_id: TXN, listing_id: LISTING, title: 'Create Your Own Pet Ornament', quantity: 1, price: money(1999),
    variations: [{ property_id: 54, value_id: null, formatted_name: 'Your pet&#39;s name', formatted_value: 'Sunny' }],
  }],
} as unknown as EtsyReceipt
const receiptFile = path.join(out, 'test-receipt.json')
writeFileSync(receiptFile, JSON.stringify(receipt, null, 1))

async function testOrder(): Promise<{ id: string; paid_at: string; metadata: any } | null> {
  const { data, error } = await supabase.from('orders').select('id, paid_at, metadata').eq('etsy_receipt_id', RECEIPT).maybeSingle()
  if (error) throw new Error(`orders read failed: ${error.message}`)
  return data
}
async function itemRow(orderId: string): Promise<{ id: string; product_id: string; metadata: any }> {
  const { data, error } = await supabase.from('order_items').select('id, product_id, metadata').eq('order_id', orderId)
  if (error) throw new Error(`order_items read failed: ${error.message}`)
  const rows = (data || []).filter((r: any) => Number(r.metadata?.etsy_transaction_id) === TXN)
  if (rows.length !== 1) throw new Error(`expected 1 order_items row for txn ${TXN}, found ${rows.length}`)
  return rows[0]
}
async function deleteTestOrder(): Promise<void> {
  const o = await testOrder()
  if (!o) return
  await supabase.from('blank_inventory_movements').delete().eq('order_id', o.id)
  const { error: e1 } = await supabase.from('order_items').delete().eq('order_id', o.id)
  const { error: e2 } = await supabase.from('orders').delete().eq('id', o.id)
  if (e1 || e2) throw new Error(`cleanup failed: ${e1?.message ?? ''} ${e2?.message ?? ''}`)
}
function runCommand(label: string, extra: string[]) {
  const args = ['--import', 'tsx', 'scripts/etsy-pet-order.ts', '--receipt-file', receiptFile, '--out', path.join(out!, label), '--photo', photo!, ...extra]
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env, cwd: process.cwd(), timeout: 600_000 })
  writeFileSync(path.join(out!, `${label}.log`), `$ etsy-pet-order.ts ${args.slice(3).join(' ')}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}\n--- exit ${r.status}\n`)
  return { exit: r.status, tail: (r.stdout || '').trim().split('\n').slice(-1)[0], stderr: (r.stderr || '').trim().split('\n').slice(-3).join(' | ') }
}

// The bridge router from this tree, on a local port, with a one-off token.
process.env.PRINT_BRIDGE_TOKEN = `proof-${randomBytes(12).toString('hex')}`
const { default: bridge } = await import('../routes/print-bridge.js')
const app = express()
app.use(express.json())
app.use('/api/print-bridge', bridge)
const server = await new Promise<any>((resolve) => { const s = app.listen(0, () => resolve(s)) })
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/print-bridge`
const auth = { Authorization: `Bearer ${process.env.PRINT_BRIDGE_TOKEN}` }
async function queue(): Promise<{ orders: any[]; cursor: string }> {
  const res = await fetch(`${base}/queue?since=${encodeURIComponent(since)}&limit=50`, { headers: auth })
  if (!res.ok) throw new Error(`/queue ${res.status}: ${await res.text()}`)
  return res.json() as any
}

let failed: unknown = null
try {
  await deleteTestOrder() // a previous run that died before its cleanup

  // 1. Held at ingest: the real receipt poller code, paid_at behind the cursor from birth.
  const backdated = {
    from: (table: string) => {
      const q: any = supabase.from(table)
      if (table !== 'orders') return q
      return new Proxy(q, {
        get(target, prop) {
          if (prop === 'insert') return (row: any) => target.insert({ ...row, paid_at: BACKDATED_PAID_AT })
          const v = Reflect.get(target, prop)
          return typeof v === 'function' ? v.bind(target) : v
        },
      })
    },
  }
  const ingest = await ingestReceipt(receipt, backdated, async () => ({ flag: 'none', needsReview: false, source: 'keyword', mode: 'shadow' }) as any)
  const order = await testOrder()
  check(ingest.created && !!order, `ingestReceipt created order ETSY-${RECEIPT}`)
  const held = await itemRow(order!.id)
  step('1-held-at-ingest', { orderId: order!.id, paid_at: order!.paid_at, orderItemId: held.id, metadata: held.metadata })
  check(held.metadata.print_file_status === 'failed' && held.metadata.print_file_path === null, 'the line is HELD (print_file_path null)')
  check(/photo is missing/.test(held.metadata.print_file_error ?? ''), `held for the missing photo: "${held.metadata.print_file_error}"`)
  check(Date.parse(order!.paid_at) < Date.parse(since), `paid_at ${order!.paid_at} is behind the cursor ${since}`)

  // 2. The queue does not have it: its paid_at is behind the cursor.
  const before = await queue()
  step('2-queue-before', { cursor: before.cursor, lines: before.orders.length, testOrderLines: before.orders.filter((o) => o.itpOrderId === order!.id) })
  check(!before.orders.some((o) => o.itpOrderId === order!.id), 'GET /queue?since=<cursor> does not send the held order')

  // 3. Re-run WITHOUT --apply: files only, the order is not touched.
  const noApply = runCommand('rerun-no-apply', [])
  const afterNoApply = await itemRow(order!.id)
  step('3-rerun-without-apply', { ...noApply, rowUnchanged: isDeepStrictEqual(afterNoApply.metadata, held.metadata) })
  check(noApply.exit === 0, 'the re-run built the line (exit 0)')
  check(isDeepStrictEqual(afterNoApply.metadata, held.metadata), 'order_items row byte-for-byte unchanged without --apply')

  // 4. Re-run WITH --apply: the row gets the line and the re-queue stamp.
  const applied = runCommand('rerun-apply', ['--apply'])
  const fixed = await itemRow(order!.id)
  step('4-rerun-with-apply', { ...applied, metadata: fixed.metadata })
  check(applied.exit === 0, 'the --apply re-run built and wrote the line (exit 0)')
  check(typeof fixed.metadata.print_file_path === 'string' && fixed.metadata.print_file_path.endsWith('/print-spec.json'), `print_file_path = ${fixed.metadata.print_file_path}`)
  check(fixed.metadata.print_file_status === 'ready' && fixed.metadata.print_file_error === null, 'print_file_status ready, no error')
  check(!!fixed.metadata.personalization?.portrait && fixed.metadata.personalization?.name === 'Sunny', `personalization ${JSON.stringify(fixed.metadata.personalization)}`)
  check(!!fixed.metadata.etsy_pet && fixed.metadata.etsy_pet.photoUrl === 'operator', 'etsy_pet records the team photo')
  check(typeof fixed.metadata.print_requeued_at === 'string', `re-queue stamp print_requeued_at = ${fixed.metadata.print_requeued_at}`)
  check(fixed.metadata.etsy_transaction_id === TXN && fixed.metadata.etsy_listing_id === LISTING, 'the row keeps its Etsy ids')

  // 5. The queue sends it now, with its parts, and the cursor does not move.
  const after = await queue()
  const line = after.orders.find((o) => o.itpOrderId === order!.id)
  writeFileSync(path.join(out, 'queue-after.json'), JSON.stringify(after, null, 1))
  const downloads = []
  for (const p of line?.petOrnamentParts ?? []) {
    const res = await fetch(p.stlUrl)
    downloads.push({ key: p.key, slot: p.slot, filament: p.filament, status: res.status, bytes: (await res.arrayBuffer()).byteLength })
  }
  step('5-queue-after', { cursor: after.cursor, line: line && { ...line, petOrnamentParts: (line.petOrnamentParts ?? []).map((p: any) => ({ ...p, stlUrl: p.stlUrl.split('?')[0] + '?<signed>' })) }, downloads })
  check(!!line, 'GET /queue?since=<cursor> sends the fixed line')
  check(after.cursor === before.cursor, `the cursor did not move (${after.cursor})`)
  check(Array.isArray(line.petOrnamentParts) && line.petOrnamentParts.length >= 3, `petOrnamentParts: ${line.petOrnamentParts?.length} parts`)
  check(!line.printFileError, 'no printFileError on the line')
  const folder = fixed.metadata.print_file_path.split('/').slice(-2, -1)[0]
  check(line.lineItemId === `${fixed.product_id}:${folder}`, `lineItemId ${line.lineItemId} (not the held line's ${fixed.product_id}: the factory takes it as a new print)`)
  check(line.requeuedAt === fixed.metadata.print_requeued_at, 'line carries requeuedAt')
  check(downloads.length > 0 && downloads.every((d) => d.status === 200 && d.bytes > 84), 'every part link downloads an STL')

  // 6. Printing: the stamp clears and the line stops coming back.
  const st = await fetch(`${base}/status`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ itpOrderId: order!.id, status: 'printing', railStatus: 'printing' }) })
  const cleared = await itemRow(order!.id)
  const final = await queue()
  step('6-printing-clears', { statusCode: st.status, print_requeued_at: cleared.metadata.print_requeued_at ?? null, print_requeue_cleared: cleared.metadata.print_requeue_cleared, sentAfter: final.orders.some((o) => o.itpOrderId === order!.id) })
  check(st.status === 200, 'POST /status printing 200')
  check(cleared.metadata.print_requeued_at === undefined && cleared.metadata.print_requeue_cleared?.status === 'printing', 'stamp moved to print_requeue_cleared')
  check(!final.orders.some((o) => o.itpOrderId === order!.id), 'the next pull no longer sends it')
  check(cleared.metadata.print_file_path === fixed.metadata.print_file_path, 'the print file stays on the row')
  proof.result = 'PASS'
} catch (err) {
  failed = err
  proof.result = `FAIL: ${err instanceof Error ? err.message : String(err)}`
} finally {
  server.close()
  if (!keep) {
    try {
      await deleteTestOrder()
      proof.cleanup = (await testOrder()) ? 'FAILED: test order still present' : `test order ETSY-${RECEIPT} deleted`
    } catch (e) {
      proof.cleanup = `FAILED: ${e instanceof Error ? e.message : String(e)}`
    }
  } else proof.cleanup = 'kept (--keep)'
  proof.finishedAt = new Date().toISOString()
  writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 1))
  console.log(`\n${proof.result} - cleanup: ${proof.cleanup} - ${path.join(out, 'proof.json')}`)
}
process.exit(failed ? 1 : 0)
