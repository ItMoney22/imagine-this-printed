/**
 * Print station API — what the agent on a workstation talks to.
 *
 * Workstations are named after planets. Pluto is the packing table: an Omarchy
 * box with a 4x6 thermal printer on USB. A tiny agent runs there, polls this
 * API, and prints whatever it is handed. The whole point is that nobody at the
 * table ever sees a print dialog.
 *
 * The agent PULLS over the public internet with a shared bearer token. The API
 * never dials into the tailnet — Render is not on it, and Tailscale is how
 * David reaches Pluto, not how Pluto gets its work. Pulling also means the
 * station can be asleep, rebooted or unplugged without losing a job: the label
 * is already bought and paid for, and it waits.
 *
 *   GET  /api/print-station/jobs/next?station=pluto   claim the oldest job
 *   GET  /api/print-station/jobs/:orderId/file        download that label
 *   POST /api/print-station/jobs/:orderId/status      printed / failed
 *   POST /api/print-station/heartbeat                 "still here"
 *   GET  /api/print-station/stations/:station         admin: is it alive
 *   POST /api/print-station/jobs/:orderId/requeue     admin: send it again
 *
 * Auth: `Bearer <PRINT_STATION_TOKEN>` for the agent routes, normal admin auth
 * for the two human ones.
 */
