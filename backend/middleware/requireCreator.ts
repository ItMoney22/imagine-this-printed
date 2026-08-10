import { Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase.js'

/**
 * Creator gate — David 2026-08-09: anyone may GENERATE art (ITC-metered), but
 * SELLING a design on the store requires the instant creator opt-in (terms +
 * 15% royalty acknowledged). Creator status lives at
 * user_profiles.metadata.creator.agreed_at — a jsonb field that has existed
 * since the initial schema, so no migration gates this rollout.
 *
 * Responds 403 with code 'creator_signup_required' so frontends can route the
 * user to /become-creator instead of showing a dead error.
 */
export async function requireCreator(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as any).user?.id || (req as any).user?.sub
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('metadata')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('[requireCreator] profile read failed:', error.message)
      res.status(500).json({ error: 'Could not verify creator status' })
      return
    }

    const creator = (data?.metadata as any)?.creator
    if (!creator?.agreed_at) {
      res.status(403).json({
        error: 'Join the creator program to sell your designs',
        code: 'creator_signup_required',
      })
      return
    }

    ;(req as any).creator = {
      agreedAt: creator.agreed_at,
      termsVersion: creator.terms_version,
      royaltyPercent: Number(creator.royalty_percent) || 15,
    }
    next()
  } catch (err: any) {
    console.error('[requireCreator] unexpected failure:', err?.message)
    res.status(500).json({ error: 'Could not verify creator status' })
  }
}
