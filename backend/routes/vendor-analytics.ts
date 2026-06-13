import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { requireVendorOrAdmin } from '../middleware/requireVendorOrAdmin.js'

const router = Router()

/**
 * GET /api/vendor/analytics — real sales numbers for the signed-in vendor.
 * Replaces the hardcoded mock in VendorDashboard (totalSales: 542.30 forever).
 * Service-role queries because RLS (correctly) hides other customers' orders
 * from vendors; this aggregates only the vendor's own product line items.
 */
router.get('/analytics', requireAuth, requireVendorOrAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const vendorId = req.user!.sub

    const { data: products, error: pErr } = await supabase
      .from('products')
      .select('id')
      .eq('vendor_id', vendorId)
    if (pErr) return res.status(500).json({ error: pErr.message })

    const productIds = (products || []).map((p: any) => p.id)
    const commissionRate = 25
    if (productIds.length === 0) {
      return res.json({ totalSales: 0, thisMonth: 0, pendingPayout: 0, orderCount: 0, commissionRate })
    }

    const { data: items, error: iErr } = await supabase
      .from('order_items')
      .select('order_id, total')
      .in('product_id', productIds)
    if (iErr) return res.status(500).json({ error: iErr.message })

    const orderIds = [...new Set((items || []).map((i: any) => i.order_id))]
    const paidOrders = new Map<string, string>() // order id -> created_at
    if (orderIds.length > 0) {
      const { data: orders } = await supabase
        .from('orders')
        .select('id, created_at')
        .in('id', orderIds)
        .eq('payment_status', 'paid')
      for (const o of orders || []) paidOrders.set(o.id, o.created_at)
    }

    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    let totalSales = 0
    let thisMonth = 0
    const countedOrders = new Set<string>()
    for (const it of items || []) {
      const createdAt = paidOrders.get(it.order_id)
      if (!createdAt) continue // unpaid/draft orders don't count
      const amount = Number(it.total) || 0
      totalSales += amount
      if (new Date(createdAt) >= monthStart) thisMonth += amount
      countedOrders.add(it.order_id)
    }

    return res.json({
      totalSales: Math.round(totalSales * 100) / 100,
      thisMonth: Math.round(thisMonth * 100) / 100,
      // Estimated earnings owed at the vendor commission rate. A true payout
      // ledger (minus already-paid Stripe Connect transfers) is a follow-up.
      pendingPayout: Math.round(totalSales * commissionRate) / 100,
      orderCount: countedOrders.size,
      commissionRate,
    })
  } catch (error: any) {
    req.log?.error?.({ err: error }, '[vendor-analytics] failed')
    return res.status(500).json({ error: error.message || 'analytics failed' })
  }
})

export default router
