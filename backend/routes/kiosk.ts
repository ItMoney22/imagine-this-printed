import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { supabase } from '../lib/supabase.js'
import { requireKioskSession, hashKioskToken } from '../middleware/requireKioskSession.js'

const router = Router()

// Session lifetime. ASSUMPTION (no existing convention to follow — noted in
// the campaign handoff): 12h covers a full retail shift on one device
// without forcing a re-provision mid-shift. Shorter than that and a busy
// kiosk risks dropping mid-day; longer and a stolen/lost device stays
// trusted too long after last use. Revisit if real usage patterns differ.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

// Verifies a kiosk ID + device secret pair against the DB and returns the
// matching device row, or null for ANY failure reason (kiosk missing,
// kiosk inactive, wrong secret, revoked device) — deliberately one outcome
// shape so the caller can't leak which reason it was. Extracted from the
// route handler so it's directly unit-testable — see kiosk.test.ts, which
// is the proof for acceptance criterion "a kiosk session cannot be
// obtained without a valid per-device secret".
export async function verifyKioskDeviceSecret(kioskId: string, deviceSecret: string): Promise<{ id: string } | null> {
  const { data: kiosk } = await supabase
    .from('kiosks')
    .select('id, is_active')
    .eq('id', kioskId)
    .maybeSingle()

  if (!kiosk || !kiosk.is_active) return null

  // Device secrets are looked up by their SHA-256 hash (never stored raw).
  // A plain indexed hash-equality lookup is the standard, secure pattern
  // for hashed API keys (what it needs to resist is forging a secret from
  // the hash, not a timing side-channel on hash comparison — that
  // property only matters when comparing a raw shared secret directly,
  // e.g. requireStorefrontSecret.ts's safeEqual()).
  const secretHash = hashKioskToken(deviceSecret)
  const { data: device } = await supabase
    .from('kiosk_devices')
    .select('id')
    .eq('kiosk_id', kioskId)
    .eq('secret_hash', secretHash)
    .is('revoked_at', null)
    .maybeSingle()

  return device ?? null
}

