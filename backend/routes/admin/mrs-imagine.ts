// Mrs. Imagine — batch trigger + progress. Mounted at /api/admin/mrs-imagine.
//
// Auth is requireQaActor (admin/manager session OR DESIGN_AGENT_TOKEN +
// allowlisted x-agent-id) so the Watchtower's scheduler can run her daily
// without a browser session — same contract as the design-QA routes.

import { Router, Request, Response } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireQaActor } from '../../middleware/requireQaActor.js'
import { startMrsImagineBatch, previewResearch } from '../../services/mrs-imagine.js'

const router = Router()
router.use(requireQaActor)

// POST /api/admin/mrs-imagine/run  { garments?, metal? }
// 202 immediately; the batch runs inline on this process. Progress lives on
// the ai_jobs row (type 'mrs_imagine_batch').
router.post('/run', async (req: Request, res: Response): Promise<any> => {
  try {
    // One batch at a time: a second concurrent run doubles spend and races the
    // mockup worker for no benefit.
    const { data: running } = await supabase
      .from('ai_jobs')
      .select('id, updated_at')
      .eq('type', 'mrs_imagine_batch')
      .eq('status', 'running')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (running) {
      // A batch silent for >20 min is dead (deploy/restart) — mark and move on.
      const age = Date.now() - new Date(running.updated_at).getTime()
      if (age < 20 * 60 * 1000) {
        return res.status(409).json({ error: 'A Mrs. Imagine batch is already running', batchId: running.id })
      }
      await supabase
        .from('ai_jobs')
        .update({ status: 'failed', error: 'stale — no heartbeat for 20 min (process restarted?)', updated_at: new Date().toISOString() })
        .eq('id', running.id)
    }

    const garments = req.body?.garments != null ? Number(req.body.garments) : undefined
    const metal = req.body?.metal != null ? Number(req.body.metal) : undefined
    const { batchId } = await startMrsImagineBatch({ garments, metal, requestedBy: req.qaActor?.id })
    return res.status(202).json({ ok: true, batchId })
  } catch (e: any) {
    req.log?.error({ error: e }, '[mrs-imagine] run failed')
    return res.status(500).json({ error: e.message })
  }
})

// GET /api/admin/mrs-imagine/runs — recent batches with progress + outcomes.
router.get('/runs', async (_req: Request, res: Response): Promise<any> => {
  const { data, error } = await supabase
    .from('ai_jobs')
    .select('id, status, input, output, error, created_at, updated_at')
    .eq('type', 'mrs_imagine_batch')
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) return res.status(500).json({ error: error.message })
  return res.json({ runs: data ?? [] })
})

// GET /api/admin/mrs-imagine/research — dry preview of what she sees on Etsy
// right now (no spend beyond the public API calls, no writes).
router.get('/research', async (_req: Request, res: Response): Promise<any> => {
  try {
    const signals = await previewResearch()
    return res.json({ signals })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
})

export default router
