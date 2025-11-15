import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="flex justify-center items-center min-h-screen">Loading...</div>
  }

  if (!user) {
    // Store the attempted location so we can redirect back after login
    localStorage.setItem('auth_return_to', location.pathname + location.search)
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
