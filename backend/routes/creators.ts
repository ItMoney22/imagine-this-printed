import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/supabaseAuth.js'

/**
 * Creator program membership — instant opt-in (David 2026-08-09 decision:
 * no application step; the product approval queue is the real quality gate).
 *
 * Status is stored at user_profiles.metadata.creator:
 *   { agreed_at, terms_version, royalty_percent }
 * written service-role so the acceptance record can't be spoofed with a
 * missing terms version. The royalty percent is recorded AT SIGNUP so a
 * future program change never silently reprices existing creators.
 */
const router = Router()

const CREATOR_TERMS_VERSION = '2026-08-09'
const CREATOR_ROYALTY_PERCENT = 15

const readCreator = async (userId: string) => {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('metadata')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return { metadata: (data?.metadata as any) || {}, creator: (data?.metadata as any)?.creator || null }
}

// GET /api/creators/me — creator status for the signed-in user
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.id || (req as any).user?.sub
    const { creator } = await readCreator(userId)
    return res.json({
      isCreator: !!creator?.agreed_at,
      agreedAt: creator?.agreed_at || null,
      termsVersion: creator?.terms_version || null,
      royaltyPercent: creator?.royalty_percent ?? CREATOR_ROYALTY_PERCENT,
    })
  } catch (err: any) {
    req.log?.error({ err }, '[creators] me failed')
    return res.status(500).json({ error: 'Could not load creator status' })
  }
})

// POST /api/creators/signup — instant opt-in; idempotent
router.post('/signup', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = (req as any).user?.id || (req as any).user?.sub
    const { metadata, creator } = await readCreator(userId)

    if (creator?.agreed_at) {
      return res.json({ isCreator: true, agreedAt: creator.agreed_at, alreadyCreator: true })
    }

    const record = {
      agreed_at: new Date().toISOString(),
      terms_version: CREATOR_TERMS_VERSION,
      royalty_percent: CREATOR_ROYALTY_PERCENT,
    }
    const { error } = await supabase
      .from('user_profiles')
      .update({ metadata: { ...metadata, creator: record }, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) return res.status(500).json({ error: 'Signup could not be saved' })

    req.log?.info({ userId }, '[creators] 🎨 new creator signed up')
    return res.json({ isCreator: true, agreedAt: record.agreed_at, royaltyPercent: record.royalty_percent })
  } catch (err: any) {
    req.log?.error({ err }, '[creators] signup failed')
    return res.status(500).json({ error: 'Signup failed' })
  }
})

export default router
