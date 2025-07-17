import { PrismaClient } from '@prisma/client'
import { verifyToken } from '../../src/utils/auth.js'

const prisma = new PrismaClient()

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { username, userId } = req.query
    const authHeader = req.headers.authorization

    let profileData = null
    let currentUser = null

    // Get current user if authenticated
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7)
      const userPayload = verifyToken(token)
      if (userPayload) {
        currentUser = await prisma.userProfile.findUnique({
          where: { id: userPayload.id },
          include: { wallet: true }
        })
      }
    }

    // Load profile based on parameters
    if (userId) {
      // Load by user ID (for account route)
      profileData = await prisma.userProfile.findUnique({
        where: { id: userId },
        include: { wallet: true }
      })
    } else if (username) {
      // Load by username (for public profile)
      profileData = await prisma.userProfile.findUnique({
        where: { username: username },
        include: { wallet: true }
      })
    }

    // If no profile found and this is the current user's request, create default profile
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

    // Load additional stats from orders
    const orderStats = await prisma.order.findMany({
      where: { userId: profileData.id },
      select: { total: true }
    })

    const totalOrders = orderStats.length
    const totalSpent = orderStats.reduce((sum, order) => sum + (order.total || 0), 0)

    // Check if this is the current user's profile
    const isOwnProfile = currentUser && currentUser.id === profileData.id

    // Format response
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
      totalOrders,
      totalSpent,
      favoriteCategories: [],
      badges: [],
      isOwnProfile
    }

    res.status(200).json(userProfile)
  } catch (error) {
    console.error('Error loading profile:', error)
    res.status(500).json({ error: 'Internal server error' })
  } finally {
    await prisma.$disconnect()
  }
}