import { Router, Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'
import { fetchOrderLabelFile, isLabelFileError } from '../services/shipping-label-file.js'
import {
  stationTokenMatches,
  stationEnabled,
  defaultStation,
  recordHeartbeat,
  stationStatus,
  newPrintJob,
  type PrintJobState
} from '../services/print-station.js'

const router = Router()

function requireStationAuth(req: Request, res: Response, next: NextFunction): void {
  if (!stationEnabled()) {
    res.status(503).json({ error: 'PRINT_STATION_TOKEN is not configured on this server' })
    return
  }
  if (!stationTokenMatches(req.headers.authorization)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  next()
}

function slug(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[a-z0-9_-]{1,40}$/.test(raw) ? raw : fallback
}

/** The shape the agent gets — deliberately small, no order internals. */
function describeJob(order: any, job: PrintJobState) {
  return {
    jobId: order.id,
    orderNumber: order.order_number || order.id.slice(0, 8).toUpperCase(),
    station: job.station,
    kind: job.kind,
    copies: job.copies,
    queuedAt: job.queued_at,
    attempts: job.attempts || 0,
    trackingNumber: order.tracking_number || null,
    carrier: order.tracking_company || null,
    fileUrl: `/api/print-station/jobs/${order.id}/file`
  }
}

/**
 * GET /api/print-station/jobs/next?station=pluto
 *
 * Claims the oldest queued job for a station and flips it to `printing` in the
 * same breath. 204 when there is nothing to do, which is the common answer and
 * is why the agent can poll cheaply.
 *
 * Polling doubles as the heartbeat, so a station that is asking for work always
 * reads as online.
 */
router.get('/jobs/next', requireStationAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const station = slug(req.query.station, defaultStation())
    recordHeartbeat(station, {
      printer: typeof req.query.printer === 'string' ? req.query.printer : null,
      agentVersion: typeof req.query.agent === 'string' ? req.query.agent : null
    })

    const { data: candidates, error } = await supabase
      .from('orders')
      .select('id, order_number, tracking_number, tracking_company, metadata')
      .eq('metadata->print_station->>station', station)
      .eq('metadata->print_station->>status', 'queued')
      .order('created_at', { ascending: true })
      .limit(5)

    if (error) {
      console.error('[print-station] queue read failed:', error.message)
      return res.status(500).json({ error: error.message })
    }

    for (const order of candidates || []) {
      const job = order.metadata?.print_station as PrintJobState | undefined
      if (!job || job.status !== 'queued') continue

      const claimed: PrintJobState = {
        ...job,
        status: 'printing',
        claimed_at: new Date().toISOString(),
        attempts: (job.attempts || 0) + 1
      }

      // Guarded write: only claim while it is still queued, so two agents
      // polling at once cannot both take the same label.
      const { data: updated, error: claimError } = await supabase
        .from('orders')
        .update({
          metadata: {
            ...(order.metadata && typeof order.metadata === 'object' ? order.metadata : {}),
            print_station: claimed
          }
        })
        .eq('id', order.id)
        .eq('metadata->print_station->>status', 'queued')
        .select('id')

      if (claimError) {
        console.error('[print-station] claim failed for', order.id, claimError.message)
        continue
      }
      if (!updated || updated.length === 0) continue // someone else took it

      return res.json({ job: describeJob(order, claimed) })
    }

    return res.status(204).end()
  } catch (error: any) {
    console.error('[print-station] jobs/next error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/print-station/jobs/:orderId/file
 *
 * The label itself, as bytes. Same resolution the browser path uses, including
 * re-signing an expired Shippo URL — so an agent that comes back after a long
 * outage still gets a working file rather than a 403 from S3.
 */
router.get('/jobs/:orderId/file', requireStationAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await fetchOrderLabelFile(req.params.orderId)
    if (isLabelFileError(result)) return res.status(result.status).json({ error: result.error })

    res.setHeader('Content-Type', result.contentType)
    res.setHeader('Content-Length', String(result.buffer.length))
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
    return res.send(result.buffer)
  } catch (error: any) {
    console.error('[print-station] jobs/:id/file error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/print-station/jobs/:orderId/status
 * Body: { status: 'printed' | 'failed', error?: string }
 *
 * A failure leaves the job `failed` rather than requeueing it. Paper jams and
 * empty rolls do not fix themselves, and a job that retries forever prints a
 * stack of duplicates the moment someone reloads the roll.
 */
router.post('/jobs/:orderId/status', requireStationAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    const status = String(req.body?.status || '').toLowerCase()
    if (status !== 'printed' && status !== 'failed') {
      return res.status(400).json({ error: "status must be 'printed' or 'failed'" })
    }

    const { data: order, error: readError } = await supabase
      .from('orders')
      .select('id, metadata')
      .eq('id', orderId)
      .single()

    if (readError || !order) return res.status(404).json({ error: 'Order not found' })

    const job = order.metadata?.print_station as PrintJobState | undefined
    if (!job) return res.status(404).json({ error: 'That order has no print job' })

    recordHeartbeat(job.station)

    const next: PrintJobState = {
      ...job,
      status: status as PrintJobState['status'],
      printed_at: status === 'printed' ? new Date().toISOString() : job.printed_at ?? null,
      error: status === 'failed' ? String(req.body?.error || 'Print failed').slice(0, 500) : null
    }

    const { error: writeError } = await supabase
      .from('orders')
      .update({
        metadata: {
          ...(order.metadata && typeof order.metadata === 'object' ? order.metadata : {}),
          print_station: next
        }
      })
      .eq('id', orderId)

    if (writeError) {
      console.error('[print-station] status write failed:', writeError.message)
      return res.status(500).json({ error: writeError.message })
    }

    if (status === 'failed') {
      console.error('[print-station] job failed on', job.station, orderId, next.error)
    }

    return res.json({ ok: true, job: next })
  } catch (error: any) {
    console.error('[print-station] jobs/:id/status error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/print-station/heartbeat
 * Body: { station, printer?, agentVersion?, note? }
 *
 * For an agent that is idle and not polling for work — keeps the status dot on
 * the station screen honest.
 */
router.post('/heartbeat', requireStationAuth, async (req: Request, res: Response): Promise<any> => {
  const station = slug(req.body?.station, defaultStation())
  recordHeartbeat(station, {
    printer: typeof req.body?.printer === 'string' ? req.body.printer : null,
    agentVersion: typeof req.body?.agentVersion === 'string' ? req.body.agentVersion : null,
    note: typeof req.body?.note === 'string' ? req.body.note : null
  })
  return res.json({ ok: true, ...stationStatus(station) })
})

/**
 * GET /api/print-station/config
 *
 * Which station the screen should talk to, and whether an agent can exist at
 * all. The station name lives in server env (PRINT_STATION_DEFAULT), so the
 * browser has to ask rather than hardcode "pluto" and break the day a
 * workstation is renamed.
 */
router.get('/config', requireAuth, requireRole(['admin', 'manager']), async (_req: Request, res: Response): Promise<any> => {
  return res.json({ enabled: stationEnabled(), defaultStation: defaultStation() })
})

/**
 * GET /api/print-station/stations/:station
 *
 * Admin view: is the station online, and what is sitting in its queue. This is
 * what turns "nothing came out of the printer" into "Pluto has not called home
 * in twenty minutes".
 */
router.get('/stations/:station', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    const station = slug(req.params.station, defaultStation())
    const status = stationStatus(station)

    const { data: queued } = await supabase
      .from('orders')
      .select('id, order_number, metadata')
      .eq('metadata->print_station->>station', station)
      .in('metadata->print_station->>status', ['queued', 'printing', 'failed'])
      .order('created_at', { ascending: true })
      .limit(25)

    const jobs = (queued || []).map(order => ({
      orderId: order.id,
      orderNumber: order.order_number || order.id.slice(0, 8).toUpperCase(),
      ...(order.metadata?.print_station || {})
    }))

    return res.json({
      ...status,
      enabled: stationEnabled(),
      queued: jobs.filter(j => j.status === 'queued').length,
      printing: jobs.filter(j => j.status === 'printing').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      jobs
    })
  } catch (error: any) {
    console.error('[print-station] stations/:station error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/print-station/jobs/:orderId/requeue
 *
 * Send an already-bought label to the station again — a jam, a bad roll, or a
 * job that was printed before anyone noticed the printer was out of labels.
 * Never buys anything; the label already exists on the order.
 */
router.post('/jobs/:orderId/requeue', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.params
    if (!stationEnabled()) {
      return res.status(503).json({ error: 'No print station is configured (PRINT_STATION_TOKEN).' })
    }

    const { data: order, error: readError } = await supabase
      .from('orders')
      .select('id, shipping_label_url, metadata')
      .eq('id', orderId)
      .single()

    if (readError || !order) return res.status(404).json({ error: 'Order not found' })

    const hasLabel = order.shipping_label_url
      || order.metadata?.shipping_label?.label_url
      || order.metadata?.shipping_label?.transaction_id
    if (!hasLabel) {
      return res.status(400).json({ error: 'That order has no purchased label to print.' })
    }

    const existing = order.metadata?.print_station as PrintJobState | undefined
    const station = slug(req.body?.station, existing?.station || defaultStation())
    const job = newPrintJob(station, Number(req.body?.copies) || 1)

    const { error: writeError } = await supabase
      .from('orders')
      .update({
        metadata: {
          ...(order.metadata && typeof order.metadata === 'object' ? order.metadata : {}),
          print_station: job
        }
      })
      .eq('id', orderId)

    if (writeError) return res.status(500).json({ error: writeError.message })

    return res.json({ ok: true, job })
  } catch (error: any) {
    console.error('[print-station] requeue error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router
