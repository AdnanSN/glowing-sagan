import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { Eye, EyeOff, Lock, Mail, User, AlertCircle, MailCheck, Clock } from 'lucide-react'

export function Login() {
  const { signIn, signUp, sendPasswordReset } = useAuth()
  const [mode, setMode] = useState('signin')      // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(null) // { needsConfirmation, email }
  const [resetSentTo, setResetSentTo] = useState('')

  function switchMode(next) {
    setMode(next)
    setError('')
    setPassword('')
    setConfirmPassword('')
    setResetSentTo('')
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

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Please use a password of at least 8 characters.')
      return
    }

    setLoading(true)
    const { error: authError, needsConfirmation } = await signUp(email, password, fullName.trim())
    setLoading(false)

    if (authError) {
      setError(authError.message)
      return
    }
    setSubmitted({ needsConfirmation, email })
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const address = email.trim()
    const { error: authError } = await sendPasswordReset(address)
    setLoading(false)

    // Supabase answers the same way whether or not the address has an
    // account — the confirmation below deliberately does too, so this page
    // can't be used to find out who works here.
    if (authError) {
      setError(authError.message)
      return
    }
    setResetSentTo(address)
  }

  const isSignUp = mode === 'signup'
  const isForgot = mode === 'forgot'

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
              <img src="/NHN_LOGO.svg" alt="NHN Architects" className="login-brand-logo-img" />
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
              <img src="/NHN_LOGO.svg" alt="NHN Architects" className="login-mobile-logo-img" />
            </div>

            {resetSentTo ? (
              <div className="login-success" id="reset-sent">
                <div className="login-success-icon">
                  <MailCheck size={26} />
                </div>
                <h2 className="login-form-title">Check your inbox</h2>
                <p className="login-success-text">
                  If <strong>{resetSentTo}</strong> belongs to an account, a link
                  to set a new password is on its way. The link expires shortly
                  and can only be used once — check your spam folder if it
                  doesn't arrive.
                </p>
                <button
                  className="login-submit-btn"
                  onClick={() => switchMode('signin')}
                  id="reset-back-to-signin"
                >
                  Back to sign in
                </button>
              </div>
            ) : submitted ? (
              <div className="login-success" id="signup-success">
                <div className="login-success-icon">
                  {submitted.needsConfirmation ? <MailCheck size={26} /> : <Clock size={26} />}
                </div>
                <h2 className="login-form-title">Request submitted</h2>
                {submitted.needsConfirmation ? (
                  <p className="login-success-text">
                    We've sent a confirmation link to <strong>{submitted.email}</strong>.
                    Confirm your address, then a principal architect will review your
                    request and grant your access level.
                  </p>
                ) : (
                  <p className="login-success-text">
                    Your account for <strong>{submitted.email}</strong> has been created and
                    is waiting for a principal architect to approve it. You'll be able to
                    sign in as soon as they do.
                  </p>
                )}
                <button
                  className="login-submit-btn"
                  onClick={() => { setSubmitted(null); switchMode('signin') }}
                  id="back-to-signin"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                <div className="login-form-header">
                  <h2 className="login-form-title">
                    {isForgot ? 'Reset your password' : isSignUp ? 'Request access' : 'Welcome back'}
                  </h2>
                  <p className="login-form-subtitle">
                    {isForgot
                      ? 'We’ll email you a link to set a new one'
                      : isSignUp
                        ? 'Create your account — an owner approves it'
                        : 'Sign in to your account to continue'}
                  </p>
                </div>

                {!isForgot && (
                  <div className="login-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={!isSignUp}
                      className={`login-tab${!isSignUp ? ' active' : ''}`}
                      onClick={() => switchMode('signin')}
                      id="tab-signin"
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isSignUp}
                      className={`login-tab${isSignUp ? ' active' : ''}`}
                      onClick={() => switchMode('signup')}
                      id="tab-signup"
                    >
                      Create account
                    </button>
                  </div>
                )}

                {error && (
                  <div className="login-error" id="login-error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                  </div>
                )}

                <form
                  onSubmit={isForgot ? handleForgotPassword : isSignUp ? handleSignUp : handleSignIn}
                  className="login-form"
                  id="login-form"
                >
                  {isSignUp && (
                    <div className="login-field">
                      <label className="login-label" htmlFor="signup-name">Full name</label>
                      <div className="login-input-wrapper">
                        <User size={16} className="login-input-icon" />
                        <input
                          id="signup-name"
                          type="text"
                          className="login-input"
                          placeholder="e.g. Aravinth S"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          required
                          autoComplete="name"
                          autoFocus
                        />
                      </div>
                    </div>
                  )}

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
                        autoFocus={!isSignUp}
                      />
                    </div>
                  </div>

                  {!isForgot && (
                  <div className="login-field">
                    <div className="login-label-row">
                      <label className="login-label" htmlFor="login-password">Password</label>
                      {!isSignUp && (
                        <button
                          type="button"
                          className="login-link"
                          onClick={() => switchMode('forgot')}
                          id="forgot-password"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="login-input-wrapper">
                      <Lock size={16} className="login-input-icon" />
                      <input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        className="login-input"
                        placeholder={isSignUp ? 'At least 8 characters' : 'Enter your password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete={isSignUp ? 'new-password' : 'current-password'}
                      />
                      <button type="button" className="login-toggle-password"
                        onClick={() => setShowPassword(v => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  )}

                  {isSignUp && (
                    <div className="login-field">
                      <label className="login-label" htmlFor="signup-confirm">Confirm password</label>
                      <div className="login-input-wrapper">
                        <Lock size={16} className="login-input-icon" />
                        <input
                          id="signup-confirm"
                          type={showPassword ? 'text' : 'password'}
                          className="login-input"
                          placeholder="Re-enter your password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          autoComplete="new-password"
                        />
                      </div>
                    </div>
                  )}

                  <button type="submit" className="login-submit-btn"
                    disabled={
                      loading || !email ||
                      (!isForgot && !password) ||
                      (isSignUp && (!fullName.trim() || !confirmPassword))
                    }
                    id="login-submit">
                    {loading
                      ? <>
                          <div className="login-spinner" />
                          {isForgot ? 'Sending…' : isSignUp ? 'Submitting…' : 'Signing in…'}
                        </>
                      : isForgot ? 'Send Reset Link' : isSignUp ? 'Request Access' : 'Sign In'}
                  </button>
                </form>

                <div className="login-help">
                  {isForgot ? (
                    <p>
                      Remembered it after all?{' '}
                      <button
                        type="button"
                        className="login-link"
                        onClick={() => switchMode('signin')}
                        id="forgot-back-to-signin"
                      >
                        Back to sign in
                      </button>
                    </p>
                  ) : isSignUp ? (
                    <p>
                      New accounts start with no access. A principal architect reviews
                      every request and decides what you can see and edit.
                    </p>
                  ) : (
                    <p>
                      Forgotten your password? Use the reset link above — it emails you
                      a secure link. Anything else, contact a principal architect.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
