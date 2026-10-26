import { Router, Request, Response, NextFunction } from 'express'
import Stripe from 'stripe'
import multer from 'multer'
import { nanoid } from 'nanoid'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { getCachedRole } from '../lib/role-cache.js'
import { uploadImageFromBuffer } from '../services/google-cloud-storage.js'
import { getPrintFileRefsFor } from '../services/print-files.js'
import { plusSizeUpchargeCents } from '../shared/catalog-capability.js'
import { splitOrder, type SplitLine } from '../lib/vendor-store-split.js'
import { askStoreAssistant, type AssistantTurn } from '../services/store-assistant.js'
import { generateVoiceResponse } from '../services/voiceGenerator.js'
import { QR_STAND, readQrStandFields, type QrStandFields } from '../shared/qr-stand.js'

// Vendor storefronts (David 2026-10-26): a seller's own branded store on
// <slug>.imaginethisprinted.com, Crystal's Shirts and More first. Buyers check out through
// ITP's Stripe; a destination charge pays the seller's Express account and ITP keeps its
// share as the application fee (lib/vendor-store-split.ts has the rules). The paid order
// rides the existing webhook (payment_intent.succeeded -> applyPaidCheckoutOrder) through
// the { orderId, orderNumber } metadata, like routes/storefront.ts.
//
//   GET  /api/vendor-store/:slug                 public store + live items
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

// Her voice note for the assistant: what a browser's MediaRecorder makes (webm/ogg/mp4) or a plain file.
const voiceNote = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^audio\/(webm|ogg|wav|x-wav|mp4|mpeg|aac|flac)/.test(file.mimetype))
})

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
  active: boolean
  sort: number
  metadata?: Record<string, any> | null
}

/**
 * An ITP item is one ITP makes and ships: a products row, or a priced line type that has no products row
 * (the Custom QR Counter Stand, backend/shared/qr-stand.ts: metadata.line_type 'qr-stand').
 */
const isQrStand = (i: ItemRow) => i.metadata?.line_type === QR_STAND.lineIdPrefix
const isItp = (i: ItemRow) => !!i.product_id || isQrStand(i)

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

