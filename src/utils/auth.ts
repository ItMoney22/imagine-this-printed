import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from './database'

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key'

export interface UserPayload {
  id: string
  email: string
  role: string
}

export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12
  return bcrypt.hash(password, saltRounds)
}

export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash)
}

export const generateToken = (payload: UserPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' })
}

export const verifyToken = (token: string): UserPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as UserPayload
  } catch (error) {
    return null
  }
}

export const generateEmailVerificationToken = (): string => {
  return jwt.sign({ purpose: 'email_verification' }, JWT_SECRET, { expiresIn: '1h' })
}

export const generatePasswordResetToken = (): string => {
  return jwt.sign({ purpose: 'password_reset' }, JWT_SECRET, { expiresIn: '1h' })
}

export const verifyEmailVerificationToken = (token: string): boolean => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    return decoded.purpose === 'email_verification'
  } catch (error) {
    return false
  }
}

export const verifyPasswordResetToken = (token: string): boolean => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    return decoded.purpose === 'password_reset'
  } catch (error) {
    return false
  }
}

export const createUser = async (email: string, password: string, userData?: any) => {
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
  
  return user
}

export const authenticateUser = async (email: string, password: string) => {
  const user = await prisma.userProfile.findUnique({
    where: { email },
    include: { wallet: true }
  })
  
  if (!user) {
    throw new Error('User not found')
  }
  
  const isValidPassword = await verifyPassword(password, user.passwordHash)
  if (!isValidPassword) {
    throw new Error('Invalid password')
  }
  
  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role
  })
  
  return { user, token }
}

export const getUserFromToken = async (token: string) => {
  const payload = verifyToken(token)
  if (!payload) {
    return null
  }
  
  const user = await prisma.userProfile.findUnique({
    where: { id: payload.id },
    include: { wallet: true }
  })
  
  return user
}