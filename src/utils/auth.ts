import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
// Removed direct Prisma import - database operations moved to API endpoints

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

// createUser function moved to API endpoint - use createUserAPI from auth-client.ts instead

// authenticateUser function moved to API endpoint - use authenticateUserAPI from auth-client.ts instead

// getUserFromToken function moved to API endpoint - use getUserFromTokenAPI from auth-client.ts instead