router.post('/:slug/checkout', async (req: Request, res: Response): Promise<any> => {
  try {
    const store = await loadStore(req.params.slug)
    if (!store || store.status === 'paused') return res.status(404).json({ error: 'Store not found' })
    if (store.status !== 'live') return res.status(409).json({ error: 'store_not_open' })
    const { ready } = await payoutsReady(store.stripe_account_id)
    if (!ready) return res.status(409).json({ error: 'store_not_open' })

    const { items, email, cancelPath } = req.body || {}
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

    const split = splitOrder(lines, {
      feePercent: Number(store.fee_percent),
      ownShippingCents: store.own_shipping_cents,
      itpShippingCents: store.itp_shipping_cents
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
      split
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: null,
        customer_email: buyerEmail,
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
        shipping_address: {},
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
          ...(l.stand ? { qr_stand: { line_index: lineIndex, link: l.stand.link, caption: l.stand.caption, logo_path: l.stand.logoPath } } : {})
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
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount' as const,
          display_name: split.ownShippingCents && split.itpShippingCents ? 'Shipping (ships in two packages)' : 'Shipping',
          fixed_amount: { amount: split.shippingCents, currency: 'usd' }
        }
      }],
      shipping_address_collection: { allowed_countries: ['US'] },
      phone_number_collection: { enabled: true },
      metadata: { orderId: order.id, orderNumber, source },
      payment_intent_data: {
        description: `Order ${orderNumber} (${store.name})`,
        application_fee_amount: split.itpShareCents,
        transfer_data: { destination: store.stripe_account_id! },
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
  if (role && [...ADMIN_ROLES, 'vendor'].includes(role)) return role
  // The role cache holds the old role for a minute, so the answer here is what counts.
  await supabase.from('user_profiles').update({ role: 'vendor' }).eq('id', user.sub)
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
      url: storeOrigin(store.slug)
    },
    payouts: {
      hasAccount: !!store.stripe_account_id,
      ready: payouts.ready,
      detailsSubmitted: !!payouts.account?.details_submitted
    },
    items: ((items || []) as ItemRow[]).map(i => ({ ...publicItem(i), active: i.active, itpCostCents: i.itp_cost_cents, sort: i.sort })),
    orders: (orders || []).map((o: any) => ({
      orderNumber: o.order_number,
      createdAt: o.created_at,
      totalCents: Math.round(Number(o.total) * 100),
      yourShareCents: o.metadata?.vendor_store?.split?.vendorShareCents ?? null,
      customer: o.customer_name || o.customer_email,
      fulfillment: o.fulfillment_status,
      items: o.metadata?.items || []
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
  if (isAdmin && isItp(item) && cost !== item.itp_cost_cents) patch.itp_cost_cents = cost
  if (b.priceCents !== undefined) {
    if (!Number.isInteger(b.priceCents) || b.priceCents < 100) return res.status(400).json({ error: 'Price must be at least $1.00' })
    if (isItp(item) && b.priceCents < cost) {
      return res.status(400).json({ error: `Price can't be under Imagine This Printed's price of $${(cost / 100).toFixed(2)}` })
    }
    patch.price_cents = b.priceCents
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

// Her store assistant: a typed message, or a voice note (multipart field `audio`). Body field `messages` is the chat
// so far as JSON [{ role, text }]. Answers { heard, reply }; the page asks /assistant/speak to read the reply out.
router.post('/manage/:slug/assistant', requireAuth, requireStoreManager, voiceNote.single('audio'), async (req: Request, res: Response): Promise<any> => {
  const { store } = req.vendorStore!
  let turns: AssistantTurn[] = []
  try {
    const raw = typeof req.body?.messages === 'string' ? JSON.parse(req.body.messages) : req.body?.messages
    if (Array.isArray(raw)) {
      turns = raw
        .filter((t: any) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.text === 'string' && t.text.trim())
        .map((t: any) => ({ role: t.role, text: t.text }))
    }
  } catch {
    return res.status(400).json({ error: 'messages must be JSON' })
  }
  const file = req.file
  if (!file && (!turns.length || turns[turns.length - 1].role !== 'user')) return res.status(400).json({ error: 'Say or type something' })
  if (!assistantTurnAllowed(store.slug)) return res.status(429).json({ error: 'The assistant has done a lot today. It’s back tomorrow.' })

  try {
    const [{ data: items }, { data: orders }, payouts] = await Promise.all([
      supabase.from('vendor_store_items').select('*').eq('storefront_id', store.id),
      supabase.from('orders').select('created_at, total, metadata').eq('source', sourceOf(store.slug)).eq('payment_status', 'paid').limit(500),
      payoutsReady(store.stripe_account_id)
    ])
    const { heard, reply, usage } = await askStoreAssistant(
      {
        storeName: store.name,
        ownerFirst: String((store.theme as any)?.ownerFirst || store.name.split(/[’']/)[0]),
        status: store.status,
        payoutsReady: payouts.ready,
        feePercent: Number(store.fee_percent),
        instagram: store.instagram,
        items: ((items || []) as ItemRow[]).map(i => ({ name: i.name, kind: isItp(i) ? 'itp' : 'own', priceCents: i.price_cents, itpCostCents: i.itp_cost_cents, active: i.active })),
        orders: (orders || []).map((o: any) => ({ createdAt: o.created_at, totalCents: Math.round(Number(o.total) * 100), shareCents: o.metadata?.vendor_store?.split?.vendorShareCents ?? null }))
      },
      turns,
      file ? { mimeType: file.mimetype.replace(/;.*$/, '').replace('x-wav', 'wav'), data: file.buffer.toString('base64') } : undefined
    )
    req.log?.info({ slug: store.slug, voice: !!file, usage }, 'vendor-store assistant turn')
    return res.json({ heard, reply })
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
