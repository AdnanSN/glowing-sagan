
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase, supabaseConfigured } from './supabase'
import { ROLE_PERMISSIONS, roleRank } from './constants'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // True between clicking a recovery link and saving the new password. The
  // link hands out a real session, so this is the only thing that tells the
  // two apart.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }

    // onAuthStateChange fires INITIAL_SESSION immediately on subscribe with
    // any persisted session, so we don't need a separate getSession() call.
    //
    // CRITICAL: this callback must NOT be async / must NOT await any other
    // supabase client method. Supabase holds an internal auth lock while the
    // callback runs, and any supabase.from(...) call also tries to take that
    // lock to attach auth headers — awaiting one here deadlocks the client
    // and leaves the app stuck on "Loading…" after a refresh. Defer all
    // supabase work via setTimeout so it runs after the lock is released.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true)
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          setTimeout(() => loadProfile(session.user.id), 0)
        } else {
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // The profile row is the single source of truth for access: it carries
  // both the role and the approval status, and RLS reads the same row
  // server-side. Nothing here is trusted by the database.
  async function loadProfile(userId) {
    try {
      let { data, error } = await supabase
        .from('profiles')
        .select('*, employee:employees(*)')
        .eq('id', userId)
        .maybeSingle()

      // No row: the sign-up trigger didn't run (account predates the
      // migration, or the row was deleted). ensure_profile() creates a
      // pending one so the person shows up in the admin's queue instead
      // of silently having a broken account.
      if (!error && !data) {
        const { error: rpcError } = await supabase.rpc('ensure_profile')
        if (!rpcError) {
          ({ data } = await supabase
            .from('profiles')
            .select('*, employee:employees(*)')
            .eq('id', userId)
            .maybeSingle())
        }
      }

      setProfile(data || null)
    } catch (err) {
      console.error('Error loading profile:', err)
      setProfile(null)
    }
    setLoading(false)
  }

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return null
    const { data } = await supabase
      .from('profiles')
      .select('*, employee:employees(*)')
      .eq('id', user.id)
      .maybeSingle()
    setProfile(data || null)
    return data || null
  }, [user?.id])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  }

  // Self-service registration. The role is deliberately NOT a parameter —
  // the database trigger always creates the profile as viewer/pending and
  // an admin assigns the real role from the Access page.
  async function signUp(email, password, fullName) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    })

    if (error) return { data: null, error, needsConfirmation: false }

    // With email confirmation on, Supabase returns a decoy user with an
    // empty identities array rather than leaking that the address is taken.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return {
        data: null,
        error: { message: 'An account with this email already exists. Try signing in instead.' },
        needsConfirmation: false,
      }
    }

    return { data, error: null, needsConfirmation: !data.session }
  }

  // Anyone with an account can ask for this — including people who are still
  // pending or suspended, since a locked-out password is a separate problem
  // from a locked-out account. Supabase answers identically whether or not
  // the address exists, so nothing here reveals who has an account.
  async function sendPasswordReset(email) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { data, error }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (!error) {
      setSession(null)
      setUser(null)
      setProfile(null)
      setIsPasswordRecovery(false)
    }
    return { error }
  }

  async function updatePassword(newPassword) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    // The recovery session becomes an ordinary one the moment the password
    // it was issued for is replaced.
    if (!error) setIsPasswordRecovery(false)
    return { data, error }
  }

  // Only an approved account carries a usable role — pending, suspended
  // and rejected all resolve to null, matching current_user_role() in SQL.
  const isApproved = profile?.status === 'approved'
  const userRole = isApproved ? profile.role : null
  const userStatus = profile?.status ?? null
  const userEmployee = profile?.employee ?? null

  function hasPermission(action) {
    const required = ROLE_PERMISSIONS[action]
    if (required === undefined) return false
    return roleRank(userRole) >= required
  }

  const value = {
    session,
    user,
    profile,
    userRole,
    userStatus,
    userEmployee,
    loading,
    isApproved,
    isPasswordRecovery,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    updatePassword,
    refreshProfile,
    hasPermission,
    isAuthenticated: !!session,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
