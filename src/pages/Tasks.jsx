import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Modal } from '../components/Modal'
import { Plus, Search, CheckSquare } from 'lucide-react'
import { RefreshButton } from '../components/RefreshButton'
import { format, isPast, isToday } from 'date-fns'
import { TASK_STATUSES, PRIORITIES } from '../lib/constants'

const STATUS_COLORS = {
  'To Do': { bg: '#F2F2F7', color: '#555' },
  'In Progress': { bg: 'var(--info-light)', color: 'var(--info)' },
  'In Review': { bg: 'var(--warning-light)', color: 'var(--warning)' },
  'Done': { bg: 'var(--success-light)', color: 'var(--success)' },
}

const PRIORITY_COLORS = {
  'Low': 'var(--priority-low)',
  'Medium': 'var(--priority-medium)',
  'High': 'var(--priority-high)',
}

const EMPTY_FORM = {
  title: '', description: '', status: 'To Do', priority: 'Medium',
  project_id: '', assignee_id: '', due_date: '', stage: ''
}

export function Tasks() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_tasks')
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('All')
  const [filterAssignee, setFilterAssignee] = useState('All')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [t, p, e] = await Promise.all([
      supabase.from('tasks').select('*, assignee:employees(id,name,color), project:projects(id,name,color)').order('created_at', { ascending: false }),
      supabase.from('projects').select('id,name,color').order('name'),
      supabase.from('employees').select('*').order('name'),
    ])
    setTasks(t.data || [])
    setProjects(p.data || [])
    setEmployees(e.data || [])
    setLoading(false)
  }

  function openNew() { setEditing(null); setForm(EMPTY_FORM); setShowModal(true) }
  function openEdit(task) { setEditing(task); setForm({ ...task, project_id: task.project_id || '', assignee_id: task.assignee_id || '', due_date: task.due_date || '', stage: task.stage || '', description: task.description || '' }); setShowModal(true) }
  function closeModal() { setShowModal(false); setEditing(null) }

  async function handleSave() {
    setSaving(true)
    const payload = {
      title: form.title,
      description: form.description,
      status: form.status,
      priority: form.priority,
      project_id: form.project_id || null,
      assignee_id: form.assignee_id || null,
      due_date: form.due_date || null,
      stage: form.stage || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = editing
      ? await supabase.from('tasks').update(payload).eq('id', editing.id)
      : await supabase.from('tasks').insert(payload)
    setSaving(false)
    if (error) {
      alert(`Could not save task: ${error.message}`)
      return
    }
    closeModal()
    fetchAll()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this task?')) return
    await supabase.from('tasks').delete().eq('id', id)
    fetchAll()
  }

  async function updateStatus(taskId, newStatus) {
    await supabase.from('tasks').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', taskId)
    fetchAll()
  }

  const filtered = tasks.filter(t => {
    const matchSearch = t.title.toLowerCase().includes(search.toLowerCase())
    const matchProject = filterProject === 'All' || t.project_id === filterProject
    const matchAssignee = filterAssignee === 'All' || t.assignee_id === filterAssignee
    return matchSearch && matchProject && matchAssignee
  })

  const columns = TASK_STATUSES.map(status => ({
    status,
    tasks: filtered.filter(t => t.status === status)
  }))

  const modalFooter = (
    <>
      <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
      <button className="btn btn-primary" onClick={handleSave} disabled={!form.title || saving}>
        {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Task'}
      </button>
    </>
  )

  const colStatusStyle = (status) => ({
    borderRadius: '50%',
    width: 10, height: 10, flexShrink: 0,
    background: STATUS_COLORS[status]?.color || '#ccc'
  })

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-header-title">Tasks</span>
          <span className="page-header-sub">{tasks.filter(t => t.status !== 'Done').length} open tasks</span>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={fetchAll} />
          {canManage && (
            <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add Task</button>
          )}
        </div>
      </div>

      <div className="page-body">
        <div className="filter-bar">
          <div className="search-bar">
            <Search />
            <input className="form-input" placeholder="Search tasks…" value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-select" style={{ width: 'auto', height: 36 }} value={filterProject}
            onChange={e => setFilterProject(e.target.value)}>
            <option value="All">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="form-select" style={{ width: 'auto', height: 36 }} value={filterAssignee}
            onChange={e => setFilterAssignee(e.target.value)}>
            <option value="All">All Assignees</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="loading-container"><div className="loading-spinner" /><span>Loading…</span></div>
        ) : tasks.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><CheckSquare /></div>
              <div className="empty-state-title">No tasks yet</div>
              <div className="empty-state-desc">Add tasks and assign them to team members</div>
              {canManage && <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add Task</button>}
            </div>
          </div>
        ) : (
          <div className="kanban-board">
            {columns.map(({ status, tasks: colTasks }) => (
              <div key={status} className="kanban-column">
                <div className="kanban-col-header">
                  <div className="kanban-col-title">
                    <div style={colStatusStyle(status)} />
                    {status}
                  </div>
                  <span className="kanban-col-count">{colTasks.length}</span>
                </div>
                {colTasks.map(task => {
                  const isOverdue = task.due_date && isPast(new Date(task.due_date)) && !isToday(new Date(task.due_date)) && task.status !== 'Done'
                  return (
                    <div key={task.id} className="kanban-task-card" onClick={() => canManage && openEdit(task)} style={{ cursor: canManage ? 'pointer' : 'default' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                        <div className="kanban-task-title">{task.title}</div>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: PRIORITY_COLORS[task.priority], flexShrink: 0, marginTop: 4 }} title={task.priority + ' priority'} />
                      </div>
                      {task.description && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                          {task.description.slice(0, 80)}{task.description.length > 80 ? '…' : ''}
                        </div>
                      )}
                      <div className="kanban-task-meta">
                        {task.project && <span className="kanban-task-project">{task.project.name}</span>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginLeft: 'auto' }}>
                          {task.due_date && (
                            <span style={{ fontSize: 'var(--text-xs)', color: isOverdue ? 'var(--danger)' : 'var(--text-muted)', fontWeight: isOverdue ? 600 : 400 }}>
                              {format(new Date(task.due_date), 'd MMM')}
                            </span>
                          )}
                          {task.assignee && (
                            <div className="avatar avatar-sm" style={{ background: task.assignee.color }} title={task.assignee.name}>
                              {task.assignee.name.charAt(0)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {canManage && (
                  <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 'var(--space-2)' }}
                    onClick={() => { setForm({ ...EMPTY_FORM, status }); setEditing(null); setShowModal(true) }}>
                    <Plus size={13} /> Add
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Task' : 'New Task'} footer={modalFooter}>
        <div className="form-group">
          <label className="form-label">Task Title *</label>
          <input className="form-input" placeholder="e.g. Prepare floor plan drawings" value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-textarea" placeholder="Add details…" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-select" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Project</label>
            <select className="form-select" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
              <option value="">— No Project —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Assignee</label>
            <select className="form-select" value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
              <option value="">— Unassigned —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Due Date</label>
            <input className="form-input" type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Stage</label>
            <input className="form-input" placeholder="e.g. Schematic Design" value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))} />
          </div>
        </div>
        {editing && canManage && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <button className="btn btn-danger btn-sm" onClick={() => { closeModal(); handleDelete(editing.id) }}>
              Delete Task
            </button>
          </div>
        )}
      </Modal>
    </>
  )
}
