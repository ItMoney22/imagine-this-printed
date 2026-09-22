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
  avatar_url?: string
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
  signIn: (email: string, password: string, captchaToken?: string | null) => Promise<{ error?: string }>
  signUp: (email: string, password: string, userData?: any, captchaToken?: string | null) => Promise<{ error?: string }>
  signInWithGoogle: () => Promise<{ error?: string }>
  signInWithMagicLink: (email: string, captchaToken?: string | null) => Promise<{ error?: string }>
  signOut: () => Promise<void>
  resetPassword: (email: string, captchaToken?: string | null) => Promise<{ error?: string }>
  validateReferralCode: (code: string) => Promise<{ isValid: boolean; error?: string }>
  refreshProfile: () => Promise<void> // Force refresh user profile from database
}

/**
 * Turns a Turnstile token into the `options` fragment supabase-js expects.
 *
 * Returns {} when there is no token so the call is byte-identical to what it
 * was before captcha existed. GoTrue rejects `captchaToken: undefined` outright
 * once Bot & Abuse Protection is on, so the key must be absent, not undefined.
 * Every captcha-protected GoTrue endpoint this app touches — signUp,
 * signInWithPassword, signInWithOtp, resetPasswordForEmail — spreads this in.
 * Missing one of them would mean the dashboard toggle locks customers out of
 * that one flow with no way back.
 */
const captchaOptions = (captchaToken?: string | null): { captchaToken?: string } =>
  captchaToken ? { captchaToken } : {}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Helper function to perform profile fetch with retry
const fetchProfileWithRetry = async (userId: string, maxRetries = 3): Promise<{ data: any; error: any }> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await Promise.race([
        supabase
          .from('user_profiles')
          .select('id, email, role, username, display_name, first_name, last_name, email_verified, avatar_url')
          .eq('id', userId)
          .single(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Profile timeout')), 15000)
        )
      ])

      // If we got data or a definitive error (not timeout), return it
      if (result.data || (result.error && result.error.code !== 'PGRST116')) {
        return result
      }

      // Profile not found yet (might be a race condition with trigger)
      if (attempt < maxRetries) {
        console.log(`[AuthContext] ⏳ Profile not found, retry ${attempt}/${maxRetries} in 1s...`)
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } catch (error: any) {
      if (attempt < maxRetries) {
        console.log(`[AuthContext] ⏳ Attempt ${attempt} failed: ${error.message}, retrying...`)
        await new Promise(resolve => setTimeout(resolve, 1000))
      } else {
        return { data: null, error }
      }
    }
  }
  return { data: null, error: new Error('Max retries reached') }
}

