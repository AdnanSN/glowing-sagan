import { createContext, useContext, useState, useEffect } from 'react'
import { supabase, supabaseConfigured } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [userRole, setUserRole] = useState(null)
  const [userEmployee, setUserEmployee] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchUserProfile(session.user)
      } else {
        setLoading(false)
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          await fetchUserProfile(session.user)
        } else {
          setUserRole(null)
          setUserEmployee(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function fetchUserProfile(authUser) {
    try {
      // The on_auth_user_created trigger creates this row automatically at sign-up time,
      // so it should always exist for any authenticated user.
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('*, employees(*)')
        .eq('auth_user_id', authUser.id)
        .single()

      if (roleData) {
        setUserRole(roleData.role)
        setUserEmployee(roleData.employees || null)
      } else {
        // Fallback: trigger may not be installed — try to create the row from metadata.
        const pendingRole = authUser.user_metadata?.pending_role
        if (pendingRole) {
          const { data: newRole } = await supabase
            .from('user_roles')
            .insert({ auth_user_id: authUser.id, role: pendingRole })
            .select('*, employees(*)')
            .single()
          setUserRole(newRole?.role ?? 'viewer')
          setUserEmployee(newRole?.employees ?? null)
        } else {
          setUserRole('viewer')
          setUserEmployee(null)
        }
      }
    } catch (err) {
      console.error('Error fetching user profile:', err)
      setUserRole('viewer')
      setUserEmployee(null)
    }
    setLoading(false)
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  }

  async function signUp(email, password, fullName, role = 'member') {
    // Store the intended role + name in user metadata during sign-up.
    // This works even without an authenticated session because Supabase
    // stores metadata as part of the auth.users record directly.
    // The actual user_roles row is created on first login in fetchUserProfile.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          pending_role: role,
          full_name: fullName,
        },
      },
    })
    if (error) return { error, needsConfirmation: false }

    const needsConfirmation = !data.session

    // The role row is created by fetchUserProfile when onAuthStateChange fires.
    // Calling createRoleFromMetadata here as well caused a race condition where
    // both paths tried to INSERT simultaneously, the second would fail, and the
    // user ended up with viewer/member access.
    console.log(`Sign-up complete. Role "${role}" stored in metadata for ${data.user?.id}`)
    return { data, error: null, needsConfirmation }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (!error) {
      setSession(null)
      setUser(null)
      setUserRole(null)
      setUserEmployee(null)
    }
    return { error }
  }

  async function updatePassword(newPassword) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    return { data, error }
  }

  // Role-based permission checks
  // admin  = Principal Architect → full control of everything
  // member = Senior Architect   → view / read-only access
  function hasPermission(action) {
    const permissions = {
      admin: [
        'manage_team', 'manage_projects', 'manage_tasks',
        'manage_documents', 'manage_roles', 'view_all',
        'delete_projects', 'delete_tasks', 'delete_members',
        'manage_settings', 'manage_billing', 'invite_users',
      ],
      member: [
        'view_all',
      ],
      viewer: [
        'view_all',
      ],
    }
    return (permissions[userRole] || []).includes(action)
  }

  const value = {
    session,
    user,
    userRole,
    userEmployee,
    loading,
    signIn,
    signUp,
    signOut,
    updatePassword,
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
