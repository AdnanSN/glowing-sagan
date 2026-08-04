import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, FolderKanban, CheckSquare, Users,
  CalendarDays, FileText, Menu, GanttChart, CalendarRange,
  LogOut, Shield, ShieldCheck, Camera
} from 'lucide-react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { roleMeta } from '../lib/constants'
import { ProfilePhotoModal } from './ProfilePhotoModal'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderKanban, label: 'Projects' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { to: '/gantt/project', icon: GanttChart, label: 'Project Timeline' },
  { to: '/gantt/team', icon: CalendarRange, label: 'Team Schedule' },
  { to: '/team', icon: Users, label: 'Team', requires: 'manage_team' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/documents', icon: FileText, label: 'Documents' },
  { to: '/access', icon: ShieldCheck, label: 'Access', requires: 'manage_access', badge: 'pending' },
]

export function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [photoOpen, setPhotoOpen] = useState(false)
  const location = useLocation()
  const { user, userRole, userEmployee, signOut, hasPermission } = useAuth()

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  // Close sidebar on ESC key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setSidebarOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Prevent body scroll when sidebar open on mobile
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  // Keep the badge on the Access link current so owners notice a new
  // sign-up without having to open the page.
  const canManageAccess = hasPermission('manage_access')
  useEffect(() => {
    if (!canManageAccess) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => { if (!cancelled) setPendingCount(count || 0) })
    return () => { cancelled = true }
  }, [canManageAccess, location.pathname])

  async function handleSignOut() {
    await signOut()
  }

  // Filter nav items based on what this user may actually do
  const visibleNavItems = navItems.filter(item => !item.requires || hasPermission(item.requires))

  const displayName = userEmployee?.name || user?.email?.split('@')[0] || 'User'
  const displayInitial = displayName.charAt(0).toUpperCase()
  const avatarColor = userEmployee?.color || '#1A1A1A'
  const avatarUrl = userEmployee?.avatar_url || null
  const role = roleMeta(userRole)

  return (
    <div className="app-shell">
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <img src="/NHN_LOGO.svg" alt="NHN Architects" className="sidebar-logo-img" />
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Main</div>
          {visibleNavItems.map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon />
              {label}
              {badge === 'pending' && pendingCount > 0 && (
                <span className="nav-item-badge">{pendingCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User section at bottom */}
        <div className="sidebar-user-section">
          <div className="sidebar-user-info">
            <button
              className="sidebar-user-avatar"
              style={{ background: avatarColor }}
              onClick={() => setPhotoOpen(true)}
              title="Change your photo"
              aria-label="Change your photo"
            >
              {avatarUrl
                ? <img className="avatar-img" src={avatarUrl} alt="" decoding="async" />
                : displayInitial}
              <span className="sidebar-user-avatar-edit"><Camera size={9} /></span>
            </button>
            <div className="sidebar-user-details">
              <div className="sidebar-user-name">{displayName}</div>
              <div className="sidebar-user-role" style={{ color: role.color }}>
                <Shield size={10} />
                {role.label}
              </div>
            </div>
          </div>
          <button
            className="sidebar-logout-btn"
            onClick={handleSignOut}
            title="Sign out"
            id="logout-btn"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="main-content">
        {/* Mobile top bar */}
        <div className="mobile-topbar">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle menu">
            <Menu size={20} />
          </button>
          <img src="/NHN_LOGO.svg" alt="NHN Architects" className="mobile-logo-img" />
          <div style={{ width: 40 }} /> {/* spacer to center logo */}
        </div>

        {children}
      </div>

      <ProfilePhotoModal isOpen={photoOpen} onClose={() => setPhotoOpen(false)} />
    </div>
  )
}
