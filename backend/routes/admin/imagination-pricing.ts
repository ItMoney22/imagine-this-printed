import { Router, Request, Response } from 'express'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { requireAdmin } from '../../middleware/requireAdmin.js'
import { pricingService } from '../../services/imagination-pricing.js'

const router = Router()

// Apply authentication and admin authorization to all routes
router.use(requireAuth)
router.use(requireAdmin)

// GET /api/admin/imagination-pricing - Get all pricing configs
router.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const pricing = await pricingService.getAllPricing()
    return res.json({
      ok: true,
      pricing
    })
  } catch (error: any) {
    console.error('[admin/imagination-pricing] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// PUT /api/admin/imagination-pricing/:featureKey - Update pricing for a feature
router.put('/:featureKey', async (req: Request, res: Response): Promise<any> => {
  try {
    const { featureKey } = req.params
    const { current_cost, is_free_trial, free_trial_uses } = req.body

    // Validate input
    if (current_cost !== undefined && (typeof current_cost !== 'number' || current_cost < 0)) {
      return res.status(400).json({ error: 'current_cost must be a non-negative number' })
    }

    if (free_trial_uses !== undefined && (typeof free_trial_uses !== 'number' || free_trial_uses < 0)) {
      return res.status(400).json({ error: 'free_trial_uses must be a non-negative number' })
    }

    const updates: Record<string, any> = {}
    if (current_cost !== undefined) updates.current_cost = current_cost
    if (is_free_trial !== undefined) updates.is_free_trial = is_free_trial
    if (free_trial_uses !== undefined) updates.free_trial_uses = free_trial_uses

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' })
    }

    const updated = await pricingService.updatePricing(featureKey, updates)
    return res.json({
      ok: true,
      pricing: updated
    })
  } catch (error: any) {
    console.error('[admin/imagination-pricing] Update error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/imagination-pricing/promo - Set promotional pricing (all free for X hours)
router.post('/promo', async (req: Request, res: Response): Promise<any> => {
  try {
    const { durationHours } = req.body

    if (typeof durationHours !== 'number' || durationHours <= 0 || durationHours > 168) {
      return res.status(400).json({ error: 'durationHours must be between 1 and 168 (1 week max)' })
    }

    await pricingService.setPromo(durationHours)
    return res.json({
      ok: true,
      message: `Promotional pricing activated for ${durationHours} hours`
    })
  } catch (error: any) {
    console.error('[admin/imagination-pricing] Promo error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/imagination-pricing/reset - Reset all pricing to base values
router.post('/reset', async (req: Request, res: Response): Promise<any> => {
  try {
    await pricingService.resetToDefaults()
    const pricing = await pricingService.getAllPricing()
    return res.json({
      ok: true,
      message: 'All pricing reset to defaults',
      pricing
    })
  } catch (error: any) {
    console.error('[admin/imagination-pricing] Reset error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
