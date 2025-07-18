import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const prisma = new PrismaClient()
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key'

const hashPassword = async (password) => {
  const saltRounds = 12
  return bcrypt.hash(password, saltRounds)
}

const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { email, password, userData } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    // Check if user already exists
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
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Internal server error' })
  } finally {
    await prisma.$disconnect()
  }
}