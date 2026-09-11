import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'
import { checkOrderTransition } from '../lib/order-status.js'
import { processOrderCompletion, retryFailedRewards, scheduleRewardProcessing } from '../services/order-reward-service.js'
import { processReferralFirstPurchase } from '../services/referral-service.js'
import { attachProductFiles } from '../services/product-files.js'
import { verifyOrderStatusToken } from '../utils/order-status-token.js'
import { resolveCarrier } from '../utils/carrier-tracking.js'
import { sendOrderShippedEmail } from '../utils/email.js'
import { WAREHOUSE_ADDRESS_FROM } from './shipping.js'
import { syncOrderTracking } from '../services/order-tracking-sync.js'
import {
  makeTrackingSyncDeps,
  issueCouponForOrder,
  sendDeliveredWithCoupon,
  isMissingColumnError,
  TRACKING_ORDER_COLUMNS,
  LEGACY_ORDER_COLUMNS
} from '../services/order-tracking-deps.js'
import { STATUS_LABELS, type ShipmentStatus } from '../services/shipment-tracking.js'

const router = Router()

// GET /api/orders/status/:orderId?t=<token> — PUBLIC, no auth.
//
// Backs the tokenized order-status link in every transactional email so a guest
// buyer (no account, no session) can still see where their order is. The token
// is an HMAC of the order id, so this can't be walked or enumerated, and it
// returns a read-only, minimal projection — never the full order row.
router.get('/status/:orderId', async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const token = (req.query.t || req.query.token) as string | undefined

    if (!verifyOrderStatusToken(orderId, token)) {
      // Same response for a bad token and a missing order — don't leak existence.
      return res.status(404).json({ error: 'Order not found' })
    }

    const BASE_COLUMNS = `
        id, order_number, status, payment_status, fulfillment_status,
        subtotal, tax_amount, shipping_amount, discount_amount, total, currency,
        customer_name, customer_email, tracking_number, tracking_company,
        estimated_delivery, shipped_at, delivered_at, created_at, metadata`

    const loadOrder = (columns: string) =>
      supabase.from('orders').select(columns).eq('id', orderId).single()

    // The live-scan columns land with 20260911000000_order_live_tracking.sql;
    // before that they simply aren't shown. A guest checking their order must
    // never 404 because a migration is pending.
    let { data: order, error } = await loadOrder(
      `${BASE_COLUMNS}, tracking_status, tracking_status_detail, tracking_status_at, tracking_location, tracking_eta`
    ) as any

    if (error && isMissingColumnError(error)) {
      ({ data: order, error } = await loadOrder(BASE_COLUMNS) as any)
    }

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    // order_items has no price/total/image_url/variations columns — those
    // live as unit_price/subtotal/metadata.{image_url,size,color}. Fetched
    // separately (matching /my and /:orderId below) rather than embedded, so
    // a bad join can't 400 the whole lookup. Orders written before the
    // order_items table existed fall back to the orders.metadata.items
    // snapshot, same as every other order-reading route in this file.
    const { data: itemRows } = await supabase
      .from('order_items')
      .select('product_name, quantity, unit_price, subtotal, metadata')
      .eq('order_id', orderId)

    const items = (itemRows && itemRows.length > 0)
      ? itemRows.map((item: any) => {
          const snap = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {}
          return {
            product_name: item.product_name,
            quantity: item.quantity,
            price: item.unit_price ?? 0,
            total: item.subtotal ?? ((item.unit_price ?? 0) * (item.quantity || 1)),
            image_url: snap.image_url || null,
            variations: (snap.size || snap.color) ? { size: snap.size, color: snap.color } : undefined
          }
        })
      : ((order.metadata as any)?.items || []).map((item: any) => ({
          product_name: item.product?.name || item.name || 'Product',
          quantity: item.quantity || 1,
          price: item.product?.price ?? item.price ?? 0,
          total: (item.product?.price ?? item.price ?? 0) * (item.quantity || 1),
          image_url: item.product?.images?.[0] || item.image || item.imageUrl || item.image_url || null,
          variations: (item.size || item.selectedSize || item.color || item.selectedColor)
            ? { size: item.size ?? item.selectedSize, color: item.color ?? item.selectedColor }
            : undefined
        }))

    const tracking = order.tracking_number
      ? resolveCarrier(order.tracking_number, order.tracking_company)
      : null

    // Mask the email — enough for the buyer to recognise it, useless to anyone else.
    const maskedEmail = (order.customer_email || '').replace(
      /^(.)(.*)(@.*)$/,
      (_m: string, a: string, mid: string, domain: string) => `${a}${'•'.repeat(Math.min(mid.length, 6))}${domain}`
    )

    return res.json({
      order: {
        order_number: order.order_number,
        status: order.status,
        payment_status: order.payment_status,
        fulfillment_status: order.fulfillment_status,
        subtotal: order.subtotal,
        tax_amount: order.tax_amount,
        shipping_amount: order.shipping_amount,
        discount_amount: order.discount_amount,
        total: order.total,
        currency: order.currency,
        customer_name: order.customer_name,
        customer_email_masked: maskedEmail,
        tracking_number: order.tracking_number,
        carrier: tracking?.name || order.tracking_company || null,
        tracking_url: tracking?.trackingUrl || null,
        // Live carrier scan, as of the last poll — the same data the admin sees.
        tracking_status: order.tracking_status || null,
        tracking_status_label: order.tracking_status
          ? STATUS_LABELS[order.tracking_status as ShipmentStatus] || null
          : null,
        tracking_status_detail: order.tracking_status_detail || null,
        tracking_status_at: order.tracking_status_at || null,
        tracking_location: order.tracking_location || null,
        tracking_eta: order.tracking_eta || null,
        estimated_delivery: order.estimated_delivery,
        shipped_at: order.shipped_at,
        delivered_at: order.delivered_at,
        created_at: order.created_at,
        print: (order.metadata as any)?.print || null,
        items
      }
    })
  } catch (error: any) {
    console.error('[orders] Public status lookup failed:', error)
    return res.status(500).json({ error: 'Failed to load order status' })
  }
})

