import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import { supabase } from '../lib/supabase.js'
import { requireStorefrontSecret } from '../middleware/requireStorefrontSecret.js'

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
}

// GET /api/storefront/catalog — active ITP products an external storefront can list + sell.
router.get('/catalog', requireStorefrontSecret, async (_req: Request, res: Response): Promise<any> => {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, description, price, images, category, metadata, is_active')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(200)

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
    sizes: p.metadata?.sizes || undefined
  }))

  return res.json({ products, plusSizeUpchargeCents: Math.round(PLUS_SIZE_UPCHARGE * 100) })
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
    const { items, customer, successUrl, cancelUrl, externalRef, source } = req.body || {}

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array required' })
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Too many items (max 50)' })
    }

    const storefront = (typeof source === 'string' && source.trim()) ? source.trim() : 'earth019'
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
          .select('id, name, price, images, is_active')
          .eq('id', raw.productId)
          .single()

        if (error || !product) {
          return res.status(400).json({ error: `Unknown product: ${raw.productId}` })
        }
        if (product.is_active === false) {
          return res.status(400).json({ error: `Product not available: ${raw.productId}` })
        }

        const base = Number(product.price) || 0
        const unitAmount = Math.round((base + (isPlusSize(size) ? PLUS_SIZE_UPCHARGE : 0)) * 100)
        if (unitAmount < 50) {
          return res.status(400).json({ error: `Invalid price for product ${raw.productId}` })
        }

        lines.push({
          name: product.name || 'ITP Product',
          unitAmount,
          quantity,
          productId: product.id,
          designUrl: isHttpUrl(raw.designUrl) ? raw.designUrl : null,
          size,
          color,
          image: Array.isArray(product.images) ? product.images[0] : undefined
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
        shipping_amount: 0,
        discount_amount: 0,
        total: subtotalCents / 100,
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
        }
      }))
    )
    if (itemsError) {
      req.log?.error({ err: itemsError, orderId: order.id }, 'storefront: failed to insert order items')
    }

    const baseSuccess = isHttpUrl(successUrl) ? successUrl : DEFAULT_SUCCESS_URL
    const baseCancel = isHttpUrl(cancelUrl) ? cancelUrl : DEFAULT_CANCEL_URL

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
      success_url: withParams(baseSuccess, { order: encodeURIComponent(orderNumber), session_id: '{CHECKOUT_SESSION_ID}' }),
      cancel_url: baseCancel,
      shipping_address_collection: { allowed_countries: ['US'] },
      phone_number_collection: { enabled: true },
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

    return res.json({ url: session.url, orderId: order.id, orderNumber, sessionId: session.id })
  } catch (error: any) {
    req.log?.error({ err: error }, 'storefront checkout failed')
    return res.status(500).json({ error: 'Failed to create checkout', message: error.message })
  }
})

export default router
