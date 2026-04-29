import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, FolderKanban, CheckSquare, Users,
  CalendarDays, FileText, Menu, X, GanttChart, LogOut, Shield
} from 'lucide-react'
import { useAuth } from '../lib/AuthContext'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderKanban, label: 'Projects' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { to: '/gantt', icon: GanttChart, label: 'Gantt Chart' },
  { to: '/team', icon: Users, label: 'Team', roles: ['admin', 'manager'] },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/documents', icon: FileText, label: 'Documents' },
]

const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
  viewer: 'Viewer',
}

const ROLE_COLORS = {
  admin: '#E05252',
  manager: '#C8A96E',
  member: '#4A90D9',
  viewer: '#6B6B6B',
}

export function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const { user, userRole, userEmployee, signOut } = useAuth()

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

  async function handleSignOut() {
    await signOut()
  }

  // Filter nav items based on user role
  const visibleNavItems = navItems.filter(item => {
    if (!item.roles) return true
    return item.roles.includes(userRole)
  })

  const displayName = userEmployee?.name || user?.email?.split('@')[0] || 'User'
  const displayInitial = displayName.charAt(0).toUpperCase()
  const avatarColor = userEmployee?.color || '#C8A96E'

  return (
    <div className="app-shell">
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">
            <div className="sidebar-logo-icon">N</div>
            <div className="sidebar-logo-text">
              <span className="sidebar-logo-name">NHN</span>
              <span className="sidebar-logo-sub">Architects</span>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Main</div>
          {visibleNavItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User section at bottom */}
        <div className="sidebar-user-section">
          <div className="sidebar-user-info">
            <div className="sidebar-user-avatar" style={{ background: avatarColor }}>
              {displayInitial}
            </div>
            <div className="sidebar-user-details">
              <div className="sidebar-user-name">{displayName}</div>
              <div className="sidebar-user-role" style={{ color: ROLE_COLORS[userRole] || '#8A8A88' }}>
                <Shield size={10} />
                {ROLE_LABELS[userRole] || 'User'}
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
          <div className="sidebar-logo-mark" style={{ gap: 10 }}>
            <div className="sidebar-logo-icon" style={{ width: 30, height: 30, fontSize: 15 }}>N</div>
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>NHN PM</span>
          </div>
          <div style={{ width: 36 }} /> {/* spacer to center logo */}
        </div>

        {children}
      </div>
    </div>
  )
}