// GET /api/orders - Get all orders (admin/manager only)
router.get('/', requireAuth, requireRole(['admin', 'manager', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { status, limit = 100 } = req.query

    // First get orders
    let query = supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data: orders, error } = await query

    if (error) {
      console.error('[orders] Error fetching orders:', error)
      return res.status(500).json({ error: error.message })
    }

    // Try to get order items separately (may fail if table has different schema)
    const orderIds = (orders || []).map(o => o.id)
    let orderItemsMap: Record<string, any[]> = {}

    if (orderIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', orderIds)

      // Group items by order_id
      for (const item of items || []) {
        if (!orderItemsMap[item.order_id]) {
          orderItemsMap[item.order_id] = []
        }
        orderItemsMap[item.order_id].push(item)
      }
    }

    // Attach items to orders, parse metadata for items if no order_items
    const ordersWithItems = (orders || []).map(order => {
      const items = orderItemsMap[order.id] || []
      // If no items in order_items table, try to get from metadata.
      // This fallback used to emit a DIFFERENT shape from the real table —
      // price/total/variations/personalization/image_url, i.e. the four columns
      // that don't exist plus a flattened image — so any consumer had to handle
      // two contracts and the admin UI silently read undefined for size,
      // colour, print location and artwork. It now emits the SAME shape
      // order_items actually has (unit_price/subtotal/metadata), which is what
      // replaceOrderItems in routes/stripe.ts writes.
      if (items.length === 0 && order.metadata?.items) {
        return {
          ...order,
          order_items: order.metadata.items.map((item: any, i: number) => {
            const unitPrice = Number(item.product?.price ?? item.price) || 0
            const quantity = Number(item.quantity) || 1
            return {
              id: `snapshot-${order.id}-${i}`,
              order_id: order.id,
              product_id: item.product?.id ?? item.id ?? null,
              product_name: item.product?.name || item.name || 'Unknown Product',
              variant_id: null,
              variant_name: null,
              quantity,
              unit_price: unitPrice,
              subtotal: unitPrice * quantity,
              metadata: {
                client_product_id: item.product?.id ?? item.id ?? null,
                image_url: item.product?.images?.[0] || item.image || item.imageUrl || item.image_url || null,
                size: item.selectedSize ?? item.size ?? null,
                color: item.selectedColor ?? item.color ?? null,
                print_location: item.printLocation ?? item.print_location ?? null,
                custom_design: item.customDesign ?? item.custom_design ?? null,
                addons: item.selectedAddons ?? item.addons ?? null,
                addons_total: 0,
                // Marks a reconstruction, so nothing downstream mistakes this
                // for a real order_items row.
                from_snapshot: true
              }
            }
          })
        }
      }
      return { ...order, order_items: items }
    })

    // Production files (mockups / clean PNG / DTF / halftone) live on the
    // PRODUCT, not the order line, so the floor cannot see them without this.
    // One batched query for the whole page; a failure inside degrades to empty
    // bundles rather than failing the order list.
    const ordersWithFiles = await attachProductFiles(ordersWithItems)

    return res.json({ orders: ordersWithFiles })
  } catch (error: any) {
    console.error('[orders] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/orders/my - Get current user's orders
router.get('/my', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { limit = 50 } = req.query

    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (error) {
      console.error('[orders/my] Error fetching user orders:', error)
      return res.status(500).json({ error: error.message })
    }

    // Try to get order items separately
    const orderIds = (orders || []).map(o => o.id)
    let orderItemsMap: Record<string, any[]> = {}

    if (orderIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', orderIds)

      for (const item of items || []) {
        if (!orderItemsMap[item.order_id]) {
          orderItemsMap[item.order_id] = []
        }
        orderItemsMap[item.order_id].push(item)
      }
    }

    // Collect product IDs to fetch images in one query. Only valid uuids may
    // be queried: products.id is a uuid column, and a single custom
    // client-side id ('3d-print-<id>', 'imagination-sheet-<id>',
    // 'metal-art-custom-<ts>') used to abort the whole lookup with 22P02 and
    // strip images from every order in the response. Custom items render
    // from the order_items/orders metadata snapshot instead.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const allProductIds = new Set<string>()
    for (const order of orders || []) {
      const items = orderItemsMap[order.id] || []
      for (const item of items) {
        if (item.product_id && UUID_RE.test(String(item.product_id))) allProductIds.add(item.product_id)
      }
      // Also check metadata items
      if (order.metadata?.items) {
        for (const item of order.metadata.items) {
          if (item.id && UUID_RE.test(String(item.id))) allProductIds.add(item.id)
          if (item.product?.id && UUID_RE.test(String(item.product.id))) allProductIds.add(item.product.id)
        }
      }
    }

    // Fetch product images
    let productImagesMap: Record<string, string> = {}
    if (allProductIds.size > 0) {
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, images')
        .in('id', Array.from(allProductIds))

      if (productsError) {
        // Non-fatal — items fall back to their snapshot image
        console.error('[orders/my] Product image lookup failed:', productsError.message)
      }
      for (const product of products || []) {
        if (product.images && product.images.length > 0) {
          productImagesMap[product.id] = product.images[0]
        }
      }
    }

    // Attach items to orders, parse metadata for items if no order_items
    const ordersWithItems = (orders || []).map(order => {
      const items = orderItemsMap[order.id] || []
      const metaItems: any[] = Array.isArray(order.metadata?.items) ? order.metadata.items : []
      if (items.length === 0 && metaItems.length > 0) {
        // No order_items rows (all orders before the order_items schema fix)
        // — render from the orders.metadata.items snapshot.
        return {
          ...order,
          order_items: metaItems.map((item: any) => {
            const productId = item.product?.id || item.id
            const imageUrl = item.product?.images?.[0] || item.image || item.imageUrl || item.image_url || productImagesMap[productId] || null
            return {
              id: productId || 'unknown',
              product_id: productId,
              product_name: item.product?.name || item.name || 'Unknown Product',
              quantity: item.quantity || 1,
              price: item.product?.price ?? item.price ?? 0,
              total: (item.product?.price ?? item.price ?? 0) * (item.quantity || 1),
              image_url: imageUrl,
              variations: { size: item.size ?? item.selectedSize, color: item.color ?? item.selectedColor },
              personalization: (item.customDesign || item.custom_design) ? { designUrl: item.customDesign || item.custom_design } : {}
            }
          })
        }
      }
      // Items from order_items table — name/image/variations come from the
      // per-item metadata snapshot first (custom items have product_id null
      // and no products row), then the order-level snapshot, then products.
      const metaById = new Map<string, any>()
      const metaByName = new Map<string, any>()
      for (const m of metaItems) {
        const mid = m?.product?.id || m?.id
        if (mid && !metaById.has(String(mid))) metaById.set(String(mid), m)
        const mname = m?.product?.name || m?.name
        if (mname && !metaByName.has(String(mname))) metaByName.set(String(mname), m)
      }
      return {
        ...order,
        order_items: items.map((item: any) => {
          const snap = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {}
          const clientId = snap.client_product_id || item.product_id
          const meta = (clientId && metaById.get(String(clientId)))
            || (item.product_id && metaById.get(String(item.product_id)))
            || metaByName.get(String(item.product_name))
          const size = snap.size ?? meta?.size ?? meta?.selectedSize
          const color = snap.color ?? meta?.color ?? meta?.selectedColor
          const designUrl = snap.custom_design ?? meta?.customDesign
          return {
            ...item,
            product_id: clientId || item.product_id,
            price: item.unit_price ?? item.price ?? 0,
            total: item.subtotal ?? item.total ?? ((item.unit_price ?? 0) * (item.quantity || 1)),
            image_url: item.image_url || snap.image_url || meta?.image || (item.product_id && productImagesMap[item.product_id]) || null,
            variations: (size || color) ? { size, color } : (item.variations || {}),
            personalization: designUrl ? { designUrl } : (item.personalization || {})
          }
        })
      }
    })

    return res.json({ orders: ordersWithItems })
  } catch (error: any) {
    console.error('[orders/my] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/orders/:orderId - Get a single order by ID
router.get('/:orderId', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const userId = req.user?.sub

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    // Check if user owns this order (unless admin)
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single()

    const isAdmin = profile?.role === 'admin' || profile?.role === 'manager'
    if (order.user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Get order items
    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId)

    // If no items in table, try metadata
    let orderItems = items || []
    if (orderItems.length === 0 && order.metadata?.items) {
      orderItems = order.metadata.items.map((item: any) => ({
        id: item.product?.id || item.id || 'unknown',
        product_id: item.product?.id || item.id,
        product_name: item.product?.name || item.name || 'Unknown Product',
        quantity: item.quantity || 1,
        price: item.product?.price || item.price || 0,
        total: (item.product?.price || item.price || 0) * (item.quantity || 1),
        image_url: item.product?.images?.[0] || item.imageUrl || null,
        variations: { size: item.selectedSize, color: item.selectedColor }
      }))
    }

    return res.json({
      order: {
        ...order,
        order_items: orderItems
      }
    })
  } catch (error: any) {
    console.error('[orders/:orderId] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// ---------------------------------------------------------------------------
// Telling the customer their order moved.
//
// Every path that shipped an order used to go silent: PATCH /api/orders/:id
// (what all the Order Management status buttons call) and the Shippo label
// purchase both wrote tracking_number + status 'shipped' and sent nothing. The
// only code that ever mailed a shipping notice lives on
// PATCH /api/stripe/orders/:id/status, which no screen in the app calls — so in
// practice a buyer heard about their package only if they went looking for it.
//
// Fail-soft on purpose: a dead mail provider must never fail the admin's write.
// The order is already updated by the time this runs.
// ---------------------------------------------------------------------------
type NotifiableOrder = {
  id: string
  order_number?: string | null
  customer_email?: string | null
  customer_name?: string | null
  shipping_address?: any
  /** Set once a thank-you coupon has been minted — makes re-delivery idempotent. */
  delivery_coupon_code?: string | null
}

const buyerName = (order: NotifiableOrder): string | undefined =>
  order.customer_name ||
  [order.shipping_address?.firstName, order.shipping_address?.lastName]
    .filter(Boolean)
    .join(' ') ||
  undefined

const notifyShipped = async (
  order: NotifiableOrder,
  trackingNumber?: string | null,
  carrier?: string | null
): Promise<boolean> => {
  if (!order.customer_email) return false
  try {
    await sendOrderShippedEmail(
      order.customer_email,
      order.order_number || order.id,
      trackingNumber || undefined,
      carrier || undefined,
      { orderId: order.id, customerName: buyerName(order) }
    )
    return true
  } catch (error) {
    console.error('[orders] Shipped email failed:', error)
    return false
  }
}

// A delivered order earns its buyer a one-time thank-you coupon, whether it was
// the carrier (the tracking sweep) or an admin clicking "Delivered" that got
// there first. Both routes go through the same two calls so the customer
// experience can't differ, and `delivery_coupon_code` on the order keeps a
// re-click from minting a second code.
const notifyDelivered = async (order: NotifiableOrder): Promise<boolean> => {
  if (!order.customer_email) return false
  try {
    const coupon = await issueCouponForOrder(order as any).catch(err => {
      console.error('[orders] Delivery coupon failed (sending email without it):', err)
      return null
    })
    return await sendDeliveredWithCoupon(order as any, coupon)
  } catch (error) {
    console.error('[orders] Delivered email failed:', error)
    return false
  }
}

// PATCH /api/orders/:orderId - Update order status and/or notes (admin/manager)
//
// Replaces the direct-from-browser supabase writes that OrderManagement.tsx
// used to do. Those ran as the signed-in user under RLS, so they failed
// silently on any policy mismatch while the UI cheerfully showed the new
// value, and nothing validated the status at all.
router.patch('/:orderId', requireAuth, requireRole(['admin', 'manager', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const {
      status, internal_notes, notes,
      tracking_number, shipping_label_url, tracking_company, estimated_delivery
    } = req.body ?? {}

    const wantsStatus = status !== undefined
    const wantsInternalNotes = internal_notes !== undefined
    const wantsNotes = notes !== undefined
    const wantsTrackingNumber = tracking_number !== undefined
    const wantsShippingLabelUrl = shipping_label_url !== undefined
    const wantsTrackingCompany = tracking_company !== undefined
    const wantsEstimatedDelivery = estimated_delivery !== undefined

    if (!wantsStatus && !wantsInternalNotes && !wantsNotes && !wantsTrackingNumber &&
      !wantsShippingLabelUrl && !wantsTrackingCompany && !wantsEstimatedDelivery) {
      return res.status(400).json({ error: 'Nothing to update — provide status, internal_notes, notes, tracking_number, shipping_label_url, tracking_company or estimated_delivery' })
    }
    if (wantsStatus && typeof status !== 'string') {
      return res.status(400).json({ error: 'status must be a string' })
    }
    if (wantsInternalNotes && typeof internal_notes !== 'string') {
      return res.status(400).json({ error: 'internal_notes must be a string' })
    }
    if (wantsNotes && typeof notes !== 'string') {
      return res.status(400).json({ error: 'notes must be a string' })
    }
    if (wantsTrackingNumber && typeof tracking_number !== 'string') {
      return res.status(400).json({ error: 'tracking_number must be a string' })
    }
    if (wantsShippingLabelUrl && typeof shipping_label_url !== 'string') {
      return res.status(400).json({ error: 'shipping_label_url must be a string' })
    }
    if (wantsTrackingCompany && typeof tracking_company !== 'string') {
      return res.status(400).json({ error: 'tracking_company must be a string' })
    }
    if (wantsEstimatedDelivery && estimated_delivery !== null && typeof estimated_delivery !== 'string') {
      return res.status(400).json({ error: 'estimated_delivery must be a string or null' })
    }

    const loadOrder = (columns: string) =>
      supabase.from('orders').select(columns).eq('id', orderId).single()

    let { data: order, error: orderError } = await loadOrder(
      'id, status, order_number, customer_email, customer_name, shipping_address, tracking_number, tracking_company, delivery_coupon_code'
    ) as any

    // delivery_coupon_code arrives with 20260911000000_order_live_tracking.sql.
    // Until that is applied, asking for it would 404 every order update — the
    // whole admin status/notes/tracking panel — so fall back to the old shape.
    if (orderError && isMissingColumnError(orderError)) {
      ({ data: order, error: orderError } = await loadOrder(
        'id, status, order_number, customer_email, customer_name, shipping_address, tracking_number, tracking_company'
      ) as any)
    }

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() }

    if (wantsStatus) {
      const transition = checkOrderTransition(order.status, status)
      if (!transition.ok) {
        return res.status(409).json({ error: transition.reason })
      }
      if (transition.unknownFrom) {
        console.warn(`[orders] Order ${orderId} had unrecognised status "${order.status}" — allowing move to "${status}"`)
      }
      // A no-op re-send of the current status writes nothing, so repeated
      // clicks stay idempotent.
      if (transition.kind === 'move') {
        updateData.status = status
        if (status === 'shipped') {
          updateData.fulfillment_status = 'fulfilled'
          updateData.shipped_at = new Date().toISOString()
        }
        if (status === 'delivered') {
          updateData.fulfillment_status = 'delivered'
          updateData.delivered_at = new Date().toISOString()
        }
      }
    }

    // Saving a tracking number IS the shipment event, so an order that is
    // legally allowed to move to 'shipped' does so in the same write — the
    // admin should not have to remember a second click for the board and the
    // buyer to agree. The state machine stays the only authority on "legal":
    // pending (unpaid) and on_hold cannot reach shipped, and for those the
    // tracking still saves rather than 409-ing the whole request away.
    if (wantsTrackingNumber && !wantsStatus && tracking_number.trim().length > 0) {
      const autoShip = checkOrderTransition(order.status, 'shipped')
      if (autoShip.ok && autoShip.kind === 'move') {
        updateData.status = 'shipped'
        updateData.fulfillment_status = 'fulfilled'
        updateData.shipped_at = new Date().toISOString()
      }
    }

    if (wantsInternalNotes) updateData.internal_notes = internal_notes
    if (wantsNotes) updateData.notes = notes
    // Carrier label fields (Watchtower task f2b836ab): a purchased label is
    // written here, service-role, rather than from the browser under RLS —
    // the same silent-drop-on-policy-mismatch class of bug the status/notes
    // path above was already rewritten to avoid.
    if (wantsTrackingNumber) updateData.tracking_number = tracking_number
    if (wantsShippingLabelUrl) updateData.shipping_label_url = shipping_label_url
    if (wantsTrackingCompany) updateData.tracking_company = tracking_company
    if (wantsEstimatedDelivery) updateData.estimated_delivery = estimated_delivery

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select('id, status, internal_notes, notes, tracking_number, shipping_label_url, tracking_company, estimated_delivery, shipped_at, updated_at')
      .single()

    if (updateError || !updated) {
      console.error('[orders] Error updating order:', updateError)
      return res.status(500).json({ error: updateError?.message || 'Failed to update order' })
    }

    // Mail the buyer, but only on real news: a genuine move into shipped or
    // delivered, or a tracking number that actually changed value. Re-saving
    // the same values — a double-clicked status button, or editing the notes
    // afterwards — must not re-announce the shipment.
    const trackingChanged =
      wantsTrackingNumber &&
      tracking_number.trim().length > 0 &&
      tracking_number.trim() !== (order.tracking_number || '')

    let customerNotified: 'shipped' | 'delivered' | null = null

    if (updateData.status === 'delivered') {
      if (await notifyDelivered(order)) customerNotified = 'delivered'
    } else if (updateData.status === 'shipped' || trackingChanged) {
      // A tracking number IS the shipment event, so adding one notifies even
      // when the status was already 'shipped' (label bought first, number
      // corrected after).
      if (await notifyShipped(order, updated.tracking_number, updated.tracking_company)) {
        customerNotified = 'shipped'
      }
    }

    if (updateData.status) {
      await supabase.from('audit_logs').insert({
        user_id: req.user?.sub,
        action: 'order_status_updated',
        entity: 'order',
        entity_id: orderId,
        changes: { previous_status: order.status, new_status: updateData.status },
        created_at: new Date().toISOString()
      })
    }

    return res.json({ ok: true, order: updated, customerNotified })
  } catch (error: any) {
    console.error('[orders] PATCH error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// ---------------------------------------------------------------------------
// GET /api/orders/:orderId/tracking - live carrier status for one order
//
// Backs the "Shipping & Tracking" panel in Order Management. Until this
// existed, a tracking number on an order was a string nobody could see behind:
// the admin pasted it, and the only way to learn what the parcel did next was
// to open the carrier's website by hand.
//
// The poll is cached on the order row (tracking_checked_at), so opening the
// same order repeatedly costs one Shippo call every TRACKING_CACHE_MINUTES.
// `?refresh=1` forces a fresh read for the "Check now" button.
//
// Delivery is a side effect of reading: if the carrier says DELIVERED, this
// call is also what moves the order, mints the thank-you coupon and mails the
// customer — exactly the same path the background sweep takes.
// ---------------------------------------------------------------------------
const TRACKING_CACHE_MINUTES = Number(process.env.TRACKING_CACHE_MINUTES) > 0
  ? Number(process.env.TRACKING_CACHE_MINUTES)
  : 15

const TERMINAL_TRACKING_STATUSES = new Set(['delivered', 'returned', 'failure'])

/** The snapshot already stored on the order, shaped like a live read. */
const cachedTrackingPayload = (order: any) => {
  const info = order.tracking_number ? resolveCarrier(order.tracking_number, order.tracking_company) : null
  const status = (order.tracking_status || null) as ShipmentStatus | null
  return {
    trackingNumber: order.tracking_number,
    carrier: info?.name || order.tracking_company || null,
    trackingUrl: info?.trackingUrl || null,
    status,
    statusLabel: status ? STATUS_LABELS[status] || null : null,
    statusDetail: order.tracking_status_detail || null,
    statusAt: order.tracking_status_at || null,
    location: order.tracking_location || null,
    eta: order.tracking_eta || order.estimated_delivery || null,
    events: Array.isArray(order.tracking_events) ? order.tracking_events : [],
    checkedAt: order.tracking_checked_at || null,
    error: order.tracking_error || null
  }
}

router.get('/:orderId/tracking', requireAuth, requireRole(['admin', 'manager', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const force = req.query.refresh === '1' || req.query.refresh === 'true'

    const loadOrder = (columns: string) =>
      supabase.from('orders').select(columns).eq('id', orderId).single()

    let { data: order, error } = await loadOrder(TRACKING_ORDER_COLUMNS) as any
    // Pre-migration API + post-migration frontend is a real deploy state here
    // (Render and Vercel ship independently) — serve live data without the cache
    // rather than 500 the panel.
    let hasTrackingColumns = true
    if (error && isMissingColumnError(error)) {
      hasTrackingColumns = false
      ;({ data: order, error } = await loadOrder(LEGACY_ORDER_COLUMNS) as any)
    }

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    if (!order.tracking_number) {
      return res.json({ tracking: null, reason: 'no_tracking', cached: false })
    }

    const checkedAt = order.tracking_checked_at ? new Date(order.tracking_checked_at).getTime() : 0
    const ageMinutes = checkedAt ? (Date.now() - checkedAt) / 60000 : Infinity
    const settled = TERMINAL_TRACKING_STATUSES.has(String(order.tracking_status || ''))
    // A delivered parcel never changes again — don't spend a carrier call on it.
    const serveCache = hasTrackingColumns && !force && checkedAt > 0 && (settled || ageMinutes < TRACKING_CACHE_MINUTES)

    if (serveCache) {
      return res.json({ tracking: cachedTrackingPayload(order), cached: true })
    }

    const outcome = await syncOrderTracking(order, makeTrackingSyncDeps())

    if (outcome.skipped) {
      // No token / unknown carrier: the deep link is all we have, and saying so
      // plainly beats an empty panel the admin can't interpret.
      return res.json({
        tracking: cachedTrackingPayload(order),
        cached: hasTrackingColumns && checkedAt > 0,
        reason: outcome.skipped,
        message: outcome.error
      })
    }

    const live = outcome.tracking
    return res.json({
      cached: false,
      deliveredNow: outcome.deliveredNow,
      customerEmailed: outcome.emailed,
      couponCode: outcome.couponCode,
      error: outcome.error,
      tracking: live
        ? {
            trackingNumber: live.trackingNumber,
            carrier: live.carrier,
            trackingUrl: live.trackingUrl,
            status: live.status,
            statusLabel: STATUS_LABELS[live.status],
            statusDetail: live.statusDetail,
            statusAt: live.statusAt,
            location: live.location,
            eta: live.eta,
            service: live.service,
            events: live.events,
            checkedAt: new Date().toISOString(),
            error: null
          }
        : cachedTrackingPayload(order)
    })
  } catch (error: any) {
    console.error('[orders/:orderId/tracking] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/orders/:orderId/complete - Mark order as completed and award rewards
router.post('/:orderId/complete', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const adminId = req.user?.sub

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' })
    }

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    // Reject illegal jumps into 'completed' (notably pending -> completed,
    // which awarded rewards for an order nobody had paid for) and reject
    // dragging a cancelled/refunded order back out of its terminal state.
    const transition = checkOrderTransition(order.status, 'completed')
    if (!transition.ok) {
      return res.status(409).json({ error: transition.reason })
    }

    // Already completed: return the same success shape without re-running any
    // side effects. processOrderCompletion self-guards via order_rewards, but
    // the referral bonus and the audit log did not, so a second call used to
    // write a second audit row and re-enter the referral path.
    if (transition.kind === 'noop') {
      return res.json({
        ok: true,
        message: 'Order was already completed',
        order: { id: orderId, status: 'completed' },
        rewards: { success: true, alreadyProcessed: true }
      })
    }

    // Claim the transition atomically — .neq('status', 'completed') means a
    // second concurrent call updates zero rows and bails before the rewards.
    const { data: claimed, error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)
      .neq('status', 'completed')
      .select('id')

    if (updateError) {
      console.error('[orders/complete] Error updating order:', updateError)
      return res.status(500).json({ error: 'Failed to update order status' })
    }

    if (!claimed || claimed.length === 0) {
      return res.json({
        ok: true,
        message: 'Order was already completed',
        order: { id: orderId, status: 'completed' },
        rewards: { success: true, alreadyProcessed: true }
      })
    }

    // Process rewards
    const rewardResult = await processOrderCompletion({
      orderId: order.id,
      userId: order.user_id,
      orderTotal: order.total,
      orderNumber: orderId.slice(0, 8)
    })

    // Check if this is the user's first finished order and process the referral
    // bonus. `select('id', { count: 'exact' })` returns the rows AND a separate
    // `count` — the old code destructured only `data` and read `.length`, which
    // silently depends on no range/limit ever being applied. `head: true` asks
    // Postgrest for the count only.
    const { count: finishedOrderCount } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', order.user_id)
      .in('status', ['completed', 'delivered'])

    if (finishedOrderCount === 1) {
      // This is the first completed order, check for referral bonus.
      // processReferralFirstPurchase additionally self-guards on an existing
      // referral_transactions row (referral-service.ts:230).
      await processReferralFirstPurchase(order.user_id, order.total)
    }

    // Create audit log
    await supabase.from('audit_logs').insert({
      user_id: adminId,
      action: 'order_completed',
      entity: 'order',
      entity_id: orderId,
      changes: {
        status: 'completed',
        rewards_awarded: rewardResult.success
      },
      created_at: new Date().toISOString()
    })

    return res.json({
      ok: true,
      message: 'Order completed successfully',
      order: {
        id: orderId,
        status: 'completed'
      },
      rewards: rewardResult
    })
  } catch (error: any) {
    console.error('[orders/complete] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// ---------------------------------------------------------------------------
// Shipping label purchase
//
// This used to run IN THE BROWSER (src/utils/shippo.ts via
// VITE_SHIPPO_API_TOKEN). Anything VITE_-prefixed is compiled into the public
// bundle, so a live Shippo token would have shipped to every visitor — which is
// why the token was never set and label generation silently served mocks. The
// purchase now runs here with the server-only SHIPPO_API_TOKEN, and the order
// row is written with the service-role client so the update is not subject to
// the RLS policies that blocked the browser from persisting it at all.
// ---------------------------------------------------------------------------

const SHIPPO_BASE_URL = 'https://api.goshippo.com'

// Same USPS/UPS filter the checkout quote uses (backend/routes/shipping.ts) so
// admins buy a label from the set of carriers the customer was quoted.
function isQuotableRate(rate: any): boolean {
  const svc = rate?.servicelevel?.token?.toLowerCase() || ''
  const provider = rate?.provider?.toLowerCase() || ''
  return (provider === 'usps' && (svc.includes('priority') || svc.includes('express') || svc.includes('ground'))) ||
         (provider === 'ups' && (svc.includes('ground') || svc.includes('2nd') || svc.includes('next') || svc.includes('saver')))
}

/**
 * Normalize the order's shipping_address JSONB into Shippo's address shape.
 * Orders have been written by several checkout generations, so accept both the
 * `{ address, zipCode, firstName, lastName }` shape the storefront writes and
 * the `{ street1/address1, zip }` shape used elsewhere.
 */
function toShippoAddress(order: any) {
  const addr = order?.shipping_address || {}
  const name = order.customer_name
    || addr.name
    || [addr.firstName, addr.lastName].filter(Boolean).join(' ').trim()
    || 'Customer'

  return {
    name,
    company: addr.company || '',
    street1: addr.street1 || addr.address1 || addr.address || addr.line1 || '',
    street2: addr.street2 || addr.address2 || addr.line2 || '',
    city: addr.city || '',
    state: addr.state || addr.province || '',
    zip: addr.zip || addr.zipCode || addr.postal_code || addr.postalCode || '',
    country: addr.country || 'US',
    phone: addr.phone || '',
    email: order.customer_email || addr.email || ''
  }
}

/** Parcel weight in lb — 0.5 lb per unit, matching the checkout quote default. */
function parcelWeightLb(items: any[]): number {
  const total = (items || []).reduce((sum, item) => {
    const qty = Number(item?.quantity) || 1
    const unit = Number(item?.weight) || 0.5
    return sum + unit * qty
  }, 0)
  return Math.max(0.5, total)
}

/**
 * POST /api/orders/:orderId/shipping-label
 *
 * Creates the shipment, buys the label with the server-side SHIPPO_API_TOKEN,
 * persists tracking/label details on the order (service role, bypasses RLS) and
 * returns the label to the caller.
 *
 * Body (all optional): { rateId?: string, weightLb?: number }
 *
 * Buying a label spends real money, so this is admin/manager only and refuses
 * to buy a second label for an order that already has one.
 */
router.post('/:orderId/shipping-label', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const { rateId, weightLb: weightOverride } = req.body || {}

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    // Never buy twice. Return what we already have so the UI can just show it.
    const existingLabel = order.shipping_label_url || order.metadata?.shipping_label?.label_url
    if (existingLabel) {
      return res.json({
        ok: true,
        alreadyPurchased: true,
        label: {
          labelUrl: existingLabel,
          trackingNumber: order.tracking_number || null,
          carrier: order.tracking_company || null,
          estimatedDelivery: order.estimated_delivery || null
        }
      })
    }

    const addressTo = toShippoAddress(order)
    const missing = (['street1', 'city', 'state', 'zip'] as const).filter(field => !addressTo[field])
    if (missing.length > 0) {
      return res.status(400).json({ error: `Order shipping address is incomplete (missing: ${missing.join(', ')})` })
    }

    const { data: items } = await supabase
      .from('order_items')
      .select('quantity')
      .eq('order_id', orderId)

    const metaItems: any[] = Array.isArray(order.metadata?.items) ? order.metadata.items : []
    const weight = Number(weightOverride) > 0
      ? Number(weightOverride)
      : parcelWeightLb((items && items.length > 0) ? items : metaItems)

    const token = process.env.SHIPPO_API_TOKEN

    // Mock mode — keeps the admin flow usable without a token, exactly as the
    // old browser code did. Deliberately does NOT touch the order: a fake
    // tracking number on a real order would surface to the customer.
    if (!token) {
      console.warn('[orders/shipping-label] SHIPPO_API_TOKEN not set — returning a demo label, order not updated')
      return res.json({
        ok: true,
        mock: true,
        persisted: false,
        message: 'Shippo is not configured on the server (SHIPPO_API_TOKEN). This is a demo label and the order was not updated.',
        label: {
          labelUrl: 'https://shippo-delivery-east.s3.amazonaws.com/mock-label.pdf',
          trackingNumber: 'MOCK123456789',
          trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=MOCK123456789',
          carrier: 'USPS',
          service: 'Priority Mail',
          cost: 8.5,
          estimatedDelivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          weightLb: Math.round(weight * 100) / 100
        }
      })
    }

    // 1. Create the shipment to get live rates.
    const shipmentRes = await fetch(`${SHIPPO_BASE_URL}/shipments/`, {
      method: 'POST',
      headers: { 'Authorization': `ShippoToken ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address_from: WAREHOUSE_ADDRESS_FROM,
        address_to: addressTo,
        parcels: [{
          length: '10', width: '8', height: '4', distance_unit: 'in',
          weight: weight.toFixed(2), mass_unit: 'lb'
        }],
        async: false
      })
    })

    if (!shipmentRes.ok) {
      const detail = await shipmentRes.text().catch(() => '')
      console.error('[orders/shipping-label] Shippo /shipments failed:', shipmentRes.status, detail)
      return res.status(502).json({ error: `Shippo could not create the shipment (${shipmentRes.status})` })
    }

    const shipment = await shipmentRes.json() as { rates?: any[] }
    const allRates = shipment.rates || []
    const usable = allRates.filter(isQuotableRate)
    const candidates = usable.length > 0 ? usable : allRates

    if (candidates.length === 0) {
      console.error('[orders/shipping-label] Shippo returned no rates for order', orderId)
      return res.status(502).json({ error: 'No carrier rates available for this address. Check the USPS/UPS carrier accounts connected in Shippo.' })
    }

    // Caller may pin a rate; otherwise buy the cheapest usable one.
    const chosen = rateId
      ? candidates.find((rate: any) => rate.object_id === rateId)
      : [...candidates].sort((a: any, b: any) => parseFloat(a.amount) - parseFloat(b.amount))[0]

    if (!chosen) {
      return res.status(400).json({ error: 'Requested rate is not available for this shipment' })
    }

    // 2. Buy the label.
    const txRes = await fetch(`${SHIPPO_BASE_URL}/transactions/`, {
      method: 'POST',
      headers: { 'Authorization': `ShippoToken ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: chosen.object_id, label_file_type: 'PDF', async: false })
    })

    const transaction = await txRes.json().catch(() => ({})) as any

    if (!txRes.ok || transaction?.status !== 'SUCCESS' || !transaction?.label_url) {
      const messages = Array.isArray(transaction?.messages)
        ? transaction.messages.map((m: any) => m?.text).filter(Boolean).join('; ')
        : ''
      console.error('[orders/shipping-label] Shippo /transactions failed:', txRes.status, transaction?.status, messages)
      return res.status(502).json({ error: messages || `Shippo could not purchase the label (${txRes.status})` })
    }

    const label = {
      id: transaction.object_id,
      orderId,
      labelUrl: transaction.label_url,
      trackingNumber: transaction.tracking_number || null,
      trackingUrl: transaction.tracking_url_provider || null,
      carrier: chosen.provider || null,
      service: chosen.servicelevel?.name || chosen.servicelevel?.token || null,
      cost: parseFloat(chosen.amount) || 0,
      estimatedDelivery: transaction.eta || null,
      weightLb: Math.round(weight * 100) / 100,
      createdAt: new Date().toISOString()
    }

    // 3. Persist on the order with the service-role client (bypasses RLS).
    const now = new Date().toISOString()
    const orderUpdate: Record<string, any> = {
      tracking_number: label.trackingNumber,
      shipping_label_url: label.labelUrl,
      tracking_company: label.carrier,
      estimated_delivery: label.estimatedDelivery,
      status: 'shipped',
      fulfillment_status: 'fulfilled',
      shipped_at: now,
      updated_at: now,
      metadata: {
        ...(order.metadata && typeof order.metadata === 'object' ? order.metadata : {}),
        shipping_label: {
          transaction_id: label.id,
          label_url: label.labelUrl,
          tracking_url: label.trackingUrl,
          carrier: label.carrier,
          service: label.service,
          cost: label.cost,
          weight_lb: label.weightLb,
          purchased_at: now,
          purchased_by: req.user?.sub || null
        }
      }
    }

    let persisted = true
    let persistError: string | null = null
    let { error: updateError } = await supabase.from('orders').update(orderUpdate).eq('id', orderId)

    // orders.shipping_label_url was read by the UI for months but never created
    // by a migration (see supabase/migrations/20260727_orders_shipping_label_url.sql).
    // The label is already bought at this point, so on a missing-column error
    // retry without it rather than losing a paid label — metadata.shipping_label
    // still carries the URL and the response always returns it.
    if (updateError && /shipping_label_url/.test(updateError.message || '')) {
      console.error('[orders/shipping-label] orders.shipping_label_url is missing — apply supabase/migrations/20260727_orders_shipping_label_url.sql')
      const { shipping_label_url: _omitted, ...withoutLabelColumn } = orderUpdate
      void _omitted
      const retry = await supabase.from('orders').update(withoutLabelColumn).eq('id', orderId)
      updateError = retry.error
    }

    if (updateError) {
      // Do NOT fail the request — the label is paid for. Hand it back with a
      // loud flag so the admin can still print and file it.
      persisted = false
      persistError = updateError.message
      console.error('[orders/shipping-label] Label purchased but order update failed:', updateError)
    }

    // Buying the label is the moment the order ships, so this is where the
    // buyer hears about it. Notify even when the order row failed to persist —
    // the label is paid for and the tracking number is real either way.
    const customerNotified = (await notifyShipped(order, label.trackingNumber, label.carrier))
      ? 'shipped'
      : null

    await supabase.from('audit_logs').insert({
      user_id: req.user?.sub,
      action: 'shipping_label_purchased',
      entity: 'order',
      entity_id: orderId,
      changes: {
        carrier: label.carrier,
        service: label.service,
        cost: label.cost,
        tracking_number: label.trackingNumber,
        persisted,
        customer_notified: customerNotified !== null
      },
      created_at: now
    })

    return res.json({ ok: true, mock: false, persisted, persistError, customerNotified, label })
  } catch (error: any) {
    console.error('[orders/shipping-label] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/orders/:orderId/retry-rewards - Retry failed reward processing
router.post('/:orderId/retry-rewards', requireAuth, requireRole(['admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params

    const result = await retryFailedRewards(orderId)

    return res.json({
      ok: result.success,
      result
    })
  } catch (error: any) {
    console.error('[orders/retry-rewards] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/orders/process-pending-rewards - Batch process pending rewards
router.post('/process-pending-rewards', requireAuth, requireRole(['admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await scheduleRewardProcessing()

    return res.json({
      ok: true,
      result
    })
  } catch (error: any) {
    console.error('[orders/process-pending-rewards] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/orders/:orderId/rewards - Get reward details for an order
router.get('/:orderId/rewards', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const userId = req.user?.sub

    // Get order to verify user owns it
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('user_id')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    // Check if user owns the order or is admin
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single()

    if (order.user_id !== userId && profile?.role !== 'admin' && profile?.role !== 'manager') {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Get reward details
    const { data: reward, error: rewardError } = await supabase
      .from('order_rewards')
      .select(`
        *,
        points_transaction:points_transactions(*),
        itc_transaction:itc_transactions(*)
      `)
      .eq('order_id', orderId)
      .single()

    if (rewardError) {
      return res.json({
        ok: true,
        reward: null,
        message: 'No rewards found for this order'
      })
    }

    return res.json({
      ok: true,
      reward
    })
  } catch (error: any) {
    console.error('[orders/rewards] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/orders/:orderId/confirmation — public, minimal order-status lookup
// for the post-checkout confirmation page (src/pages/OrderSuccess.tsx).
//
// WHY THIS EXISTS (Watchtower task 6079bd09): OrderSuccess used to read
// order_id off the query string (inventing one from Date.now() if absent)
// and render a full "Order Confirmed!" screen with NO backend call at all —
// visiting /order-success?order_id=anything showed a fake confirmation for
// an order that may not exist or may not have been paid.
//
// No requireAuth: checkout is guest-friendly (optionalAuth on
// /checkout-payment-intent), so a guest has no session to prove ownership
// with. The order UUID itself is the capability, same pattern Stripe's own
// Checkout success page and most storefronts use — 122 bits of entropy,
// never enumerable, only ever seen by the person who just placed the order
// (in the redirect URL) or an admin. Deliberately returns a MINIMAL field
// set (no street address, no line items, no payment_intent_id) — just
// enough for the confirmation screen to render real state instead of
// trusting the URL.
router.get('/:orderId/confirmation', async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRe.test(orderId)) {
      return res.status(400).json({ error: 'Invalid order id' })
    }

    const { data: order, error } = await supabase
      .from('orders')
      .select('id, order_number, status, payment_status, fulfillment_status, total, currency, customer_name, customer_email, created_at')
      .eq('id', orderId)
      .single()

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }

    return res.json({ order })
  } catch (error: any) {
    console.error('[orders/:orderId/confirmation] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
