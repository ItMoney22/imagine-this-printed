// Admin ops-monitor status: worker heartbeat, stalled orders, pending
// approvals, low blank stock, AI-job failures, 24h order/revenue pulse.
// Powers the AdminDashboard overview "Ops Monitor" panel.
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'
import { getStalledOrders, getWorkerHeartbeat } from '../../services/order-monitor.js'

const router = Router()

router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [worker, stalledOrders, ordersRes, approvalsRes, blanksRes, failedJobsRes] = await Promise.all([
      getWorkerHeartbeat(),
      getStalledOrders(),
      supabase.from('orders').select('total, payment_status').gt('created_at', since24h),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
      supabase.from('blank_inventory').select('qty_on_hand, reorder_threshold'),
      supabase.from('ai_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gt('updated_at', since24h)
    ])

    const paid = (ordersRes.data || []).filter(o => o.payment_status === 'paid')
    const lowStockCount = (blanksRes.data || []).filter(b => b.qty_on_hand <= b.reorder_threshold).length

    return res.json({
      worker,
      database: { ok: !ordersRes.error },
      orders_24h: { paid: paid.length, revenue: paid.reduce((s, o) => s + (Number(o.total) || 0), 0) },
      stalled_orders: stalledOrders,
      pending_approvals: approvalsRes.count ?? 0,
      low_stock_count: lowStockCount,
      ai_jobs_failed_24h: failedJobsRes.count ?? 0,
      checked_at: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('[admin/monitor] status failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
