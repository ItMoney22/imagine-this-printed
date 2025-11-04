import React, { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase, STORAGE_KEY } from '@/lib/supabase'
import type { User as SupabaseUser } from '@supabase/supabase-js'

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
  signInWithGoogle: () => Promise<{ error?: string }>
  signInWithMagicLink: (email: string) => Promise<{ error?: string }>
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

// Helper function to convert Supabase user to our User interface
const mapSupabaseUserToUser = async (supabaseUser: SupabaseUser): Promise<User | null> => {
  try {
    // Get user profile data
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select(`
        *,
        user_wallets (
          points,
          itc_balance
        )
      `)
      .eq('id', supabaseUser.id)
      .single()

    if (error) {
      console.error('Error fetching user profile:', error)
      return null
    }

    if (!profile) {
      return null
    }

    // PostgREST returns user_wallets as an array, get first item
    const walletData = Array.isArray(profile.user_wallets)
      ? profile.user_wallets[0]
      : profile.user_wallets

    return {
      id: profile.id,
      email: profile.email,
      role: profile.role || 'customer',
      username: profile.username,
      displayName: profile.display_name,
      firstName: profile.first_name,
      lastName: profile.last_name,
      emailVerified: profile.email_verified || false,
      profileCompleted: profile.profile_completed || false,
      wallet: walletData ? {
        pointsBalance: walletData.points || 0,
        itcBalance: Number(walletData.itc_balance) || 0
      } : undefined
    }
  } catch (error) {
    console.error('Error mapping Supabase user:', error)
    return null
  }
}

