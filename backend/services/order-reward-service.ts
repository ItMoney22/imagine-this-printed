/**
 * Order Reward Service
 *
 * Handles automatic reward processing when orders are completed
 */

import { supabase } from '../lib/supabase.js'
import {
  calculateOrderRewards,
  getCurrentPromoMultiplier,
  validateRewardCalculation,
  formatRewardMessage
} from '../utils/reward-calculator.js'

export interface OrderCompletionEvent {
  orderId: string
  userId: string
  orderTotal: number
  orderNumber?: string
  metadata?: Record<string, any>
}

export interface RewardResult {
  success: boolean
  orderId: string
  itcAwarded: number
  tier: string
  message: string
  error?: string
}

/**
 * Process order completion and award rewards
 */
export async function processOrderCompletion(event: OrderCompletionEvent): Promise<RewardResult> {
  const { orderId, userId, orderTotal, orderNumber } = event

  try {
    console.log(`[OrderRewardService] Processing rewards for order ${orderId}`)

    // 1. Check if rewards already awarded
    const { data: existingReward } = await supabase
      .from('order_rewards')
      .select('id, status')
      .eq('order_id', orderId)
      .single()

    if (existingReward) {
      console.log(`[OrderRewardService] Rewards already awarded for order ${orderId}`)
      return {
        success: false,
        orderId,
        itcAwarded: 0,
        tier: 'unknown',
        message: 'Rewards already awarded for this order',
        error: 'Duplicate reward attempt'
      }
    }

    // 2. Get current promotional multiplier
    const promoMultiplier = getCurrentPromoMultiplier()

    // 3. Call the database function to award rewards
    const { data: result, error } = await supabase.rpc('award_order_rewards', {
      p_order_id: orderId,
      p_user_id: userId,
      p_order_total: orderTotal,
      p_promo_multiplier: promoMultiplier
    })

    if (error) {
      console.error(`[OrderRewardService] Error awarding rewards:`, error)
      throw error
    }

    if (!result || !result.success) {
      throw new Error(result?.error || 'Failed to award rewards')
    }

    // 4. Log success
    console.log(`[OrderRewardService] Rewards awarded successfully:`, {
      orderId,
      itc: result.itc_awarded,
      tier: result.tier
    })

    // 5. Create audit log
    await createAuditLog({
      userId,
      action: 'order_rewards_awarded',
      entity: 'order',
      entityId: orderId,
      changes: {
        itc: result.itc_awarded,
        tier: result.tier,
        promo_multiplier: promoMultiplier
      }
    })

    // 6. Send notification to user (optional - would integrate with notification service)
    const message = formatRewardMessage(
      {
        itc: result.itc_awarded,
        baseITC: result.itc_awarded,
        tierBonus: 0,
        promoBonus: 0,
        reason: 'Order completed'
      },
      orderNumber || orderId.slice(0, 8)
    )

    return {
      success: true,
      orderId,
      itcAwarded: result.itc_awarded,
      tier: result.tier,
      message
    }
  } catch (error: any) {
    console.error(`[OrderRewardService] Failed to process order completion:`, error)

    // Log failure in order_rewards table
    await supabase.from('order_rewards').insert({
      order_id: orderId,
      user_id: userId,
      order_total: orderTotal,
      status: 'failed',
      metadata: {
        error: error.message,
        timestamp: new Date().toISOString()
      }
    })

    return {
      success: false,
      orderId,
      itcAwarded: 0,
      tier: 'unknown',
      message: 'Failed to award rewards',
      error: error.message
    }
  }
}

/**
 * Bulk process multiple order completions
 */
export async function processBatchOrderCompletions(
  events: OrderCompletionEvent[]
): Promise<RewardResult[]> {
  console.log(`[OrderRewardService] Processing ${events.length} order completions`)

  const results = await Promise.allSettled(
    events.map(event => processOrderCompletion(event))
  )

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value
    } else {
      return {
        success: false,
        orderId: events[index].orderId,
        itcAwarded: 0,
        tier: 'unknown',
        message: 'Processing failed',
        error: result.reason?.message || 'Unknown error'
      }
    }
  })
}

