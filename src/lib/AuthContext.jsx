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
        // No role row yet — check if sign-up stored a pending role in user metadata
        const pendingRole = authUser.user_metadata?.pending_role
        const pendingName = authUser.user_metadata?.full_name

        if (pendingRole) {
          console.log(`Creating user_roles row from metadata: role=${pendingRole}, name=${pendingName}`)

          // Try to match the name to an employee record
          let employeeId = null
          if (pendingName) {
            const { data: employees } = await supabase
              .from('employees')
              .select('id, name')
            const matched = (employees || []).find(
              e => e.name.toLowerCase().trim() === pendingName.toLowerCase().trim()
            )
            employeeId = matched?.id ?? null
          }

          const { data: newRole, error: insertError } = await supabase
            .from('user_roles')
            .insert({
              auth_user_id: authUser.id,
              employee_id: employeeId,
              role: pendingRole,
            })
            .select('*, employees(*)')
            .single()

          if (insertError) {
            console.error('Failed to create user role from metadata:', insertError)
            setUserRole('viewer')
            setUserEmployee(null)
          } else {
            console.log('User role created successfully:', newRole.role)
            setUserRole(newRole.role)
            setUserEmployee(newRole.employees || null)

            // Clear the pending metadata now that the role is persisted
            await supabase.auth.updateUser({
              data: { pending_role: null, full_name: null },
            })
          }
        } else {
          // No pending role in metadata either — true viewer
          setUserRole('viewer')
          setUserEmployee(null)
        }
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

    // If we got a session immediately (email confirm OFF), try to insert
    // the role right now so the user doesn't have to re-login.
    if (data.session && data.user) {
      await createRoleFromMetadata(data.user)
    }

    console.log(`Sign-up complete. Role "${role}" stored in metadata for ${data.user?.id}`)
    return { data, error: null, needsConfirmation }
  }

  // Helper: create the user_roles row from user metadata
  async function createRoleFromMetadata(authUser) {
    const role = authUser.user_metadata?.pending_role
    const fullName = authUser.user_metadata?.full_name
    if (!role) return

    let employeeId = null
    if (fullName) {
      const { data: employees } = await supabase
        .from('employees')
        .select('id, name')
      const matched = (employees || []).find(
        e => e.name.toLowerCase().trim() === fullName.toLowerCase().trim()
      )
      employeeId = matched?.id ?? null
    }

    const { error: roleError } = await supabase.from('user_roles').insert({
      auth_user_id: authUser.id,
      employee_id: employeeId,
      role,
    })

    if (roleError) {
      console.error('Failed to insert user role:', roleError)
    } else {
      console.log(`User role created: ${role}`)
      await supabase.auth.updateUser({
        data: { pending_role: null, full_name: null },
      })
    }
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
