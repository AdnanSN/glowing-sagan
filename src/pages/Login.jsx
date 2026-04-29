import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { Eye, EyeOff, Lock, Mail, AlertCircle, CheckCircle, KeyRound, UserPlus, LogIn } from 'lucide-react'

// The invite code your team members need to create an account.
// Change this to anything you want — share it verbally or via WhatsApp.
// To change it later: update VITE_INVITE_CODE in your .env.local file.
const INVITE_CODE = import.meta.env.VITE_INVITE_CODE || 'NHN2024'

export function Login() {
  const { signIn, signUp } = useAuth()
  const [tab, setTab] = useState('signin') // 'signin' | 'signup'

  // Shared fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Sign-up only
  const [fullName, setFullName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [showInviteCode, setShowInviteCode] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  function switchTab(newTab) {
    setTab(newTab)
    setError('')
    setSuccess('')
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setFullName('')
    setInviteCode('')
  }

  async function handleSignIn(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: authError } = await signIn(email, password)
    if (authError) {
      setError(
        authError.message === 'Invalid login credentials'
          ? 'Invalid email or password. Please try again.'
          : authError.message
      )
    }
    setLoading(false)
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    // Validate invite code
    if (inviteCode.trim() !== INVITE_CODE) {
      setError('Invalid invite code. Please ask your administrator.')
      return
    }

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    const { error: authError, needsConfirmation } = await signUp(email, password, fullName)

    if (authError) {
      setError(
        authError.message.includes('already registered')
          ? 'An account with this email already exists. Try signing in.'
          : authError.message
      )
    } else if (needsConfirmation) {
      setSuccess('Account created! Check your email to confirm before signing in.')
    } else {
      setSuccess('Account created! You are now signed in.')
    }
    setLoading(false)
  }

  return (
    <div className="login-page">
      <div className="login-bg-pattern" />
      <div className="login-bg-glow login-bg-glow-1" />
      <div className="login-bg-glow login-bg-glow-2" />

      <div className="login-container">
        {/* Left panel — Branding */}
        <div className="login-brand-panel">
          <div className="login-brand-content">
            <div className="login-brand-logo">
              <div className="login-brand-logo-icon">N</div>
              <div className="login-brand-logo-text">
                <span className="login-brand-name">NHN</span>
                <span className="login-brand-sub">Architects</span>
              </div>
            </div>
            <h1 className="login-brand-headline">
              Architecture<br />
              <span className="login-brand-highlight">Project Management</span>
            </h1>
            <p className="login-brand-desc">
              Streamline your projects, collaborate with your team, and deliver
              exceptional architectural designs — all in one place.
            </p>
            <div className="login-brand-features">
              <div className="login-feature">
                <div className="login-feature-dot" />
                <span>Project Tracking &amp; Gantt Charts</span>
              </div>
              <div className="login-feature">
                <div className="login-feature-dot" />
                <span>Task Management &amp; Calendar</span>
              </div>
              <div className="login-feature">
                <div className="login-feature-dot" />
                <span>Team Collaboration &amp; Documents</span>
              </div>
            </div>
          </div>
          <div className="login-brand-footer">
            <span>© {new Date().getFullYear()} NHN Architects</span>
          </div>
        </div>

        {/* Right panel — Form */}
        <div className="login-form-panel">
          <div className="login-form-wrapper">
            {/* Mobile logo */}
            <div className="login-mobile-logo">
              <div className="login-brand-logo-icon">N</div>
              <span style={{ fontWeight: 700, fontSize: 18 }}>NHN Architects</span>
            </div>

            {/* Tab switcher */}
            <div className="login-tabs">
              <button
                className={`login-tab${tab === 'signin' ? ' active' : ''}`}
                onClick={() => switchTab('signin')}
                id="tab-signin"
                type="button"
              >
                <LogIn size={14} />
                Sign In
              </button>
              <button
                className={`login-tab${tab === 'signup' ? ' active' : ''}`}
                onClick={() => switchTab('signup')}
                id="tab-signup"
                type="button"
              >
                <UserPlus size={14} />
                Create Account
              </button>
            </div>

            {/* Header */}
            <div className="login-form-header">
              {tab === 'signin' ? (
                <>
                  <h2 className="login-form-title">Welcome back</h2>
                  <p className="login-form-subtitle">Sign in to your account to continue</p>
                </>
              ) : (
                <>
                  <h2 className="login-form-title">Create account</h2>
                  <p className="login-form-subtitle">You'll need the team invite code to register</p>
                </>
              )}
            </div>

            {/* Alerts */}
            {error && (
              <div className="login-error" id="login-error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="login-success" id="login-success">
                <CheckCircle size={16} />
                <span>{success}</span>
              </div>
            )}

            {/* ── SIGN IN FORM ── */}
            {tab === 'signin' && (
              <form onSubmit={handleSignIn} className="login-form" id="login-form">
                <div className="login-field">
                  <label className="login-label" htmlFor="login-email">Email address</label>
                  <div className="login-input-wrapper">
                    <Mail size={16} className="login-input-icon" />
                    <input
                      id="login-email"
                      type="email"
                      className="login-input"
                      placeholder="you@nhn.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="login-field">
                  <label className="login-label" htmlFor="login-password">Password</label>
                  <div className="login-input-wrapper">
                    <Lock size={16} className="login-input-icon" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      className="login-input"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                    />
                    <button type="button" className="login-toggle-password"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="login-submit-btn"
                  disabled={loading || !email || !password} id="login-submit">
                  {loading ? <><div className="login-spinner" />Signing in…</> : 'Sign In'}
                </button>
              </form>
            )}

            {/* ── SIGN UP FORM ── */}
            {tab === 'signup' && (
              <form onSubmit={handleSignUp} className="login-form" id="signup-form">
                <div className="login-field">
                  <label className="login-label" htmlFor="signup-name">Full Name</label>
                  <div className="login-input-wrapper">
                    <Mail size={16} className="login-input-icon" />
                    <input
                      id="signup-name"
                      type="text"
                      className="login-input"
                      placeholder="e.g. Aravinth S"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                </div>

                <div className="login-field">
                  <label className="login-label" htmlFor="signup-email">Email address</label>
                  <div className="login-input-wrapper">
                    <Mail size={16} className="login-input-icon" />
                    <input
                      id="signup-email"
                      type="email"
                      className="login-input"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div className="login-field">
                  <label className="login-label" htmlFor="signup-password">Password</label>
                  <div className="login-input-wrapper">
                    <Lock size={16} className="login-input-icon" />
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      className="login-input"
                      placeholder="Min. 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                    />
                    <button type="button" className="login-toggle-password"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="login-field">
                  <label className="login-label" htmlFor="signup-confirm">Confirm Password</label>
                  <div className="login-input-wrapper">
                    <Lock size={16} className="login-input-icon" />
                    <input
                      id="signup-confirm"
                      type="password"
                      className="login-input"
                      placeholder="Repeat your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                <div className="login-field">
                  <label className="login-label" htmlFor="signup-invite">
                    Invite Code
                    <span className="login-invite-hint"> — ask your admin</span>
                  </label>
                  <div className="login-input-wrapper">
                    <KeyRound size={16} className="login-input-icon" />
                    <input
                      id="signup-invite"
                      type={showInviteCode ? 'text' : 'password'}
                      className="login-input"
                      placeholder="Enter invite code"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      required
                    />
                    <button type="button" className="login-toggle-password"
                      onClick={() => setShowInviteCode(v => !v)}
                      aria-label="Toggle invite code visibility">
                      {showInviteCode ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="login-submit-btn"
                  disabled={loading || !email || !password || !inviteCode || !fullName}
                  id="signup-submit">
                  {loading ? <><div className="login-spinner" />Creating account…</> : 'Create Account'}
                </button>
              </form>
            )}

            <div className="login-help">
              {tab === 'signin'
                ? <p>Contact your administrator if you need access or forgot your password.</p>
                : <p>Already have an account? <button type="button" className="login-link" onClick={() => switchTab('signin')}>Sign in</button></p>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
