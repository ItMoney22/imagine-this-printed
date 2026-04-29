import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { sendWelcomeEmail } from '../utils/email.js'

const router = Router()
const prisma = new PrismaClient()
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key'

// Types
interface UserPayload {
  id: string
  email: string
  role: string
}

// Legacy JWT verification kept for the /me, /profile, /wallet endpoints
// below, which still expect a Prisma-issued token. The original /login and
// /register routes that minted those tokens have been removed (frontend
// uses Supabase Auth exclusively); these endpoints are effectively dead
// surfaces but are left intact pending a separate audit of /api/account/*
// callers before the rest of the file is retired.
const verifyToken = (token: string): UserPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as UserPayload
  } catch (error) {
    return null
  }
}

// Authentication middleware
const authenticateUser = async (req: Request): Promise<any> => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7)
  const payload = verifyToken(token)
  if (!payload) return null

  const user = await prisma.userProfile.findUnique({
    where: { id: payload.id },
    include: { wallet: true }
  })

  return user
}

router.get('/me', async (req: Request, res: Response) => {
  try {
    const user = await authenticateUser(req)
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    
    return res.status(200).json({ user })
  } catch (error) {
    console.error('Me endpoint error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// Profile routes
router.get('/profile', async (req: Request, res: Response) => {
  try {
    const { username, userId } = req.query
    const currentUser = await authenticateUser(req)

    let profileData = null

    if (userId) {
      profileData = await prisma.userProfile.findUnique({
        where: { id: userId as string },
        include: { wallet: true }
      })
    } else if (username) {
      profileData = await prisma.userProfile.findUnique({
        where: { username: username as string },
        include: { wallet: true }
      })
    }

    if (!profileData && currentUser && (userId === currentUser.id || username === currentUser.username)) {
      const defaultProfile = {
        id: currentUser.id,
        email: currentUser.email,
        username: currentUser.username,
        displayName: currentUser.displayName || 'User',
        firstName: currentUser.firstName,
        lastName: currentUser.lastName,
        bio: '',
        avatarUrl: null,
        role: 'customer',
        emailVerified: currentUser.emailVerified,
        profileCompleted: false,
        preferences: {},
        metadata: {},
        passwordHash: currentUser.passwordHash
      }

      profileData = await prisma.userProfile.create({
        data: defaultProfile,
        include: { wallet: true }
      })
    }

    if (!profileData) {
      return res.status(404).json({ error: 'Profile not found' })
    }

    // Only count paid orders for CRM stats
    const orderStats = await prisma.order.findMany({
      where: {
        userId: profileData.id,
        paymentStatus: 'paid'  // Only count completed/paid orders
      },
      select: { total: true }
    })

    const totalOrders = orderStats.length
    const totalSpent = orderStats.reduce((sum: number, order: any) => sum + (order.total || 0), 0)
    const isOwnProfile = currentUser && currentUser.id === profileData.id

    const userProfile = {
      id: profileData.id,
      userId: profileData.id,
      username: profileData.username,
      displayName: profileData.displayName,
      bio: profileData.bio || '',
      profileImage: profileData.avatarUrl || null,
      location: profileData.phone || '',
      website: profileData.companyName || '',
      socialLinks: profileData.preferences || {},
      isPublic: true,
      showOrderHistory: false,
      showDesigns: true,
      showModels: true,
      joinedDate: profileData.createdAt.toISOString(),
      // CRM stats: only expose to the profile owner. Public viewers see 0.
      totalOrders: isOwnProfile ? totalOrders : 0,
      totalSpent: isOwnProfile ? totalSpent : 0,
      favoriteCategories: [],
      badges: [],
      isOwnProfile
    }

    return res.status(200).json(userProfile)
  } catch (error) {
    console.error('Profile get error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/profile', async (req: Request, res: Response) => {
  try {
    const user = await authenticateUser(req)
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const {
      username,
      displayName,
      bio,
      location,
      website,
      socialLinks,
      avatarUrl,
      isPublic,
      showOrderHistory,
      showDesigns,
      showModels
    } = req.body

    if (!username || !displayName) {
      return res.status(400).json({ error: 'Username and display name are required' })
    }

    const profileData = {
      username,
      displayName,
      bio: bio || '',
      phone: location || '',
      companyName: website || '',
      preferences: socialLinks || {},
      avatarUrl: avatarUrl || null,
      profileCompleted: true
    }

    const existingProfile = await prisma.userProfile.findUnique({
      where: { id: user.id },
      select: { id: true }
    })

    if (existingProfile) {
      await prisma.userProfile.update({
        where: { id: user.id },
        data: profileData
      })
    } else {
      await prisma.userProfile.create({
        data: {
          ...profileData,
          id: user.id,
          email: user.email,
          role: 'customer',
          emailVerified: user.emailVerified,
          passwordHash: user.passwordHash
        }
      })
    }

    return res.status(200).json({ message: 'Profile updated successfully' })
  } catch (error) {
    console.error('Profile update error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// Wallet routes
router.get('/wallet', async (req: Request, res: Response) => {
  try {
    const user = await authenticateUser(req)
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const walletData = await prisma.userWallet.findUnique({
      where: { userId: user.id },
      select: {
        pointsBalance: true,
        itcBalance: true
      }
    })

    // Only get recent transactions for basic display
    const pointsData = await prisma.pointsTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10
    })

    const itcData = await prisma.itcTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10
    })

    return res.status(200).json({
      pointsBalance: walletData?.pointsBalance || 0,
      itcBalance: Number(walletData?.itcBalance || 0),
      pointsHistory: pointsData || [],
      itcHistory: itcData || []
    })
  } catch (error) {
    console.error('Wallet get error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

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