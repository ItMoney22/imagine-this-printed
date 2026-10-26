import { Router, Request, Response, NextFunction } from 'express'
import Stripe from 'stripe'
import multer from 'multer'
import sharp from 'sharp'
import { nanoid } from 'nanoid'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { getCachedRole, invalidateCachedRole } from '../lib/role-cache.js'
import { getSignedUrl, uploadImageFromBuffer } from '../services/google-cloud-storage.js'
import { getPrintFileRefsFor } from '../services/print-files.js'
import { plusSizeUpchargeCents } from '../shared/catalog-capability.js'
import { splitOrder, type SplitLine } from '../lib/vendor-store-split.js'
import { askStoreAssistant, type AssistantImage, type AssistantTurn } from '../services/store-assistant.js'
import { generateVoiceResponse } from '../services/voiceGenerator.js'
import { QR_STAND, readQrStandFields, type QrStandFields } from '../shared/qr-stand.js'
import storeInboxRouter, { syncInboxOwner } from './vendor-store-inbox.js'
import { WAREHOUSE_ADDRESS_FROM } from './shipping.js'
import { verifyStoreShippingQuote } from '../services/shipping-quote.js'
import {
  buySellerLabel,
  isShippoLabelUrl,
  labelCents,
  orderShippingAddress,
  packageWeights,
  quoteStoreShipping,
  readUsAddress,
  type SellerLabel,
  type ShipAddress
} from '../services/vendor-store-shipping.js'

// Vendor storefronts (David 2026-10-26): a seller's own branded store on
// <slug>.imaginethisprinted.com, Crystal's Shirts and More first. Buyers check out through
// ITP's Stripe; a destination charge pays the seller's Express account and ITP keeps its
// share as the application fee (lib/vendor-store-split.ts has the rules). The paid order
// rides the existing webhook (payment_intent.succeeded -> applyPaidCheckoutOrder) through
// the { orderId, orderNumber } metadata, like routes/storefront.ts.
//
//   GET  /api/vendor-store/:slug                 public store + live items
//   POST /api/vendor-store/:slug/shipping-rates   real Shippo rates for the cart (services/vendor-store-shipping.ts)
//   POST /api/vendor-store/:slug/checkout         Stripe Checkout URL
//   /api/vendor-store/manage/...                  the seller (owner) and ITP admins
const router = Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia'
})

const MEDIA_BASE = process.env.MEDIA_PUBLIC_BASE || 'https://api.imaginethisprinted.com/api/media'
const SITE_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'
const storeOrigin = (slug: string) =>
  /localhost|127\.0\.0\.1/.test(SITE_URL) ? `${SITE_URL}/store/${slug}` : `https://${slug}.imaginethisprinted.com`
const sourceOf = (slug: string) => `store:${slug}`

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
})

// What she can hand her assistant with a message: a voice note (what a browser's MediaRecorder makes, webm/ogg/mp4,
// or a plain audio file) and a picture of a design for it to look over. A file of the wrong kind is a clear 400,
// never silently dropped: a dropped picture would get an answer about a design it never saw.
const VOICE_TYPES = /^audio\/(webm|ogg|wav|x-wav|mp4|mpeg|aac|flac)/
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const assistantFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'audio' ? VOICE_TYPES.test(file.mimetype) : PICTURE_TYPES.includes(file.mimetype)) cb(null, true)
    else cb(new Error(file.fieldname === 'audio' ? 'That voice note can’t be played' : 'Send a PNG, JPG or WEBP picture'))
  }
}).fields([{ name: 'audio', maxCount: 1 }, { name: 'image', maxCount: 1 }])
function takeAssistantFiles(req: Request, res: Response, next: NextFunction): void {
  assistantFiles(req, res, (err: any) => {
    if (!err) return next()
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That file is over 15 MB' : err.message || 'That file didn’t come through' })
  })
}

/**
 * Her picture, read the way a print shop reads one: its pixel size and whether the background is really clear (an
 * alpha channel with at least one see-through pixel, not just a channel). The model gets a copy at most 1536 px on mid
 * grey, never the raw file: on white, white artwork vanishes (same reason as step-flow's describeUpload), and a 15 MB
 * PNG would not fit in one request.
 */
export async function readDesignPicture(buffer: Buffer): Promise<Omit<AssistantImage, 'data' | 'mimeType'> & { preview: Buffer }> {
  const meta = await sharp(buffer).metadata()
  if (!meta.width || !meta.height) throw new Error('unreadable picture')
  const sideways = (meta.orientation ?? 1) >= 5
  const transparent = !!meta.hasAlpha && ((await sharp(buffer).stats()).channels[3]?.min ?? 255) < 255
  const preview = await sharp(buffer)
    .rotate()
    .flatten({ background: '#808080' })
    .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  return { widthPx: sideways ? meta.height : meta.width, heightPx: sideways ? meta.width : meta.height, transparent, preview }
}

// The assistant is part of her store, not metered in ITC, so it gets a daily ceiling per store instead.
const ASSISTANT_DAILY_TURNS = 200
const assistantUse = new Map<string, { day: string; turns: number }>()
function assistantTurnAllowed(slug: string): boolean {
  const day = new Date().toISOString().slice(0, 10)
  const u = assistantUse.get(slug)
  if (!u || u.day !== day) {
    assistantUse.set(slug, { day, turns: 1 })
    return true
  }
  if (u.turns >= ASSISTANT_DAILY_TURNS) return false
  u.turns++
  return true
}

type StoreRow = {
  id: string
  slug: string
  name: string
  tagline: string | null
  logo_url: string | null
  theme: Record<string, unknown>
  owner_user_id: string | null
  owner_email: string | null
  fee_percent: number
  own_shipping_cents: number
  itp_shipping_cents: number
  stripe_account_id: string | null
  status: 'draft' | 'live' | 'paused'
  instagram: string | null
  /** The store's own mailbox (routes/vendor-store-inbox.ts). */
  inbox_mailbox_id: string | null
  /** Where she ships her own items from. Server-only: never in a public response. */
  ship_from: ShipAddress | null
}

type ItemRow = {
  id: string
  storefront_id: string
  product_id: string | null
  name: string
  description: string | null
  images: string[]
  sizes: string[]
  colors: string[]
  price_cents: number
  itp_cost_cents: number
  suggested_price_cents?: number | null
  active: boolean
  sort: number
  metadata?: Record<string, any> | null
}

/**
 * An ITP item is one ITP makes and ships: a products row, or a priced line type that has no products row
 * (the Custom QR Counter Stand, backend/shared/qr-stand.ts: metadata.line_type 'qr-stand'), or an ITP-made item
 * that is only sold through stores (metadata.made_by 'itp', e.g. the can lids, printed from metadata.print_file).
 */
const isQrStand = (i: ItemRow) => i.metadata?.line_type === QR_STAND.lineIdPrefix
const isItp = (i: ItemRow) => !!i.product_id || isQrStand(i) || i.metadata?.made_by === 'itp'

/** The stand's listing photos: the real plate-and-brace stand, served from public/business/ on ITP and on every
 *  store subdomain (one Vercel project). Stripe gets them made absolute (absoluteImage). */
