import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Phase = 'verifying' | 'ready' | 'saving' | 'done' | 'error'

const MIN_PASSWORD_LENGTH = 8

/**
 * Password-recovery landing page for `/auth/reset-password`.
 *
 * This route used to render <AuthCallback />, which hard-fails unless an
 * `oauth-state` key is in localStorage. That key is only ever written by
 * signInWithGoogle, so every recovery link died with "PKCE keys not found"
 * and bounced back to /login — leaving anyone without a working password
 * with no way back into their account.
 *
 * Recovery links only need the code-verifier (written by
 * resetPasswordForEmail), so this page does its own exchange and then
 * collects the new password.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('verifying')
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  // Establish the recovery session from whatever the email link handed us.
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

        // Supabase reports expired/invalid links via query or hash params.
        const errorDescription =
          params.get('error_description') || hash.get('error_description')
        const errorCode = params.get('error_code') || hash.get('error_code')
        if (errorDescription || errorCode) {
          throw new Error(
            errorCode === 'otp_expired'
              ? 'This reset link has expired. Request a new one from the sign-in page.'
              : errorDescription || errorCode || 'Invalid reset link'
          )
        }

        // `detectSessionInUrl` may already have consumed the code, so check
        // for an existing session before trying to exchange anything.
        const { data: existing } = await supabase.auth.getSession()
        if (existing.session) {
          console.log('[reset-password] ✅ Recovery session already active')
          setPhase('ready')
          return
        }

        const code = params.get('code')
        if (code) {
          console.log('[reset-password] 🔑 Exchanging recovery code for session')
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
            window.location.href
          )
          if (exchangeError) throw exchangeError
        } else if (hash.get('access_token')) {
          // Legacy implicit-style recovery link.
          console.log('[reset-password] 🔑 Restoring session from hash tokens')
          const { error: setError_ } = await supabase.auth.setSession({
            access_token: hash.get('access_token') as string,
            refresh_token: hash.get('refresh_token') || '',
          })
          if (setError_) throw setError_
        } else {
          throw new Error(
            'This page needs a password-reset link. Request one from the sign-in page.'
          )
        }

        const { data: verified } = await supabase.auth.getSession()
        if (!verified.session) {
          throw new Error('Could not verify the reset link. Request a new one.')
        }

        // Strip the token out of the address bar.
        window.history.replaceState({}, '', window.location.pathname)
        console.log('[reset-password] ✅ Recovery session established')
        setPhase('ready')
      } catch (err: any) {
        console.error('[reset-password] ❌ Link verification failed:', err)
        setError(err?.message || 'Could not verify the reset link')
        setPhase('error')
      }
    })()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setPhase('saving')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      console.log('[reset-password] ✅ Password updated')
      setPhase('done')
      setTimeout(() => navigate('/', { replace: true }), 1500)
    } catch (err: any) {
      console.error('[reset-password] ❌ Password update failed:', err)
      setError(err?.message || 'Could not update your password')
      setPhase('ready')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-card py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-text">
            Choose a new password
          </h2>
          <p className="mt-2 text-center text-sm text-muted">
            {phase === 'verifying' && 'Verifying your reset link...'}
            {(phase === 'ready' || phase === 'saving') &&
              'Pick something at least 8 characters long.'}
            {phase === 'done' && 'Password updated — signing you in.'}
            {phase === 'error' && 'We could not use that reset link.'}
          </p>
        </div>

        {phase === 'verifying' && (
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
        )}

        {(phase === 'ready' || phase === 'saving') && (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                autoComplete="new-password"
                required
                className="w-full px-3 py-3 border card-border rounded-md bg-card text-text focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
                required
                className="w-full px-3 py-3 border card-border rounded-md bg-card text-text focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <button
              type="submit"
              disabled={phase === 'saving'}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-gradient-to-r from-primary to-secondary hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:bg-gray-400 disabled:cursor-not-allowed transition-all hover:scale-[1.02]"
            >
              {phase === 'saving' ? 'Saving...' : 'Update password'}
            </button>
          </form>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-md bg-red-50 text-red-700 border border-red-200">
            {error}
          </div>
        )}

        {phase === 'done' && (
          <div className="mt-4 p-3 rounded-md bg-green-50 text-green-700 border border-green-200">
            Password updated successfully.
          </div>
        )}

        <div className="text-center">
          <Link
            to="/login"
            className="font-medium text-primary hover:text-secondary transition-colors"
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
