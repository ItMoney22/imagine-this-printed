import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase'

const AuthCallback = () => {
  const navigate = useNavigate()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Handle the OAuth callback by exchanging the code for a session
        const { data, error } = await supabase.auth.getSession()
        if (error) {
          console.error('Auth callback error:', error)
          navigate('/login?error=auth_callback_failed', { replace: true })
          return
        }

        if (data.session) {
          // Successful authentication - redirect to intended destination or home
          const urlParams = new URLSearchParams(window.location.search)
          const returnTo = urlParams.get('returnTo') || localStorage.getItem('auth_return_to') || '/'
          localStorage.removeItem('auth_return_to')
          navigate(returnTo, { replace: true })
        } else {
          // No session found - redirect to login
          navigate('/login', { replace: true })
        }
      } catch (error) {
        console.error('Auth callback error:', error)
        navigate('/login?error=auth_callback_failed', { replace: true })
      }
    }

    handleAuthCallback()
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Completing sign in...</p>
      </div>
    </div>
  )
}

export default AuthCallback