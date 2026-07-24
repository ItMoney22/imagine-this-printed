// Admin Etsy integration routes: OAuth connect/status, setup lookups
// (taxonomy, shipping profiles, return policies), and product publishing.
// Mounted at /api/admin/etsy. Full flow: docs/plans/2026-07-24-etsy-integration-plan.md
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import {
  buildAuthUrl,
  getConnectionStatus,
  getReturnPolicies,
  getShippingProfiles,
  getTaxonomyNodes,
  handleOAuthCallback,
  isEtsyConfigured,
  listEtsyListings,
  publishProductToEtsy
} from '../../services/etsy.js'

const router = Router()

// OAuth callback MUST stay above the auth gate: Etsy redirects the admin's
// browser here without our JWT. The persisted `state` token is the CSRF check.
router.get('/callback', async (req: Request, res: Response) => {
  const frontend = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'
  try {
    const { code, state, error: oauthError } = req.query as Record<string, string>
    if (oauthError) return res.redirect(`${frontend}/admin?etsy=denied`)
    if (!code || !state) return res.status(400).json({ error: 'Missing code/state' })
    const { shopId, shopName } = await handleOAuthCallback(code, state)
    console.log(`[etsy] connected — shop ${shopName ?? 'none yet'} (${shopId ?? 'n/a'})`)
    return res.redirect(`${frontend}/admin?etsy=connected`)
  } catch (error: any) {
    console.error('[etsy] OAuth callback failed:', error)
    return res.redirect(`${frontend}/admin?etsy=error`)
  }
})

router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

// Connection + config state for the admin panel.
router.get('/status', async (_req: Request, res: Response) => {
  try {
    return res.json(await getConnectionStatus())
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// Start the OAuth consent flow: returns the Etsy authorize URL for the admin
// to open (frontend does window.location = url).
router.get('/connect', async (req: Request, res: Response) => {
  try {
    if (!isEtsyConfigured()) {
      return res.status(503).json({ error: 'ETSY_KEYSTRING not configured — create the Etsy app first' })
    }
    const userId = (req as any).user?.id as string | undefined
    const url = await buildAuthUrl(userId)
    return res.json({ url })
  } catch (error: any) {
    console.error('[etsy] connect failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Setup lookups so taxonomy/shipping/return ids are picked, never guessed.
router.get('/taxonomy', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').toLowerCase()
    const nodes = await getTaxonomyNodes()
    const flat: Array<{ id: number, name: string, path: string }> = []
    const walk = (list: any[], trail: string[]) => {
      for (const n of list || []) {
        const path = [...trail, n.name]
        flat.push({ id: n.id, name: n.name, path: path.join(' > ') })
        walk(n.children, path)
      }
    }
    walk(nodes, [])
    const results = q ? flat.filter(n => n.path.toLowerCase().includes(q)) : flat
    return res.json({ count: results.length, results: results.slice(0, 200) })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

router.get('/shipping-profiles', async (_req: Request, res: Response) => {
  try {
    return res.json({ results: await getShippingProfiles() })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

router.get('/return-policies', async (_req: Request, res: Response) => {
  try {
    return res.json({ results: await getReturnPolicies() })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

// Post one ITP product to Etsy. Creates a DRAFT by default; body.publish=true
// activates it (visible + $0.20 listing fee).
router.post('/publish/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params
    const { taxonomyId, shippingProfileId, returnPolicyId, quantity, publish, priceOverride } = req.body || {}
    const result = await publishProductToEtsy(productId, {
      taxonomyId: taxonomyId ? Number(taxonomyId) : undefined,
      shippingProfileId: shippingProfileId ? Number(shippingProfileId) : undefined,
      returnPolicyId: returnPolicyId ? Number(returnPolicyId) : undefined,
      quantity: quantity ? Number(quantity) : undefined,
      priceOverride: priceOverride ? Number(priceOverride) : undefined,
      publish: publish === true
    })
    return res.status(result.ok ? 200 : 422).json(result)
  } catch (error: any) {
    console.error('[etsy] publish failed:', error)
    return res.status(500).json({ error: error.message })
  }
})

// Sync-state ledger (etsy_listings) for the admin panel.
router.get('/listings', async (_req: Request, res: Response) => {
  try {
    return res.json({ results: await listEtsyListings() })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
})

export default router
