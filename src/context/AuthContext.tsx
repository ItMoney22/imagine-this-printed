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
      console.log('🔄 AuthContext: Getting initial session...')
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) {
          console.error('❌ AuthContext: Error getting session:', error)
          throw error
        }
        console.log('✅ AuthContext: Initial session retrieved:', session ? 'User logged in' : 'No active session')
        setSession(session)
        setUser(session?.user ?? null)
      } catch (error) {
        console.error('❌ AuthContext: Failed to get session:', {
          error,
          message: (error as any)?.message,
          status: (error as any)?.status
        })
      }
      setLoading(false)
    }

    getSession()

    console.log('🔄 AuthContext: Setting up auth state change listener...')
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('🔄 AuthContext: Auth state changed:', { event, hasSession: !!session })
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => {
      console.log('🔄 AuthContext: Cleaning up auth listener')
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    console.log('🔄 AuthContext: Attempting sign in for:', email)
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      
      if (error) {
        console.error('❌ AuthContext: Sign in failed:', {
          error,
          message: error.message,
          status: error.status
        })
      } else {
        console.log('✅ AuthContext: Sign in successful for:', email)
      }
      
      return { data, error }
    } catch (networkError) {
      console.error('❌ AuthContext: Network error during sign in:', {
        error: networkError,
        message: (networkError as any)?.message,
        stack: (networkError as any)?.stack
      })
      return { data: null, error: networkError }
    }
  }

  const signUp = async (email: string, password: string, userData?: any) => {
    console.log('🔄 AuthContext: Attempting sign up for:', email)
    
    try {
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

      if (error) {
        console.error('❌ AuthContext: Sign up failed:', {
          error,
          message: error.message,
          status: error.status
        })
      } else {
        console.log('✅ AuthContext: Sign up successful for:', email, {
          user: data.user ? 'User created' : 'User pending confirmation',
          session: data.session ? 'Session active' : 'No session'
        })
      }

      // Create user profile after successful signup
      if (data.user && !error) {
        console.log('🔄 AuthContext: Creating user profile...')
        await createUserProfile(data.user, userData)
        
        // Process stored referral for real signup
        console.log('🔄 AuthContext: Processing referral for new user...')
        const storedReferral = referralSystem.retrieveStoredReferral()
        if (storedReferral) {
          await processReferralSignup(storedReferral, data.user)
        }
      }

      return { data, error }
    } catch (networkError) {
      console.error('❌ AuthContext: Network error during sign up:', {
        error: networkError,
        message: (networkError as any)?.message,
        stack: (networkError as any)?.stack
      })
      return { data: null, error: networkError }
    }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    
    // Clear local state immediately
    setUser(null)
    setSession(null)
  }

  const createUserProfile = async (user: User, userData?: any) => {
    try {
      const username = user.email?.split('@')[0] || 'user'
      const displayName = userData?.firstName && userData?.lastName 
        ? `${userData.firstName} ${userData.lastName}`.trim()
        : userData?.firstName || 'User'
      
      const defaultProfile = {
        user_id: user.id,
        username: username,
        display_name: displayName,
        bio: '',
        profile_image: null,
        location: '',
        website: '',
        social_links: {},
        is_public: true,
        show_order_history: false,
        show_designs: true,
        show_models: true,
        joined_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('user_profiles')
        .insert([defaultProfile])
        .select()
        .single()

      if (error) {
        console.error('❌ AuthContext: Error creating user profile:', error)
        throw error
      }

      console.log('✅ AuthContext: User profile created successfully:', data)
      return data
    } catch (error) {
      console.error('❌ AuthContext: Failed to create user profile:', error)
      throw error
    }
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