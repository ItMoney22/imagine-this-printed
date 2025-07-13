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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<(User & { role?: string }) | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const getSession = async () => {
      if (supabase) {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          setSession(session)
          setUser(session?.user ?? null)
        } catch (error) {
          console.warn('Supabase auth error:', error)
        }
      }
      setLoading(false)
    }

    getSession()

    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          setSession(session)
          setUser(session?.user ?? null)
          setLoading(false)
        }
      )

      return () => subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    if (!supabase) {
      // Mock sign in for demo purposes
      const mockUser = {
        id: 'demo-user-id',
        email,
        role: email.includes('admin') ? 'admin' : email.includes('manager') ? 'manager' : email.includes('founder') ? 'founder' : email.includes('vendor') ? 'vendor' : 'customer',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString()
      }
      setUser(mockUser as any)
      return { data: { user: mockUser, session: null }, error: null }
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  }

  const signUp = async (email: string, password: string, userData?: any) => {
    if (!supabase) {
      // Mock sign up for demo purposes
      const mockUser = {
        id: 'demo-user-' + Date.now(),
        email,
        role: 'customer',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString()
      }
      
      // Process stored referral for mock signup
      const storedReferral = referralSystem.retrieveStoredReferral()
      if (storedReferral) {
        await processReferralSignup(storedReferral, mockUser as any)
      }
      
      setUser(mockUser as any)
      return { data: { user: mockUser, session: null }, error: null }
    }

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
    return { data, error }
  }

  const signOut = async () => {
    if (!supabase) {
      setUser(null)
      setSession(null)
      return
    }

    const { error } = await supabase.auth.signOut()
    if (error) throw error
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
    if (!supabase) {
      return { data: null, error: null }
    }

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