export const SupabaseAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    console.log('[AuthContext] 🚀 Initializing auth context...')

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      console.log('[AuthContext] 📦 Initial session check:', {
        hasSession: !!session,
        hasUser: !!session?.user,
        userId: session?.user?.id,
        error: error?.message
      })

      if (error) {
        console.error('[AuthContext] ❌ Error getting initial session:', error)
      }

      if (session?.user) {
        console.log('[AuthContext] 👤 Mapping Supabase user to app user...')
        const mappedUser = await mapSupabaseUserToUser(session.user)
        if (mappedUser) {
          console.log('[AuthContext] ✅ User loaded:', {
            id: mappedUser.id,
            email: mappedUser.email,
            username: mappedUser.username
          })
          setUser(mappedUser)
        } else {
          console.warn('[AuthContext] ⚠️ Failed to map user profile')
        }
      } else {
        console.log('[AuthContext] ℹ️ No active session found')
      }

      setLoading(false)
      console.log('[AuthContext] ✅ Initial auth check complete')
    })

    // Listen for auth changes
    console.log('[AuthContext] 👂 Setting up auth state change listener...')
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[AuthContext] 🔄 Auth state changed:', event, {
        hasSession: !!session,
        userId: session?.user?.id
      })

      if (session?.user) {
        console.log('[AuthContext] 👤 User signed in, fetching profile...')
        const mappedUser = await mapSupabaseUserToUser(session.user)
        if (mappedUser) {
          console.log('[AuthContext] ✅ User profile loaded:', mappedUser.username)
          setUser(mappedUser)
        } else {
          console.warn('[AuthContext] ⚠️ Failed to load user profile after sign in')
          setUser(null)
        }
      } else {
        console.log('[AuthContext] 👋 User signed out')
        setUser(null)
      }
      setLoading(false)
    })

    return () => {
      console.log('[AuthContext] 🧹 Cleaning up auth listener')
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string): Promise<{ error?: string }> => {
    console.log('🔄 SupabaseAuth: Attempting sign in for:', email)
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        console.error('❌ SupabaseAuth: Sign in failed:', error)
        return { error: error.message }
      }

      if (data.user) {
        console.log('✅ SupabaseAuth: Sign in successful')
        return {}
      }

      return { error: 'Authentication failed' }
    } catch (error: any) {
      console.error('❌ SupabaseAuth: Sign in exception:', error)
      return { error: error.message || 'Sign in failed' }
    }
  }

  const signUp = async (email: string, password: string, userData?: any): Promise<{ error?: string }> => {
    console.log('🔄 SupabaseAuth: Attempting sign up for:', email)
    
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: userData?.username || email.split('@')[0],
            display_name: userData?.displayName || userData?.firstName || email.split('@')[0],
            first_name: userData?.firstName,
            last_name: userData?.lastName,
          }
        }
      })

      if (error) {
        console.error('❌ SupabaseAuth: Sign up failed:', error)
        return { error: error.message }
      }

      if (data.user) {
        console.log('✅ SupabaseAuth: Sign up successful')
        return {}
      }

      return { error: 'Registration failed' }
    } catch (error: any) {
      console.error('❌ SupabaseAuth: Sign up exception:', error)
      return { error: error.message || 'Sign up failed' }
    }
  }

  const signInWithGoogle = async (): Promise<{ error?: string }> => {
    console.log('[AuthContext] 🔄 Attempting Google OAuth sign in')

    try {
      // Save current path for post-auth redirect
      const currentPath = window.location.pathname + window.location.search
      if (currentPath !== '/login' && currentPath !== '/signup') {
        localStorage.setItem('auth_return_to', currentPath)
        console.log('[AuthContext] 💾 Saved return path:', currentPath)
      }

      // IMPORTANT: Use apex domain consistently (no www)
      // This MUST match where the user starts the OAuth flow
      const redirectTo = `${window.location.origin}/auth/callback`
      console.log('[AuthContext] 🎯 OAuth redirect URL:', redirectTo)
      console.log('[AuthContext] 🌐 Current origin:', window.location.origin)

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
          skipBrowserRedirect: true, // CRITICAL: Ensures PKCE state/verifier are stored before redirect
        }
      })

      if (error) {
        console.error('[AuthContext] ❌ Google sign in failed:', error)
        return { error: error.message }
      }

      if (!data?.url) {
        console.error('[AuthContext] ❌ No provider redirect URL returned')
        return { error: 'No provider redirect URL returned' }
      }

      console.log('[AuthContext] ✅ PKCE keys stored, manual redirect to:', data.url)

      // CRITICAL WORKAROUND: Manually persist PKCE state to ensure it's available on callback
      // skipBrowserRedirect: true sometimes doesn't persist the oauth-state before redirect
      try {
        const providerUrl = new URL(data.url)
        const state = providerUrl.searchParams.get('state')

        if (state) {
          const stateKey = `${STORAGE_KEY}-oauth-state`
          localStorage.setItem(stateKey, state)
          console.log('[PKCE] 🔐 Manually stored oauth-state under:', stateKey)
          console.log('[PKCE] 📊 Current storage keys:', Object.keys(localStorage).filter(k => k.startsWith('sb-')))
        } else {
          console.warn('[PKCE] ⚠️ No state parameter found in provider URL')
        }
      } catch (err) {
        console.warn('[PKCE] ⚠️ Failed to parse provider URL or store state:', err)
      }

      // Manual redirect AFTER PKCE data is safely saved to localStorage
      window.location.assign(data.url)
      return {}
    } catch (error: any) {
      console.error('[AuthContext] ❌ Google sign in exception:', error)
      return { error: error.message || 'Google sign in failed' }
    }
  }

  const signInWithMagicLink = async (email: string): Promise<{ error?: string }> => {
    console.log('[AuthContext] 🔄 Attempting magic link sign in for:', email)

    try {
      const publicUrl = import.meta.env.VITE_PUBLIC_URL || window.location.origin
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${publicUrl}/auth/callback`
        }
      })

      if (error) {
        console.error('[AuthContext] ❌ Magic link failed:', error)
        return { error: error.message }
      }

      console.log('[AuthContext] ✅ Magic link sent to:', email)
      return {}
    } catch (error: any) {
      console.error('[AuthContext] ❌ Magic link exception:', error)
      return { error: error.message || 'Magic link failed' }
    }
  }

  const signOut = async () => {
    console.log('🔄 SupabaseAuth: Signing out user')
    
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('❌ SupabaseAuth: Sign out failed:', error)
      } else {
        console.log('✅ SupabaseAuth: Sign out successful')
      }
    } catch (error) {
      console.error('❌ SupabaseAuth: Sign out exception:', error)
    }
  }

  const resetPassword = async (email: string): Promise<{ error?: string }> => {
    console.log('🔄 SupabaseAuth: Attempting password reset for:', email)
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`
      })

      if (error) {
        console.error('❌ SupabaseAuth: Password reset failed:', error)
        return { error: error.message }
      }

      console.log('✅ SupabaseAuth: Password reset email sent')
      return {}
    } catch (error: any) {
      console.error('❌ SupabaseAuth: Password reset exception:', error)
      return { error: error.message || 'Password reset failed' }
    }
  }

  const validateReferralCode = async (code: string): Promise<{ isValid: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase
        .from('referral_codes')
        .select('id, is_active, max_uses, total_uses, expires_at')
        .eq('code', code)
        .single()

      if (error) {
        console.error('Referral validation error:', error)
        return { isValid: false, error: 'Invalid referral code' }
      }

      // Check if code is active
      if (!data.is_active) {
        return { isValid: false, error: 'Referral code is not active' }
      }

      // Check if code has reached max uses
      if (data.max_uses && data.total_uses >= data.max_uses) {
        return { isValid: false, error: 'Referral code has reached maximum uses' }
      }

      // Check if code has expired
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        return { isValid: false, error: 'Referral code has expired' }
      }

      return { isValid: true }
    } catch (error: any) {
      console.error('Referral validation exception:', error)
      return { isValid: false, error: 'Network error occurred' }
    }
  }

  const value: AuthContextType = {
    user,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    signInWithMagicLink,
    signOut,
    resetPassword,
    validateReferralCode,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}