import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

/**
 * Wraps routes that require authentication.
 * Optionally checks for specific roles.
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string[]} [props.allowedRoles] - Optional array of roles that can access this route
 */
export function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, loading, userRole } = useAuth()

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
        <span>Loading…</span>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && !allowedRoles.includes(userRole)) {
    return (
      <div className="auth-forbidden">
        <div className="auth-forbidden-icon">🔒</div>
        <h2>Access Denied</h2>
        <p>You don't have permission to access this page.</p>
        <a href="/" className="btn btn-primary">Go to Dashboard</a>
      </div>
    )
  }

  return children
}
