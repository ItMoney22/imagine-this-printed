// Store analytics beacons (task 47174caa): impressions, clicks, product-page
// views and add-to-carts per design. Public and unauthenticated on purpose: the
// browser sends them with fetch keepalive as text/plain (a CORS-simple request,
// so no preflight and it survives the tab closing). The body is untrusted, so
// parseEventBatch allowlists every field and the service stamps the artwork +
// prompt variant ids itself. Always answers 204: a shopper's page never waits
// on, or learns anything from, analytics.
import express, { Router, Request, Response } from 'express'
import { isBotUserAgent, parseEventBatch, recordDesignEvents } from '../services/design-performance.js'

const router = Router()

router.post('/', express.text({ type: 'text/plain', limit: '32kb' }), async (req: Request, res: Response) => {
  res.status(204).end()
  if (isBotUserAgent(req.get('user-agent'))) return
  let raw: unknown = req.body
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return
    }
  }
  const { sessionId, events } = parseEventBatch(raw)
  try {
    await recordDesignEvents(sessionId, events)
  } catch (error: any) {
    console.error('[design-events] record failed:', error?.message || error)
  }
})

export default router
