import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Login } from './pages/Login'
import { PendingApproval } from './pages/PendingApproval'
import { AccessControl } from './pages/AccessControl'
import { Dashboard } from './pages/Dashboard'
import { Projects } from './pages/Projects'
import { ProjectDetail } from './pages/ProjectDetail'
import { Tasks } from './pages/Tasks'
import { Team } from './pages/Team'
import { Calendar } from './pages/Calendar'
import { Documents } from './pages/Documents'
import { GanttProject } from './pages/GanttProject'
import { GanttTeam } from './pages/GanttTeam'
import { supabaseConfigured } from './lib/supabase'
import './index.css'

function SetupBanner() {
  if (supabaseConfigured) return null
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      background: '#1A1A1A', color: '#FFFFFF', borderRadius: 0,
      padding: '16px 20px', maxWidth: 360, boxShadow: '0 24px 64px rgba(26,26,26,0.16)',
      fontSize: 13, lineHeight: 1.6, border: '1px solid rgba(255,255,255,0.18)'
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 11 }}>⚡ Supabase Setup Required</div>
      <div>Create a <code style={{ background: 'rgba(255,255,255,0.12)', padding: '1px 5px' }}>.env.local</code> file in the project root with:</div>
      <pre style={{ marginTop: 8, background: 'rgba(255,255,255,0.08)', padding: 10, fontSize: 11, overflowX: 'auto' }}>
{`VITE_SUPABASE_URL=your_url
VITE_SUPABASE_ANON_KEY=your_anon_key`}
      </pre>
      <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>Run the SQL schema in supabase/schema.sql then restart the dev server.</div>
    </div>
  )
}

function AppRoutes() {
  const { isAuthenticated, isApproved, loading } = useAuth()

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
        <span>Loading…</span>
      </div>
    )
  }

  // Signed in but not yet let in: the whole app is replaced by the gate.
  // The database already returns nothing for these accounts — this is so
  // they get an explanation rather than a wall of empty screens.
  if (isAuthenticated && !isApproved) {
    return (
      <Routes>
        <Route path="*" element={<PendingApproval />} />
      </Routes>
    )
  }

  return (
    <Routes>
      {/* Public route */}
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout><Dashboard /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects"
        element={
          <ProtectedRoute>
            <Layout><Projects /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:id"
        element={
          <ProtectedRoute>
            <Layout><ProjectDetail /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks"
        element={
          <ProtectedRoute>
            <Layout><Tasks /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/team"
        element={
          <ProtectedRoute requires="manage_team">
            <Layout><Team /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/access"
        element={
          <ProtectedRoute requires="manage_access">
            <Layout><AccessControl /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/calendar"
        element={
          <ProtectedRoute>
            <Layout><Calendar /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/documents"
        element={
          <ProtectedRoute>
            <Layout><Documents /></Layout>
          </ProtectedRoute>
        }
      />
      {/* The chart is two charts now: one job stage by stage, and the
          whole team's workload. /gantt keeps old links working. */}
      <Route path="/gantt" element={<Navigate to="/gantt/project" replace />} />
      <Route
        path="/gantt/project"
        element={
          <ProtectedRoute>
            <Layout><GanttProject /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/gantt/team"
        element={
          <ProtectedRoute>
            <Layout><GanttTeam /></Layout>
          </ProtectedRoute>
        }
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SetupBanner />
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
