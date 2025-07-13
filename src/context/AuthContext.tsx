import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import type { ReactNode } from 'react'
import { supabase } from '../utils/supabase'
import { referralSystem } from '../utils/referral-system'

interface AuthContextType {
  user: (User & { role?: string }) | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<any>
  signUp: (email: string, password: string, userData?: any) => Promise<any>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<any>
  processReferralCode: (code: string) => Promise<boolean>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<(User & { role?: string }) | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const getSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setSession(session)
        setUser(session?.user ?? null)
      } catch (error) {
        console.warn('Supabase auth error:', error)
      }
      setLoading(false)
    }

    getSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  }

  const signUp = async (email: string, password: string, userData?: any) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: 'customer',
          ...userData
        }
      }
    })

    // Process stored referral for real signup
    if (data.user && !error) {
      const storedReferral = referralSystem.retrieveStoredReferral()
      if (storedReferral) {
        await processReferralSignup(storedReferral, data.user)
      }
    }

    return { data, error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    
    // Clear local state immediately
    setUser(null)
    setSession(null)
  }

  const processReferralSignup = async (referralCode: string, user: User) => {
    try {
      const transaction = await referralSystem.processReferral(
        referralCode,
        user.id,
        user.email || ''
      )
      
      if (transaction) {
        // In real app, would update user's points balance
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

  const resetPassword = async (email: string) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email)
    return { data, error }
  }

  const value = {
    user,
    session,
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