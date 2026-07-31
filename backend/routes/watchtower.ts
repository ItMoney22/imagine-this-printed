// backend/routes/watchtower.ts
//
// Proxy for filing tasks onto the Watchtower dispatch board
// (davidtrinidad.com). Two callers, both in-app:
//   - Mr. Imagine's create_watchtower_task tool on the AI Product Builder
//     (source: itp-mr-imagine)
//   - The floating Watchtower button admins/managers see across the admin
//     area (source: itp-admin)
//
// The board's own auth is an internal shared secret
// (x-internal-secret, see david-trinidad-com/src/app/api/tasks/internal),
// which must never reach the browser — hence this proxy. Tasks are pinned to
// project "imagine-this-printed" so the board's engine cd's into this repo.

import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../middleware/supabaseAuth.js'

const router = Router()

const BOARD_URL = (process.env.WATCHTOWER_BOARD_URL || 'https://davidtrinidad.com').replace(/\/$/, '')
const INTERNAL_SECRET = process.env.WATCHTOWER_INTERNAL_SECRET || ''
const BOARD_PROJECT = process.env.WATCHTOWER_PROJECT_SLUG || 'imagine-this-printed'

const PRIORITIES = new Set(['low', 'medium', 'high', 'critical'])
// Whitelist sources so the board can tell WHO filed it, and nothing else
// can be spoofed through this proxy.
const SOURCES = new Set(['itp-mr-imagine', 'itp-admin'])

// Filing a task is cheap for us but every row lands on David's live board and
// gets AI triage on arrival — keep a per-user soft cap so a stuck retry loop
// can't flood dispatch. In-memory is fine at admin-team scale.
const fileLimit = new Map<string, { count: number; resetAt: number }>()
const FILE_LIMIT = 10
const FILE_WINDOW_MS = 60_000

function checkFileLimit(userId: string): boolean {
  const now = Date.now()
  const state = fileLimit.get(userId)
  if (!state || state.resetAt < now) {
    fileLimit.set(userId, { count: 1, resetAt: now + FILE_WINDOW_MS })
    return true
  }
  if (state.count >= FILE_LIMIT) return false
  state.count++
  return true
}

/**
 * POST /api/watchtower/tasks
 * Body: { title, description?, priority?, source? }
 * → files onto the board as project imagine-this-printed, status pending.
 */
router.post('/tasks', requireAuth, requireRole(['admin', 'manager']), async (req: Request, res: Response): Promise<any> => {
  try {
    if (!INTERNAL_SECRET) {
      return res.status(503).json({
        error: 'Watchtower link not configured (WATCHTOWER_INTERNAL_SECRET missing on the server).',
      })
    }

    const userId = req.user?.sub || req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    if (!checkFileLimit(userId)) {
      return res.status(429).json({ error: `Too many tasks filed — try again in a minute (limit ${FILE_LIMIT}/min).` })
    }

    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    if (!title) return res.status(400).json({ error: 'title is required' })

    const rawDescription = typeof req.body?.description === 'string' ? req.body.description.trim() : ''
    const priority = PRIORITIES.has(req.body?.priority) ? req.body.priority : 'medium'
    const source = SOURCES.has(req.body?.source) ? req.body.source : 'itp-admin'

    // Stamp who filed it so the board (and whoever picks the task up) knows
    // which human or agent conversation it came from.
    const filedBy = req.user?.email ? `Filed from ITP by ${req.user.email}` : 'Filed from ITP'
    const description = [rawDescription, filedBy].filter(Boolean).join('\n\n').slice(0, 8000)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    let boardRes: globalThis.Response
    try {
      boardRes = await fetch(`${BOARD_URL}/api/tasks/internal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': INTERNAL_SECRET,
        },
        body: JSON.stringify({
          title: title.slice(0, 300),
          description,
          priority,
          project: BOARD_PROJECT,
          source,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    const data = await boardRes.json().catch(() => ({})) as {
      id?: string; title?: string; status?: string; priority?: string; error?: string
    }
    if (!boardRes.ok) {
      req.log?.warn({ status: boardRes.status, error: data?.error }, '[watchtower] board rejected task')
      return res.status(502).json({ error: data?.error || `Watchtower board error (${boardRes.status})` })
    }

    req.log?.info({ taskId: data?.id, title, source }, '[watchtower] task filed on the board')
    return res.json({
      ok: true,
      taskId: data?.id,
      title: data?.title || title,
      status: data?.status || 'pending',
      priority: data?.priority || priority,
    })
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    req.log?.error({ err }, '[watchtower] task filing failed')
    return res.status(502).json({
      error: aborted ? 'Watchtower board timed out — task NOT filed.' : 'Could not reach the Watchtower board — task NOT filed.',
    })
  }
})

export default router
