import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

// Bearer-token auth for trusted external storefronts (e.g. earth019.com) calling
// ITP's headless checkout API. Mirrors the print-bridge token pattern: a shared
// secret held only on ITP + the storefront's SERVER (never shipped to a browser).
// Constant-time compare so a wrong key can't be guessed via timing.
export function requireStorefrontSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.STOREFRONT_API_KEY
  if (!expected) {
    res.status(503).json({ error: 'Storefront checkout not configured' })
    return
  }

  const header = req.headers.authorization || ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  next()
}
