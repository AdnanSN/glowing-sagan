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
      // Look up the user_roles table to find the role and linked employee
      const { data: roleData, error } = await supabase
        .from('user_roles')
        .select('*, employees(*)')
        .eq('auth_user_id', authUser.id)
        .single()

      if (error || !roleData) {
        // User exists in auth but has no role assigned
        setUserRole('viewer')
        setUserEmployee(null)
      } else {
        setUserRole(roleData.role)
        setUserEmployee(roleData.employees || null)
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
  function hasPermission(action) {
    const permissions = {
      admin: [
        'manage_team', 'manage_projects', 'manage_tasks',
        'manage_documents', 'manage_roles', 'view_all',
        'delete_projects', 'delete_tasks', 'delete_members',
      ],
      manager: [
        'manage_projects', 'manage_tasks', 'manage_documents',
        'view_all', 'delete_tasks',
      ],
      member: [
        'manage_tasks', 'view_all', 'manage_documents',
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
