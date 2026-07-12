import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import multer from 'multer'
import { nanoid } from 'nanoid'
import { supabase } from '../lib/supabase.js'
import { requireStorefrontSecret } from '../middleware/requireStorefrontSecret.js'
import { uploadImageFromBuffer } from '../services/google-cloud-storage.js'
import { slugify, generateUniqueSlug } from '../utils/slugify.js'

// Headless checkout API for external storefronts (earth019.com). A trusted
// storefront server POSTs a mixed cart; ITP resolves catalog prices server-side,
// persists a pending ITP order (so it lands in normal order management with the
// design attached for printing), and returns a Stripe-hosted Checkout URL. The
// buyer pays on Stripe and returns to the storefront — ITP never has to render a
// checkout UI for them. Payment is confirmed by the EXISTING Stripe webhook:
// because we stamp { orderId, orderNumber } into payment_intent_data.metadata,
// `payment_intent.succeeded` flows through handleCheckoutOrderPayment and flips
// the order to paid with no webhook changes.
const router = Router()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia'
})

// Plus-size upcharge — mirrors src/context/CartContext.tsx so external storefronts
// price ITP catalog items EXACTLY like the ITP store does.
const PLUS_SIZES = ['2XL', '2X', 'XXL', '3XL', '3X', 'XXXL', '4XL', '4X', 'XXXXL', '5XL', '5X', 'XXXXXL']
const PLUS_SIZE_UPCHARGE = 2.50
const isPlusSize = (size?: string): boolean =>
  !!size && PLUS_SIZES.some(ps => size.toUpperCase().includes(ps))

const DEFAULT_SUCCESS_URL = process.env.STOREFRONT_SUCCESS_URL || 'https://earth019.com/checkout/success'
const DEFAULT_CANCEL_URL = process.env.STOREFRONT_CANCEL_URL || 'https://earth019.com/cart'

// D1 cost model for creator (Merch Studio) products: ITP base cost per shirt,
// plus an extra-location upcharge when a back print ships too. Env-overridable
// so the back-print $ can be tuned without a deploy. (Creator margin at sale
// time = retail − cost_price − fee share; see services/creator-margins.ts.)
const BASE_COST_USD = (() => {
  const v = Number(process.env.STOREFRONT_BASE_COST_USD)
  return Number.isFinite(v) && v > 0 ? v : 10
})()
const BACK_PRINT_UPCHARGE_USD = (() => {
  const v = Number(process.env.STOREFRONT_BACK_PRINT_UPCHARGE_USD)
  return Number.isFinite(v) && v >= 0 ? v : 5
})()

// Multipart upload for creator product publishes: print files are PNG
// (300 DPI at print size, transparent bg — DPI is enforced by the publishing
// studio; ITP re-checks at review), mockups may be png/jpg/webp composites.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'front_print' || file.fieldname === 'back_print') {
      cb(null, file.mimetype === 'image/png')
    } else {
      cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
    }
  }
})

// Accepts either a JSON array string ('["Black","White"]') or CSV ('Black,White').
function parseListField(raw: unknown, max = 30): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  let values: unknown[] = []
  try {
    const parsed = JSON.parse(raw)
    values = Array.isArray(parsed) ? parsed : []
  } catch {
    values = raw.split(',')
  }
  return [...new Set(
    values
      .filter((v): v is string => typeof v === 'string')
      .map(v => v.trim())
      .filter(Boolean)
  )].slice(0, max)
}

const isHttpUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function withParams(base: string, params: Record<string, string>): string {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`
}

type ResolvedLine = {
  name: string
  unitAmount: number // cents
  quantity: number
  productId: string | null
  designUrl: string | null
  size?: string
  color?: string
  image?: string
  printFiles?: { front?: string; back?: string } | null
}

// GET /api/storefront/catalog — sellable ITP products an external storefront can list.
//
// Liveness gate (reconciled 2026-07-10): sellable = status 'active' AND
// is_active true. is_active DEFAULTS TRUE in the live DB, so filtering on it
// alone leaked 2,000+ draft (unapproved) products into external storefronts;
// status alone misses admin-deactivated items. Both flags together are the
// single source of truth — the approval flow now sets both (see
// routes/admin/user-product-approvals.ts).
//
// Creator scoping: a creator-mapped key (STOREFRONT_CREATOR_KEYS) only sees
// products its ITP user created — e.g. Darrell's /shop lists only Darrell's
// merch. The legacy earth019 key has no creator mapping and keeps the full
// (unscoped) catalog.
router.get('/catalog', requireStorefrontSecret, async (req: Request, res: Response): Promise<any> => {
  let query = supabase
    .from('products')
    .select('id, name, description, price, images, category, metadata, is_active, status, sizes, colors, print_locations, created_by_user_id')
    .eq('is_active', true)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(200)

  const creatorUserId = req.storefront?.creatorUserId
  if (creatorUserId) {
    query = query.eq('created_by_user_id', creatorUserId)
  }

  const { data, error } = await query

  if (error) {
    return res.status(500).json({ error: 'Failed to load catalog', message: error.message })
  }

  const products = (data || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceCents: Math.round((Number(p.price) || 0) * 100),
    image: Array.isArray(p.images) ? p.images[0] : undefined,
    images: Array.isArray(p.images) ? p.images : [],
    category: p.category,
    sizes: (Array.isArray(p.sizes) && p.sizes.length ? p.sizes : p.metadata?.sizes) || undefined,
    colors: Array.isArray(p.colors) && p.colors.length ? p.colors : undefined,
    printLocations: Array.isArray(p.print_locations) && p.print_locations.length ? p.print_locations : undefined
  }))

  return res.json({
    products,
    plusSizeUpchargeCents: Math.round(PLUS_SIZE_UPCHARGE * 100),
    ...(creatorUserId ? { vendor: req.storefront?.vendor } : {})
  })
})

// POST /api/storefront/checkout — create a hosted Stripe Checkout Session for a
// mixed cart and persist a pending ITP order tagged with the storefront source.
//
// Body: {
//   items: Array<
//     | { type: 'catalog', productId, quantity?, size?, color?, designUrl? }   // price resolved server-side
//     | { type: 'custom',  name, priceCents, quantity?, designUrl?, imageUrl?, garment?, size?, color? }
//   >,
//   customer?: { email?, name?, firstName?, lastName?, shipping? },
//   successUrl?, cancelUrl?, externalRef?, source?
// }
router.post('/checkout', requireStorefrontSecret, async (req: Request, res: Response): Promise<any> => {
  try {
    const { items, customer, successUrl, cancelUrl, externalRef, source, embedded, shippingCents, shippingLabel } = req.body || {}

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' })
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Too many items (max 50)' })
    }

    // Shipping chosen on the storefront (from /api/shipping/rates — the Shippo
    // flow) rides in as a fixed amount + label. Trusted like custom pricing:
    // the storefront key is authenticated. Clamped to something sane.
    const shipCents = Math.max(0, Math.min(20000, parseInt(shippingCents, 10) || 0))
    const shipLabel = (typeof shippingLabel === 'string' && shippingLabel.trim())
      ? shippingLabel.trim().slice(0, 80)
      : 'Shipping'
    // A storefront that collected the buyer's address itself (embedded flow)
    // passes customer.shipping — then Stripe skips re-collecting it.
    const providedAddress = customer?.shipping && typeof customer.shipping === 'object' &&
      (customer.shipping.address || customer.shipping.street1) && (customer.shipping.zipCode || customer.shipping.zip)
      ? customer.shipping
      : null
    const useEmbedded = embedded === true

    const storefront = (typeof source === 'string' && source.trim())
      ? source.trim()
      : (req.storefront?.vendor || 'earth019')
    const lines: ResolvedLine[] = []

    for (const raw of items) {
      const quantity = Math.max(1, Math.min(99, parseInt(raw?.quantity, 10) || 1))
      const size = typeof raw?.size === 'string' ? raw.size : undefined
      const color = typeof raw?.color === 'string' ? raw.color : undefined

      if (raw?.type === 'catalog') {
        if (!raw.productId) {
          return res.status(400).json({ error: 'catalog item missing productId' })
        }
        const { data: product, error } = await supabase
          .from('products')
          .select('id, name, price, images, is_active, status, metadata')
          .eq('id', raw.productId)
          .single()

        if (error || !product) {
          return res.status(400).json({ error: `Unknown product: ${raw.productId}` })
        }
        // Same liveness gate as /catalog: only status-active AND is_active
        // products are sellable (is_active defaults true, so drafts passed the
        // old is_active-only check and were purchasable).
        if (product.is_active === false || product.status !== 'active') {
          return res.status(400).json({ error: `Product not available: ${raw.productId}` })
        }

        const base = Number(product.price) || 0
        const unitAmount = Math.round((base + (isPlusSize(size) ? PLUS_SIZE_UPCHARGE : 0)) * 100)
        if (unitAmount < 50) {
          return res.status(400).json({ error: `Invalid price for product ${raw.productId}` })
        }

        // Creator (Merch Studio) products carry their print-ready files on the
        // product itself — default the fulfillment design URL from them so the
        // DTF queue always has the art even when the storefront omits designUrl.
        const printFiles = (product.metadata?.print_files && typeof product.metadata.print_files === 'object')
          ? product.metadata.print_files as { front?: string; back?: string }
          : null

        lines.push({
          name: product.name || 'ITP Product',
          unitAmount,
          quantity,
          productId: product.id,
          designUrl: isHttpUrl(raw.designUrl) ? raw.designUrl : (isHttpUrl(printFiles?.front) ? printFiles!.front! : null),
          size,
          color,
          image: Array.isArray(product.images) ? product.images[0] : undefined,
          printFiles
        })
      } else {
        // Custom storefront item — price is TRUSTED from the authenticated storefront
        // (it owns its own art-on-shirt pricing). Still validated against Stripe's floor.
        const unitAmount = parseInt(raw?.priceCents, 10)
        if (!Number.isFinite(unitAmount) || unitAmount < 50) {
          return res.status(400).json({ error: 'custom item requires priceCents >= 50' })
        }
        const name = (typeof raw?.name === 'string' && raw.name.trim()) ? raw.name.trim() : 'Custom Item'
        const designUrl = isHttpUrl(raw?.designUrl) ? raw.designUrl : (isHttpUrl(raw?.imageUrl) ? raw.imageUrl : null)

        lines.push({
          name,
          unitAmount,
          quantity,
          productId: null,
          designUrl,
          size,
          color,
          image: isHttpUrl(raw?.imageUrl) ? raw.imageUrl : (designUrl || undefined)
        })
      }
    }

    const subtotalCents = lines.reduce((sum, l) => sum + l.unitAmount * l.quantity, 0)
    if (subtotalCents < 50) {
      return res.status(400).json({ error: 'Order total below Stripe minimum ($0.50)' })
    }

    const orderNumber = `ITP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
    const email = customer?.email || null
    const customerName = customer?.name
      || [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').trim()
      || null

    // Persist a pending order so it lands in normal ITP order management.
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: null, // external storefront buyers are guests on ITP
        customer_email: email,
        customer_name: customerName,
        subtotal: subtotalCents / 100,
        tax_amount: 0,
        shipping_amount: shipCents / 100,
        discount_amount: 0,
        total: (subtotalCents + shipCents) / 100,
        currency: 'USD',
        status: 'pending',
        payment_status: 'pending',
        fulfillment_status: 'unfulfilled',
        payment_method: 'stripe',
        shipping_address: customer?.shipping || {},
        discount_codes: [],
        source: storefront,
        metadata: {
          storefront,
          external_ref: externalRef || null,
          items: lines.map(l => ({
            id: l.productId,
            name: l.name,
            price: l.unitAmount / 100,
            quantity: l.quantity,
            image: l.image,
            designUrl: l.designUrl,
            size: l.size,
            color: l.color
          }))
        }
      })
      .select()
      .single()

    if (orderError) {
      req.log?.error({ err: orderError }, 'storefront: failed to create order')
      return res.status(500).json({ error: 'Failed to create order', message: orderError.message })
    }

    // Order items — live order_items schema is unit_price/subtotal/metadata.
    // The old price/total/variations/personalization columns DON'T exist, so this
    // insert was silently failing (logged, non-fatal) and external-storefront
    // orders had NO line items. Map to the real columns and keep the design URL,
    // size, color + client product id in metadata (the print bridge reads
    // metadata.client_product_id / design_url to fulfill). product_id must be a
    // UUID or null (external ids aren't ITP UUIDs).
    const { error: itemsError } = await supabase.from('order_items').insert(
      lines.map(l => ({
        order_id: order.id,
        product_id: (typeof l.productId === 'string' && UUID_RE.test(l.productId)) ? l.productId : null,
        product_name: l.name,
        quantity: l.quantity,
        unit_price: l.unitAmount / 100,
        subtotal: (l.unitAmount * l.quantity) / 100,
        metadata: {
          client_product_id: l.productId ?? null,
          design_url: l.designUrl ?? null,
          image_url: l.image ?? null,
          size: l.size ?? null,
          color: l.color ?? null,
          // Both placements for the DTF operator when the product ships with
          // print-ready files (design_url alone only carries the front).
          ...(l.printFiles ? { print_files: l.printFiles } : {}),
        }
      }))
    )
    if (itemsError) {
      req.log?.error({ err: itemsError, orderId: order.id }, 'storefront: failed to insert order items')
    }

    const baseSuccess = isHttpUrl(successUrl) ? successUrl : DEFAULT_SUCCESS_URL
    const baseCancel = isHttpUrl(cancelUrl) ? cancelUrl : DEFAULT_CANCEL_URL

    const successWithParams = withParams(baseSuccess, { order: encodeURIComponent(orderNumber), session_id: '{CHECKOUT_SESSION_ID}' })
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lines.map(l => ({
        quantity: l.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: l.unitAmount,
          product_data: {
            name: l.name,
            ...(isHttpUrl(l.image) ? { images: [l.image] } : {})
          }
        }
      })),
      ...(email ? { customer_email: email } : {}),
      // Embedded mode renders inside the storefront's own page (no redirect);
      // hosted mode keeps the classic success/cancel redirect pair.
      ...(useEmbedded
        ? { ui_mode: 'embedded' as const, return_url: successWithParams }
        : { success_url: successWithParams, cancel_url: baseCancel }),
      // The chosen carrier rate (from /api/shipping/rates) becomes the Stripe
      // shipping line so the buyer pays it with the order.
      ...(shipCents > 0
        ? {
            shipping_options: [{
              shipping_rate_data: {
                type: 'fixed_amount' as const,
                display_name: shipLabel,
                fixed_amount: { amount: shipCents, currency: 'usd' }
              }
            }]
          }
        : {}),
      // Skip re-collecting the address when the storefront already captured it
      // (that address is what the rate was quoted against, and it's on the order).
      ...(providedAddress ? {} : { shipping_address_collection: { allowed_countries: ['US'] } }),
      phone_number_collection: { enabled: !providedAddress },
      metadata: { orderId: order.id, orderNumber, source: storefront },
      // This is the bridge to ITP's existing webhook: payment_intent.succeeded ->
      // handleCheckoutOrderPayment marks the order paid + emails the buyer.
      payment_intent_data: {
        description: `Order ${orderNumber} (${storefront})`,
        metadata: { orderId: order.id, orderNumber, userId: '', itcCreditAmount: '0', itcCreditUSD: '0' }
      }
    })

    await supabase
      .from('orders')
      .update({ metadata: { ...order.metadata, stripe_session_id: session.id } })
      .eq('id', order.id)

    req.log?.info({
      orderId: order.id,
      orderNumber,
      storefront,
      amount: subtotalCents / 100,
      itemCount: lines.length,
      sessionId: session.id
    }, 'storefront checkout session created')

    if (useEmbedded) {
      // client_secret mounts Stripe's Embedded Checkout on the storefront's own
      // page; the publishable key is public by design and pairs with it.
      return res.json({
        clientSecret: session.client_secret,
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
        orderId: order.id,
        orderNumber,
        sessionId: session.id
      })
    }
    return res.json({ url: session.url, orderId: order.id, orderNumber, sessionId: session.id })
  } catch (error: any) {
    req.log?.error({ err: error }, 'storefront checkout failed')
    return res.status(500).json({ error: 'Failed to create checkout', message: error.message })
  }
})

