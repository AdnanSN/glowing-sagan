import { createContext, useContext, useState, useEffect } from 'react'
import { supabase, supabaseConfigured } from './supabase'

const AuthContext = createContext(null)

// admin  = Principal Architect / CEO  → full control
// member = Senior Architect            → read-only
const PERMISSIONS = {
  admin: [
    'manage_team', 'manage_projects', 'manage_tasks',
    'manage_documents', 'manage_milestones',
    'delete_projects', 'delete_tasks',
    'view_all',
  ],
  member: [
    'view_all',
  ],
}

function roleFromUser(authUser) {
  return authUser?.app_metadata?.role || 'member'
}

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

    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => { applySession(session) }
    )

    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function applySession(session) {
    setSession(session)
    setUser(session?.user ?? null)

    if (!session?.user) {
      setUserRole(null)
      setUserEmployee(null)
      setLoading(false)
      return
    }

    setUserRole(roleFromUser(session.user))
    await fetchEmployee(session.user.id)
    setLoading(false)
  }

  async function fetchEmployee(authUserId) {
    const { data, error } = await supabase
      .from('employees')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    if (error) {
      console.error('Error fetching employee record:', error)
      setUserEmployee(null)
      return
    }
    setUserEmployee(data ?? null)
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
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

  function hasPermission(action) {
    return (PERMISSIONS[userRole] || []).includes(action)
  }

  const value = {
    session,
    user,
    userRole,
    userEmployee,
    loading,
    signIn,
    signOut,
    hasPermission,
    isAuthenticated: !!session,
    isAdmin: userRole === 'admin',
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
