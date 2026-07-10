import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

// Bearer-token auth for trusted external storefronts (e.g. earth019.com,
// darrellmccutchen.com) calling ITP's headless storefront API. Mirrors the
// print-bridge token pattern: a shared secret held only on ITP + the
// storefront's SERVER (never shipped to a browser). Constant-time compare so a
// wrong key can't be guessed via timing.
//
// Two kinds of keys:
//   1. STOREFRONT_API_KEY — the original single-tenant key (earth019). Catalog
//      stays UNSCOPED for it (full active catalog), and it cannot create
//      products (no creator identity).
//   2. STOREFRONT_CREATOR_KEYS — JSON map of creator storefronts. Each key is
//      bound to an ITP user: their catalog is scoped to products that user
//      created, and POST /api/storefront/products creates products AS them.
//      Shape: { "<vendor-slug>": { "key": "<secret>", "creatorUserId": "<itp user uuid>" } }
//      e.g.   { "darrell": { "key": "sk_...", "creatorUserId": "6f1e..." } }
//      (Pairs with the external site's STOREFRONT_VENDOR env.)

export type StorefrontContext = {
  vendor: string
  creatorUserId: string | null
}

declare global {
  namespace Express {
    interface Request { storefront?: StorefrontContext }
  }
}

type CreatorKeyEntry = { key: string; creatorUserId: string }

// Parsed once per process — env doesn't change at runtime. A malformed JSON
// value must not take down the legacy key path, so this never throws.
let creatorKeysCache: Record<string, CreatorKeyEntry> | null = null
function loadCreatorKeys(): Record<string, CreatorKeyEntry> {
  if (creatorKeysCache) return creatorKeysCache
  const out: Record<string, CreatorKeyEntry> = {}
  const raw = process.env.STOREFRONT_CREATOR_KEYS
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      for (const [vendor, entry] of Object.entries(parsed || {})) {
        const e = entry as any
        if (vendor && e && typeof e.key === 'string' && e.key.length >= 16 && typeof e.creatorUserId === 'string' && e.creatorUserId) {
          out[vendor] = { key: e.key, creatorUserId: e.creatorUserId }
        } else {
          console.error(`[storefront-auth] ⚠️ STOREFRONT_CREATOR_KEYS entry "${vendor}" invalid (needs key >= 16 chars + creatorUserId) — skipped`)
        }
      }
    } catch (e: any) {
      console.error('[storefront-auth] ⚠️ STOREFRONT_CREATOR_KEYS is not valid JSON — creator keys disabled:', e?.message)
    }
  }
  creatorKeysCache = out
  return out
}

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function requireStorefrontSecret(req: Request, res: Response, next: NextFunction): void {
  const primary = process.env.STOREFRONT_API_KEY
  const creatorKeys = loadCreatorKeys()

  if (!primary && Object.keys(creatorKeys).length === 0) {
    res.status(503).json({ error: 'Storefront checkout not configured' })
    return
  }

  const header = req.headers.authorization || ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (primary && safeEqual(provided, primary)) {
    // Legacy single-tenant key — unscoped catalog, no creator identity.
    req.storefront = { vendor: process.env.STOREFRONT_PRIMARY_VENDOR || 'earth019', creatorUserId: null }
    next()
    return
  }

  for (const [vendor, entry] of Object.entries(creatorKeys)) {
    if (safeEqual(provided, entry.key)) {
      req.storefront = { vendor, creatorUserId: entry.creatorUserId }
      next()
      return
    }
  }

  res.status(401).json({ error: 'Unauthorized' })
}