// POST /api/storefront/products — a trusted creator storefront (Darrell V2
// Merch Studio) publishes a designed product INTO ITP. Requires a
// creator-mapped key (STOREFRONT_CREATOR_KEYS); the legacy unscoped key is
// rejected because there is no creator to own the product.
//
// multipart/form-data:
//   front_print  PNG file, REQUIRED — print-ready front art (300 DPI at print
//                size, transparent bg; the studio enforces DPI before publish)
//   back_print   PNG file, optional — print-ready back art (adds the
//                extra-location upcharge to cost_price)
//   mockups      up to 10 images (png/jpg/webp) — per-color composites shown
//                in the review queue and on /shop
//   name         REQUIRED
//   retailPrice  REQUIRED, dollars ("24.99"); must beat cost or publish fails
//   description  optional
//   colors       optional — JSON array or CSV ("Black,White")
//   sizes        optional — JSON array or CSV ("S,M,L,XL,2XL")
//   placement    optional — JSON blob of designer transforms (stored verbatim)
//   externalRef  optional — the storefront's draft id, echoed for reconciliation
//
// The product is created AS the mapped creator: created_by_user_id=<creator>,
// is_user_generated=true, status='pending_approval',
// cost_price=$10 base (+$5 back upcharge; env-tunable). Files land in ITP GCS
// storage; the product lands in the existing admin approval queue
// (metadata.user_submitted + status='pending_approval'), and on approval goes
// live on the creator's scoped /catalog.
router.post('/products', requireStorefrontSecret, (req: Request, res: Response, next) => {
  upload.fields([
    { name: 'front_print', maxCount: 1 },
    { name: 'back_print', maxCount: 1 },
    { name: 'mockups', maxCount: 10 }
  ])(req, res, (err: any) => {
    if (err) return res.status(400).json({ error: 'Upload failed', message: err.message })
    next()
  })
}, async (req: Request, res: Response): Promise<any> => {
  try {
    const creatorUserId = req.storefront?.creatorUserId
    const vendor = req.storefront?.vendor || 'storefront'
    if (!creatorUserId) {
      return res.status(403).json({ error: 'This storefront key has no creator mapping — product publishing requires a creator-scoped key' })
    }

    const files = (req.files || {}) as { [field: string]: Express.Multer.File[] }
    const frontPrint = files.front_print?.[0]
    const backPrint = files.back_print?.[0]
    const mockupFiles = files.mockups || []

    if (!frontPrint) {
      return res.status(400).json({ error: 'front_print PNG is required' })
    }

    const name = (typeof req.body.name === 'string' ? req.body.name : '').trim()
    if (!name) {
      return res.status(400).json({ error: 'name is required' })
    }

    const retailUsd = Number(req.body.retailPrice ?? (Number(req.body.retailPriceCents) / 100))
    if (!Number.isFinite(retailUsd) || retailUsd <= 0) {
      return res.status(400).json({ error: 'retailPrice (dollars) is required' })
    }

    // D1 cost: base + extra-location upcharge when a back print ships.
    const costUsd = BASE_COST_USD + (backPrint ? BACK_PRINT_UPCHARGE_USD : 0)
    if (retailUsd <= costUsd) {
      return res.status(400).json({
        error: `Retail price must exceed base cost ($${costUsd.toFixed(2)})`,
        costUsd,
        retailUsd
      })
    }

    const description = (typeof req.body.description === 'string' && req.body.description.trim())
      ? req.body.description.trim()
      : null
    const colors = parseListField(req.body.colors)
    const sizes = parseListField(req.body.sizes)
    const externalRef = (typeof req.body.externalRef === 'string' && req.body.externalRef.trim())
      ? req.body.externalRef.trim()
      : null
    let placement: any = null
    if (typeof req.body.placement === 'string' && req.body.placement.trim()) {
      try { placement = JSON.parse(req.body.placement) } catch { /* stored as null; not fatal */ }
    }

    // Store print files + mockups in ITP storage (GCS) — ITP owns everything
    // after Publish.
    const batchId = nanoid(10)
    const basePath = `merch-studio/${vendor}/${batchId}`
    const frontUpload = await uploadImageFromBuffer(frontPrint.buffer, `${basePath}/front.png`, 'image/png')
    const backUpload = backPrint
      ? await uploadImageFromBuffer(backPrint.buffer, `${basePath}/back.png`, 'image/png')
      : null
    const mockupUrls: string[] = []
    for (let i = 0; i < mockupFiles.length; i++) {
      const f = mockupFiles[i]
      const ext = f.mimetype === 'image/jpeg' ? 'jpg' : f.mimetype === 'image/webp' ? 'webp' : 'png'
      const uploaded = await uploadImageFromBuffer(f.buffer, `${basePath}/mockup-${i + 1}.${ext}`, f.mimetype)
      mockupUrls.push(uploaded.publicUrl)
    }

    // Resolve the shirts category WITHOUT clobbering its display name (the
    // AI-flow upsert pattern overwrites `name`; a select-then-insert doesn't).
    let categoryId: string | null = null
    const { data: existingCategory } = await supabase
      .from('product_categories')
      .select('id')
      .eq('slug', 'shirts')
      .maybeSingle()
    if (existingCategory) {
      categoryId = existingCategory.id
    } else {
      const { data: newCategory } = await supabase
        .from('product_categories')
        .insert({ slug: 'shirts', name: 'Shirts' })
        .select('id')
        .single()
      categoryId = newCategory?.id ?? null
    }

    // Unique slug (same pattern as the AI product flows).
    const baseSlug = slugify(name)
    const { data: existingProducts } = await supabase
      .from('products')
      .select('slug')
      .like('slug', `${baseSlug}%`)
    const uniqueSlug = generateUniqueSlug(baseSlug, existingProducts?.map((p: any) => p.slug).filter(Boolean) || [])

    const printLocations = backUpload ? ['front_image', 'back_image'] : ['front_image']
    const printFiles: { front: string; back?: string } = { front: frontUpload.publicUrl }
    if (backUpload) printFiles.back = backUpload.publicUrl

    const { data: product, error: productError } = await supabase
      .from('products')
      .insert({
        category_id: categoryId,
        name,
        slug: uniqueSlug,
        description: description || `${name} — custom shirt`,
        price: retailUsd,
        cost_price: costUsd,
        status: 'pending_approval', // lands in the existing admin approval queue
        is_active: true, // sellable gate is status+is_active; status holds it back until approval
        images: mockupUrls.length ? mockupUrls : [frontUpload.publicUrl],
        category: 'shirts',
        print_locations: printLocations,
        ...(sizes.length ? { sizes } : {}),
        ...(colors.length ? { colors } : {}),
        is_user_generated: true,
        created_by_user_id: creatorUserId,
        metadata: {
          user_submitted: true, // approval-queue filter key
          creator_id: creatorUserId,
          source: 'merch-studio',
          storefront_vendor: vendor,
          external_ref: externalRef,
          placement,
          print_files: printFiles,
          mockup_url: mockupUrls[0] || null,
          // Direct-print product: the uploaded 300-DPI transparent PNG IS the
          // print-ready deliverable, so it doubles as clean art + DTF file.
          // The approval completeness gate skips AI-generation artifacts
          // (halftone) for products carrying print_files.
          assets: {
            clean: frontUpload.publicUrl,
            dtf: frontUpload.publicUrl,
            ...(backUpload ? { back_print: backUpload.publicUrl } : {}),
            mockups: mockupUrls,
          },
          cost_breakdown: {
            base_usd: BASE_COST_USD,
            back_upcharge_usd: backUpload ? BACK_PRINT_UPCHARGE_USD : 0,
          },
          submitted_at: new Date().toISOString(),
        },
      })
      .select('id, slug, status')
      .single()

    if (productError) {
      req.log?.error({ err: productError, vendor }, 'storefront: product create failed')
      return res.status(500).json({ error: 'Failed to create product', message: productError.message })
    }

    req.log?.info({
      productId: product.id,
      vendor,
      creatorUserId,
      retailUsd,
      costUsd,
      backPrint: !!backUpload,
      mockups: mockupUrls.length
    }, 'storefront: creator product submitted for approval')

    return res.status(201).json({
      productId: product.id,
      slug: product.slug,
      status: product.status, // 'pending_approval'
      name,
      retailUsd,
      costUsd,
      files: {
        front: frontUpload.publicUrl,
        ...(backUpload ? { back: backUpload.publicUrl } : {}),
        mockups: mockupUrls,
      },
    })
  } catch (error: any) {
    req.log?.error({ err: error }, 'storefront: product create crashed')
    return res.status(500).json({ error: 'Failed to create product', message: error.message })
  }
})

