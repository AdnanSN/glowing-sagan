import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { roleRank, ROLE_PERMISSIONS } from '../lib/constants'

/**
 * Wraps routes that require authentication.
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string[]} [props.allowedRoles] - Only these roles may enter
 * @param {string} [props.requires] - A key of ROLE_PERMISSIONS the user must hold
 */
export function ProtectedRoute({ children, allowedRoles, requires }) {
  const { isAuthenticated, isApproved, loading, userRole } = useAuth()

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

  // Unapproved accounts never reach a real route — App renders the
  // approval gate for them — but fail closed here too.
  if (!isApproved) {
    return <Navigate to="/" replace />
  }

  const roleAllowed = !allowedRoles || allowedRoles.includes(userRole)
  const permissionAllowed = !requires || roleRank(userRole) >= (ROLE_PERMISSIONS[requires] ?? Infinity)

  if (!roleAllowed || !permissionAllowed) {
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