// Fast profile fetch with caching - eliminates redundant queries
const fetchUserProfile = async (supabaseUser: SupabaseUser): Promise<User | null> => {
  const userId = supabaseUser.id

  // Check cache first - but only use it if it has proper data (username and role)
  const cached = profileCache.get(userId)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // Only use cache if it has real username (not email-derived) and proper role
    if (cached.user.username && !cached.user.username.includes('@')) {
      console.log('[AuthContext] ⚡ Using cached profile:', cached.user.username, 'role:', cached.user.role)
      return cached.user
    }
    // Cache has stale data, clear it
    console.log('[AuthContext] 🧹 Cache has stale data, refetching...')
    profileCache.delete(userId)
  }

  try {
    console.log('[AuthContext] 🔍 Fetching profile for:', userId)

    // Use retry logic for more resilient profile fetching
    const startTime = Date.now()
    const { data: profile, error } = await fetchProfileWithRetry(userId)
    const elapsed = Date.now() - startTime
    console.log(`[AuthContext] 📊 Profile query took ${elapsed}ms`)

    if (error || !profile) {
      console.warn('[AuthContext] ⚠️ Profile fetch failed:', error?.message, 'error code:', error?.code)
      console.warn('[AuthContext] ⚠️ FALLING BACK TO CUSTOMER ROLE - this is the problem!')
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

    // SUCCESS - Log what we got from the database
    console.log('[AuthContext] ✅ RAW PROFILE DATA FROM DB:', {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      username: profile.username,
      display_name: profile.display_name
    })

    // Fetch wallet balance - create wallet if it doesn't exist
    let walletBalance = 0
    try {
      const { data: walletData, error: walletError } = await supabase
        .from('user_wallets')
        .select('itc_balance')
        .eq('user_id', userId)
        .single()

      if (walletData?.itc_balance !== undefined) {
        walletBalance = walletData.itc_balance
        console.log('[AuthContext] 💰 Wallet balance loaded:', walletBalance, 'ITC')
      } else if (walletError?.code === 'PGRST116') {
        // Wallet doesn't exist - create it with welcome bonus (trigger may have failed)
        const WELCOME_ITC_BONUS = 50 // Welcome ITC for new users ($0.50)
        console.log('[AuthContext] ⚠️ No wallet found, creating one with welcome bonus...')
        const { data: newWallet, error: createError } = await supabase
          .from('user_wallets')
          .insert({
            user_id: userId,
            points_balance: 0,
            itc_balance: WELCOME_ITC_BONUS,
            lifetime_points_earned: 0,
            lifetime_itc_earned: WELCOME_ITC_BONUS,
            wallet_status: 'active'
          })
          .select('itc_balance')
          .single()

        if (newWallet) {
          walletBalance = newWallet.itc_balance || 0
          console.log('[AuthContext] ✅ Wallet created with welcome bonus:', walletBalance, 'ITC')

          // Log the welcome bonus transaction
          try {
            await supabase.from('itc_transactions').insert({
              user_id: userId,
              type: 'signup_bonus',
              amount: WELCOME_ITC_BONUS,
              balance_after: WELCOME_ITC_BONUS,
              description: 'Welcome bonus for joining Imagine This Printed!'
            })
          } catch (txError) {
            console.warn('[AuthContext] ⚠️ Could not log welcome bonus transaction')
          }
        } else if (createError) {
          console.warn('[AuthContext] ⚠️ Could not create wallet:', createError.message)
        }
      }
    } catch (walletError: any) {
      console.warn('[AuthContext] ⚠️ Could not fetch wallet balance:', walletError?.message || walletError)
    }

    const mappedUser: User = {
      id: profile.id,
      email: profile.email || supabaseUser.email || '',
      role: profile.role || 'customer',
      username: profile.username || profile.display_name || supabaseUser.email?.split('@')[0] || 'user',
      displayName: profile.display_name,
      firstName: profile.first_name,
      lastName: profile.last_name,
      avatar_url: profile.avatar_url,
      emailVerified: profile.email_verified || false,
      profileCompleted: true, // Column doesn't exist in DB, default to true
      wallet: {
        itcBalance: walletBalance
      }
    }

    // Cache the result
    profileCache.set(userId, { user: mappedUser, timestamp: Date.now() })
    console.log('[AuthContext] ✅ Profile loaded:', mappedUser.username, 'role:', mappedUser.role)

    return mappedUser
  } catch (error: any) {
    console.error('[AuthContext] ❌ Profile error (TIMEOUT OR EXCEPTION):', error?.message || error)
    console.error('[AuthContext] ❌ This caused FALLBACK TO CUSTOMER ROLE!')
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

    isProcessingRef.current = true
    lastUserIdRef.current = supabaseUser.id

    try {
      const mappedUser = await fetchUserProfile(supabaseUser)
      if (mappedUser) {
        // Always use the fetched role - database is source of truth
        console.log('[AuthContext] 📋 Setting user:', mappedUser.username, 'role:', mappedUser.role)
        setUser(mappedUser)
      }
    } finally {
      isProcessingRef.current = false
      setLoading(false)
    }
  }, []) // No dependencies - always fetch fresh from database

  useEffect(() => {
    console.log('[AuthContext] 🚀 Initializing...')

    // IMPORTANT: Clear cache on page load/refresh to ensure fresh roles
    // This fixes the issue where role changes in DB don't reflect until cache expires
    profileCache.clear()
    console.log('[AuthContext] 🧹 Cache cleared on init for fresh role fetch')

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

  const signIn = async (
    email: string,
    password: string,
    captchaToken?: string | null
  ): Promise<{ error?: string }> => {
    console.log('🔄 SupabaseAuth: Attempting sign in for:', email)

    // Clear profile cache to force fresh profile fetch
    profileCache.clear()
    lastUserIdRef.current = null

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: captchaOptions(captchaToken),
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

  const signUp = async (
    email: string,
    password: string,
    userData?: any,
    captchaToken?: string | null
  ): Promise<{ error?: string }> => {
    console.log('🔄 SupabaseAuth: Attempting sign up for:', email)

    try {
      const username = userData?.username || email.split('@')[0]

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          ...captchaOptions(captchaToken),
          data: {
            username: username,
            display_name: userData?.displayName || userData?.firstName || username,
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

        // The welcome email is NOT sent from here any more. At this point the
        // address is unproved — whoever typed it may not own it — and mailing
        // it is how the September 2026 bot wave put our branded mail in front
        // of scraped corporate inboxes. It now goes out from
        // src/pages/AuthCallback.tsx, the first moment a CONFIRMED session
        // exists, against an endpoint that reads the address from the access
        // token instead of trusting a request body.

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

    // Clear profile cache to force fresh profile fetch after OAuth
    profileCache.clear()
    lastUserIdRef.current = null

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

  const signInWithMagicLink = async (
    email: string,
    captchaToken?: string | null
  ): Promise<{ error?: string }> => {
    console.log('[AuthContext] 🔄 Attempting magic link sign in for:', email)

    try {
      const publicUrl = import.meta.env.VITE_PUBLIC_URL || window.location.origin
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          ...captchaOptions(captchaToken),
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

  const resetPassword = async (
    email: string,
    captchaToken?: string | null
  ): Promise<{ error?: string }> => {
    console.log('🔄 SupabaseAuth: Attempting password reset for:', email)
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        ...captchaOptions(captchaToken),
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

  // Force refresh user profile from database (clears cache)
  const refreshProfile = useCallback(async (): Promise<void> => {
    console.log('[AuthContext] 🔄 Force refreshing profile...')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      console.log('[AuthContext] ⚠️ No session to refresh')
      return
    }

    // Clear cache for this user to force fresh fetch
    profileCache.delete(session.user.id)
    lastUserIdRef.current = null
    isProcessingRef.current = false

    // Fetch fresh profile from database
    const freshProfile = await fetchUserProfile(session.user)
    if (freshProfile) {
      console.log('[AuthContext] ✅ Profile refreshed:', freshProfile.username, 'role:', freshProfile.role)
      setUser(freshProfile)
    }
  }, [])

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
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

