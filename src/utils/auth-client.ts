// Frontend-safe authentication service that uses API endpoints
import { apiFetch } from '@/lib/api';

export interface User {
  id: string
  email: string
  role: string
  username: string
  displayName?: string
  firstName?: string
  lastName?: string
  emailVerified: boolean
  profileCompleted: boolean
  wallet?: {
    pointsBalance: number
    itcBalance: number
  }
}

export interface AuthResponse {
  user?: User
  token?: string
  error?: string
}

export const authenticateUser = async (email: string, password: string): Promise<AuthResponse> => {
  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })

    return { user: data.user, token: data.token }
  } catch (error) {
    console.error('Authentication error:', error)
    return { error: error instanceof Error ? error.message : 'Network error occurred' }
  }
}

export const createUser = async (email: string, password: string, userData?: any): Promise<AuthResponse> => {
  try {
    const data = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        username: userData?.username || email.split('@')[0],
        ...userData
      }),
    })

    return { user: data.user, token: data.token }
  } catch (error) {
    console.error('Registration error:', error)
    return { error: error instanceof Error ? error.message : 'Network error occurred' }
  }
}

export const getUserFromToken = async (token: string): Promise<User | null> => {
  try {
    const data = await apiFetch('/api/auth/me', {
      method: 'GET',
    })
    return data.user
  } catch (error) {
    console.error('Get user error:', error)
    return null
  }
}

export const sendPasswordResetEmail = async (email: string): Promise<{ error?: string }> => {
  try {
    await apiFetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })

    return {}
  } catch (error) {
    console.error('Password reset error:', error)
    return { error: error instanceof Error ? error.message : 'Network error occurred' }
  }
}