import { Router, Request, Response } from 'express'
import { sendWelcomeEmail } from '../utils/email.js'
import { supabase } from '../lib/supabase.js'
import { verifyAccountClaimToken } from '../utils/account-claim-token.js'

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

// ===========================================
// POST-PURCHASE ACCOUNT CLAIM (opt-in)
// ===========================================
//
// A guest buyer clicks the signed link in their order confirmation and gets an
// account whose email is already verified — they proved they own the inbox by
// receiving the link. Their past orders are linked on the way through, so the
// account has history from the first sign-in instead of being empty.
//
// The email is never taken from the request. It is read from the order row the
// token is signed for, so the worst a tampered link can do is fail.

/** Orders matching this email get adopted by the new account. */
async function linkPastOrders(email: string, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('orders')
    .update({ user_id: userId })
    .ilike('customer_email', email)
    .is('user_id', null)
    .select('id')

  if (error) {
    console.error('[claim] order backfill failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

/** Resolves the order behind a claim token, or the reason it cannot be used. */
async function resolveClaim(orderId: string, token: unknown) {
  const check = verifyAccountClaimToken(orderId, typeof token === 'string' ? token : null)
  if (!check.valid) {
    const message = check.reason === 'expired'
      ? 'This link has expired. Ask us to send a new one and we will sort you out.'
      : 'This link is not valid.'
    return { ok: false as const, status: 400, message }
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, customer_email, customer_name')
    .eq('id', orderId)
    .maybeSingle()

  if (!order?.customer_email) {
    // Either the order is gone or it never carried an address — a checkout
    // abandoned before the email field cannot be claimed by anyone.
    return { ok: false as const, status: 404, message: 'We could not find an order for this link.' }
  }

  const email = String(order.customer_email).trim().toLowerCase()

  // listUsers has no server-side email filter, so this is a scan. It stays cheap
  // because the platform's real user count is small and the endpoint is behind
  // authLimiter; revisit if the table grows past a few thousand.
  const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const alreadyHasAccount = (existing?.users || []).some(
    u => (u.email || '').toLowerCase() === email
  )

  return { ok: true as const, order, email, alreadyHasAccount }
}

/**
 * GET /api/account/claim/:orderId?t=<token>
 * Read-only preview so the claim page can address the buyer by name and tell
 * them up front whether they already have an account.
 */
router.get('/claim/:orderId', async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await resolveClaim(req.params.orderId, req.query.t)
    if (!result.ok) return res.status(result.status).json({ error: result.message })

    const [user, domain] = result.email.split('@')
    return res.json({
      orderNumber: result.order.order_number,
      customerName: result.order.customer_name,
      // Masked: the page confirms which inbox this is for without printing a
      // full address onto a screen that may be shared or shoulder-surfed.
      emailMasked: `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`,
      alreadyHasAccount: result.alreadyHasAccount
    })
  } catch (error: any) {
    console.error('[claim] preview failed:', error)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

/**
 * POST /api/account/claim/:orderId
 * Body: { t: string, password: string }
 * Creates the account and adopts the buyer's past orders.
 */
router.post('/claim/:orderId', async (req: Request, res: Response): Promise<any> => {
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  }

  try {
    const result = await resolveClaim(req.params.orderId, req.body?.t)
    if (!result.ok) return res.status(result.status).json({ error: result.message })

    if (result.alreadyHasAccount) {
      // Never touch an existing account from an emailed link — that would be an
      // account-takeover path. Send them to the normal sign-in instead.
      return res.status(409).json({
        error: 'You already have an account with this email. Sign in and your orders will be there.',
        alreadyHasAccount: true
      })
    }

    const [firstName, ...restName] = String(result.order.customer_name || '').trim().split(/\s+/)

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: result.email,
      password,
      // They received the link at this address, so the address is proven.
      email_confirm: true,
      user_metadata: {
        first_name: firstName || undefined,
        last_name: restName.join(' ') || undefined,
        display_name: result.order.customer_name || undefined,
        claimed_from_order: result.order.order_number || result.order.id
      }
    })

    if (createError || !created?.user) {
      console.error('[claim] createUser failed:', createError?.message)
      return res.status(500).json({ error: 'We could not create your account. Please try again.' })
    }

    const linkedOrders = await linkPastOrders(result.email, created.user.id)

    console.log(
      `[claim] account created for ${result.email} from order ${result.order.order_number} `
      + `(${linkedOrders} order(s) linked)`
    )

    return res.json({ ok: true, email: result.email, linkedOrders })
  } catch (error: any) {
    console.error('[claim] failed:', error)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

export default router
