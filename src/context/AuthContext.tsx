import React, { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { authenticateUser, createUser, getUserFromToken, sendPasswordResetEmail } from '../utils/auth-client'

interface User {
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

interface AuthContextType {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signUp: (email: string, password: string, userData?: any) => Promise<{ error?: string }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error?: string }>
  validateReferralCode: (code: string) => Promise<{ isValid: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadUser = async () => {
      console.log('🔄 AuthContext: Loading user from localStorage...')
      
      const token = localStorage.getItem('auth_token')
      if (!token) {
        console.log('ℹ️ AuthContext: No token found')
        setLoading(false)
        return
      }

      try {
        const userData = await getUserFromToken(token)
        if (userData) {
          console.log('✅ AuthContext: User loaded successfully')
          setUser({
            id: userData.id,
            email: userData.email,
            role: userData.role,
            username: userData.username,
            displayName: userData.displayName || undefined,
            firstName: userData.firstName || undefined,
            lastName: userData.lastName || undefined,
            emailVerified: userData.emailVerified,
            profileCompleted: userData.profileCompleted,
            wallet: userData.wallet ? {
              pointsBalance: userData.wallet.pointsBalance,
              itcBalance: Number(userData.wallet.itcBalance)
            } : undefined
          })
        } else {
          console.log('❌ AuthContext: Invalid token, removing from localStorage')
          localStorage.removeItem('auth_token')
        }
      } catch (error) {
        console.error('❌ AuthContext: Error loading user:', error)
        localStorage.removeItem('auth_token')
      }
      
      setLoading(false)
    }

    loadUser()
  }, [])

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    console.log('🔄 AuthContext: Attempting sign in for:', email)
    
    try {
      const result = await authenticateUser(email, password)
      
      if (result.error) {
        return { error: result.error }
      }

      if (result.token && result.user) {
        localStorage.setItem('auth_token', result.token)
        setUser(result.user)
        console.log('✅ AuthContext: Sign in successful')
        return {}
      }

      return { error: 'Authentication failed' }
    } catch (error: any) {
      console.error('❌ AuthContext: Sign in failed:', error)
      return { error: error.message || 'Sign in failed' }
    }
  }

  const signUp = async (email: string, password: string, userData?: any): Promise<{ error?: string }> => {
    console.log('🔄 AuthContext: Attempting sign up for:', email)
    
    try {
      const result = await createUser(email, password, userData)
      
      if (result.error) {
        return { error: result.error }
      }

      if (result.token && result.user) {
        localStorage.setItem('auth_token', result.token)
        setUser(result.user)
        console.log('✅ AuthContext: Sign up successful')
        return {}
      }

      return { error: 'Registration failed' }
    } catch (error: any) {
      console.error('❌ AuthContext: Sign up failed:', error)
      return { error: error.message || 'Sign up failed' }
    }
  }

  const signOut = async () => {
    console.log('🔄 AuthContext: Signing out user')
    localStorage.removeItem('auth_token')
    setUser(null)
  }

  const resetPassword = async (email: string): Promise<{ error?: string }> => {
    console.log('🔄 AuthContext: Attempting password reset for:', email)
    
    try {
      const result = await sendPasswordResetEmail(email)
      
      if (result.error) {
        return { error: result.error }
      }

      console.log('✅ AuthContext: Password reset email sent')
      return {}
    } catch (error: any) {
      console.error('❌ AuthContext: Password reset failed:', error)
      return { error: error.message || 'Password reset failed' }
    }
  }

  const validateReferralCode = async (code: string): Promise<{ isValid: boolean; error?: string }> => {
    try {
      const response = await fetch('/api/referrals/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      })

      const data = await response.json()

      if (!response.ok) {
        return { isValid: false, error: data.error || 'Validation failed' }
      }

      return { isValid: data.isValid }
    } catch (error: any) {
      console.error('Referral validation error:', error)
      return { isValid: false, error: 'Network error occurred' }
    }
  }

  const value: AuthContextType = {
    user,
    loading,
    signIn,
    signUp,
    signOut,
    resetPassword,
    validateReferralCode,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}