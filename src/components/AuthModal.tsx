import React, { useState } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import TurnstileWidget from './TurnstileWidget'
import { isCaptchaConfigured } from '../lib/captcha'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  initialMode?: 'signin' | 'signup'
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, initialMode = 'signin' }) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  const { signIn, signUp, resetPassword } = useAuth()

  // Supabase applies Bot & Abuse Protection to sign-in and password reset as
  // well as signup, so all three modes of this modal carry a token — gating
  // only the signup branch would lock customers out of the other two the
  // moment the dashboard toggle is flipped.
  const captchaRequired = isCaptchaConfigured()

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    if (captchaRequired && !captchaToken) {
      setLoading(false)
      setMessage('Please complete the security check below.')
      return
    }

    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password, captchaToken)
        if (error) throw error
        setMessage('Signed in successfully!')
        onClose()
      } else if (mode === 'signup') {
        const { error } = await signUp(email, password, { firstName, lastName }, captchaToken)
        if (error) throw error
        setMessage('Account created! Please check your email to verify your account.')
      } else if (mode === 'reset') {
        const { error } = await resetPassword(email, captchaToken)
        if (error) throw error
        setMessage('Password reset email sent!')
      }
    } catch (error: any) {
      setMessage(error.message)
    } finally {
      // Tokens are single-use, so the next attempt needs a fresh challenge
      // whether this one succeeded or not.
      setCaptchaToken(null)
      setCaptchaReset((n) => n + 1)
      setLoading(false)
    }
  }

  const resetForm = () => {
    setEmail('')
    setPassword('')
    setFirstName('')
    setLastName('')
    setMessage('')
    setCaptchaToken(null)
    setCaptchaReset((n) => n + 1)
  }

  const switchMode = (newMode: 'signin' | 'signup' | 'reset') => {
    setMode(newMode)
    resetForm()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-card text-text rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">
            {mode === 'signin' && 'Sign In'}
            {mode === 'signup' && 'Sign Up'}
            {mode === 'reset' && 'Reset Password'}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-text"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First Name"
                required
                className="px-3 py-2 bg-card text-text border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last Name"
                required
                className="px-3 py-2 bg-card text-text border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
          )}

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            required
            className="w-full px-3 py-2 bg-card text-text border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
          />

          {mode !== 'reset' && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full px-3 py-2 bg-card text-text border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          )}

          <TurnstileWidget
            action={mode === 'signup' ? 'signup' : mode === 'reset' ? 'password-reset' : 'signin'}
            onVerify={setCaptchaToken}
            resetSignal={captchaReset}
            className="flex justify-center"
          />

          <button
            type="submit"
            disabled={loading || (captchaRequired && !captchaToken)}
            className="w-full btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing...' : (
              mode === 'signin' ? 'Sign In' :
              mode === 'signup' ? 'Create Account' :
              'Send Reset Email'
            )}
          </button>
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

        <div className="mt-6 text-center text-sm">
          {mode === 'signin' && (
            <>
              <p className="text-muted mb-2">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="text-purple-600 hover:text-purple-700 font-medium"
                >
                  Sign up
                </button>
              </p>
              <button
                type="button"
                onClick={() => switchMode('reset')}
                className="text-purple-600 hover:text-purple-700 font-medium"
              >
                Forgot password?
              </button>
            </>
          )}

          {mode === 'signup' && (
            <p className="text-muted">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-purple-600 hover:text-purple-700 font-medium"
              >
                Sign in
              </button>
            </p>
          )}

          {mode === 'reset' && (
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="text-purple-600 hover:text-purple-700 font-medium"
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default AuthModal
