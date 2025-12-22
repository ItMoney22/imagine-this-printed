import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'

const router = Router()

// GET /api/admin/control-panel/settings - Get platform settings
router.get('/settings', requireAuth, requireRole(['admin', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('*')
      .in('category', ['fees', 'payouts'])

    if (error) {
      console.error('[control-panel] Error fetching settings:', error)
      return res.status(500).json({ error: error.message })
    }

    // Convert key-value pairs to object
    const settings: Record<string, any> = {}
    let lastUpdated: string | null = null

    for (const row of data || []) {
      const key = row.setting_key
      let value: any = row.setting_value

      // Parse numeric values
      if (['platform_fee_percentage', 'stripe_fee_percentage', 'founder_earnings_percentage', 'minimum_payout_amount'].includes(key)) {
        value = parseFloat(value)
      }
      // Parse boolean
      if (key === 'auto_payout_enabled') {
        value = value === 'true'
      }

      settings[key] = value

      // Track latest update
      if (row.last_updated && (!lastUpdated || row.last_updated > lastUpdated)) {
        lastUpdated = row.last_updated
      }
    }

    return res.json({
      settings: {
        platformFeePercentage: settings.platform_fee_percentage || 0.07,
        stripeFeePercentage: settings.stripe_fee_percentage || 0.035,
        founderEarningsPercentage: settings.founder_earnings_percentage || 0.35,
        minimumPayoutAmount: settings.minimum_payout_amount || 25.00,
        payoutSchedule: settings.payout_schedule || 'weekly',
        autoPayoutEnabled: settings.auto_payout_enabled ?? true,
        lastUpdated
      }
    })
  } catch (error: any) {
    console.error('[control-panel] Settings error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// PUT /api/admin/control-panel/settings - Update platform settings
router.put('/settings', requireAuth, requireRole(['admin']), async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      platformFeePercentage,
      stripeFeePercentage,
      founderEarningsPercentage,
      minimumPayoutAmount,
      payoutSchedule,
      autoPayoutEnabled
    } = req.body

    // Validate inputs
    if (platformFeePercentage !== undefined && (platformFeePercentage < 0 || platformFeePercentage > 1)) {
      return res.status(400).json({ error: 'Platform fee must be between 0 and 1' })
    }
    if (stripeFeePercentage !== undefined && (stripeFeePercentage < 0 || stripeFeePercentage > 1)) {
      return res.status(400).json({ error: 'Stripe fee must be between 0 and 1' })
    }
    if (founderEarningsPercentage !== undefined && (founderEarningsPercentage < 0 || founderEarningsPercentage > 1)) {
      return res.status(400).json({ error: 'Founder earnings must be between 0 and 1' })
    }
    if (minimumPayoutAmount !== undefined && minimumPayoutAmount < 1) {
      return res.status(400).json({ error: 'Minimum payout must be at least $1' })
    }
    if (payoutSchedule && !['daily', 'weekly', 'monthly'].includes(payoutSchedule)) {
      return res.status(400).json({ error: 'Invalid payout schedule' })
    }

    // Update each setting
    const updates = [
      { key: 'platform_fee_percentage', value: platformFeePercentage?.toString() },
      { key: 'stripe_fee_percentage', value: stripeFeePercentage?.toString() },
      { key: 'founder_earnings_percentage', value: founderEarningsPercentage?.toString() },
      { key: 'minimum_payout_amount', value: minimumPayoutAmount?.toString() },
      { key: 'payout_schedule', value: payoutSchedule },
      { key: 'auto_payout_enabled', value: autoPayoutEnabled?.toString() }
    ].filter(u => u.value !== undefined)

    for (const update of updates) {
      const { error } = await supabase
        .from('platform_settings')
        .update({
          setting_value: update.value,
          last_updated: new Date().toISOString()
        })
        .eq('setting_key', update.key)

      if (error) {
        console.error(`[control-panel] Error updating ${update.key}:`, error)
      }
    }

    console.log(`[control-panel] Settings updated by user`)

    // Fetch updated settings
    const { data } = await supabase
      .from('platform_settings')
      .select('*')
      .in('category', ['fees', 'payouts'])

    // Convert to response format
    const settings: Record<string, any> = {}
    for (const row of data || []) {
      settings[row.setting_key] = row.setting_value
    }

    return res.json({
      success: true,
      settings: {
        platformFeePercentage: parseFloat(settings.platform_fee_percentage) || 0.07,
        stripeFeePercentage: parseFloat(settings.stripe_fee_percentage) || 0.035,
        founderEarningsPercentage: parseFloat(settings.founder_earnings_percentage) || 0.35,
        minimumPayoutAmount: parseFloat(settings.minimum_payout_amount) || 25.00,
        payoutSchedule: settings.payout_schedule || 'weekly',
        autoPayoutEnabled: settings.auto_payout_enabled === 'true',
        lastUpdated: new Date().toISOString()
      }
    })
  } catch (error: any) {
    console.error('[control-panel] Update settings error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/admin/control-panel/earnings - Get earnings overview
router.get('/earnings', requireAuth, requireRole(['admin', 'founder']), async (req: Request, res: Response): Promise<any> => {
  try {
    // Get settings for fee calculations
    const { data: settingsData } = await supabase
      .from('platform_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['platform_fee_percentage', 'founder_earnings_percentage'])

    const settingsMap: Record<string, string> = {}
    for (const row of settingsData || []) {
      settingsMap[row.setting_key] = row.setting_value
    }

    const platformFeeRate = parseFloat(settingsMap.platform_fee_percentage) || 0.07
    const founderRate = parseFloat(settingsMap.founder_earnings_percentage) || 0.35

    // Get completed orders for revenue calculation
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('total_amount, status, vendor_id, created_at')
      .in('status', ['completed', 'delivered', 'shipped', 'paid'])

    if (ordersError) {
      console.error('[control-panel] Error fetching orders:', ordersError)
    }

    // Calculate totals
    const totalRevenue = orders?.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0) || 0
    const vendorSales = orders?.filter(o => o.vendor_id).reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0) || 0
    const inHouseSales = totalRevenue - vendorSales

    const totalPlatformFees = totalRevenue * platformFeeRate
    const totalVendorPayouts = vendorSales * (1 - platformFeeRate)
    const totalFounderEarnings = totalPlatformFees * founderRate

    // Get pending payouts (orders completed but not yet paid out)
    const { data: pendingOrders } = await supabase
      .from('orders')
      .select('total_amount')
      .eq('status', 'completed')
      .not('vendor_id', 'is', null)

    const pendingPayouts = pendingOrders?.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0) * (1 - platformFeeRate), 0) || 0

    return res.json({
      earnings: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalPlatformFees: Math.round(totalPlatformFees * 100) / 100,
        totalVendorPayouts: Math.round(totalVendorPayouts * 100) / 100,
        totalFounderEarnings: Math.round(totalFounderEarnings * 100) / 100,
        pendingPayouts: Math.round(pendingPayouts * 100) / 100,
        period: 'all-time',
        breakdown: {
          vendorSales: Math.round(vendorSales * 100) / 100,
          inHouseSales: Math.round(inHouseSales * 100) / 100,
          subscriptionRevenue: 0,
          otherRevenue: 0
        }
      }
    })
  } catch (error: any) {
    console.error('[control-panel] Earnings error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
