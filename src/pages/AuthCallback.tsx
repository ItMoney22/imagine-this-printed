import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const AuthCallback = () => {
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Handle the OAuth callback - check if user is already authenticated
        if (user) {
          // User is authenticated - redirect to intended destination or home
          const urlParams = new URLSearchParams(window.location.search)
          const returnTo = urlParams.get('returnTo') || localStorage.getItem('auth_return_to') || '/'
          localStorage.removeItem('auth_return_to')
          navigate(returnTo, { replace: true })
        } else {
          // No user found - redirect to login
          navigate('/login', { replace: true })
        }
      } catch (error) {
        console.error('Auth callback error:', error)
        navigate('/login?error=auth_callback_failed', { replace: true })
      }
    }

    handleAuthCallback()
  }, [navigate, user])

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