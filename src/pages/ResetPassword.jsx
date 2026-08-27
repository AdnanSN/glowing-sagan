import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Eye, EyeOff, Lock, AlertCircle, KeyRound, CheckCircle2, XCircle } from 'lucide-react'

// Where the link in Supabase's recovery email lands. Reaching this page with a
// usable session is what proves the person owns the mailbox — the one-time
// token in the URL is traded for that session either by the client itself
// (detectSessionInUrl handles the default `{{ .ConfirmationURL }}` template)
// or by one of the exchanges below, for projects whose template sends a
// token hash or a PKCE code instead. No session means no valid link, so the
// page says so rather than showing a form that cannot save.
export function ResetPassword() {
  const navigate = useNavigate()
  const { updatePassword } = useAuth()
  const [phase, setPhase] = useState('verifying')  // verifying | ready | invalid | done
  const [linkError, setLinkError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Keep the one-time token out of the address bar, the browser history
    // and any analytics that reads location.
    function scrubUrl() {
      window.history.replaceState({}, document.title, window.location.pathname)
    }

    // Supabase's own wording is the useful part — it says whether the link
    // expired, was already spent or was never valid. Tack on what to do
    // about it, since that is the same either way.
    function linkFailed(message) {
      const reason = /[.!?]$/.test(message) ? message : `${message}.`
      return `${reason} Reset links expire and can only be used once — request a fresh one and it will arrive in a moment.`
    }

    async function verifyLink() {
      if (!supabaseConfigured) {
        if (!cancelled) {
          setLinkError('Password resets are unavailable because Supabase is not configured for this deployment.')
          setPhase('invalid')
        }
        return
      }

      const query = new URLSearchParams(window.location.search)
      // Supabase reports an expired or already-used link in the fragment,
      // which never reaches the server — check both halves of the URL.
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const urlError =
        hash.get('error_description') || query.get('error_description') ||
        hash.get('error') || query.get('error')

      if (urlError) {
        if (!cancelled) {
          setLinkError(linkFailed(urlError))
          setPhase('invalid')
        }
        return
      }

      const tokenHash = query.get('token_hash')
      if (tokenHash) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: query.get('type') || 'recovery',
        })
        if (cancelled) return
        if (otpError) {
          setLinkError(linkFailed(otpError.message))
          setPhase('invalid')
          return
        }
        scrubUrl()
        setPhase('ready')
        return
      }

      const code = query.get('code')
      if (code) {
        const { error: codeError } = await supabase.auth.exchangeCodeForSession(code)
        if (cancelled) return
        if (codeError) {
          // A PKCE client spends the code during its own start-up, so a
          // failure here is only fatal if no session came out of it.
          const { data } = await supabase.auth.getSession()
          if (cancelled) return
          if (!data?.session) {
            setLinkError(linkFailed(codeError.message))
            setPhase('invalid')
            return
          }
        }
        scrubUrl()
        setPhase('ready')
        return
      }

      // Nothing left to exchange: either the client already turned the
      // fragment into a session, or there was never a valid link.
      // getSession() waits for that start-up work to finish.
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data?.session) {
        scrubUrl()
        setPhase('ready')
        return
      }
      setLinkError(linkFailed('This reset link is invalid or has already been used'))
      setPhase('invalid')
    }

    verifyLink()
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Please use a password of at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSaving(true)
    const { error: updateError } = await updatePassword(password)
    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }
    setPhase('done')
  }

  return (
    <div className="gate-page">
      <div className="gate-card">
        <img src="/NHN_LOGO.svg" alt="NHN Architects" className="gate-logo" />

        {phase === 'verifying' && (
          <>
            <div className="auth-loading-spinner" />
            <p className="gate-body">Checking your reset link…</p>
          </>
        )}

        {phase === 'invalid' && (
          <>
            <div className="gate-icon gate-icon-danger">
              <XCircle size={26} />
            </div>
            <h1 className="gate-title">Link no longer works</h1>
            <p className="gate-body">{linkError}</p>
            <div className="gate-actions">
              <button
                className="btn btn-primary"
                onClick={() => navigate('/login', { replace: true })}
                id="reset-request-new"
              >
                Request a new link
              </button>
            </div>
          </>
        )}

        {phase === 'ready' && (
          <>
            <div className="gate-icon gate-icon-neutral">
              <KeyRound size={26} />
            </div>
            <h1 className="gate-title">Choose a new password</h1>
            <p className="gate-body">
              Pick something you don't use anywhere else. You'll stay signed in
              on this device once it's saved.
            </p>

            <form className="gate-form" onSubmit={handleSubmit} id="reset-password-form">
              {error && (
                <div className="login-error" id="reset-error">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}

              <div className="login-field">
                <label className="login-label" htmlFor="reset-password">New password</label>
                <div className="login-input-wrapper">
                  <Lock size={16} className="login-input-icon" />
                  <input
                    id="reset-password"
                    type={showPassword ? 'text' : 'password'}
                    className="login-input"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="login-toggle-password"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="login-field">
                <label className="login-label" htmlFor="reset-confirm">Confirm new password</label>
                <div className="login-input-wrapper">
                  <Lock size={16} className="login-input-icon" />
                  <input
                    id="reset-confirm"
                    type={showPassword ? 'text' : 'password'}
                    className="login-input"
                    placeholder="Re-enter your new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="login-submit-btn"
                disabled={saving || !password || !confirmPassword}
                id="reset-submit"
              >
                {saving
                  ? <><div className="login-spinner" />Saving…</>
                  : 'Save new password'}
              </button>
            </form>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="gate-icon gate-icon-success">
              <CheckCircle2 size={26} />
            </div>
            <h1 className="gate-title">Password updated</h1>
            <p className="gate-body">
              Your new password is active. Use it the next time you sign in.
            </p>
            <div className="gate-actions">
              <button
                className="btn btn-primary"
                onClick={() => navigate('/', { replace: true })}
                id="reset-continue"
              >
                Continue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
