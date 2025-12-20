import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { supabase, STORAGE_KEY } from '../lib/supabase'
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
    itcBalance: number
  }
}

// Profile cache to prevent redundant fetches
const profileCache = new Map<string, { user: User; timestamp: number }>()
const CACHE_TTL = 60000 // 1 minute cache

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

// Fast profile fetch with caching - eliminates redundant queries
const fetchUserProfile = async (supabaseUser: SupabaseUser): Promise<User | null> => {
  const userId = supabaseUser.id

  // Check cache first
  const cached = profileCache.get(userId)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[AuthContext] ⚡ Using cached profile for:', userId)
    return cached.user
  }

  try {
    console.log('[AuthContext] 🔍 Fetching profile for:', userId)

    // Optimized query - only fetch needed columns, 5s timeout
    const { data: profile, error } = await Promise.race([
      supabase
        .from('user_profiles')
        .select('id, email, role, username, display_name, first_name, last_name, email_verified, profile_completed')
        .eq('id', userId)
        .single(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Profile timeout')), 5000)
      )
    ])

    if (error || !profile) {
      console.warn('[AuthContext] ⚠️ Profile fetch failed:', error?.message)
      // Check if we have a cached version with better role
      const staleCache = profileCache.get(userId)
      if (staleCache && staleCache.user.role !== 'customer') {
        console.log('[AuthContext] 🔒 Using stale cache to preserve role:', staleCache.user.role)
        return staleCache.user
      }
      // Return minimal user from Supabase data for fast fallback
      return {
        id: userId,
        email: supabaseUser.email || '',
        role: 'customer',
        username: supabaseUser.email?.split('@')[0] || 'user',
        emailVerified: !!supabaseUser.email_confirmed_at,
        profileCompleted: false,
        wallet: undefined
      }
    }

    const mappedUser: User = {
      id: profile.id,
      email: profile.email,
      role: profile.role || 'customer',
      username: profile.username,
      displayName: profile.display_name,
      firstName: profile.first_name,
      lastName: profile.last_name,
      emailVerified: profile.email_verified || false,
      profileCompleted: profile.profile_completed || false,
      wallet: undefined
    }

    // Cache the result
    profileCache.set(userId, { user: mappedUser, timestamp: Date.now() })
    console.log('[AuthContext] ✅ Profile loaded:', mappedUser.username, 'role:', mappedUser.role)

    return mappedUser
  } catch (error) {
    console.error('[AuthContext] ❌ Profile error:', error)
    // Check if we have a cached version with better role
    const staleCache = profileCache.get(userId)
    if (staleCache && staleCache.user.role !== 'customer') {
      console.log('[AuthContext] 🔒 Using stale cache to preserve role:', staleCache.user.role)
      return staleCache.user
    }
    // Fast fallback - don't block on errors
    return {
      id: userId,
      email: supabaseUser.email || '',
      role: 'customer',
      username: supabaseUser.email?.split('@')[0] || 'user',
      emailVerified: !!supabaseUser.email_confirmed_at,
      profileCompleted: false,
      wallet: undefined
    }
  }
}

export const SupabaseAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const isProcessingRef = useRef(false)
  const lastUserIdRef = useRef<string | null>(null)

  // Memoized user loader to prevent duplicate fetches
  const loadUser = useCallback(async (supabaseUser: SupabaseUser | null, source: string) => {
    if (!supabaseUser) {
      console.log(`[AuthContext] ${source}: No user, clearing state`)
      setUser(null)
      setLoading(false)
      lastUserIdRef.current = null
      return
    }

    // Skip if we're already processing this user
    if (isProcessingRef.current && lastUserIdRef.current === supabaseUser.id) {
      console.log(`[AuthContext] ${source}: Already processing user, skipping`)
      return
    }

    // Skip if user hasn't changed and we already have data
    if (lastUserIdRef.current === supabaseUser.id && user?.id === supabaseUser.id) {
      console.log(`[AuthContext] ${source}: User unchanged, using existing`)
      setLoading(false)
      return
    }

    isProcessingRef.current = true
    lastUserIdRef.current = supabaseUser.id

    try {
      const mappedUser = await fetchUserProfile(supabaseUser)
      if (mappedUser) {
        setUser(prev => {
          // Preserve non-customer role if new fetch returns customer
          if (prev?.id === mappedUser.id && prev.role !== 'customer' && mappedUser.role === 'customer') {
            console.log('[AuthContext] 🔒 Preserving role:', prev.role)
            return { ...mappedUser, role: prev.role }
          }
          return mappedUser
        })
      }
    } finally {
      isProcessingRef.current = false
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    console.log('[AuthContext] 🚀 Initializing...')

    // Fast initial session check
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) console.error('[AuthContext] Session error:', error.message)
      loadUser(session?.user || null, 'init')
    })

    // Listen for auth changes - cache prevents duplicate fetches
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthContext] 🔄 Auth event:', event)

      if (event === 'SIGNED_OUT') {
        profileCache.clear()
        setUser(null)
        setLoading(false)
        lastUserIdRef.current = null
      } else if (session?.user) {
        loadUser(session.user, event)
      }
    })

    return () => subscription.unsubscribe()
  }, [loadUser])

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

