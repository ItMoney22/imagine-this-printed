import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../utils/supabase'

const AuthCallback = () => {
  const navigate = useNavigate()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('Auth callback error:', error)
          navigate('/login?error=auth_callback_failed')
          return
        }

        if (data.session) {
          console.log('✅ Auth callback successful, user logged in')
          // Redirect to home or intended destination
          const redirectTo = new URLSearchParams(window.location.search).get('redirect_to') || '/'
          navigate(redirectTo)
        } else {
          console.log('❌ No session found in auth callback')
          navigate('/login?error=no_session')
        }
      } catch (error) {
        console.error('Auth callback exception:', error)
        navigate('/login?error=callback_exception')
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