const QR_STAND_IMAGES = ['/business/qr-stand-shop.webp', '/business/qr-stand-lineup.webp']
const absoluteImage = (src: string | undefined, origin: string) => (src && src.startsWith('/') ? `${origin}${src}` : src)

/** Offer (or re-price) the QR stand on a store. One stand row per store; it has no products row to key on. */
async function offerQrStand(storefrontId: string, itpCostCents: number): Promise<ItemRow | null> {
  const fields = {
    name: QR_STAND.name,
    description:
      'A 3D-printed counter stand with your own QR code: your link, your words under the code (Pay Here, Review Us, ' +
      'Scan For Menu or your own) and your logo in the middle. Printed to order in Rockmart, GA. About 9 x 12 cm.',
    images: QR_STAND_IMAGES,
    sizes: [],
    colors: [],
    itp_cost_cents: itpCostCents,
    metadata: { line_type: QR_STAND.lineIdPrefix },
    updated_at: new Date().toISOString(),
  }
  const { data: existing } = await supabase
    .from('vendor_store_items').select('*').eq('storefront_id', storefrontId).eq('metadata->>line_type', QR_STAND.lineIdPrefix).maybeSingle()
  const q = existing
    ? supabase.from('vendor_store_items').update({ ...fields, price_cents: Math.max(existing.price_cents, itpCostCents) }).eq('id', existing.id)
    : supabase.from('vendor_store_items').insert({ ...fields, storefront_id: storefrontId, product_id: null, price_cents: Math.max(QR_STAND.wasCents, itpCostCents), active: false })
  const { data } = await q.select().single()
  return (data as ItemRow) || null
}

async function loadStore(slug: string): Promise<StoreRow | null> {
  const { data } = await supabase.from('vendor_storefronts').select('*').eq('slug', String(slug).toLowerCase()).maybeSingle()
  return (data as StoreRow) || null
}

const publicItem = (i: ItemRow) => ({
  id: i.id,
  kind: isItp(i) ? 'itp' : 'own',
  lineType: isQrStand(i) ? QR_STAND.lineIdPrefix : null,
  name: i.name,
  description: i.description,
  images: Array.isArray(i.images) ? i.images : [],
  sizes: i.sizes || [],
  colors: i.colors || [],
  priceCents: i.price_cents
})

/** Can the seller's Express account receive transfers right now? Read live, never cached in the DB. */
async function payoutsReady(accountId: string | null): Promise<{ ready: boolean; account: Stripe.Account | null }> {
  if (!accountId) return { ready: false, account: null }
  try {
    const account = await stripe.accounts.retrieve(accountId)
    return { ready: account.capabilities?.transfers === 'active', account }
  } catch {
    return { ready: false, account: null }
  }
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

router.get('/:slug', async (req: Request, res: Response): Promise<any> => {
  const store = await loadStore(req.params.slug)
  if (!store || store.status === 'paused') return res.status(404).json({ error: 'Store not found' })

  const { data: items, error } = await supabase
    .from('vendor_store_items')
    .select('*')
    .eq('storefront_id', store.id)
    .eq('active', true)
    .order('sort', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: 'Failed to load store' })

  return res.json({
    store: {
      slug: store.slug,
      name: store.name,
      tagline: store.tagline,
      logoUrl: store.logo_url,
      theme: store.theme || {},
      instagram: store.instagram,
      // Checkout is open once David has set the store live AND her payouts are set up.
      open: store.status === 'live' && (await payoutsReady(store.stripe_account_id)).ready
    },
    items: ((items || []) as ItemRow[]).map(publicItem)
  })
})

// The cart's shipping: real Shippo rates for both packages (hers from her ship-from address, ITP's from Rockmart),
// with ITP's usual cut, each choice signed for the checkout. Rating is free; nothing is bought here.
router.post('/:slug/shipping-rates', async (req: Request, res: Response): Promise<any> => {
  try {
    const store = await loadStore(req.params.slug)
    if (!store || store.status === 'paused') return res.status(404).json({ error: 'Store not found' })
    const shipTo = readUsAddress(req.body?.shipTo)
    if ('error' in shipTo) return res.status(400).json({ error: shipTo.error })

    const items = req.body?.items
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Your cart is empty' })
    if (items.length > 30) return res.status(400).json({ error: 'Too many items (max 30)' })
    const ids = [...new Set(items.map((i: any) => String(i?.itemId || '')))].filter(Boolean)
    const { data: rows } = await supabase
      .from('vendor_store_items').select('*').eq('storefront_id', store.id).eq('active', true).in('id', ids)
    const byId = new Map(((rows || []) as ItemRow[]).map(r => [r.id, r]))
    const sides: Array<{ kind: 'own' | 'itp'; quantity: number }> = []
    for (const raw of items) {
      const item = byId.get(String(raw?.itemId))
      if (!item) return res.status(400).json({ error: 'An item in the cart is no longer for sale' })
      // Same quantity rule as the checkout, so the package weights match the signed quote.
      sides.push({ kind: isItp(item) ? 'itp' : 'own', quantity: Math.max(1, Math.min(20, parseInt(raw?.quantity, 10) || 1)) })
    }

    const quoted = await quoteStoreShipping({
      slug: store.slug,
      shipFrom: store.ship_from,
      warehouse: WAREHOUSE_ADDRESS_FROM,
      shipTo: shipTo.address,
      weights: packageWeights(sides)
    })
    req.log?.info({ slug: store.slug, zip: shipTo.address.zip, source: quoted.source, options: quoted.options.length }, 'vendor-store shipping quoted')
    return res.json(quoted)
  } catch (error: any) {
    req.log?.error({ err: error }, 'vendor-store shipping quote failed')
    return res.status(500).json({ error: 'Shipping prices didn’t load. Try again.' })
  }
})

