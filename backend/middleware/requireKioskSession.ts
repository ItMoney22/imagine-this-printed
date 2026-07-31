import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { supabase } from '../lib/supabase.js'

// Bearer-token auth for physical kiosk terminals. A kiosk never becomes a
// Supabase Auth user and is never granted RLS access to anything (see
// supabase/migrations/20260728_kiosk_device_sessions.sql) — it authenticates
// by presenting an opaque session token minted by POST /api/kiosk/session
// (backend/routes/kiosk.ts) in exchange for a per-device secret. Only the
// token's SHA-256 hash is ever stored or compared, mirroring
// requireStorefrontSecret.ts's safeEqual pattern but DB-backed and
// short-lived instead of one static env value.

export type KioskSessionContext = {
  kioskId: string
  deviceId: string
  vendorId: string
}

declare global {
  namespace Express {
    interface Request { kioskSession?: KioskSessionContext }
  }
}

export function hashKioskToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export async function requireKioskSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!token) {
    res.status(401).json({ error: 'Missing kiosk session token' })
    return
  }

  try {
    const tokenHash = hashKioskToken(token)

    const { data: session, error } = await supabase
      .from('kiosk_sessions')
      .select('kiosk_id, device_id, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (error || !session || session.revoked_at || new Date(session.expires_at) < new Date()) {
      res.status(401).json({ error: 'Invalid or expired kiosk session' })
      return
    }

    const { data: kiosk } = await supabase
      .from('kiosks')
      .select('vendor_id, is_active')
      .eq('id', session.kiosk_id)
      .maybeSingle()

    if (!kiosk?.is_active) {
      res.status(401).json({ error: 'Kiosk is no longer active' })
      return
    }

    req.kioskSession = { kioskId: session.kiosk_id, deviceId: session.device_id, vendorId: kiosk.vendor_id }
    next()
  } catch (err: any) {
    console.error('[requireKioskSession] Unexpected error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
