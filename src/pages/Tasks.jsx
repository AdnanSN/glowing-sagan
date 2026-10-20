import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { RefreshButton } from '../components/RefreshButton'
import { TaskBoard } from '../components/TaskBoard'
import { ASSIGNEES_SELECT, LEAD_SELECT } from '../lib/assignees'
import { matchesDue, useDueFilter } from '../lib/taskFilters'

/* ────────────────────────────────────────────────────────────────
   ALL TASKS

   Tasks live inside their projects now — Projects › folder › project
   is where the board is worked from, and this page is no longer in the
   sidebar. It stays as the one view across every project, which is
   what the dashboard's "Open Tasks" and "Overdue Tasks" cards open:
   the number you clicked is the list you land on.
   ──────────────────────────────────────────────────────────────── */

export function Tasks() {
  const { hasPermission } = useAuth()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [folders, setFolders] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const due = useDueFilter()

  useEffect(() => { fetchAll() }, [])

  // `quiet` re-reads without the spinner: after a save the board stays
  // mounted, so its search and open cards survive.
  async function fetchAll({ quiet = false } = {}) {
    if (!quiet) setLoading(true)
    const [t, p, f, e] = await Promise.all([
      supabase.from('tasks')
        .select(`*, ${LEAD_SELECT}, project:projects(id,name,color), ${ASSIGNEES_SELECT}`)
        .order('created_at', { ascending: false }),
      // Stages for the dialog's stage list; the restriction columns so a
      // Principal Architect sees when a task is already hidden by its
      // project or folder.
      supabase.from('projects').select('id,name,color,stages,is_confidential,folder_id').order('name'),
      supabase.from('project_folders').select('id,name,parent_id,is_confidential'),
      supabase.from('employees').select('*').order('name'),
    ])
    if (t.error) console.error('Tasks: tasks query failed —', t.error)
    setTasks(t.data || [])
    setProjects(p.data || [])
    setFolders(f.data || [])
    setEmployees(e.data || [])
    setLoading(false)
  }

  // Sub-tasks count: each is somebody's real work, and the dashboard
  // counts them the same way, so the card and this header agree.
  const headline = due.active
    ? `${tasks.filter(t => matchesDue(t, due.value)).length} ${due.active.count}`
    : `${tasks.filter(t => t.status !== 'Done').length} open tasks across all projects`

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button className="icon-btn" title="Back to the dashboard" onClick={() => navigate('/')}>
              <ArrowLeft size={15} />
            </button>
            <div>
              <span className="page-header-title">All Tasks</span>
              <span className="page-header-sub" style={{ display: 'block' }}>{headline}</span>
            </div>
          </div>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={() => fetchAll({ quiet: true })} />
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="loading-container"><div className="loading-spinner" /><span>Loading…</span></div>
        ) : (
          <TaskBoard
            tasks={tasks}
            employees={employees}
            projects={projects}
            folders={folders}
            canManage={hasPermission('manage_tasks')}
            canRestrict={hasPermission('manage_confidential')}
            onChanged={() => fetchAll({ quiet: true })}
          />
        )}
      </div>
    </>
  )
}