/**
 * Retry failed reward processing
 */
export async function retryFailedRewards(orderId: string): Promise<RewardResult> {
  try {
    // Get the failed reward record
    const { data: failedReward, error: fetchError } = await supabase
      .from('order_rewards')
      .select('*')
      .eq('order_id', orderId)
      .eq('status', 'failed')
      .single()

    if (fetchError || !failedReward) {
      throw new Error('Failed reward record not found')
    }

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('user_id, total')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      throw new Error('Order not found')
    }

    // Delete failed record
    await supabase.from('order_rewards').delete().eq('id', failedReward.id)

    // Retry processing
    return await processOrderCompletion({
      orderId,
      userId: order.user_id,
      orderTotal: order.total
    })
  } catch (error: any) {
    console.error(`[OrderRewardService] Failed to retry rewards for ${orderId}:`, error)
    return {
      success: false,
      orderId,
      itcAwarded: 0,
      tier: 'unknown',
      message: 'Retry failed',
      error: error.message
    }
  }
}

/**
 * Get reward summary for an order
 */
export async function getOrderRewardSummary(orderId: string) {
  const { data, error } = await supabase
    .from('order_rewards')
    .select(`
      *,
      points_transaction:points_transactions(*),
      itc_transaction:itc_transactions(*)
    `)
    .eq('order_id', orderId)
    .single()

  if (error) {
    console.error('[OrderRewardService] Error fetching reward summary:', error)
    return null
  }

  return data
}

/**
 * Get pending orders that need reward processing
 */
export async function getPendingRewardOrders() {
  // Find orders that are completed/delivered but don't have rewards
  const { data: completedOrders, error } = await supabase
    .from('orders')
    .select('id, user_id, total, created_at, status')
    .in('status', ['delivered', 'completed'])
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[OrderRewardService] Error fetching pending orders:', error)
    return []
  }

  // Filter out orders that already have rewards
  const ordersWithoutRewards = []
  for (const order of completedOrders || []) {
    const { data: reward } = await supabase
      .from('order_rewards')
      .select('id')
      .eq('order_id', order.id)
      .single()

    if (!reward) {
      ordersWithoutRewards.push(order)
    }
  }

  return ordersWithoutRewards
}

/**
 * Create audit log entry
 */
async function createAuditLog(log: {
  userId: string
  action: string
  entity: string
  entityId: string
  changes?: Record<string, any>
}) {
  try {
    await supabase.from('audit_logs').insert({
      user_id: log.userId,
      action: log.action,
      entity: log.entity,
      entity_id: log.entityId,
      changes: log.changes,
      created_at: new Date().toISOString()
    })
  } catch (error) {
    console.error('[OrderRewardService] Failed to create audit log:', error)
  }
}

/**
 * Schedule automatic reward processing for completed orders
 * This would be called by a cron job or order status change webhook
 */
export async function scheduleRewardProcessing() {
  console.log('[OrderRewardService] Starting scheduled reward processing...')

  const pendingOrders = await getPendingRewardOrders()

  if (pendingOrders.length === 0) {
    console.log('[OrderRewardService] No pending orders to process')
    return
  }

  console.log(`[OrderRewardService] Found ${pendingOrders.length} orders needing rewards`)

  const events: OrderCompletionEvent[] = pendingOrders.map(order => ({
    orderId: order.id,
    userId: order.user_id,
    orderTotal: order.total
  }))

  const results = await processBatchOrderCompletions(events)

  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  console.log(`[OrderRewardService] Batch processing complete: ${successful} successful, ${failed} failed`)

  return {
    total: results.length,
    successful,
    failed,
    results
  }
}
