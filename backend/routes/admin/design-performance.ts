// Admin Design Performance (task 47174caa): click-through, add-to-cart and paid
// orders per AI prompt variant, with the prune / refresh verdicts. Read-only;
// the daily worker sweep is what stores the verdicts.
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { REPORT_WINDOWS, loadDesignPerformance, rawCountsForProduct } from '../../services/design-performance.js'

const router = Router()

router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

const windowOf = (q: unknown) => {
  const days = Number(q)
  return (REPORT_WINDOWS as readonly number[]).includes(days) ? days : 30
}

router.get('/', async (req: Request, res: Response) => {
  try {
    return res.json(await loadDesignPerformance(windowOf(req.query.days)))
  } catch (error: any) {
    console.error('[admin/design-performance] report failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Raw event + order counts for one product, read straight off the tables
// (no aggregation function), so a dashboard row can be checked against them.
router.get('/raw/:productId', async (req: Request, res: Response) => {
  const { productId } = req.params
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return res.status(400).json({ error: 'Bad product id' })
  try {
    return res.json(await rawCountsForProduct(productId, windowOf(req.query.days)))
  } catch (error: any) {
    console.error('[admin/design-performance] raw counts failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
