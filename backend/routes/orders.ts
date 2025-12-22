import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'
import { processOrderCompletion, retryFailedRewards, scheduleRewardProcessing } from '../services/order-reward-service.js'
import { processReferralFirstPurchase } from '../services/referral-service.js'

const router = Router()

// GET /api/orders - Get all orders (admin/manager only)
router.get('/', requireAuth, requireRole(['admin', 'manager', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { status, limit = 100 } = req.query

    let query = supabase
      .from('orders')
      .select(`
        *,
        order_items (
          id,
          product_id,
          product_name,
          quantity,
          price,
          total,
          variations,
          personalization
        )
      `)
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) {
      console.error('[orders] Error fetching orders:', error)
      return res.status(500).json({ error: error.message })
    }

    return res.json({ orders: data || [] })
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

    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          id,
          product_id,
          product_name,
          quantity,
          price,
          total,
          variations,
          personalization
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (error) {
      console.error('[orders/my] Error fetching user orders:', error)
      return res.status(500).json({ error: error.message })
    }

    return res.json({ orders: data || [] })
  } catch (error: any) {
    console.error('[orders/my] Error:', error)
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

    // Update order status to completed
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId)

    if (updateError) {
      console.error('[orders/complete] Error updating order:', updateError)
      return res.status(500).json({ error: 'Failed to update order status' })
    }

    // Process rewards
    const rewardResult = await processOrderCompletion({
      orderId: order.id,
      userId: order.user_id,
      orderTotal: order.total,
      orderNumber: orderId.slice(0, 8)
    })

    // Check if this is user's first purchase and process referral bonus
    const { data: orderCount } = await supabase
      .from('orders')
      .select('id', { count: 'exact' })
      .eq('user_id', order.user_id)
      .in('status', ['completed', 'delivered'])

    if (orderCount && orderCount.length === 1) {
      // This is the first completed order, check for referral bonus
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
      .eq('user_id', userId)
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

export default router
