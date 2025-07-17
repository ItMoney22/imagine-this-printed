import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const Login: React.FC = () => {
  const [mode, setMode] = useState<'signin' | 'reset'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const { signIn, resetPassword, user } = useAuth()
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {mode === 'signin' && 'Sign in to your account'}
            {mode === 'reset' && 'Reset your password'}
          </h2>
          {mode === 'signin' && (
            <p className="mt-2 text-center text-sm text-gray-600">
              Don't have an account?{' '}
              <Link to="/signup" className="font-medium text-purple-600 hover:text-purple-500">
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
              className="w-full px-3 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            />

            {mode !== 'reset' && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                className="w-full px-3 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? 'Processing...' : (
                mode === 'signin' ? 'Sign In' :
                'Send Reset Email'
              )}
            </button>
          </div>

        </form>

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
                className="text-sm font-medium text-purple-600 hover:text-purple-500"
              >
                Forgot your password?
              </button>
            </p>
          )}

          {mode === 'reset' && (
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="text-sm font-medium text-purple-600 hover:text-purple-500"
            >
              Back to sign in
            </button>
          )}

          <div className="mt-4">
            <Link to="/" className="text-sm text-gray-600 hover:text-gray-500">
              ← Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Login