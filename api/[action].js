import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const prisma = new PrismaClient()
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key'

// Auth utilities
const hashPassword = async (password) => {
  const saltRounds = 12
  return bcrypt.hash(password, saltRounds)
}

const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash)
}

const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' })
}

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch (error) {
    return null
  }
}

// Authentication middleware
const authenticateUser = async (req) => {
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

// Admin authorization middleware
const requireAdmin = async (req) => {
  const user = await authenticateUser(req)
  if (!user || user.role !== 'admin') {
    return null
  }
  return user
}

export default async function handler(req, res) {
  const { action } = req.query

  try {
    switch (action) {
      // Auth routes
      case 'login':
        return await handleLogin(req, res)
      case 'register':
        return await handleRegister(req, res)
      case 'me':
        return await handleMe(req, res)
      
      // Profile routes
      case 'profile-get':
        return await handleProfileGet(req, res)
      case 'profile-update':
        return await handleProfileUpdate(req, res)
      
      // Wallet routes (light operations only)
      case 'wallet-get':
        return await handleWalletGet(req, res)
      
      // Admin routes (redirect to VPS for heavy operations)
      case 'admin-create-user':
      case 'admin-table-data':
      case 'admin-tables':
        return await redirectToVPS(req, res, action)
      
      // Payment routes (redirect to VPS)
      case 'create-payment-intent':
      case 'wallet-redeem':
        return await redirectToVPS(req, res, action)
      
      default:
        return res.status(404).json({ error: 'Action not found' })
    }
  } catch (error) {
    console.error('API error:', error)
    res.status(500).json({ error: 'Internal server error' })
  } finally {
    await prisma.$disconnect()
  }
}

// Auth handlers
async function handleLogin(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  const user = await prisma.userProfile.findUnique({
    where: { email },
    include: { wallet: true }
  })
  
  if (!user) {
    return res.status(401).json({ error: 'User not found' })
  }
  
  const isValidPassword = await verifyPassword(password, user.passwordHash)
  if (!isValidPassword) {
    return res.status(401).json({ error: 'Invalid password' })
  }
  
  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role
  })
  
  res.status(200).json({ user, token })
}

async function handleRegister(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, password, userData } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  const existingUser = await prisma.userProfile.findUnique({
    where: { email }
  })

  if (existingUser) {
    return res.status(400).json({ error: 'User already exists' })
  }

  const hashedPassword = await hashPassword(password)
  const username = email.split('@')[0]
  const displayName = userData?.firstName && userData?.lastName 
    ? `${userData.firstName} ${userData.lastName}`.trim()
    : userData?.firstName || 'User'
  
  const user = await prisma.userProfile.create({
    data: {
      email,
      passwordHash: hashedPassword,
      username,
      displayName,
      firstName: userData?.firstName,
      lastName: userData?.lastName,
      role: 'customer',
      emailVerified: false,
      profileCompleted: false,
      preferences: {},
      metadata: {},
      wallet: {
        create: {
          pointsBalance: 0,
          itcBalance: 0,
          lifetimePointsEarned: 0,
          lifetimeItcEarned: 0,
          walletStatus: 'active'
        }
      }
    },
    include: {
      wallet: true
    }
  })

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role
  })
  
  res.status(201).json({ user, token })
}

async function handleMe(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const user = await authenticateUser(req)
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  
  res.status(200).json({ user })
}

// Profile handlers
async function handleProfileGet(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { username, userId } = req.query
  const currentUser = await authenticateUser(req)

  let profileData = null

  if (userId) {
    profileData = await prisma.userProfile.findUnique({
      where: { id: userId },
      include: { wallet: true }
    })
  } else if (username) {
    profileData = await prisma.userProfile.findUnique({
      where: { username: username },
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

  const orderStats = await prisma.order.findMany({
    where: { userId: profileData.id },
    select: { total: true }
  })

  const totalOrders = orderStats.length
  const totalSpent = orderStats.reduce((sum, order) => sum + (order.total || 0), 0)
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
    totalOrders,
    totalSpent,
    favoriteCategories: [],
    badges: [],
    isOwnProfile
  }

  res.status(200).json(userProfile)
}

async function handleProfileUpdate(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

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

  res.status(200).json({ message: 'Profile updated successfully' })
}

// Wallet handlers (light operations only)
async function handleWalletGet(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

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

  res.status(200).json({
    pointsBalance: walletData?.pointsBalance || 0,
    itcBalance: Number(walletData?.itcBalance || 0),
    pointsHistory: pointsData || [],
    itcHistory: itcData || []
  })
}

// VPS redirect handler
async function redirectToVPS(req, res, action) {
  const vpsBaseUrl = 'https://api.imaginethisprinted.com'
  const vpsUrl = `${vpsBaseUrl}/api/${action}`

  try {
    const response = await fetch(vpsUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization || ''
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
    })

    const data = await response.json()
    res.status(response.status).json(data)
  } catch (error) {
    console.error('VPS redirect error:', error)
    res.status(500).json({ error: 'VPS service unavailable' })
  }
}