import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Projects } from './pages/Projects'
import { ProjectDetail } from './pages/ProjectDetail'
import { Tasks } from './pages/Tasks'
import { Team } from './pages/Team'
import { Calendar } from './pages/Calendar'
import { Documents } from './pages/Documents'
import { Gantt } from './pages/Gantt'
import { supabaseConfigured } from './lib/supabase'
import './index.css'

function SetupBanner() {
  if (supabaseConfigured) return null
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      background: '#1C1C1E', color: '#F5EDD8', borderRadius: 12,
      padding: '16px 20px', maxWidth: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      fontSize: 13, lineHeight: 1.6, border: '1px solid rgba(200,169,110,0.3)'
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#C8A96E' }}>⚡ Supabase Setup Required</div>
      <div>Create a <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: 4 }}>.env.local</code> file in the project root with:</div>
      <pre style={{ marginTop: 8, background: 'rgba(255,255,255,0.06)', padding: 10, borderRadius: 8, fontSize: 11, overflowX: 'auto' }}>
{`VITE_SUPABASE_URL=your_url
VITE_SUPABASE_ANON_KEY=your_anon_key`}
      </pre>
      <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>Run the SQL schema in supabase/schema.sql then restart the dev server.</div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SetupBanner />
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/team" element={<Team />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/gantt" element={<Gantt />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