// POST /api/kiosk/session — exchange a kiosk ID + per-device provisioning
// secret for a short-lived session token. This is the ONLY way a browser
// can obtain kiosk data or place a kiosk order now — see the comment block
// in supabase/migrations/20260728_kiosk_device_sessions.sql for why the
// previous URL-param auto-login (KioskAuthContext reading :kioskId and
// minting a User client-side) was insecure, and
// backend/routes/admin/kiosk-devices.ts for how a device secret is issued.
router.post('/session', async (req: Request, res: Response) => {
  try {
    const { kioskId, deviceSecret } = req.body || {}
    if (!kioskId || typeof kioskId !== 'string' || !deviceSecret || typeof deviceSecret !== 'string') {
      res.status(400).json({ error: 'kioskId and deviceSecret are required' })
      return
    }

    const device = await verifyKioskDeviceSecret(kioskId, deviceSecret)

    // One generic failure for "kiosk doesn't exist", "kiosk inactive" and
    // "wrong secret" alike — distinct error messages would let an attacker
    // enumerate valid kiosk IDs by response shape alone.
    if (!device) {
      res.status(401).json({ error: 'Invalid kiosk ID or device secret' })
      return
    }

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = hashKioskToken(rawToken)
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()

    const { error: insertError } = await supabase.from('kiosk_sessions').insert({
      kiosk_id: kioskId,
      device_id: device.id,
      token_hash: tokenHash,
      expires_at: expiresAt
    })

    if (insertError) {
      console.error('[kiosk/session] Failed to create session:', insertError)
      res.status(500).json({ error: 'Failed to create kiosk session' })
      return
    }

    await supabase.from('kiosk_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', device.id)

    // Deliberately NOT `select('*')` — commission_rate/partner_commission_rate
    // are exactly the fields the dropped "All users can view active kiosks"
    // RLS policy used to leak (see the migration's audit note); the session
    // payload only carries what the terminal UI actually renders.
    const { data: fullKiosk } = await supabase
      .from('kiosks')
      .select('id, name, location, settings, vendor_id, kiosk_user_id, access_url, total_sales, total_orders, created_at')
      .eq('id', kioskId)
      .maybeSingle()

    res.json({
      sessionToken: rawToken,
      expiresAt,
      kiosk: fullKiosk ? {
        id: fullKiosk.id,
        name: fullKiosk.name,
        location: fullKiosk.location,
        settings: fullKiosk.settings,
        vendorId: fullKiosk.vendor_id,
        kioskUserId: fullKiosk.kiosk_user_id,
        accessUrl: fullKiosk.access_url,
        totalSales: fullKiosk.total_sales,
        totalOrders: fullKiosk.total_orders,
        createdAt: fullKiosk.created_at,
        // Always true here — the session was only minted because the
        // active-kiosk check above passed.
        isActive: true
      } : null
    })
  } catch (err: any) {
    console.error('[kiosk/session] Unexpected error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /api/kiosk/products — the authenticated kiosk's vendor's sellable
// catalog. vendorId comes from the verified session (req.kioskSession),
// never from a query param — a kiosk can only ever see its own vendor's
// products.
router.get('/products', requireKioskSession, async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.kioskSession!

    const { data, error } = await supabase
      .from('products')
      .select('id, name, description, price, images, category, in_stock, vendor_id, approved, created_at')
      .eq('vendor_id', vendorId)
      .eq('approved', true)
      .eq('status', 'active') // matches the public "All users can view approved products" RLS filter
      .eq('in_stock', true)

    if (error) {
      console.error('[kiosk/products] Failed to fetch products:', error)
      res.status(500).json({ error: 'Failed to fetch products' })
      return
    }

    res.json((data || []).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      price: p.price,
      images: p.images || [],
      category: p.category,
      inStock: p.in_stock,
      vendorId: p.vendor_id,
      approved: p.approved,
      createdAt: p.created_at
    })))
  } catch (err: any) {
    console.error('[kiosk/products] Unexpected error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/kiosk/orders — creates a REAL row in `orders` + `order_items`.
// This is the fix for the actual business bug behind this task: the old
// kiosk-service.ts mock never touched the database at all, so a customer
// paying cash at a kiosk left zero record anywhere.
//
// Prices and the vendor are re-resolved server-side from `products` rather
// than trusted from the request body — a compromised/tampered kiosk client
// could otherwise submit an arbitrary total.
router.post('/orders', requireKioskSession, async (req: Request, res: Response) => {
  try {
    const { items, paymentMethod, customerName, customerEmail, customerPhone } = req.body || {}
    const { kioskId, deviceId, vendorId } = req.kioskSession!

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items array is required' })
      return
    }
    if (!['card', 'cash', 'itc_wallet'].includes(paymentMethod)) {
      res.status(400).json({ error: 'Invalid paymentMethod' })
      return
    }

    const productIds = [...new Set(items.map((i: any) => i?.product?.id).filter(Boolean))]
    if (productIds.length === 0) {
      res.status(400).json({ error: 'items must reference valid products' })
      return
    }

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, price')
      .in('id', productIds)
      .eq('vendor_id', vendorId)
      .eq('approved', true)
      .eq('status', 'active')

    if (productsError || !products || products.length === 0) {
      res.status(400).json({ error: "No valid products found for this kiosk's vendor" })
      return
    }
    const productById = new Map(products.map(p => [p.id, p]))

    let subtotal = 0
    const orderItemsPayload: any[] = []
    for (const item of items) {
      const product = productById.get(item?.product?.id)
      const quantity = Number(item?.quantity) || 0
      if (!product || quantity <= 0) continue
      const lineTotal = product.price * quantity
      subtotal += lineTotal
      orderItemsPayload.push({
        product_id: product.id,
        product_name: product.name,
        quantity,
        price: product.price,
        total: lineTotal,
        vendor_id: vendorId
      })
    }

    if (orderItemsPayload.length === 0) {
      res.status(400).json({ error: 'No valid line items' })
      return
    }

    const { data: kiosk } = await supabase
      .from('kiosks')
      .select('commission_rate, partner_commission_rate')
      .eq('id', kioskId)
      .maybeSingle()

    // Same rate fallbacks + 7% platform fee the old mock used
    // (kiosk-service.ts createKioskOrder) — preserved so commission math
    // doesn't silently change for kiosks that predate this migration.
    const vendorCommissionRate = kiosk?.commission_rate ?? 0.25
    const partnerCommissionRate = kiosk?.partner_commission_rate ?? 0.05
    const platformFeeRate = 0.07

    const commission = {
      vendorAmount: subtotal * vendorCommissionRate,
      platformFee: subtotal * platformFeeRate,
      partnerCommission: subtotal * partnerCommissionRate
    }

    const namePart = (typeof customerName === 'string' && customerName.trim() ? customerName : 'Guest').split(' ')[0].toUpperCase()
    const idPart = Math.floor(1000 + Math.random() * 9000)
    const customerIdentifier = `${namePart}-${idPart}`

    const orderNumber = `KIOSK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        customer_email: customerEmail || null,
        customer_name: customerName || null,
        subtotal,
        total: subtotal,
        status: 'pending',
        payment_status: 'pending',
        payment_method: paymentMethod,
        source: 'kiosk',
        metadata: {
          kioskId,
          deviceId,
          customerPhone: customerPhone || null,
          customerIdentifier,
          commission
        }
      })
      .select('id, order_number, total, created_at')
      .single()

    if (orderError || !order) {
      console.error('[kiosk/orders] Failed to create order:', orderError)
      res.status(500).json({ error: 'Failed to create order' })
      return
    }

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItemsPayload.map(i => ({ ...i, order_id: order.id })))

    if (itemsError) {
      console.error('[kiosk/orders] Failed to create order items:', itemsError)
      // Roll back the order shell rather than leaving an itemless row a
      // vendor dashboard would render as a $0 mystery order.
      await supabase.from('orders').delete().eq('id', order.id)
      res.status(500).json({ error: 'Failed to create order items' })
      return
    }

    res.json({
      id: order.id,
      kioskId,
      vendorId,
      items,
      total: order.total,
      paymentMethod,
      paymentStatus: 'pending',
      customerName,
      customerEmail,
      customerPhone,
      customerIdentifier,
      commission,
      createdAt: order.created_at
    })
  } catch (err: any) {
    console.error('[kiosk/orders] Unexpected error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/kiosk/orders/:orderId/complete — marks a kiosk order paid.
router.post('/orders/:orderId/complete', requireKioskSession, async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params
    const { kioskId } = req.kioskSession!
    const { paymentIntentId } = req.body || {}

    const { data: existing } = await supabase
      .from('orders')
      .select('id, metadata, source')
      .eq('id', orderId)
      .maybeSingle()

    // A kiosk may only complete an order that IS its own — checked against
    // the order's stored kioskId, never trusted from the request. Without
    // this, a valid session for kiosk A could mark any order in the system
    // (any kiosk's, or a regular web order) as paid.
    if (!existing || existing.source !== 'kiosk' || existing.metadata?.kioskId !== kioskId) {
      res.status(404).json({ error: 'Order not found' })
      return
    }

    const completedAt = new Date().toISOString()
    const { data: updated, error } = await supabase
      .from('orders')
      .update({
        status: 'completed',
        payment_status: 'completed',
        payment_intent_id: paymentIntentId || null,
        metadata: { ...existing.metadata, completedAt }
      })
      .eq('id', orderId)
      .select('id, total, payment_method, customer_name, customer_email, created_at, metadata')
      .single()

    if (error || !updated) {
      console.error('[kiosk/orders/complete] Failed to complete order:', error)
      res.status(500).json({ error: 'Failed to complete order' })
      return
    }

    res.json({
      id: updated.id,
      kioskId,
      total: updated.total,
      paymentMethod: updated.payment_method,
      paymentStatus: 'completed',
      customerName: updated.customer_name,
      customerEmail: updated.customer_email,
      customerIdentifier: updated.metadata?.customerIdentifier,
      commission: updated.metadata?.commission,
      createdAt: updated.created_at,
      completedAt: updated.metadata?.completedAt
    })
  } catch (err: any) {
    console.error('[kiosk/orders/complete] Unexpected error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