// GET /api/storefront/products/status — creator-scoped review-status pull, so an
// external storefront can reconcile its local design records with ITP's approval
// pipeline. The /catalog only lists SELLABLE products, so an approval is visible
// there but a REJECTION never is — this endpoint reports both, keyed by product
// id + the externalRef the storefront sent at publish time.
//
// Requires a creator-mapped key (same 403 rule as POST /products — the legacy
// unscoped key has no creator whose products it could report on).
//
// Query: ?ids=<csv of product uuids> narrows the report (max 200); without it,
// every product this vendor published (metadata.storefront_vendor) is returned,
// newest first (max 500).
//
// Response: { vendor, products: [{ productId, externalRef, status,
// rejectionReason, rawStatus }] } where `status` collapses ITP internals to the
// storefront contract:
//   'active'           — approved AND sellable (status 'active' + is_active)
//   'rejected'         — sent back (reason from metadata.rejection_reason)
//   'pending_approval' — anything else (in queue, incomplete, deactivated)
router.get('/products/status', requireStorefrontSecret, async (req: Request, res: Response): Promise<any> => {
  try {
    const creatorUserId = req.storefront?.creatorUserId
    const vendor = req.storefront?.vendor || 'storefront'
    if (!creatorUserId) {
      return res.status(403).json({ error: 'This storefront key has no creator mapping — status reporting requires a creator-scoped key' })
    }

    const ids = (typeof req.query.ids === 'string' ? req.query.ids : '')
      .split(',')
      .map(s => s.trim())
      .filter(s => UUID_RE.test(s))
      .slice(0, 200)

    let query = supabase
      .from('products')
      .select('id, status, is_active, metadata')
      .eq('created_by_user_id', creatorUserId)

    if (ids.length > 0) {
      query = query.in('id', ids)
    } else {
      query = query
        .eq('metadata->>storefront_vendor', vendor)
        .order('created_at', { ascending: false })
        .limit(500)
    }

    const { data, error } = await query
    if (error) {
      return res.status(500).json({ error: 'Failed to load product statuses', message: error.message })
    }

    const products = (data || []).map((p: any) => {
      const rejected = p.status === 'rejected'
      return {
        productId: p.id,
        externalRef: p.metadata?.external_ref ?? null,
        status: (p.status === 'active' && p.is_active !== false) ? 'active'
          : rejected ? 'rejected'
          : 'pending_approval',
        rawStatus: p.status,
        rejectionReason: rejected ? (p.metadata?.rejection_reason ?? null) : null,
      }
    })

    return res.json({ vendor, products })
  } catch (error: any) {
    req.log?.error({ err: error }, 'storefront: product status report failed')
    return res.status(500).json({ error: 'Failed to load product statuses', message: error.message })
  }
})

export default router
