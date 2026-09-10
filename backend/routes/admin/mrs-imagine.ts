// Mrs. Imagine — SCOUT board. Mounted at /api/admin/mrs-imagine.
//
// David 2026-09-09: "mrs imagine is a scout ... she drops a list of her top 10
// everyday and i just have to click on it it goes to step flow". THE BATCH
// TRIGGER IS GONE FROM THIS ROUTER ON PURPOSE. `POST /run` used to kick off
// her autonomous designer (services/mrs-imagine.ts): 15 products designed,
// mocked up and queued unattended. David turned that behaviour off on
// 2026-09-02, but the button stayed wired, and the last press drained the
// OpenAI wallet to a 429 without shipping anything. Deleting the route closes
// the door for good — the service itself stays on disk for its reusable
// pieces, but nothing in the product reaches it any more.
//
// Auth is requireQaActor (admin/manager session OR DESIGN_AGENT_TOKEN +
// allowlisted x-agent-id) so the Watchtower's scheduler can run the scout
// daily without a browser session — same contract as the design-QA routes.

import { Router, Request, Response } from 'express'
import { supabase } from '../../lib/supabase.js'
import { requireQaActor } from '../../middleware/requireQaActor.js'
import { previewResearch } from '../../services/mrs-imagine.js'
import {
  latestScoutRun,
  runAndRecordScout,
  scoutIsRunning,
  SCOUT_JOB_TYPE,
} from '../../services/mrs-imagine-scout.js'

const router = Router()
router.use(requireQaActor)

// GET /api/admin/mrs-imagine/scout — the current top 10, with the receipts.
// Cheap and read-only: it reads back the last recorded run, it does not sweep.
router.get('/scout', async (_req: Request, res: Response): Promise<any> => {
  try {
    const run = await latestScoutRun()
    return res.json({ run })
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }
})

// POST /api/admin/mrs-imagine/scout/run — sweep now instead of waiting for the
// daily clock. Read-only against Etsy plus one cheap text call; no image spend,
// so unlike the batch this is safe to press twice. One at a time all the same:
// a concurrent sweep just burns Etsy rate limit for the same answer.
router.post('/scout/run', async (req: Request, res: Response): Promise<any> => {
  try {
    if (await scoutIsRunning()) {
      return res.status(409).json({ error: 'Mrs. Imagine is already out scouting' })
    }
    const run = await runAndRecordScout({ requestedBy: req.qaActor?.id })
    // A failed sweep is a 200 carrying a failed run, not a 500: the card shows
    // the reason in place, and a stale-but-real list stays on screen.
    return res.json({ run })
  } catch (e: any) {
    req.log?.error({ error: e }, '[mrs-imagine] scout failed')
    return res.status(500).json({ error: e.message })
  }
})

// GET /api/admin/mrs-imagine/scout/history — recent sweeps, for auditing what
// she pitched and when.
router.get('/scout/history', async (_req: Request, res: Response): Promise<any> => {
  const { data, error } = await supabase
    .from('ai_jobs')
    .select('id, status, input, output, error, created_at, updated_at')
    .eq('type', SCOUT_JOB_TYPE)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) return res.status(500).json({ error: error.message })
  return res.json({ runs: data ?? [] })
})

// GET /api/admin/mrs-imagine/runs — the OLD autonomous batches, read-only.
// Kept so the record of what she built unattended stays auditable; nothing
// can create a new one.
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
