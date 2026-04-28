// Express routes for the image-flow service.
// Mounts at /api/image-flow/* in backend/index.ts.

import { Router, type Request, type Response, type NextFunction } from 'express'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'
import { generate } from '../services/image-flow/api/generate.js'
import { edit } from '../services/image-flow/api/edit.js'
import { bgRemove } from '../services/image-flow/api/bg-remove.js'
import { upscale } from '../services/image-flow/api/upscale.js'
import { enhancePrompt } from '../services/image-flow/prompt-enhancer.js'
import {
  MODELS,
  PURPOSE_ENUM,
  DEFAULT_GENERATE_MODEL,
  DEFAULT_EDIT_MODEL,
  DEFAULT_MOCKUP_MODEL,
  DEFAULT_BG_REMOVE_MODEL,
  getModel,
} from '../services/image-flow/models.js'

const router = Router()

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', req.user.sub)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    res.status(403).json({ error: 'Forbidden: Admin access required' })
    return
  }
  next()
}

// GET /api/image-flow/models — list available models with tiers, costs, prompt-craft
router.get('/models', requireAuth, async (_req, res) => {
  res.json({
    models: MODELS,
    purposes: PURPOSE_ENUM,
    defaults: {
      generate: DEFAULT_GENERATE_MODEL,
      edit: DEFAULT_EDIT_MODEL,
      mockup: DEFAULT_MOCKUP_MODEL,
      bgRemove: DEFAULT_BG_REMOVE_MODEL,
    },
  })
})

// POST /api/image-flow/generate — text -> image
router.post('/generate', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await generate({
      ...req.body,
      createdBy: req.user?.sub,
    })
    const code = result.status === 'needs_confirmation' ? 402 : 200
    return res.status(code).json(result)
  } catch (err: any) {
    req.log?.error({ err: err.message }, '[image-flow] generate failed')
    return res.status(500).json({ error: err.message ?? 'unknown error' })
  }
})

// POST /api/image-flow/edit — image(s) + prompt -> edited image
router.post('/edit', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await edit({
      ...req.body,
      createdBy: req.user?.sub,
    })
    const code = result.status === 'needs_confirmation' ? 402 : 200
    return res.status(code).json(result)
  } catch (err: any) {
    req.log?.error({ err: err.message }, '[image-flow] edit failed')
    return res.status(500).json({ error: err.message ?? 'unknown error' })
  }
})

// POST /api/image-flow/upscale — increase resolution
router.post('/upscale', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await upscale({ ...req.body })
    return res.json(result)
  } catch (err: any) {
    req.log?.error({ err: err.message }, '[image-flow] upscale failed')
    return res.status(500).json({ error: err.message ?? 'unknown error' })
  }
})

// POST /api/image-flow/bg-remove — bg remove or replace
router.post('/bg-remove', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await bgRemove({
      ...req.body,
      createdBy: req.user?.sub,
    })
    return res.json(result)
  } catch (err: any) {
    req.log?.error({ err: err.message }, '[image-flow] bg-remove failed')
    return res.status(500).json({ error: err.message ?? 'unknown error' })
  }
})

// POST /api/image-flow/enhance — rewrite a prompt only (no generation)
router.post('/enhance', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<any> => {
  try {
    const { prompt, purpose, modelId } = req.body
    if (!prompt) return res.status(400).json({ error: 'prompt required' })
    const model = modelId ? getModel(modelId) : undefined
    const result = await enhancePrompt({
      prompt,
      purpose: purpose ?? 'product',
      model,
    })
    return res.json(result)
  } catch (err: any) {
    req.log?.error({ err: err.message }, '[image-flow] enhance failed')
    return res.status(500).json({ error: err.message ?? 'unknown error' })
  }
})

export default router
