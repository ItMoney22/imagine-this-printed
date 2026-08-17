import { Router, Request, Response, NextFunction } from 'express'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'
import { runDesignBriefScout, type DesignBriefQueue, type DesignBrief } from '../services/design-brief-scout.js'
import { supabase } from '../lib/supabase.js'

const router = Router()

const CACHE_MS = 20 * 60 * 60 * 1000
let inFlight: Promise<DesignBriefQueue> | null = null

async function getQueue(forceRefresh: boolean): Promise<DesignBriefQueue> {
  if (!forceRefresh) {
    try {
      const { data, error } = await supabase
        .from('scout_design_briefs')
        .select('*')
        .order('rank', { ascending: true })

      if (!error && data && data.length >= 10) {
        const newestTime = new Date(data[0].created_at).getTime()
        const isStale = Date.now() - newestTime > CACHE_MS
        if (!isStale) {
          const briefs: DesignBrief[] = data.map((row) => ({
            id: row.id,
            rank: row.rank,
            score: row.score,
            theme: row.theme,
            saying: row.saying,
            styleNotes: row.style_notes,
            targetHoliday: row.target_holiday,
            targetDate: row.target_date,
            niche: row.niche,
            audience: row.audience,
            productType: row.product_type as any,
            evidence: row.evidence,
            saturation: row.saturation as any,
            riskFlags: row.risk_flags,
            sourceQueries: row.source_queries,
          }))
          return {
            generatedAt: data[0].created_at,
            briefs,
            note: 'Design Brief Scout (loaded from Supabase database).',
          }
        }
      }
    } catch (dbErr: any) {
      console.error('[scout] failed to read from Supabase cache, falling back to scout run:', dbErr?.message || dbErr)
    }
  }

  if (inFlight) return inFlight

  inFlight = (async () => {
    const queue = await runDesignBriefScout({ minBriefs: 10 })

    try {
      // Clear out old briefs
      await supabase.from('scout_design_briefs').delete().neq('id', '')

      // Map to db shape
      const dbRows = queue.briefs.map((b) => ({
        id: b.id,
        rank: b.rank,
        score: b.score,
        theme: b.theme,
        saying: b.saying,
        style_notes: b.styleNotes,
        target_holiday: b.targetHoliday,
        target_date: b.targetDate,
        niche: b.niche,
        audience: b.audience,
        product_type: b.productType,
        evidence: b.evidence,
        saturation: b.saturation,
        risk_flags: b.riskFlags,
        source_queries: b.sourceQueries,
        status: 'pending',
      }))

      const { error: insertError } = await supabase
        .from('scout_design_briefs')
        .insert(dbRows)

      if (insertError) {
        console.error('[scout] failed to insert fresh briefs to Supabase:', insertError.message)
      }
    } catch (persistErr: any) {
      console.error('[scout] persistence failure:', persistErr?.message || persistErr)
    }

    return queue
  })()

  inFlight.finally(() => {
    inFlight = null
  })

  return inFlight
}

// GET /api/scout/design-briefs — the integration point the design agent (or
// any internal tool) polls for the current ranked queue. Cheap: served from
// Supabase unless the database is empty or older than 20h, in which case it
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

// POST /api/scout/design-briefs/run — manual/cron-triggered refresh.
// Wire a daily Render Cron Job (or an internal scheduler) to call this.
// Authenticates either via the internal cron secret header or an admin/manager session.
router.post(
  '/design-briefs/run',
  async (req: Request, res: Response, next: NextFunction) => {
    const cronSecret = req.header('x-cron-secret') || req.header('X-Cron-Secret')
    const internalSecret = process.env.WATCHTOWER_INTERNAL_SECRET
    if (internalSecret && cronSecret === internalSecret) {
      return next()
    }
    // Otherwise fallback to admin/manager session auth
    requireAuth(req, res, () => {
      requireRole(['admin', 'manager'])(req, res, next)
    })
  },
  async (_req: Request, res: Response) => {
    try {
      const queue = await getQueue(true)
      res.json(queue)
    } catch (error: any) {
      console.error('[scout] manual run failed:', error?.message || error)
      res.status(500).json({ error: 'Failed to run design brief scout', details: error?.message })
    }
  }
)

export default router

