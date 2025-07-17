import React, { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { authenticateUser, createUser, getUserFromToken } from '../utils/auth'
import { sendEmailVerification, sendPasswordResetEmail, sendWelcomeEmail } from '../utils/email'
import { prisma } from '../utils/database'
import { referralSystem } from '../utils/referral-system'

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
  processReferralCode: (code: string) => Promise<boolean>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

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
      const { user: userData, token } = await authenticateUser(email, password)
      
      localStorage.setItem('auth_token', token)
      
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
      
      console.log('✅ AuthContext: Sign in successful')
      return {}
    } catch (error: any) {
      console.error('❌ AuthContext: Sign in failed:', error)
      return { error: error.message }
    }
  }

  const signUp = async (email: string, password: string, userData?: any): Promise<{ error?: string }> => {
    console.log('🔄 AuthContext: Attempting sign up for:', email)
    
    try {
      const newUser = await createUser(email, password, userData)
      
      console.log('✅ AuthContext: User created successfully')
      
      // Send email verification
      const verificationToken = await prisma.userProfile.update({
        where: { id: newUser.id },
        data: { emailVerificationToken: 'temp-token' }, // Replace with actual token generation
        select: { emailVerificationToken: true }
      })
      
      await sendEmailVerification(email, verificationToken.emailVerificationToken!)
      await sendWelcomeEmail(email, userData?.firstName)
      
      // Process stored referral for real signup
      console.log('🔄 AuthContext: Processing referral for new user...')
      const storedReferral = referralSystem.retrieveStoredReferral()
      if (storedReferral) {
        await processReferralSignup(storedReferral, newUser)
      }
      
      return {}
    } catch (error: any) {
      console.error('❌ AuthContext: Sign up failed:', error)
      return { error: error.message }
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
      const existingUser = await prisma.userProfile.findUnique({
        where: { email }
      })
      
      if (!existingUser) {
        return { error: 'User not found' }
      }
      
      const resetToken = 'temp-reset-token' // Replace with actual token generation
      const resetExpiry = new Date(Date.now() + 3600000) // 1 hour
      
      await prisma.userProfile.update({
        where: { id: existingUser.id },
        data: {
          passwordResetToken: resetToken,
          passwordResetExpiry: resetExpiry
        }
      })
      
      await sendPasswordResetEmail(email, resetToken)
      
      console.log('✅ AuthContext: Password reset email sent')
      return {}
    } catch (error: any) {
      console.error('❌ AuthContext: Password reset failed:', error)
      return { error: error.message }
    }
  }

  const processReferralSignup = async (referralCode: string, user: any) => {
    try {
      const transaction = await referralSystem.processReferral(
        referralCode,
        user.id,
        user.email || ''
      )
      
      if (transaction) {
        console.log('Referral processed successfully:', transaction)
        
        // Show success message to user
        setTimeout(() => {
          alert(`Welcome! You've received ${transaction.refereeReward} bonus points from your referral!`)
        }, 1000)
      }
    } catch (error) {
      console.error('Error processing referral:', error)
    }
  }

  const processReferralCode = async (code: string): Promise<boolean> => {
    const validation = await referralSystem.validateReferralCode(code)
    if (validation.valid) {
      referralSystem.storeReferralCode(code)
      return true
    }
    return false
  }

  const value = {
    user,
    loading,
    signIn,
    signUp,
    signOut,
    resetPassword,
    processReferralCode,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}