router.post('/:slug/checkout', async (req: Request, res: Response): Promise<any> => {
  try {
    const store = await loadStore(req.params.slug)
    if (!store || store.status === 'paused') return res.status(404).json({ error: 'Store not found' })
    if (store.status !== 'live') return res.status(409).json({ error: 'store_not_open' })
    const { ready } = await payoutsReady(store.stripe_account_id)
    if (!ready) return res.status(409).json({ error: 'store_not_open' })

    const { items, email, cancelPath, shipTo: rawShipTo, shippingQuote } = req.body || {}
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items array required' })
    if (items.length > 30) return res.status(400).json({ error: 'Too many items (max 30)' })

    const ids = [...new Set(items.map((i: any) => String(i?.itemId || '')))].filter(Boolean)
    const { data: rows } = await supabase
      .from('vendor_store_items')
      .select('*')
      .eq('storefront_id', store.id)
      .eq('active', true)
      .in('id', ids)
    const byId = new Map(((rows || []) as ItemRow[]).map(r => [r.id, r]))

    // An ITP product must still be sellable on ITP itself.
    const productIds = [...new Set(((rows || []) as ItemRow[]).map(r => r.product_id).filter(Boolean))] as string[]
    const liveProducts = new Set<string>()
    if (productIds.length) {
      const { data: prods } = await supabase.from('products').select('id, status, is_active').in('id', productIds)
      for (const p of prods || []) if ((p as any).status === 'active' && (p as any).is_active !== false) liveProducts.add((p as any).id)
    }
    const printRefs = productIds.length ? await getPrintFileRefsFor(productIds) : {}

    const lines: Array<SplitLine & { item: ItemRow; size?: string; color?: string; stand?: QrStandFields }> = []
    for (const raw of items) {
      const item = byId.get(String(raw?.itemId))
      if (!item) return res.status(400).json({ error: 'An item in the cart is no longer for sale' })
      if (item.product_id && !liveProducts.has(item.product_id)) {
        return res.status(400).json({ error: `${item.name} is no longer for sale` })
      }
      const quantity = Math.max(1, Math.min(20, parseInt(raw?.quantity, 10) || 1))
      const size = typeof raw?.size === 'string' && item.sizes?.includes(raw.size) ? raw.size : undefined
      const color = typeof raw?.color === 'string' && item.colors?.includes(raw.color) ? raw.color : undefined
      if (item.sizes?.length && !size) return res.status(400).json({ error: `Pick a size for ${item.name}` })
      // A QR stand carries the buyer's link, words and logo, checked by the same rules as ITP's own stand page.
      let stand: QrStandFields | undefined
      if (isQrStand(item)) {
        const { fields, problem } = readQrStandFields(raw?.personalization)
        if (problem) return res.status(400).json({ error: `${item.name}: ${problem}` })
        stand = fields
      }
      // A bigger ITP shirt costs ITP more, so the upcharge rides both the price and ITP's cost.
      const up = item.product_id ? plusSizeUpchargeCents(size) : 0
      lines.push({
        kind: isItp(item) ? 'itp' : 'own',
        unitCents: item.price_cents + up,
        itpCostCents: isItp(item) ? item.itp_cost_cents + up : 0,
        quantity,
        item,
        size,
        color,
        stand
      })
    }

    // Shipping is what the cart showed: the signed Shippo quote for this address and these packages, never a flat rate.
    const shipTo = readUsAddress(rawShipTo)
    if ('error' in shipTo) return res.status(400).json({ error: shipTo.error, code: 'ship_to' })
    const weights = packageWeights(lines)
    const quote = verifyStoreShippingQuote({
      token: shippingQuote,
      slug: store.slug,
      destinationZip: shipTo.address.zip,
      ownWeightLb: weights.own,
      itpWeightLb: weights.itp
    })
    if (!quote.ok) return res.status(400).json({ error: quote.error, code: 'shipping_quote' })
    const { own: ownShip, itp: itpShip } = quote.claims

    const split = splitOrder(lines, {
      feePercent: Number(store.fee_percent),
      ownShippingCents: ownShip?.chargeCents ?? 0,
      itpShippingCents: itpShip?.chargeCents ?? 0,
      ownLabelCents: labelCents(ownShip),
      itpLabelCents: labelCents(itpShip)
    })
    if (split.totalCents < 50) return res.status(400).json({ error: 'Order total below Stripe minimum ($0.50)' })

    const source = sourceOf(store.slug)
    const orderNumber = `ITP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
    const buyerEmail = typeof email === 'string' && /.+@.+\..+/.test(email) ? email.trim() : null
    const vendorStore = {
      id: store.id,
      slug: store.slug,
      name: store.name,
      stripe_account_id: store.stripe_account_id,
      fee_percent: Number(store.fee_percent),
      split,
      // Each package's quote: her label is bought on this service when she presses Print label.
      shipping: { destination_zip: shipTo.address.zip, own: ownShip, itp: itpShip }
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: null,
        customer_email: buyerEmail,
        customer_name: shipTo.address.name,
        subtotal: split.subtotalCents / 100,
        tax_amount: 0,
        shipping_amount: split.shippingCents / 100,
        discount_amount: 0,
        total: split.totalCents / 100,
        currency: 'USD',
        status: 'pending',
        payment_status: 'pending',
        fulfillment_status: 'unfulfilled',
        payment_method: 'stripe',
        shipping_address: orderShippingAddress(shipTo.address, buyerEmail),
        discount_codes: [],
        source,
        metadata: {
          storefront: source,
          vendor_store: vendorStore,
          items: lines.map(l => ({
            id: l.item.product_id,
            vendor_store_item_id: l.item.id,
            maker: l.kind === 'itp' ? 'itp' : 'vendor',
            name: l.item.name,
            price: l.unitCents / 100,
            quantity: l.quantity,
            image: l.item.images?.[0],
            size: l.size,
            color: l.color,
            ...(l.stand ? { qr_link: l.stand.link, qr_caption: l.stand.caption } : {})
          }))
        }
      })
      .select()
      .single()
    if (orderError) {
      req.log?.error({ err: orderError }, 'vendor-store: failed to create order')
      return res.status(500).json({ error: 'Failed to create order' })
    }

    const { error: itemsError } = await supabase.from('order_items').insert(
      lines.map((l, lineIndex) => ({
        order_id: order.id,
        product_id: l.item.product_id,
        product_name: l.stand ? `${QR_STAND.name}: ${l.stand.caption}` : l.item.name,
        quantity: l.quantity,
        unit_price: l.unitCents / 100,
        subtotal: (l.unitCents * l.quantity) / 100,
        metadata: {
          vendor_store: store.slug,
          vendor_store_item_id: l.item.id,
          // 'vendor' = the seller makes and ships it herself; ITP prints only 'itp' lines.
          maker: l.kind === 'itp' ? 'itp' : 'vendor',
          image_url: l.item.images?.[0] ?? null,
          size: l.size ?? null,
          color: l.color ?? null,
          ...(l.item.product_id && printRefs[l.item.product_id] ? { print_file_refs: printRefs[l.item.product_id] } : {}),
          // The stand's paid-order hook (services/qr-stand-builds.ts onQrStandOrderPaid) queues its print file from this.
          ...(l.stand ? { qr_stand: { line_index: lineIndex, link: l.stand.link, caption: l.stand.caption, logo_path: l.stand.logoPath } } : {}),
          // An ITP item with no products row (the can lids) names its print file for the print desk.
          ...(l.item.metadata?.print_file ? { print_file: l.item.metadata.print_file } : {})
        }
      }))
    )
    if (itemsError) req.log?.error({ err: itemsError, orderId: order.id }, 'vendor-store: failed to insert order items')

    const origin = storeOrigin(store.slug)
    const cancel = typeof cancelPath === 'string' && cancelPath.startsWith('/') ? `${origin}${cancelPath}` : origin
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lines.map(l => ({
        quantity: l.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: l.unitCents,
          product_data: {
            name: [l.item.name, l.size, l.color, l.stand?.caption].filter(Boolean).join(' / '),
            ...(absoluteImage(l.item.images?.[0], origin)?.startsWith('https://') ? { images: [absoluteImage(l.item.images[0], origin)!] } : {})
          }
        }
      })),
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      success_url: `${origin}${origin.includes('/store/') ? '' : '/'}?thanks=${encodeURIComponent(orderNumber)}`,
      cancel_url: cancel,
      // The cart already took the address its rate was quoted for, so Stripe shows the shipping line and doesn't ask
      // again (the same as routes/storefront.ts).
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount' as const,
          display_name: `${(ownShip || itpShip)!.name}${ownShip && itpShip ? ' (ships in two packages)' : ''}`.slice(0, 100),
          fixed_amount: { amount: split.shippingCents, currency: 'usd' }
        }
      }],
      phone_number_collection: { enabled: !shipTo.address.phone },
      metadata: { orderId: order.id, orderNumber, source },
      payment_intent_data: {
        description: `Order ${orderNumber} (${store.name})`,
        application_fee_amount: split.itpShareCents,
        transfer_data: { destination: store.stripe_account_id! },
        shipping: {
          name: shipTo.address.name,
          ...(shipTo.address.phone ? { phone: shipTo.address.phone } : {}),
          address: {
            line1: shipTo.address.street1,
            ...(shipTo.address.street2 ? { line2: shipTo.address.street2 } : {}),
            city: shipTo.address.city,
            state: shipTo.address.state,
            postal_code: shipTo.address.zip,
            country: 'US'
          }
        },
        metadata: { orderId: order.id, orderNumber, userId: '', itcCreditAmount: '0', itcCreditUSD: '0', vendorStore: store.slug }
      }
    })

    await supabase
      .from('orders')
      .update({ metadata: { ...order.metadata, stripe_session_id: session.id } })
      .eq('id', order.id)

    req.log?.info({ orderId: order.id, orderNumber, source, split, sessionId: session.id }, 'vendor-store checkout session created')
    return res.json({ url: session.url, orderNumber })
  } catch (error: any) {
    req.log?.error({ err: error }, 'vendor-store checkout failed')
    return res.status(500).json({ error: 'Failed to create checkout' })
  }
})

// ---------------------------------------------------------------------------
// Manage: the seller who owns the store, and ITP admins (who also set ITP's side)
// ---------------------------------------------------------------------------

type ManageCtx = { store: StoreRow; isAdmin: boolean }
declare global {
  namespace Express {
    interface Request { vendorStore?: ManageCtx }
  }
}

const ADMIN_ROLES = ['admin', 'manager']

/**
 * The seller claims her store the first time she signs in with the email David put on it:
 * the store links to her account and she gets the vendor role. Returns the role to use now.
 */
async function claimIfOwner(store: StoreRow, user: { sub: string; email?: string }, role: string | null): Promise<string | null> {
  if (store.owner_user_id || !store.owner_email || !user.email) return role
  if (user.email.toLowerCase() !== store.owner_email.toLowerCase()) return role
  // Only an address she proved she owns can claim a store.
  const { data: authUser } = await supabase.auth.admin.getUserById(user.sub)
  if (!authUser?.user?.email_confirmed_at) return role
  await supabase.from('vendor_storefronts').update({ owner_user_id: user.sub, updated_at: new Date().toISOString() }).eq('id', store.id)
  store.owner_user_id = user.sub
  await syncInboxOwner(store.inbox_mailbox_id, user.sub)
  if (role && [...ADMIN_ROLES, 'vendor'].includes(role)) return role
  // The role cache holds the old role for a minute, so the answer here is what counts, and the cache is dropped:
  // without that, every other card on her first visit (assistant, credits) read the old role and said Not your store.
  await supabase.from('user_profiles').update({ role: 'vendor' }).eq('id', user.sub)
  invalidateCachedRole(user.sub)
  return 'vendor'
}

async function requireStoreManager(req: Request, res: Response, next: NextFunction): Promise<void> {
  const store = await loadStore(req.params.slug)
  if (!store) {
    res.status(404).json({ error: 'Store not found' })
    return
  }
  const role = await claimIfOwner(store, req.user!, await getCachedRole(req.user!.sub))
  const isAdmin = !!role && ADMIN_ROLES.includes(role)
  if (!isAdmin && !(role === 'vendor' && store.owner_user_id === req.user!.sub)) {
    res.status(403).json({ error: 'Not your store' })
    return
  }
  req.vendorStore = { store, isAdmin }
  next()
}

router.get('/manage/mine', requireAuth, async (req: Request, res: Response): Promise<any> => {
  const role = await getCachedRole(req.user!.sub)
  let q = supabase.from('vendor_storefronts').select('slug, name, logo_url, status').order('created_at')
  if (!role || !ADMIN_ROLES.includes(role)) {
    // Her own store, or one waiting for her email to claim it (requireStoreManager links it).
    const email = (req.user!.email || '').toLowerCase().replace(/[,()]/g, '')
    q = email
      ? q.or(`owner_user_id.eq.${req.user!.sub},and(owner_user_id.is.null,owner_email.eq.${email})`)
      : q.eq('owner_user_id', req.user!.sub)
  }
  const { data } = await q
  return res.json({ stores: data || [], isAdmin: !!role && ADMIN_ROLES.includes(role) })
})

router.get('/manage/:slug', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store, isAdmin } = req.vendorStore!
  const [{ data: items }, { data: orders }, payouts] = await Promise.all([
    supabase.from('vendor_store_items').select('*').eq('storefront_id', store.id).order('sort').order('created_at', { ascending: false }),
    supabase
      .from('orders')
      .select('order_number, created_at, total, customer_name, customer_email, fulfillment_status, metadata, payment_status')
      .eq('source', sourceOf(store.slug))
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: false })
      .limit(50),
    payoutsReady(store.stripe_account_id)
  ])

  return res.json({
    isAdmin,
    store: {
      slug: store.slug,
      name: store.name,
      tagline: store.tagline,
      logoUrl: store.logo_url,
      theme: store.theme,
      status: store.status,
      feePercent: Number(store.fee_percent),
      ownShippingCents: store.own_shipping_cents,
      itpShippingCents: store.itp_shipping_cents,
      ownerEmail: store.owner_email,
      instagram: store.instagram,
      shipFrom: store.ship_from,
      url: storeOrigin(store.slug)
    },
    payouts: {
      hasAccount: !!store.stripe_account_id,
      ready: payouts.ready,
      detailsSubmitted: !!payouts.account?.details_submitted
    },
    items: ((items || []) as ItemRow[]).map(i => ({ ...publicItem(i), active: i.active, itpCostCents: i.itp_cost_cents, suggestedPriceCents: i.suggested_price_cents ?? null, sort: i.sort })),
    orders: (orders || []).map((o: any) => ({
      orderNumber: o.order_number,
      createdAt: o.created_at,
      totalCents: Math.round(Number(o.total) * 100),
      yourShareCents: o.metadata?.vendor_store?.split?.vendorShareCents ?? null,
      customer: o.customer_name || o.customer_email,
      fulfillment: o.fulfillment_status,
      items: o.metadata?.items || [],
      // Her package: what its shipping charged and the label she prints for it.
      shipping: o.metadata?.vendor_store?.shipping?.own
        ? { chargeCents: o.metadata.vendor_store.shipping.own.chargeCents, service: o.metadata.vendor_store.shipping.own.name }
        : null,
      label: sellerLabelView(o.metadata?.vendor_store?.label)
    }))
  })
})

router.patch('/manage/:slug', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store, isAdmin } = req.vendorStore!
  const b = req.body || {}
  const patch: Record<string, unknown> = {}
  if (typeof b.tagline === 'string') patch.tagline = b.tagline.trim().slice(0, 140) || null
  if (Number.isInteger(b.ownShippingCents) && b.ownShippingCents >= 0 && b.ownShippingCents <= 5000) patch.own_shipping_cents = b.ownShippingCents
  if (typeof b.instagram === 'string') {
    // Accepts @handle or a profile link; stores the bare handle.
    const handle = b.instagram.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '')
    if (handle && !/^[A-Za-z0-9._]{1,30}$/.test(handle)) return res.status(400).json({ error: 'That doesn’t look like an Instagram handle' })
    patch.instagram = handle || null
  }
  if (b.shipFrom !== undefined) {
    // Where she ships from: her labels are bought from this address, her package is rated from it.
    if (b.shipFrom === null) patch.ship_from = null
    else {
      const read = readUsAddress(b.shipFrom, { phoneRequired: true })
      if ('error' in read) return res.status(400).json({ error: read.error })
      patch.ship_from = read.address
    }
  }
  if (isAdmin) {
    if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 80)
    if (typeof b.feePercent === 'number' && b.feePercent >= 0 && b.feePercent <= 50) patch.fee_percent = b.feePercent
    if (Number.isInteger(b.itpShippingCents) && b.itpShippingCents >= 0 && b.itpShippingCents <= 5000) patch.itp_shipping_cents = b.itpShippingCents
    if (['draft', 'live', 'paused'].includes(b.status)) patch.status = b.status
    if (typeof b.ownerEmail === 'string') {
      const ownerEmail = b.ownerEmail.trim().toLowerCase()
      patch.owner_email = ownerEmail || null
      patch.owner_user_id = null
      if (ownerEmail) {
        // The owner must already have an ITP account; she gets the vendor role with it.
        const { data: profile } = await supabase.from('user_profiles').select('id, role').ilike('email', ownerEmail).maybeSingle()
        if (profile) {
          patch.owner_user_id = profile.id
          if (!['admin', 'manager', 'vendor'].includes(profile.role)) {
            await supabase.from('user_profiles').update({ role: 'vendor' }).eq('id', profile.id)
          }
        }
      }
    }
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' })
  patch.updated_at = new Date().toISOString()
  const { error } = await supabase.from('vendor_storefronts').update(patch).eq('id', store.id)
  if (error) return res.status(500).json({ error: 'Failed to save' })
  if ('owner_user_id' in patch) await syncInboxOwner(store.inbox_mailbox_id, patch.owner_user_id as string | null)
  return res.json({ ok: true, ownerLinked: patch.owner_email ? !!patch.owner_user_id : undefined })
})

// Her own product: she makes and ships it. Live on her store as soon as it is saved.
router.post('/manage/:slug/items', requireAuth, requireStoreManager, upload.array('images', 6), async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const name = String(req.body?.name || '').trim().slice(0, 120)
  const priceCents = Math.round(Number(req.body?.price) * 100)
  if (!name) return res.status(400).json({ error: 'Give it a name' })
  if (!Number.isFinite(priceCents) || priceCents < 100) return res.status(400).json({ error: 'Price must be at least $1.00' })
  const files = (req.files as Express.Multer.File[]) || []
  if (!files.length) return res.status(400).json({ error: 'Add at least one picture' })

  const images: string[] = []
  for (const f of files) {
    const ext = f.mimetype === 'image/png' ? 'png' : f.mimetype === 'image/webp' ? 'webp' : 'jpg'
    const path = `products/vendor-stores/${store.slug}/${nanoid(12)}.${ext}`
    await uploadImageFromBuffer(f.buffer, path, f.mimetype)
    images.push(`${MEDIA_BASE}/${path}`)
  }
  const list = (v: unknown) =>
    String(v || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20)

  const { data, error } = await supabase
    .from('vendor_store_items')
    .insert({
      storefront_id: store.id,
      product_id: null,
      name,
      description: String(req.body?.description || '').trim().slice(0, 2000) || null,
      images,
      sizes: list(req.body?.sizes),
      colors: list(req.body?.colors),
      price_cents: priceCents,
      itp_cost_cents: 0,
      active: true
    })
    .select()
    .single()
  if (error) return res.status(500).json({ error: 'Failed to save' })
  return res.json({ item: publicItem(data as ItemRow) })
})

router.patch('/manage/:slug/items/:id', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store, isAdmin } = req.vendorStore!
  const { data: item } = await supabase
    .from('vendor_store_items').select('*').eq('id', req.params.id).eq('storefront_id', store.id).maybeSingle()
  if (!item) return res.status(404).json({ error: 'Item not found' })
  const b = req.body || {}
  const patch: Record<string, unknown> = {}
  const cost = isAdmin && Number.isInteger(b.itpCostCents) && b.itpCostCents >= 0 ? b.itpCostCents : item.itp_cost_cents
  if (isAdmin && isItp(item) && cost !== item.itp_cost_cents) {
    patch.itp_cost_cents = cost
    // David sets her price; a cost above what she charges lifts her price with it, so no sale goes under our cost.
    if (b.priceCents === undefined && item.price_cents < cost) patch.price_cents = cost
  }
  if (b.priceCents !== undefined) {
    // Small ITP items (a 25-cent can lid) may sell under a dollar; her own products start at $1.
    const floor = isItp(item) ? 50 : 100
    if (!Number.isInteger(b.priceCents) || b.priceCents < floor) return res.status(400).json({ error: `Price must be at least $${(floor / 100).toFixed(2)}` })
    if (isItp(item) && b.priceCents < cost) {
      return res.status(400).json({ error: `Price can't be under Imagine This Printed's price of $${(cost / 100).toFixed(2)}` })
    }
    patch.price_cents = b.priceCents
  }
  // David suggests what she sells an ITP product for; she still sets her own price.
  if (isAdmin && isItp(item) && (b.suggestedPriceCents === null || (Number.isInteger(b.suggestedPriceCents) && b.suggestedPriceCents >= 0))) {
    patch.suggested_price_cents = b.suggestedPriceCents
  }
  if (typeof b.active === 'boolean') patch.active = b.active
  if (Number.isInteger(b.sort)) patch.sort = b.sort
  if (!isItp(item)) {
    if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 120)
    if (typeof b.description === 'string') patch.description = b.description.trim().slice(0, 2000) || null
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' })
  patch.updated_at = new Date().toISOString()
  const { error } = await supabase.from('vendor_store_items').update(patch).eq('id', item.id)
  if (error) return res.status(500).json({ error: 'Failed to save' })
  return res.json({ ok: true })
})

router.delete('/manage/:slug/items/:id', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store, isAdmin } = req.vendorStore!
  const { data: item } = await supabase
    .from('vendor_store_items').select('*').eq('id', req.params.id).eq('storefront_id', store.id).maybeSingle()
  if (!item) return res.status(404).json({ error: 'Item not found' })
  // ITP products David offered her stay on the list; she switches them off instead.
  if (!isAdmin && isItp(item as ItemRow)) return res.status(403).json({ error: 'Switch it off instead' })
  const { error } = await supabase.from('vendor_store_items').delete().eq('id', item.id)
  if (error) return res.status(500).json({ error: 'Failed to delete' })
  return res.json({ ok: true })
})

// Her store inbox (her own address on our domain, Jev's junk kept out): the owner and ITP admins only.
router.use('/manage/:slug/inbox', requireAuth, requireStoreManager, storeInboxRouter)

// Her store assistant. One turn: what she typed (`text`), a voice note (multipart `audio`) and/or a picture of a design
// (multipart `image`). The chat itself lives in vendor_store_assistant_messages, so it follows her to any device and the
// assistant reads its own last turns from there, never from the browser. What it chose to remember about her
// (vendor_store_assistant_memory) goes back into every turn. Answers { heard, reply, makeProduct, imageUrl, messages }:
// `messages` are her turn and the reply as saved. The page asks /assistant/speak to read the reply out.
const HISTORY_TURNS = 16
const MEMORY_FACTS = 30
type MessageRow = { id: string; role: 'user' | 'assistant'; text: string; image_url: string | null; created_at: string }
// An assistant row's image_url is the design that reply offers to make into a product (her Make it a product button).
const publicMessage = (m: MessageRow) => ({
  id: m.id,
  role: m.role,
  text: m.text,
  imageUrl: m.image_url,
  makeProduct: m.role === 'assistant' && !!m.image_url,
  createdAt: m.created_at
})

/** Her last turns (newest first, as read) the way the model takes them: oldest first, opening on her, one per speaker. */
export function chatTurns(rows: MessageRow[]): AssistantTurn[] {
  const turns: AssistantTurn[] = []
  for (const r of [...rows].reverse()) {
    const text = r.text.trim() || (r.image_url && r.role === 'user' ? '(She sent a picture.)' : '')
    if (!text) continue
    const last = turns[turns.length - 1]
    if (last?.role === r.role) last.text += `\n${text}`
    else turns.push({ role: r.role, text })
  }
  while (turns[0]?.role === 'assistant') turns.shift()
  return turns
}

router.get('/manage/:slug/assistant/history', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const { data, error } = await supabase
    .from('vendor_store_assistant_messages')
    .select('id, role, text, image_url, created_at')
    .eq('storefront_id', store.id)
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) return res.status(500).json({ error: 'The chat didn’t load' })
  return res.json({ messages: ((data || []) as MessageRow[]).reverse().map(publicMessage) })
})

// The design a reply offered to make into a product, handed back as a data URL for the Step Flow's upload
// (customerStepFlow.upload takes the file itself). Read here from where her turn saved it, so the page never
// downloads it cross-origin from the media host.
router.get('/manage/:slug/assistant/design/:messageId', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const { data: row } = await supabase
    .from('vendor_store_assistant_messages')
    .select('image_url')
    .eq('id', req.params.messageId)
    .eq('storefront_id', store.id)
    .maybeSingle()
  const url: string | undefined = row?.image_url
  if (!url?.startsWith(`${MEDIA_BASE}/`)) return res.status(404).json({ error: 'That design isn’t saved any more. Attach it again.' })
  try {
    const path = url.slice(MEDIA_BASE.length + 1)
    const file = await fetch(await getSignedUrl(path, 5))
    if (!file.ok) throw new Error(`storage ${file.status}`)
    const type = file.headers.get('content-type')?.split(';')[0] || 'image/png'
    // A neutral name: the stored one is a random id, and the upload reads a file name as a hint for the product's name.
    const filename = `design.${type === 'image/jpeg' ? 'jpg' : type.replace('image/', '')}`
    return res.json({ image: `data:${type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`, filename })
  } catch (error) {
    req.log?.error({ err: error }, 'vendor-store assistant design not read')
    return res.status(502).json({ error: 'That design didn’t load. Try again.' })
  }
})

router.post('/manage/:slug/assistant', requireAuth, requireStoreManager, takeAssistantFiles, async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const files = (req.files || {}) as Record<string, Express.Multer.File[] | undefined>
  const voice = files.audio?.[0]
  const picture = files.image?.[0]
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 4000) : ''
  if (!text && !voice && !picture) return res.status(400).json({ error: 'Say or type something' })

  let design: Awaited<ReturnType<typeof readDesignPicture>> | null = null
  if (picture) {
    try {
      design = await readDesignPicture(picture.buffer)
    } catch {
      return res.status(400).json({ error: 'That picture couldn’t be opened' })
    }
  }
  if (!assistantTurnAllowed(store.slug)) return res.status(429).json({ error: 'The assistant has done a lot today. It’s back tomorrow.' })

  try {
    const [{ data: items }, { data: orders }, payouts, { data: past }, { data: memory }] = await Promise.all([
      supabase.from('vendor_store_items').select('*').eq('storefront_id', store.id),
      supabase.from('orders').select('created_at, total, metadata').eq('source', sourceOf(store.slug)).eq('payment_status', 'paid').limit(500),
      payoutsReady(store.stripe_account_id),
      supabase
        .from('vendor_store_assistant_messages')
        .select('id, role, text, image_url, created_at')
        .eq('storefront_id', store.id)
        .order('created_at', { ascending: false })
        .limit(HISTORY_TURNS),
      supabase
        .from('vendor_store_assistant_memory')
        .select('fact')
        .eq('storefront_id', store.id)
        .order('created_at', { ascending: false })
        .limit(MEMORY_FACTS)
    ])
    const memories = ((memory || []) as Array<{ fact: string }>).map(m => m.fact)
    const turns = chatTurns((past || []) as MessageRow[])
    if (text) {
      const last = turns[turns.length - 1]
      if (last?.role === 'user') last.text += `\n${text}`
      else turns.push({ role: 'user', text })
    }

    const savePicture = async (): Promise<string | null> => {
      if (!picture) return null
      try {
        const ext = picture.mimetype === 'image/png' ? 'png' : picture.mimetype === 'image/webp' ? 'webp' : 'jpg'
        const path = `products/vendor-stores/${store.slug}/assistant/${nanoid(12)}.${ext}`
        await uploadImageFromBuffer(picture.buffer, path, picture.mimetype)
        return `${MEDIA_BASE}/${path}`
      } catch (error) {
        req.log?.warn({ err: error }, 'vendor-store assistant picture not saved')
        return null
      }
    }
    const [answer, imageUrl] = await Promise.all([
      askStoreAssistant(
        {
          storeName: store.name,
          ownerFirst: String((store.theme as any)?.ownerFirst || store.name.split(/[’']/)[0]),
          status: store.status,
          payoutsReady: payouts.ready,
          feePercent: Number(store.fee_percent),
          instagram: store.instagram,
          items: ((items || []) as ItemRow[]).map(i => ({ name: i.name, kind: isItp(i) ? 'itp' : 'own', priceCents: i.price_cents, itpCostCents: i.itp_cost_cents, active: i.active })),
          orders: (orders || []).map((o: any) => ({ createdAt: o.created_at, totalCents: Math.round(Number(o.total) * 100), shareCents: o.metadata?.vendor_store?.split?.vendorShareCents ?? null })),
          memories
        },
        turns,
        voice ? { mimeType: voice.mimetype.replace(/;.*$/, '').replace('x-wav', 'wav'), data: voice.buffer.toString('base64') } : undefined,
        design
          ? { mimeType: 'image/jpeg', data: design.preview.toString('base64'), widthPx: design.widthPx, heightPx: design.heightPx, transparent: design.transparent }
          : undefined
      ),
      savePicture()
    ])
    const { heard, reply, remember, makeProduct, usage } = answer

    // Both turns, in order (the reply a millisecond after hers), then anything new worth remembering about her.
    const at = Date.now()
    const { data: saved, error: saveError } = await supabase
      .from('vendor_store_assistant_messages')
      .insert([
        { storefront_id: store.id, role: 'user', text: heard || text || (voice ? '(voice note)' : ''), image_url: imageUrl, created_at: new Date(at).toISOString() },
        { storefront_id: store.id, role: 'assistant', text: reply, image_url: makeProduct ? imageUrl : null, created_at: new Date(at + 1).toISOString() }
      ])
      .select('id, role, text, image_url, created_at')
    if (saveError) req.log?.error({ err: saveError }, 'vendor-store assistant chat not saved')
    const known = new Set(memories.map(m => m.toLowerCase()))
    const fresh = remember.filter(r => !known.has(r.toLowerCase()))
    if (fresh.length) {
      const { error } = await supabase.from('vendor_store_assistant_memory').insert(fresh.map(fact => ({ storefront_id: store.id, fact })))
      if (error) req.log?.error({ err: error }, 'vendor-store assistant memory not saved')
    }

    req.log?.info({ slug: store.slug, voice: !!voice, picture: !!picture, remembered: fresh.length, makeProduct, usage }, 'vendor-store assistant turn')
    return res.json({
      heard,
      reply,
      makeProduct,
      imageUrl,
      messages: ((saved || []) as MessageRow[]).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(publicMessage)
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'vendor-store assistant failed')
    return res.status(502).json({ error: 'The assistant didn’t answer. Try again.' })
  }
})

// Read an assistant reply out loud (Gemini 3.8 Flash TTS, voiceGenerator's 'store-assistant' voice).
router.post('/manage/:slug/assistant/speak', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 1500) : ''
  if (!text) return res.status(400).json({ error: 'Nothing to say' })
  try {
    return res.json({ audioUrl: await generateVoiceResponse(text, { persona: 'store-assistant' }) })
  } catch (error: any) {
    req.log?.error({ err: error }, 'vendor-store assistant speak failed')
    return res.status(502).json({ error: 'Couldn’t read that out loud' })
  }
})

// Her ITC credits: the balance on her own ITP account, what the AI tools cost, and what she spent them on.
// She buys more on /wallet; the tools (Imagination Station, the Creator Studio design flow) charge ITC themselves.
const CREDIT_PRICES: Array<{ key: string; label: string }> = [
  { key: 'generate', label: 'Design a shirt with AI (per design)' },
  { key: 'generate', label: 'Make an image' },
  { key: 'bg_remove', label: 'Remove a background' },
]
router.get('/manage/:slug/credits', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const { data: pricing } = await supabase
    .from('imagination_pricing')
    .select('feature_key, current_cost')
    .in('feature_key', [...new Set(CREDIT_PRICES.map(p => p.key))])
  const cost = new Map((pricing || []).map((p: any) => [p.feature_key, Number(p.current_cost)]))
  const prices = CREDIT_PRICES.filter(p => cost.has(p.key)).map(p => ({ label: p.label, itc: cost.get(p.key)! }))
  if (!store.owner_user_id) return res.json({ linked: false, balance: null, prices, recent: [] })

  const [{ data: wallet }, { data: recent }] = await Promise.all([
    supabase.from('user_wallets').select('itc_balance').eq('user_id', store.owner_user_id).maybeSingle(),
    supabase.from('itc_transactions').select('type, amount, reference, metadata, created_at').eq('user_id', store.owner_user_id).order('created_at', { ascending: false }).limit(8)
  ])
  return res.json({
    linked: true,
    balance: Number(wallet?.itc_balance ?? 0),
    prices,
    recent: (recent || []).map((t: any) => ({
      at: t.created_at,
      amount: Number(t.amount),
      what: String(t.metadata?.reason || t.reference || t.type).replace(/^imagination_station:/, '').replace(/_/g, ' ')
    }))
  })
})

// Admin: search ITP's live catalog to offer a product to the store.
router.get('/manage/:slug/itp-catalog', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  if (!req.vendorStore!.isAdmin) return res.status(403).json({ error: 'Admins only' })
  const term = String(req.query.q || '').trim().slice(0, 60)
  let q = supabase
    .from('products')
    .select('id, name, price, cost_price, images, category')
    .eq('status', 'active')
    .eq('is_active', true)
    // A creator's product already pays its creator a margin off the sale price.
    .or('is_user_generated.is.null,is_user_generated.eq.false')
    .order('created_at', { ascending: false })
    .limit(24)
  if (term) q = q.ilike('name', `%${term.replace(/[%_]/g, '')}%`)
  const { data } = await q
  // The QR stand has no products row (it is a priced line type), so it is offered by its line id.
  const standMatches = !term || /qr|stand|counter|code/i.test(term)
  return res.json({
    products: [
      ...(standMatches ? [{ id: QR_STAND.lineIdPrefix, name: QR_STAND.name, priceCents: QR_STAND.wasCents, costCents: QR_STAND.priceCents, image: QR_STAND_IMAGES[0], category: 'business' }] : []),
      ...(data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      priceCents: Math.round(Number(p.price) * 100),
      costCents: p.cost_price != null ? Math.round(Number(p.cost_price) * 100) : null,
      image: Array.isArray(p.images) ? p.images[0] : null,
      category: p.category
      }))
    ]
  })
})

// Admin: offer an ITP product to the store at David's price for her. She switches it on
// with her own price.
router.post('/manage/:slug/offer', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store, isAdmin } = req.vendorStore!
  if (!isAdmin) return res.status(403).json({ error: 'Admins only' })
  const { productId, itpCostCents } = req.body || {}
  if (!Number.isInteger(itpCostCents) || itpCostCents < 0) return res.status(400).json({ error: 'Set her price (cents)' })
  if (productId === QR_STAND.lineIdPrefix) {
    const row = await offerQrStand(store.id, itpCostCents)
    if (!row) return res.status(500).json({ error: 'Failed to offer' })
    return res.json({ item: { ...publicItem(row), active: row.active, itpCostCents } })
  }
  const { data: p } = await supabase
    .from('products')
    .select('id, name, description, price, images, sizes, colors, status, is_active, is_user_generated')
    .eq('id', productId)
    .maybeSingle()
  if (!p || p.status !== 'active' || p.is_active === false) return res.status(400).json({ error: 'Product is not live on ITP' })
  if (p.is_user_generated) return res.status(400).json({ error: "A creator's product can't be resold" })
  const retail = Math.round(Number(p.price) * 100)
  const { data, error } = await supabase
    .from('vendor_store_items')
    .upsert({
      storefront_id: store.id,
      product_id: p.id,
      name: p.name,
      description: p.description,
      images: Array.isArray(p.images) ? p.images : [],
      sizes: Array.isArray(p.sizes) ? p.sizes : [],
      colors: Array.isArray(p.colors) ? p.colors : [],
      itp_cost_cents: itpCostCents,
      // Starts at ITP's own retail (or her cost, if David set it higher); she changes it.
      price_cents: Math.max(retail, itpCostCents),
      updated_at: new Date().toISOString()
    }, { onConflict: 'storefront_id,product_id' })
    .select()
    .single()
  if (error) return res.status(500).json({ error: 'Failed to offer' })
  return res.json({ item: { ...publicItem(data as ItemRow), active: (data as ItemRow).active, itpCostCents } })
})

// ---------------------------------------------------------------------------
// Her shipping labels (David 2026-10-26: "her own items ship from HER: give her the Shippo label to print"). Her
// package's shipping, paid at checkout, buys the label on ITP's Shippo account from her ship-from address. One label
// per order, never two; ITP's own package keeps the normal order flow (routes/orders.ts).
// ---------------------------------------------------------------------------

function sellerLabelView(label: SellerLabel | undefined | null) {
  if (!label?.label_url) return null
  return {
    trackingNumber: label.tracking_number,
    trackingUrl: label.tracking_url,
    carrier: label.carrier,
    service: label.service,
    purchasedAt: label.purchased_at
  }
}

async function loadStoreOrder(store: StoreRow, orderNumber: string) {
  const { data } = await supabase
    .from('orders')
    .select('id, order_number, customer_email, customer_name, shipping_address, payment_status, metadata')
    .eq('source', sourceOf(store.slug))
    .eq('order_number', String(orderNumber))
    .maybeSingle()
  return data as any
}

const labelsBuying = new Set<string>()

router.post('/manage/:slug/orders/:orderNumber/label', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const order = await loadStoreOrder(store, req.params.orderNumber)
  if (!order || order.payment_status !== 'paid') return res.status(404).json({ error: 'Order not found' })
  const vs = order.metadata?.vendor_store || {}
  const hers = (order.metadata?.items || []).filter((i: any) => i.maker === 'vendor')
  if (!hers.length) return res.status(400).json({ error: 'Imagine This Printed ships everything in this order' })
  if (vs.label?.label_url) return res.json({ ok: true, alreadyPurchased: true, label: sellerLabelView(vs.label) })
  if (!store.ship_from) return res.status(409).json({ error: 'Add the address you ship from in Settings first', code: 'ship_from' })

  const a = order.shipping_address || {}
  const shipTo = {
    name: order.customer_name || [a.firstName, a.lastName].filter(Boolean).join(' ') || 'Customer',
    street1: a.address || a.street1 || '',
    street2: a.address2 || a.street2 || '',
    city: a.city || '',
    state: a.state || '',
    zip: a.zipCode || a.zip || '',
    country: a.country || 'US',
    phone: a.phone || '',
    email: order.customer_email || a.email || ''
  }
  if (!shipTo.street1 || !shipTo.city || !shipTo.state || !shipTo.zip) return res.status(400).json({ error: 'This order has no full shipping address' })

  if (labelsBuying.has(order.id)) return res.status(409).json({ error: 'The label is already being made' })
  labelsBuying.add(order.id)
  try {
    const weightLb = Number(vs.shipping?.own?.weightLb) || packageWeights(hers.map((i: any) => ({ kind: 'own' as const, quantity: Number(i.quantity) || 1 }))).own!
    const bought = await buySellerLabel({
      shipFrom: store.ship_from,
      shipTo,
      weightLb,
      service: vs.shipping?.own?.service || null,
      reference: `${order.order_number} ${store.slug}`,
      purchasedBy: req.user!.sub
    })
    if (!bought.ok) {
      req.log?.error({ orderId: order.id, error: bought.error }, 'vendor-store label purchase failed')
      return res.status(502).json({ error: bought.error })
    }
    // Read the row fresh so a webhook write in the meantime isn't lost. The label is bought: keep it whatever happens.
    const { data: fresh } = await supabase.from('orders').select('metadata').eq('id', order.id).maybeSingle()
    const metadata = (fresh as any)?.metadata || order.metadata || {}
    const { error } = await supabase
      .from('orders')
      .update({ metadata: { ...metadata, vendor_store: { ...(metadata.vendor_store || {}), label: bought.label } }, updated_at: new Date().toISOString() })
      .eq('id', order.id)
    if (error) req.log?.error({ err: error, orderId: order.id, label: bought.label }, 'vendor-store label bought but not saved')
    req.log?.info({ orderId: order.id, slug: store.slug, tracking: bought.label.tracking_number, costCents: bought.label.cost_cents }, 'vendor-store label bought')
    return res.json({ ok: true, label: sellerLabelView(bought.label) })
  } finally {
    labelsBuying.delete(order.id)
  }
})

// The label as a PDF download (Shippo's file, passed through so the browser saves it with the order number).
router.get('/manage/:slug/orders/:orderNumber/label.pdf', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  const order = await loadStoreOrder(store, req.params.orderNumber)
  const url = order?.metadata?.vendor_store?.label?.label_url
  if (!order || !isShippoLabelUrl(url)) return res.status(404).json({ error: 'No label for this order yet' })
  const file = await fetch(url)
  if (!file.ok) return res.status(502).json({ error: 'Shippo didn’t send the label file. Try again.' })
  const pdf = Buffer.from(await file.arrayBuffer())
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="label-${order.order_number}.pdf"`)
  return res.send(pdf)
})

// The seller's payouts: one Express account per store, onboarded on Stripe's own page.
router.post('/manage/:slug/payouts-link', requireAuth, requireStoreManager, async (req: Request, res: Response): Promise<any> => {
  try {
    const { store } = req.vendorStore!
    let accountId = store.stripe_account_id
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        ...(store.owner_email ? { email: store.owner_email } : {}),
        business_profile: { name: store.name, url: storeOrigin(store.slug), product_description: 'Shirts and gifts sold on Imagine This Printed' },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { platform: 'imaginethisprinted', purpose: 'vendor_store', vendor_store: store.slug }
      })
      accountId = account.id
      await supabase.from('vendor_storefronts').update({ stripe_account_id: accountId, updated_at: new Date().toISOString() }).eq('id', store.id)
    }
    const back = `${SITE_URL}/vendor/store/${store.slug}`
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${back}?payouts=retry`,
      return_url: `${back}?payouts=done`,
      collection_options: { fields: 'eventually_due' }
    })
    return res.json({ url: link.url })
  } catch (error: any) {
    req.log?.error({ err: error }, 'vendor-store payouts link failed')
    return res.status(500).json({ error: 'Could not open payouts setup' })
  }
})

export default router
