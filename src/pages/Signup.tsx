import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'
import TurnstileWidget from '../components/TurnstileWidget'
import { GateBanner } from '../components/GuestGate'
import { gateBannerFor } from '../lib/guest-gate'
import HoneypotField from '../components/HoneypotField'
import { isCaptchaConfigured, friendlySignupError } from '../lib/captcha'

const SIGNUP_SENT = 'Account created! Please check your email to verify your account.'

const Signup: React.FC = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  const [honeypot, setHoneypot] = useState('')
  const { signUp, user } = useAuth()

  // Every Turnstile token is single-use. Burning one on a failed attempt and
  // then reusing it would make the retry fail for a reason the customer cannot
  // see, so a new challenge is issued after each attempt.
  const captchaRequired = isCaptchaConfigured()
  const navigate = useNavigate()
  const location = useLocation()
  const gateBanner = gateBannerFor(location.state)

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      const from = location.state?.from?.pathname || '/'
      navigate(from, { replace: true })
    }
  }, [user, navigate, location])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // A bot filled the hidden field: show the normal success and send nothing,
    // so no confirmation email goes to the stranger whose address it typed.
    if (honeypot) {
      setMessage(SIGNUP_SENT)
      return
    }

    setLoading(true)
    setMessage('')

    console.log('🔄 Signup: Form submitted', { 
      email, 
      hasPassword: !!password, 
      firstName, 
      lastName 
    })

    if (captchaRequired && !captchaToken) {
      setLoading(false)
      setMessage('Please complete the security check below.')
      return
    }

    try {
      console.log('🔄 Signup: Attempting to create account...')
      const result = await signUp(email, password, { firstName, lastName }, captchaToken)

      setCaptchaReset((n) => n + 1)

      if (result.error) {
        console.error('❌ Signup: Account creation failed:', {
          error: result.error
        })
        setMessage(friendlySignupError(result.error))
        return
      }
      
      console.log('✅ Signup: Account creation successful')
      setMessage(SIGNUP_SENT)
    } catch (error: any) {
      setCaptchaReset((n) => n + 1)
      console.error('❌ Signup: Form submission error:', {
        error,
        message: error?.message,
        name: error?.name,
        stack: error?.stack
      })
      setMessage(error?.message || 'Failed to create account. Please try again.')
    } finally {
      setLoading(false)
    }
  }


  return (
    <div className="min-h-screen flex items-center justify-center bg-card py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-text">
            Create your account
          </h2>
          <p className="mt-2 text-center text-sm text-muted">
            Already have an account?{' '}
            <Link to="/login" state={location.state} className="font-medium text-purple-600 hover:text-purple-500">
              Sign in
            </Link>
          </p>
          {gateBanner && (
            <div className="mt-6">
              <GateBanner
                title={gateBanner.title}
                why={`${gateBanner.why} Once you confirm your email you come straight back to where you were.`}
              />
            </div>
          )}
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <HoneypotField value={honeypot} onChange={setHoneypot} />
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First Name"
                required
                className="px-3 py-3 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last Name"
                required
                className="px-3 py-3 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              required
              className="w-full px-3 py-3 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            />

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              minLength={6}
              className="w-full px-3 py-3 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <TurnstileWidget
            action="signup"
            onVerify={setCaptchaToken}
            resetSignal={captchaReset}
            className="flex justify-center"
          />

          <div>
            <button
              type="submit"
              disabled={loading || (captchaRequired && !captchaToken)}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </div>

        </form>

        {message && (
          <div className={`mt-4 p-3 rounded-md ${
            message !== SIGNUP_SENT
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-green-50 text-green-700 border border-green-200'
          }`}>
            {message}
          </div>
        )}

        <div className="text-center">
          <Link to="/" className="text-sm text-muted hover:text-muted">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}

export default Signup
