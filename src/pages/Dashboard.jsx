import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  FolderKanban, CheckSquare, Users, AlertTriangle,
  TrendingUp, Clock, Plus, ArrowRight, Circle
} from 'lucide-react'
import { RefreshButton } from '../components/RefreshButton'
import { Avatar } from '../components/Avatar'
import { format, isPast, isToday } from 'date-fns'
import { STAGES, PROJECT_COLORS } from '../lib/constants'

export function Dashboard() {
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [milestones, setMilestones] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [p, t, e, m] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('tasks').select('*, assignee:employees(id,name,color,avatar_url)').order('created_at', { ascending: false }),
      supabase.from('employees').select('*').order('name'),
      supabase.from('milestones').select('*, project:projects(name)').order('due_date'),
    ])
    setProjects(p.data || [])
    setTasks(t.data || [])
    setEmployees(e.data || [])
    setMilestones(m.data || [])
    setLoading(false)
  }

  const activeProjects = projects.filter(p => p.status === 'Active').length
  const todayTasks = tasks.filter(t => t.due_date && isToday(new Date(t.due_date)) && t.status !== 'Done').length
  const overdueTasks = tasks.filter(t => t.due_date && isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date)) && t.status !== 'Done').length
  const upcomingMilestones = milestones.filter(m => !m.is_completed && m.due_date).slice(0, 5)

  const recentProjects = projects.slice(0, 6)

  if (loading) return (
    <div className="page-body">
      <div className="loading-container"><div className="loading-spinner" /><span>Loading dashboard…</span></div>
    </div>
  )

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-header-title">Dashboard</span>
          <span className="page-header-sub">{format(new Date(), 'EEEE, d MMMM yyyy')}</span>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={fetchAll} />
          <Link to="/projects" className="btn btn-primary"><Plus size={15} /> New Project</Link>
        </div>
      </div>

      <div className="page-body">
        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--accent-light)', color: 'var(--accent-primary)' }}>
              <FolderKanban />
            </div>
            <div className="stat-content">
              <div className="stat-value">{activeProjects}</div>
              <div className="stat-label">Active Projects</div>
              <div className="stat-delta">{projects.length} total</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--info-light)', color: 'var(--info)' }}>
              <CheckSquare />
            </div>
            <div className="stat-content">
              <div className="stat-value">{tasks.filter(t => t.status !== 'Done').length}</div>
              <div className="stat-label">Open Tasks</div>
              <div className="stat-delta">{todayTasks} due today</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: overdueTasks > 0 ? 'var(--danger-light)' : 'var(--success-light)', color: overdueTasks > 0 ? 'var(--danger)' : 'var(--success)' }}>
              <AlertTriangle />
            </div>
            <div className="stat-content">
              <div className="stat-value">{overdueTasks}</div>
              <div className="stat-label">Overdue Tasks</div>
              <div className="stat-delta" style={{ color: overdueTasks > 0 ? 'var(--danger)' : 'var(--success)' }}>
                {overdueTasks > 0 ? 'Needs attention' : 'All on track'}
              </div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#F0EBF8', color: '#8B5CF6' }}>
              <Users />
            </div>
            <div className="stat-content">
              <div className="stat-value">{employees.length}</div>
              <div className="stat-label">Team Members</div>
              <div className="stat-delta">
                {tasks.filter(t => t.assignee_id && t.status !== 'Done').length} assigned tasks
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-main-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 'var(--space-6)' }}>
          {/* Projects */}
          <div>
            <div className="section-header">
              <span className="section-title">Active Projects</span>
              <Link to="/projects" className="btn btn-ghost btn-sm">View all <ArrowRight size={13} /></Link>
            </div>
            {recentProjects.length === 0 ? (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-state-icon"><FolderKanban /></div>
                  <div className="empty-state-title">No projects yet</div>
                  <div className="empty-state-desc">Create your first project to get started</div>
                  <Link to="/projects" className="btn btn-primary"><Plus size={15} /> New Project</Link>
                </div>
              </div>
            ) : (
              <div className="projects-grid">
                {recentProjects.map(project => {
                  const projectTasks = tasks.filter(t => t.project_id === project.id)
                  const doneTasks = projectTasks.filter(t => t.status === 'Done').length
                  const totalTasks = projectTasks.length
                  const progress = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0
                  const stageIdx = STAGES.indexOf(project.current_stage)
                  const stagePercent = Math.round(((stageIdx + 1) / STAGES.length) * 100)
                  const assignees = [...new Map(
                    projectTasks.filter(t => t.assignee).map(t => [t.assignee.id, t.assignee])
                  ).values()].slice(0, 4)

                  return (
                    <Link to={`/projects/${project.id}`} key={project.id} style={{ textDecoration: 'none' }}>
                      <div className="project-card" style={{ '--project-color': project.color }}>
                        <div className="project-card-header">
                          <div>
                            <div className="project-card-title">{project.name}</div>
                            <div className="project-card-client">{project.client}</div>
                          </div>
                          <span className={`badge badge-${project.status.toLowerCase()}`}>{project.status}</span>
                        </div>

                        <div className="project-card-meta">
                          <span className="tag">{project.project_type}</span>
                          <span className="tag" style={{ color: 'var(--text-muted)' }}>
                            <Clock size={11} style={{ marginRight: 3 }} />
                            {project.current_stage}
                          </span>
                        </div>

                        <div style={{ marginBottom: 'var(--space-3)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span className="text-xs text-muted">Stage Progress</span>
                            <span className="text-xs text-muted">{stagePercent}%</span>
                          </div>
                          <div className="progress-bar-container">
                            <div className="progress-bar-fill" style={{ width: `${stagePercent}%`, background: project.color }} />
                          </div>
                        </div>

                        <div className="project-card-footer">
                          <div className="task-count-badge">
                            <CheckSquare size={12} />
                            {doneTasks}/{totalTasks} tasks
                          </div>
                          <div className="avatar-group">
                            {assignees.map(a => (
                              <Avatar key={a.id} name={a.name} color={a.color} avatarUrl={a.avatar_url} size="sm" />
                            ))}
                          </div>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Sidebar: Upcoming Milestones + Team */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Upcoming Milestones</span>
              </div>
              <div className="card-body" style={{ paddingTop: 'var(--space-4)' }}>
                {upcomingMilestones.length === 0 ? (
                  <div className="no-data">No upcoming milestones</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {upcomingMilestones.map(m => {
                      const isOverdue = m.due_date && isPast(new Date(m.due_date)) && !isToday(new Date(m.due_date))
                      return (
                        <div key={m.id} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: isOverdue ? 'var(--danger)' : 'var(--accent-primary)', marginTop: 5, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{m.title}</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: isOverdue ? 'var(--danger)' : 'var(--text-secondary)' }}>
                              {m.project?.name} · {m.due_date ? format(new Date(m.due_date), 'd MMM') : 'No date'}
                              {isOverdue && ' · Overdue'}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Team</span>
                <Link to="/team" className="btn btn-ghost btn-sm">Manage</Link>
              </div>
              <div className="card-body" style={{ paddingTop: 'var(--space-2)', paddingBottom: 'var(--space-2)' }}>
                {employees.length === 0 ? (
                  <div className="no-data">No team members yet</div>
                ) : (
                  employees.slice(0, 6).map(emp => {
                    const assigned = tasks.filter(t => t.assignee_id === emp.id && t.status !== 'Done').length
                    return (
                      <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) 0' }}>
                        <Avatar name={emp.name} color={emp.color} avatarUrl={emp.avatar_url} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{emp.name}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{emp.role}</div>
                        </div>
                        {assigned > 0 && <span className="chip">{assigned}</span>}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
