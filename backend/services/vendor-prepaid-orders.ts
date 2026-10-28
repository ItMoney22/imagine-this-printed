/**
 * Orders a vendor site already took payment for, landing in ITP's order queue
 * (POST /api/storefront/orders, task d2e4d280: ZenTress Head Spa's merch).
 *
 * The site charged the buyer on its own Stripe platform (a destination charge
 * to the spa's connected account, ITP's share as the application fee), so the
 * order arrives paid. ITP re-prices every line itself (shared/vendor-order-pricing.ts)
 * and refuses an order whose claimed share is not its own number to the cent.
 *
 *   shirt / mug  the art comes as base64 PNG and goes to the PRIVATE print-file
 *                bucket, so the press always has it (order line print_file_refs,
 *                signed per read like a Merch Studio product's).
 *   qr-stand     link + caption checked with the stand's own rules; the logo is
 *                re-encoded into qr-stand-logos/ exactly like the order page's
 *                upload, and the paid-order hook queues the Earth builder.
 *
 * Opt-in per vendor (STOREFRONT_PREPAID_VENDORS), idempotent on the site's own
 * order id, and a Stripe TEST-mode payment is refused unless
 * STOREFRONT_ACCEPT_TEST_ORDERS=1, so a site still on test keys can never put a
 * free order on the press.
 *
 * When the site refunds its buyer it cancels here too
 * (POST /api/storefront/orders/:externalRef/cancel, task 14ce738b), so a
 * refunded order can never be printed or shipped for free. Once the order has
 * shipped the cancel is refused (409) and the order is left exactly as it was.
 */
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { nanoid } from 'nanoid'
import { supabase } from '../lib/supabase.js'
import { uploadImageFromBuffer } from './google-cloud-storage.js'
import { PRINT_FILES_BUCKET, storePrintFile, type PrintFileRefs } from './print-files.js'
import { onQrStandOrderPaid } from './qr-stand-builds.js'
import { checkOrderTransition } from '../lib/order-status.js'
import {
  QR_LOGO_PREFIX,
  QR_STAND,
  cleanQrCaption,
  normalizeQrLink,
  qrCaptionProblem,
  qrLinkProblem,
} from '../shared/qr-stand.js'
import {
  VendorPricingError,
  priceVendorOrder,
  type VendorLine,
  type VendorLineKind,
  type VendorOrderType,
} from '../shared/vendor-order-pricing.js'

type Logger = { info?: Function; warn?: Function; error?: Function } | undefined

/** A print file is a few MB at 300 DPI; a logo far less. */
const MAX_PNG_BYTES = 25 * 1024 * 1024
const KINDS: VendorLineKind[] = ['shirt', 'mug', 'qr-stand']
const SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL']
const DEFAULT_NAMES: Record<VendorLineKind, string> = { shirt: 'T-Shirt', mug: 'Mug', 'qr-stand': QR_STAND.name }

export class PrepaidOrderError extends Error {
  constructor(public status: number, message: string, public detail?: Record<string, unknown>) {
    super(message)
  }
}

