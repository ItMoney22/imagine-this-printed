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
// SEND WELCOME EMAIL (confirmed accounts only)
// ===========================================
//
// 2026-09-22 (Sifu, Watchtower 4d915741). This endpoint used to take an
// arbitrary `email` out of the request body and mail it, with no
// authentication at all. That made it an open relay for welcome mail from the
// imaginethisprinted.com domain: anyone who knew the URL could send our
// branded mail to any inbox on earth without ever creating an account, and
// during the September bot wave it was the thing that put welcome mail in
// front of ~290 scraped corporate addresses. Reputation damage to a sending
// domain is slow to earn back, so the rules are now:
//
//   1. The caller must present a Supabase access token. No token, no send.
//   2. The destination address is read from the VERIFIED token, never from
//      the request body. A tampered body can no longer redirect the mail.
//   3. The address must already be CONFIRMED. An unconfirmed signup has not
//      proved it owns the inbox, and mailing it is exactly the spam the bot
//      wave produced.
//   4. One welcome per account, forever — stamped on
//      user_profiles.welcome_email_sent_at (added in
//      supabase/migrations/20260922120000_signup_wallet_and_welcome_email.sql)
//      rather than an in-process map, which forgot everything on each Render
//      restart and reset per instance.
//
// The frontend therefore calls this from the auth callback (where a confirmed
// session exists) instead of straight after signUp, where one never did.

/** Per-IP backstop. Points 1–4 are the real control; this just caps noise. */
const welcomeEmailLimitByIp = new Map<string, { count: number; resetAt: number }>()

function checkWelcomeEmailIpLimit(ip: string): boolean {
  const now = Date.now()
  const state = welcomeEmailLimitByIp.get(ip)
  if (!state || state.resetAt < now) {
    welcomeEmailLimitByIp.set(ip, { count: 1, resetAt: now + 300_000 })
    return true
  }
  if (state.count >= 5) return false
  state.count++
  return true
}

/**
 * POST /api/account/send-welcome-email
 * Authorization: Bearer <supabase access token>
 *
 * Sends the one-time welcome email for the confirmed account the token
 * belongs to. Idempotent: a second call returns 200 without sending.
 */
router.post('/send-welcome-email', async (req: Request, res: Response) => {
  try {
    const ip = (req.ip || req.headers['x-forwarded-for'] || 'unknown') as string
    if (!checkWelcomeEmailIpLimit(ip)) {
      return res.status(429).json({ error: 'Too many requests' })
    }

    const authHeader = req.headers.authorization
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : ''
    if (!token) {
      return res.status(401).json({ error: 'Sign-in required' })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      console.warn('[account] welcome email: token rejected')
      return res.status(401).json({ error: 'Sign-in required' })
    }

    // `confirmed_at` covers accounts confirmed by phone or by an admin as well
    // as by email link; either way the address has been vouched for.
    const isConfirmed = Boolean((user as any).email_confirmed_at || (user as any).confirmed_at)
    if (!isConfirmed) {
      console.warn('[account] welcome email: account not confirmed, refusing to send')
      return res.status(403).json({ error: 'Confirm your email address first' })
    }

    const email = user.email
    if (!email) {
      return res.status(400).json({ error: 'Account has no email address' })
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('username, display_name, first_name, welcome_email_sent_at')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) {
      // Do not fail open into a send — a read failure is not proof it is unsent.
      console.error('[account] welcome email: profile lookup failed:', profileError.message)
      return res.status(503).json({ error: 'Could not verify account state' })
    }

    if (profile?.welcome_email_sent_at) {
      return res.status(200).json({ success: true, alreadySent: true })
    }

    const metadata = (user.user_metadata || {}) as Record<string, string | undefined>
    const displayName =
      profile?.display_name ||
      profile?.first_name ||
      profile?.username ||
      metadata.display_name ||
      metadata.first_name ||
      email.split('@')[0] ||
      'Friend'

    console.log('[account] 📧 Sending welcome email to confirmed account:', user.id)

    // Stamp BEFORE sending. A crash between send and stamp would otherwise let
    // a retry mail the customer twice; a crash between stamp and send costs
    // them a welcome email, which is the cheaper of the two mistakes.
    const { error: stampError } = await supabase
      .from('user_profiles')
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq('id', user.id)
      .is('welcome_email_sent_at', null)

    if (stampError) {
      console.error('[account] welcome email: could not stamp profile:', stampError.message)
      return res.status(503).json({ error: 'Could not record welcome email' })
    }

    try {
      await sendWelcomeEmail(email, displayName)
      console.log('[account] ✅ Welcome email sent successfully')
      return res.status(200).json({ success: true })
    } catch (emailError: any) {
      console.error('[account] ❌ Failed to send welcome email:', emailError)
      // Registration already succeeded; a failed welcome is not the customer's
      // problem. Clear the stamp so a later attempt can try again.
      await supabase
        .from('user_profiles')
        .update({ welcome_email_sent_at: null })
        .eq('id', user.id)
      return res.status(200).json({ success: false, message: 'Welcome email could not be sent' })
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
