import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'

interface RoleRouteProps {
  children: React.ReactNode
  allowedRoles: string[]
}

/**
 * Client-side role gate for admin routes.
 *
 * This is DEFENSE IN DEPTH ONLY — it hides UI and stops the lazy admin chunk
 * from being fetched. It is NOT authorization. The role it reads comes from the
 * browser, so a determined user can bypass it. Every /admin API route must
 * enforce the same check server-side, independently of this component.
 *
 * Anonymous visitors are sent to /login (matching ProtectedRoute). Logged-in
 * users holding the wrong role get an explicit "Access Denied" panel rather
 * than a silent redirect, so they can see which role they actually have.
 */
export default function RoleRoute({ children, allowedRoles }: RoleRouteProps) {
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

  if (!allowedRoles.includes(user.role)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-soft border border-red-100 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-display font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-600 mb-2">
            This page requires {allowedRoles.join(' or ')} access.
          </p>
          <p className="text-sm text-slate-500">
            Current role: <span className="font-medium text-slate-700">{user.role || 'none'}</span>
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