export function prepaidVendors(): Set<string> {
  return new Set(
    (process.env.STOREFRONT_PREPAID_VENDORS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
}

function decodePng(raw: unknown, what: string): Buffer {
  if (typeof raw !== 'string' || !raw) throw new PrepaidOrderError(400, `${what} is required (base64 PNG)`)
  const b64 = raw.replace(/^data:image\/png;base64,/, '')
  const buf = Buffer.from(b64, 'base64')
  if (!buf.length || buf.length > MAX_PNG_BYTES) throw new PrepaidOrderError(400, `${what} is empty or too large`)
  // PNG signature: the press file must be a PNG with its transparency intact.
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new PrepaidOrderError(400, `${what} must be a PNG`)
  return buf
}

interface ParsedLine extends VendorLine {
  name: string
  color: string | null
  /** Where the art goes, as the shop says it ("left chest", "full front"). */
  printLocation: string | null
  frontPng: Buffer | null
  backPng: Buffer | null
  qr: { link: string; caption: string; logoPng: Buffer | null } | null
}

export interface PrepaidOrderInput {
  vendor: string
  body: any
}

function parseLines(raw: unknown, type: VendorOrderType): ParsedLine[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
    throw new PrepaidOrderError(400, 'lines must be 1 to 50 items')
  }
  return raw.map((l: any, i: number) => {
    const kind = l?.kind as VendorLineKind
    if (!KINDS.includes(kind)) throw new PrepaidOrderError(400, `line ${i}: kind must be shirt, mug or qr-stand`)
    const quantity = Number(l.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new PrepaidOrderError(400, `line ${i}: quantity must be 1 to 99`)
    }
    if (kind === 'qr-stand' && type === 'store') {
      throw new PrepaidOrderError(400, `line ${i}: the QR stand is ordered by the business, not sold in its store`)
    }
    const size = kind === 'shirt' ? String(l.size ?? '').toUpperCase() : null
    if (kind === 'shirt' && !SHIRT_SIZES.includes(size!)) {
      throw new PrepaidOrderError(400, `line ${i}: size must be one of ${SHIRT_SIZES.join(', ')}`)
    }
    const backPrint = kind === 'shirt' && l.backPrint === true
    const name = (typeof l.name === 'string' && l.name.trim() ? l.name.trim() : DEFAULT_NAMES[kind]).slice(0, 120)
    const color = typeof l.color === 'string' && l.color.trim() ? l.color.trim().slice(0, 40) : null
    const printLocation = kind !== 'qr-stand' && typeof l.printLocation === 'string' && l.printLocation.trim()
      ? l.printLocation.trim().slice(0, 40)
      : null
    let qr: ParsedLine['qr'] = null
    if (kind === 'qr-stand') {
      const link = normalizeQrLink(l.qr?.link)
      const caption = cleanQrCaption(l.qr?.caption)
      const problem = qrLinkProblem(link) ?? qrCaptionProblem(caption)
      if (problem) throw new PrepaidOrderError(400, `line ${i}: ${problem}`)
      qr = { link, caption, logoPng: l.qr?.logoPng ? decodePng(l.qr.logoPng, `line ${i} logo`) : null }
    }
    return {
      kind,
      quantity,
      size,
      backPrint,
      retailCents: l.retailCents == null ? null : Number(l.retailCents),
      name,
      color,
      printLocation,
      frontPng: kind === 'qr-stand' ? null : decodePng(l.frontPng, `line ${i} front print`),
      backPng: backPrint ? decodePng(l.backPng, `line ${i} back print`) : null,
      qr,
    }
  })
}

function parsePayment(raw: any) {
  const pi = typeof raw?.paymentIntentId === 'string' ? raw.paymentIntentId : ''
  if (!/^pi_[A-Za-z0-9]+$/.test(pi)) throw new PrepaidOrderError(400, 'payment.paymentIntentId is required')
  const amountCents = Number(raw?.amountCents)
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new PrepaidOrderError(400, 'payment.amountCents is required')
  if (typeof raw?.livemode !== 'boolean') throw new PrepaidOrderError(400, 'payment.livemode is required')
  return {
    provider: 'stripe',
    payment_intent_id: pi,
    charge_id: typeof raw?.chargeId === 'string' ? raw.chargeId.slice(0, 64) : null,
    account: typeof raw?.account === 'string' ? raw.account.slice(0, 64) : null,
    livemode: raw.livemode as boolean,
    amount_cents: amountCents,
  }
}

async function findExisting(vendor: string, externalRef: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, total, metadata')
    .eq('source', vendor)
    .eq('metadata->>external_ref', externalRef)
    .limit(1)
  if (error) throw new Error(`prepaid lookup: ${error.message}`)
  return data?.[0] ?? null
}

/** Store a line's art (and a stand's logo), returning the order-line metadata for it. */
async function storeLineFiles(vendor: string, batchId: string, index: number, line: ParsedLine) {
  if (line.kind === 'qr-stand') {
    let logoPath: string | null = null
    if (line.qr!.logoPng) {
      // Same treatment as the order page's logo upload (routes/qr-stand.ts).
      const png = await sharp(line.qr!.logoPng, { limitInputPixels: 40_000_000 })
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
      logoPath = `${QR_LOGO_PREFIX}${randomUUID()}.png`
      await uploadImageFromBuffer(png, logoPath, 'image/png')
    }
    return {
      qr_stand: { line_index: index, link: line.qr!.link, caption: line.qr!.caption, logo_path: logoPath, reseller: null },
    }
  }
  const base = `print-files/vendor-orders/${vendor}/${batchId}/line-${index}`
  const refs: PrintFileRefs = {
    bucket: PRINT_FILES_BUCKET,
    front: await storePrintFile(line.frontPng!, `${base}-front.png`),
    back: line.backPng ? await storePrintFile(line.backPng, `${base}-back.png`) : null,
  }
  return { print_file_refs: refs }
}

export async function createPrepaidVendorOrder(input: PrepaidOrderInput, log?: Logger) {
  const vendor = input.vendor.toLowerCase()
  if (!prepaidVendors().has(vendor)) {
    throw new PrepaidOrderError(403, 'This storefront key may not send prepaid orders')
  }
  const b = input.body || {}
  const externalRef = typeof b.externalRef === 'string' ? b.externalRef.trim() : ''
  if (!externalRef || externalRef.length > 100) throw new PrepaidOrderError(400, 'externalRef is required')
  const type: VendorOrderType = b.orderType === 'spa' ? 'spa' : b.orderType === 'store' ? 'store' : (null as any)
  if (!type) throw new PrepaidOrderError(400, "orderType must be 'store' or 'spa'")
  const payment = parsePayment(b.payment)
  if (!payment.livemode && process.env.STOREFRONT_ACCEPT_TEST_ORDERS !== '1') {
    throw new PrepaidOrderError(422, 'A Stripe test-mode payment cannot place a real order')
  }

  const existing = await findExisting(vendor, externalRef)
  if (existing) {
    return { duplicate: true, orderId: existing.id, orderNumber: existing.order_number, itpShareCents: Math.round(Number(existing.total) * 100) }
  }

  const lines = parseLines(b.lines, type)
  const shippingCents = Number(b.shippingCents) || 0
  let pricing
  try {
    pricing = priceVendorOrder(lines, type, shippingCents)
  } catch (err) {
    if (err instanceof VendorPricingError) throw new PrepaidOrderError(400, err.message)
    throw err
  }
  const claimed = Number(b.itpShareCents)
  if (claimed !== pricing.itpShareCents) {
    throw new PrepaidOrderError(409, 'ITP share does not match ITP pricing', {
      itpShareCents: pricing.itpShareCents,
      claimedCents: Number.isFinite(claimed) ? claimed : null,
    })
  }
  if (payment.amount_cents < pricing.itpShareCents) {
    throw new PrepaidOrderError(409, 'The payment is smaller than ITP share')
  }

  const customer = b.customer || {}
  const email = typeof customer.email === 'string' ? customer.email.trim().toLowerCase().slice(0, 200) : null
  const customerName = typeof customer.name === 'string' ? customer.name.trim().slice(0, 120) : null
  const shipping = customer.shipping && typeof customer.shipping === 'object' ? customer.shipping : null
  if (!shipping || !(shipping.address || shipping.street1 || shipping.line1) || !(shipping.zip || shipping.zipCode || shipping.postal_code)) {
    throw new PrepaidOrderError(400, 'customer.shipping needs a street address and ZIP')
  }

  const batchId = nanoid(10)
  const fileMeta: Array<Record<string, unknown>> = []
  for (let i = 0; i < lines.length; i++) fileMeta.push(await storeLineFiles(vendor, batchId, i, lines[i]))

  const orderNumber = `ITP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
  const testNote = payment.livemode ? null : 'TEST ORDER (Stripe test mode). Do not print or ship.'
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      order_number: orderNumber,
      user_id: null,
      customer_email: email,
      customer_name: customerName,
      // ITP's own money on this order: its price for the lines, its fee, the shipping.
      subtotal: (pricing.itemsCents + pricing.feeCents) / 100,
      tax_amount: 0,
      shipping_amount: pricing.shippingCents / 100,
      discount_amount: 0,
      total: pricing.itpShareCents / 100,
      currency: 'USD',
      status: 'processing',
      payment_status: 'paid',
      fulfillment_status: 'unfulfilled',
      payment_method: 'vendor_prepaid',
      shipping_address: shipping,
      discount_codes: [],
      source: vendor,
      notes: testNote,
      metadata: {
        storefront: vendor,
        external_ref: externalRef,
        order_type: type,
        test_mode: !payment.livemode,
        external_payment: payment,
        itp_share: {
          items_cents: pricing.itemsCents,
          fee_cents: pricing.feeCents,
          shipping_cents: pricing.shippingCents,
          total_cents: pricing.itpShareCents,
        },
      },
    })
    .select('id, order_number')
    .single()
  if (orderError || !order) throw new Error(`prepaid order insert: ${orderError?.message ?? 'no row'}`)

  const { error: itemsError } = await supabase.from('order_items').insert(
    lines.map((line, i) => ({
      order_id: order.id,
      product_id: null,
      product_name: line.name,
      quantity: line.quantity,
      unit_price: pricing.lines[i].unitCents / 100,
      subtotal: pricing.lines[i].lineCents / 100,
      metadata: {
        vendor_line_kind: line.kind,
        size: line.size ?? null,
        color: line.color,
        print_location: line.printLocation,
        back_print: line.backPrint ?? false,
        retail_unit_cents: type === 'store' ? line.retailCents : null,
        itp_fee_cents: pricing.lines[i].feeCents,
        ...fileMeta[i],
      },
    }))
  )
  if (itemsError) {
    // An order with no lines can't be printed: take it back out so a retry starts clean.
    await supabase.from('orders').delete().eq('id', order.id)
    throw new Error(`prepaid order items: ${itemsError.message}`)
  }

  await onQrStandOrderPaid({ id: order.id, order_number: order.order_number }, log)
  log?.info?.({ orderId: order.id, vendor, externalRef, itpShareCents: pricing.itpShareCents, test: !payment.livemode }, 'prepaid vendor order received')
  return { duplicate: false, orderId: order.id, orderNumber: order.order_number, itpShareCents: pricing.itpShareCents }
}

/** Past this point the box has left the building: a cancel can no longer stop it. */
const SHIPPED_STATUSES = new Set(['shipped', 'delivered', 'completed'])
const SHIPPED_FULFILLMENT = new Set(['fulfilled', 'partially_fulfilled', 'shipped', 'delivered'])

export interface CancelPrepaidOrderInput {
  vendor: string
  externalRef: string
  body: any
}

/**
 * The vendor site refunded (or called off) an order it sent here: cancel it so
 * it never reaches the press or the post. Idempotent; refuses (409) once the
 * order has shipped and leaves it untouched.
 */
export async function cancelPrepaidVendorOrder(input: CancelPrepaidOrderInput, log?: Logger) {
  const vendor = input.vendor.toLowerCase()
  if (!prepaidVendors().has(vendor)) {
    throw new PrepaidOrderError(403, 'This storefront key may not cancel prepaid orders')
  }
  const externalRef = typeof input.externalRef === 'string' ? input.externalRef.trim() : ''
  if (!externalRef || externalRef.length > 100) throw new PrepaidOrderError(400, 'externalRef is required')
  const b = input.body || {}
  const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 40) : 'cancelled'
  const refund = b.refund && typeof b.refund === 'object'
    ? {
        charge_id: typeof b.refund.chargeId === 'string' ? b.refund.chargeId.slice(0, 64) : null,
        amount_refunded_cents: Number.isInteger(b.refund.amountRefundedCents) ? b.refund.amountRefundedCents : null,
      }
    : null

  // Two tries: if the order moves under us (staff marking it shipped), decide again on what it is now.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_status, fulfillment_status, metadata')
      .eq('source', vendor)
      .eq('metadata->>external_ref', externalRef)
      .limit(1)
    if (error) throw new Error(`prepaid lookup: ${error.message}`)
    const order = data?.[0]
    // notFound tells the site this is a real answer, not a route that isn't deployed yet.
    if (!order) throw new PrepaidOrderError(404, 'No order with that reference', { notFound: true })

    const done = { orderId: order.id, orderNumber: order.order_number, status: 'cancelled' }
    if (order.status === 'cancelled') return { ...done, alreadyCancelled: true }
    if (SHIPPED_STATUSES.has(order.status) || SHIPPED_FULFILLMENT.has(order.fulfillment_status)) {
      throw new PrepaidOrderError(409, `Order ${order.order_number} has already shipped and can no longer be cancelled`, {
        orderNumber: order.order_number,
        status: order.status,
        shipped: true,
      })
    }
    const move = checkOrderTransition(order.status, 'cancelled')
    if (!move.ok) {
      throw new PrepaidOrderError(409, `Order ${order.order_number} cannot be cancelled: ${move.reason}`, {
        orderNumber: order.order_number,
        status: order.status,
      })
    }

    const now = new Date().toISOString()
    let claim = supabase
      .from('orders')
      .update({
        status: 'cancelled',
        // The buyer's money went back to them: nothing on this order is paid any more.
        ...(reason === 'refunded' ? { payment_status: 'refunded' } : {}),
        metadata: { ...(order.metadata || {}), cancellation: { by: vendor, reason, at: now, refund } },
        updated_at: now,
      })
      .eq('id', order.id)
    claim = order.status == null ? claim.is('status', null) : claim.eq('status', order.status)
    const { data: claimed, error: claimError } = await claim.select('id')
    if (claimError) throw new Error(`prepaid cancel: ${claimError.message}`)
    if (!claimed?.length) continue

    await stopStandBuilds(order.id, log)
    log?.info?.({ orderId: order.id, vendor, externalRef, from: order.status, reason }, 'prepaid vendor order cancelled')
    return { ...done, alreadyCancelled: false }
  }
  throw new PrepaidOrderError(409, 'The order changed while it was being cancelled; try again')
}

/** A cancelled order's QR stands: a build not started never starts, and a print not yet sent never goes. */
async function stopStandBuilds(orderId: string, log?: Logger) {
  const now = new Date().toISOString()
  const queued = await supabase
    .from('qr_stand_builds')
    .update({ status: 'failed', error: 'Order cancelled', updated_at: now })
    .eq('order_id', orderId)
    .eq('status', 'queued')
  const printing = await supabase
    .from('qr_stand_builds')
    .update({ print_status: 'failed', print_error: 'Order cancelled: do not print', updated_at: now })
    .eq('order_id', orderId)
    .eq('print_status', 'requested')
  const err = queued.error || printing.error
  if (err) log?.error?.({ err, orderId }, '[qr-stand] could not stop the stand builds of a cancelled order')
}
