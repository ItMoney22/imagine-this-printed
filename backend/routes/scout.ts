import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'
import { runDesignBriefScout, type DesignBriefQueue } from '../services/design-brief-scout.js'

const router = Router()

// In-memory cache: one scout pass per process per 20h. Each pass makes ~28
// SerpAPI calls (14 seed targets x 2 marketplace queries) plus ~14 OpenAI
// calls, so this endpoint must never regenerate on every request.
let cachedQueue: DesignBriefQueue | null = null
let cachedAt = 0
const CACHE_MS = 20 * 60 * 60 * 1000
let inFlight: Promise<DesignBriefQueue> | null = null

async function getQueue(forceRefresh: boolean): Promise<DesignBriefQueue> {
  const isStale = !cachedQueue || Date.now() - cachedAt > CACHE_MS
  if (!forceRefresh && !isStale) return cachedQueue as DesignBriefQueue
  if (inFlight) return inFlight

  inFlight = runDesignBriefScout({ minBriefs: 10 })
    .then((queue) => {
      cachedQueue = queue
      cachedAt = Date.now()
      return queue
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

// GET /api/scout/design-briefs — the integration point the design agent (or
// any internal tool) polls for the current ranked queue. Cheap: served from
// cache unless the cache is empty or older than 20h, in which case it
// generates once and every caller in that window shares the result.
router.get('/design-briefs', async (_req: Request, res: Response) => {
  try {
    const queue = await getQueue(false)
    res.json(queue)
  } catch (error: any) {
    console.error('[scout] design-briefs failed:', error?.message || error)
    res.status(500).json({ error: 'Failed to load design brief queue', details: error?.message })
  }
})

// POST /api/admin/scout/design-briefs/run — manual/cron-triggered refresh.
// Wire a daily Render Cron Job (or an internal scheduler) to call this with
// a service-role/admin session so the queue rotates once every 24h without
// waiting on the first visitor of the day to pay the generation latency.
router.post('/design-briefs/run', requireAuth, requireRole(['admin', 'manager']), async (_req: Request, res: Response) => {
  try {
    const queue = await getQueue(true)
    res.json(queue)
  } catch (error: any) {
    console.error('[scout] manual run failed:', error?.message || error)
    res.status(500).json({ error: 'Failed to run design brief scout', details: error?.message })
  }
})

export default router
