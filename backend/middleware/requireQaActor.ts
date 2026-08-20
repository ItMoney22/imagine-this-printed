import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { requireAuth, requireRole } from './supabaseAuth.js'

// Auth for the design QA gate. Two kinds of caller, one middleware:
//
//   1. A HUMAN — an admin or manager holding a Supabase JWT, working the QA
//      queue in the admin panel.
//   2. AN AGENT — the daily designer (Watchtower f95ad58d) and the Etsy scout
//      (12d1c31d) run headless with no browser session, so they present
//      `Authorization: Bearer <DESIGN_AGENT_TOKEN>` plus `x-agent-id`. Same
//      shared-secret shape as requireStorefrontSecret/print-bridge, and the
//      same constant-time compare.
//
// The agent id is recorded on every review as `submitted_by`, which is the
// whole point: "who submitted this and how many times" is the number that says
// whether the designer agent is getting better or just resubmitting.
//
// Agent ids are ALLOWLISTED rather than free text. One shared token means any
// holder could claim to be anyone, so an open field would make the audit trail
// decorative. Extend DESIGN_AGENT_IDS when a new agent joins the pipeline.

export type QaActor = { id: string; kind: 'admin' | 'agent' }

declare global {
  namespace Express {
    interface Request { qaActor?: QaActor }
  }
}

const DEFAULT_AGENT_IDS = ['daily-designer', 'etsy-scout', 'mr-imagine', 'mrs-imagine', 'etsy-worker']

const agentIds = (): Set<string> =>
  new Set(
    (process.env.DESIGN_AGENT_IDS || DEFAULT_AGENT_IDS.join(','))
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  )

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function requireQaActor(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!provided) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // Agent token first: it is a cheap constant-time compare, and an agent token
  // is never a valid JWT so there is no ambiguity.
  const agentToken = process.env.DESIGN_AGENT_TOKEN
  if (agentToken && agentToken.length >= 16 && safeEqual(provided, agentToken)) {
    const claimed = String(req.headers['x-agent-id'] || '').trim()
    if (!agentIds().has(claimed)) {
      res.status(403).json({
        error: `Unknown agent id "${claimed || '(none)'}". Send x-agent-id with one of: ${[...agentIds()].join(', ')}`
      })
      return
    }
    req.qaActor = { id: claimed, kind: 'agent' }
    next()
    return
  }

  // Otherwise it must be an admin/manager session. Delegate to the real auth
  // chain rather than re-verifying the JWT here — requireRole() resolves the
  // role from the server-trusted role cache, and a second implementation of
  // that check is a second chance to get it wrong.
  const staffOnly = requireRole(['admin', 'manager'])
  await requireAuth(req, res, () => {
    void staffOnly(req, res, () => {
      req.qaActor = { id: req.user?.email || req.user?.id || 'admin', kind: 'admin' }
      next()
    })
  })
}
