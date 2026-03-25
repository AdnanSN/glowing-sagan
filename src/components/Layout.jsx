import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FolderKanban, CheckSquare, Users,
  CalendarDays, FileText, Building2
} from 'lucide-react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects', icon: FolderKanban, label: 'Projects' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { to: '/team', icon: Users, label: 'Team' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/documents', icon: FileText, label: 'Documents' },
]

export function Layout({ children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">
            <div className="sidebar-logo-icon">A</div>
            <div className="sidebar-logo-text">
              <span className="sidebar-logo-name">Archivio</span>
              <span className="sidebar-logo-sub">Studio</span>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Main</div>
          {navItems.map(({ to, icon: Icon, label }) => (
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

        <div className="sidebar-footer">
          <div className="sidebar-footer-text">Archivio PM v1.0</div>
        </div>
      </aside>

      <div className="main-content">
        {children}
      </div>
    </div>
  )
}
