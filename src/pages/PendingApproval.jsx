import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { Clock, Ban, XCircle, RefreshCw, LogOut } from 'lucide-react'

// Shown instead of the whole app to anyone who is signed in but not
// approved. There is nothing to leak here — RLS returns an empty
// database for these accounts regardless of what the UI does.
const STATES = {
  pending: {
    icon: Clock,
    title: 'Waiting for approval',
    body: 'Your account has been created and a principal architect has been notified. ' +
          'Once they grant you an access level, everything unlocks here automatically.',
    tone: 'warning',
  },
  suspended: {
    icon: Ban,
    title: 'Access suspended',
    body: 'A principal architect has suspended this account. Get in touch with them ' +
          'if you think this is a mistake.',
    tone: 'danger',
  },
  rejected: {
    icon: XCircle,
    title: 'Request declined',
    body: 'Your access request was declined. If you believe you should have access, ' +
          'contact a principal architect.',
    tone: 'danger',
  },
  unknown: {
    icon: Clock,
    title: 'Setting up your account',
    body: 'We could not load your access details. Try again in a moment — if it keeps ' +
          'happening, contact a principal architect.',
    tone: 'warning',
  },
}

export function PendingApproval() {
  const { user, userStatus, refreshProfile, signOut } = useAuth()
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState(null)

  const state = STATES[userStatus] || STATES.unknown
  const Icon = state.icon

  async function handleCheck() {
    setChecking(true)
    await refreshProfile()
    setChecking(false)
    setCheckedAt(new Date())
  }

  return (
    <div className="gate-page">
      <div className="gate-card">
        <img src="/NHN_LOGO.svg" alt="NHN Architects" className="gate-logo" />

        <div className={`gate-icon gate-icon-${state.tone}`}>
          <Icon size={26} />
        </div>

        <h1 className="gate-title">{state.title}</h1>
        <p className="gate-body">{state.body}</p>

        {user?.email && (
          <div className="gate-account">
            <span className="gate-account-label">Signed in as</span>
            <span className="gate-account-email">{user.email}</span>
          </div>
        )}

        <div className="gate-actions">
          {userStatus !== 'rejected' && (
            <button className="btn btn-primary" onClick={handleCheck} disabled={checking} id="gate-recheck">
              <RefreshCw size={15} className={checking ? 'gate-spin' : undefined} />
              {checking ? 'Checking…' : 'Check again'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={signOut} id="gate-signout">
            <LogOut size={15} /> Sign out
          </button>
        </div>

        {checkedAt && (
          <div className="gate-checked">
            Last checked at {checkedAt.toLocaleTimeString()} — still {STATES[userStatus] ? userStatus : 'unavailable'}.
          </div>
        )}
      </div>
    </div>
  )
}
