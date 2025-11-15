import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'

// Feature flags from environment
const ENABLE_GOOGLE_OAUTH = import.meta.env.VITE_ENABLE_GOOGLE_OAUTH === 'true'
const ENABLE_MAGIC_LINK = import.meta.env.VITE_ENABLE_MAGIC_LINK === 'true'

const Login: React.FC = () => {
  const [mode, setMode] = useState<'signin' | 'reset'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const { signIn, signInWithGoogle, signInWithMagicLink, resetPassword, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      const from = location.state?.from?.pathname || '/'
      navigate(from, { replace: true })
    }
  }, [user, navigate, location])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    console.log('🔄 Login: Form submitted', { mode, email, hasPassword: !!password })

    try {
      if (mode === 'signin') {
        console.log('🔄 Login: Attempting sign in...')
        const { error } = await signIn(email, password)
        
        if (error) {
          console.error('❌ Login: Sign in failed:', error)
          setMessage(error)
          return
        }
        
        console.log('✅ Login: Sign in successful, redirecting...')
        setMessage('Signed in successfully!')
        const from = location.state?.from?.pathname || '/'
        navigate(from, { replace: true })
      } else if (mode === 'reset') {
        console.log('🔄 Login: Attempting password reset...')
        const { error } = await resetPassword(email)
        if (error) {
          console.error('❌ Login: Password reset failed:', error)
          setMessage(error)
          return
        }
        console.log('✅ Login: Password reset email sent')
        setMessage('Password reset email sent!')
      }
    } catch (error: any) {
      console.error('❌ Login: Form submission error:', error)
      setMessage(error?.message || 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }


  const resetForm = () => {
    setEmail('')
    setPassword('')
    setMessage('')
  }

  const switchMode = (newMode: 'signin' | 'reset') => {
    setMode(newMode)
    resetForm()
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setMessage('')

    try {
      const { error } = await signInWithGoogle()
      if (error) {
        setMessage(error)
      }
      // Note: For OAuth, the redirect will handle success, so we don't need to do anything here
    } catch (error: any) {
      console.error('❌ Google sign-in error:', error)
      setMessage(error?.message || 'Google sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  const handleMagicLinkSignIn = async () => {
    if (!email) {
      setMessage('Please enter your email address')
      return
    }

    setLoading(true)
    setMessage('')

    try {
      const { error } = await signInWithMagicLink(email)
      if (error) {
        setMessage(error)
      } else {
        setMessage('Check your email for a sign-in link!')
      }
    } catch (error: any) {
      console.error('❌ Magic link error:', error)
      setMessage(error?.message || 'Magic link failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-card py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-text">
            {mode === 'signin' && 'Sign in to your account'}
            {mode === 'reset' && 'Reset your password'}
          </h2>
          {mode === 'signin' && (
            <p className="mt-2 text-center text-sm text-muted">
              Don't have an account?{' '}
              <Link to="/signup" className="font-medium text-primary hover:text-secondary transition-colors">
                Sign up
              </Link>
            </p>
          )}
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              required
              className="w-full px-3 py-3 border card-border rounded-md bg-card text-text focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {mode !== 'reset' && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                className="w-full px-3 py-3 border card-border rounded-md bg-card text-text focus:outline-none focus:ring-2 focus:ring-primary"
              />
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-gradient-to-r from-primary to-secondary hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:bg-gray-400 disabled:cursor-not-allowed transition-all hover:scale-[1.02]"
            >
              {loading ? 'Processing...' : (
                mode === 'signin' ? 'Sign In' :
                'Send Reset Email'
              )}
            </button>
          </div>

        </form>

        {mode === 'signin' && (ENABLE_GOOGLE_OAUTH || ENABLE_MAGIC_LINK) && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t card-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-card text-muted">Or continue with</span>
              </div>
            </div>

            {ENABLE_GOOGLE_OAUTH && (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="group relative w-full flex justify-center py-3 px-4 border card-border text-sm font-medium rounded-md text-text bg-card hover:bg-card focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:bg-card disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {loading ? 'Processing...' : 'Sign in with Google'}
              </button>
            )}

            {ENABLE_MAGIC_LINK && (
              <button
                type="button"
                onClick={handleMagicLinkSignIn}
                disabled={loading || !email}
                className="group relative w-full flex justify-center py-3 px-4 border card-border text-sm font-medium rounded-md text-text bg-card hover:bg-card focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:bg-card disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {loading ? 'Sending...' : 'Send me a sign-in link'}
              </button>
            )}
          </>
        )}

        {message && (
          <div className={`mt-4 p-3 rounded-md ${
            message.includes('error') || message.includes('Error')
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-green-50 text-green-700 border border-green-200'
          }`}>
            {message}
          </div>
        )}

        <div className="text-center">
          {mode === 'signin' && (
            <p>
              <button
                type="button"
                onClick={() => switchMode('reset')}
                className="text-sm font-medium text-primary hover:text-secondary transition-colors"
              >
                Forgot your password?
              </button>
            </p>
          )}

          {mode === 'reset' && (
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="text-sm font-medium text-primary hover:text-secondary transition-colors"
            >
              Back to sign in
            </button>
          )}

          <div className="mt-4">
            <Link to="/" className="text-sm text-muted hover:text-text transition-colors">
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login
