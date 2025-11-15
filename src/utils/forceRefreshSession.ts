import { supabase } from '../lib/supabase'

/**
 * Force refresh the current user's session and profile data.
 * This is useful when user roles have been updated in the database
 * but the frontend session cache still has old data.
 */
export async function forceRefreshSession() {
  console.log('[Session] 🔄 Force refreshing user session...')

  try {
    // Step 1: Get current session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()

    if (sessionError) {
      console.error('[Session] ❌ Error getting session:', sessionError)
      return { success: false, error: sessionError.message }
    }

    if (!session) {
      console.log('[Session] ℹ️ No active session to refresh')
      return { success: false, error: 'No active session' }
    }

    console.log('[Session] 📦 Current session user:', session.user.id)

    // Step 2: Fetch fresh profile data from database
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()

    if (profileError) {
      console.error('[Session] ❌ Error fetching profile:', profileError)
      return { success: false, error: profileError.message }
    }

    console.log('[Session] 📊 Fresh profile data:', {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      username: profile.username
    })

    // Step 3: Refresh the auth session (triggers onAuthStateChange)
    const { error: refreshError } = await supabase.auth.refreshSession()

    if (refreshError) {
      console.error('[Session] ❌ Error refreshing session:', refreshError)
      return { success: false, error: refreshError.message }
    }

    console.log('[Session] ✅ Session refreshed successfully')

    return {
      success: true,
      profile: {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        username: profile.username
      }
    }
  } catch (error: any) {
    console.error('[Session] ❌ Unexpected error:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Clear all local storage auth data and force sign out.
 * Use this as a nuclear option when session is corrupted.
 */
export async function hardResetAuth() {
  console.log('[Session] ☢️ Hard reset: clearing all auth data...')

  try {
    // Clear localStorage auth keys
    const authKeys = Object.keys(localStorage).filter(key =>
      key.includes('supabase') || key.includes('auth')
    )

    console.log('[Session] 🗑️ Removing storage keys:', authKeys)
    authKeys.forEach(key => localStorage.removeItem(key))

    // Sign out from Supabase
    await supabase.auth.signOut()

    console.log('[Session] ✅ Hard reset complete - please sign in again')

    return { success: true }
  } catch (error: any) {
    console.error('[Session] ❌ Hard reset error:', error)
    return { success: false, error: error.message }
  }
}

