import { Router, Request, Response } from 'express'
import { sendWelcomeEmail } from '../utils/email.js'

const router = Router()

// The legacy Prisma-JWT `/me`, `/profile` (GET/POST), and `/wallet` routes
// that used to live here have been removed (2026-07-27 audit). They
// authenticated against a locally-issued Prisma JWT (`JWT_SECRET`), but the
// only routes that ever minted such a token — `/login` and `/register` —
// were already removed in an earlier cycle (frontend uses Supabase Auth
// exclusively). A repo-wide search of `src/` found zero callers of
// `/api/account/me`, `/api/account/profile`, or `/api/account/wallet` —
// they always 401'd. Removing them retires the last consumer of the legacy
// `JWT_SECRET` in this file, closing the gap where it could be confused
// with `SUPABASE_JWT_SECRET`.

// ===========================================
// SEND WELCOME EMAIL (for Supabase Auth signups)
// ===========================================

// Anti-spam: cap by destination email AND by source IP. The endpoint is
// unauthenticated because it's called immediately after signUp, before the
// session token exists when email confirmation is enabled.
const welcomeEmailLimitByAddress = new Map<string, number>() // email -> last send (ms)
const welcomeEmailLimitByIp = new Map<string, { count: number; resetAt: number }>()

function checkWelcomeEmailLimit(email: string, ip: string): boolean {
  const now = Date.now()

  // 60s cooldown per email address (blocks bombing one inbox)
  const lastSent = welcomeEmailLimitByAddress.get(email)
  if (lastSent && now - lastSent < 60_000) return false
  welcomeEmailLimitByAddress.set(email, now)

  // 5 sends per IP per 5 minutes (blocks scripted enumeration)
  const ipState = welcomeEmailLimitByIp.get(ip)
  if (!ipState || ipState.resetAt < now) {
    welcomeEmailLimitByIp.set(ip, { count: 1, resetAt: now + 300_000 })
    return true
  }
  if (ipState.count >= 5) return false
  ipState.count++
  return true
}

/**
 * POST /api/account/send-welcome-email
 * Send welcome email to a new user after Supabase signup
 * Called from the frontend after successful registration
 */
router.post('/send-welcome-email', async (req: Request, res: Response) => {
  try {
    const { email, username } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    const ip = (req.ip || req.headers['x-forwarded-for'] || 'unknown') as string
    if (!checkWelcomeEmailLimit(email, ip)) {
      return res.status(429).json({ error: 'Too many requests' })
    }

    const displayName = username || email.split('@')[0] || 'Friend'

    console.log('[account] 📧 Sending welcome email to:', email, 'as:', displayName)

    try {
      await sendWelcomeEmail(email, displayName)
      console.log('[account] ✅ Welcome email sent successfully to:', email)
      return res.status(200).json({ success: true, message: 'Welcome email sent' })
    } catch (emailError: any) {
      console.error('[account] ❌ Failed to send welcome email:', emailError)
      // Return success anyway - we don't want to fail registration over email
      return res.status(200).json({ success: false, message: 'Email sending failed but registration complete' })
    }
  } catch (error: any) {
    console.error('[account] ❌ Welcome email endpoint error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router