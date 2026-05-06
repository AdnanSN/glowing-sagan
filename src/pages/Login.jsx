import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { Eye, EyeOff, Lock, Mail, AlertCircle } from 'lucide-react'

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
              <img src="/NHN logo.jpeg" alt="NHN Architects" className="login-brand-logo-img" />
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
            <div className="login-mobile-logo">
              <img src="/NHN logo no BG.png" alt="NHN Architects" className="login-mobile-logo-img" />
            </div>

            <div className="login-form-header">
              <h2 className="login-form-title">Welcome back</h2>
              <p className="login-form-subtitle">Sign in to your account to continue</p>
            </div>

            {error && (
              <div className="login-error" id="login-error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSignIn} className="login-form" id="login-form">
              <div className="login-field">
                <label className="login-label" htmlFor="login-email">Email address</label>
                <div className="login-input-wrapper">
                  <Mail size={16} className="login-input-icon" />
                  <input
                    id="login-email"
                    type="email"
                    className="login-input"
                    placeholder="you@nhn.local"
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

            <div className="login-help">
              <p>Accounts are managed by your administrator. Contact them if you need access or to reset your password.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
