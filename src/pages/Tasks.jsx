import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Modal } from '../components/Modal'
import { Plus, Search, CheckSquare } from 'lucide-react'
import { RefreshButton } from '../components/RefreshButton'
import { AvatarStack } from '../components/Avatar'
import { AssigneePicker } from '../components/AssigneePicker'
import { ConfidentialIcon } from '../components/ConfidentialTag'
import { format, isPast, isToday, isTomorrow } from 'date-fns'
import { TASK_STATUSES, PRIORITIES } from '../lib/constants'
import {
  ASSIGNEES_SELECT, LEAD_SELECT, assigneeIdsOf, assigneesOf, isAssignedTo, setTaskAssignees,
} from '../lib/assignees'

const STATUS_COLORS = {
  'To Do': { bg: '#F3F4F6', color: '#6B7280' },
  'In Progress': { bg: 'var(--info-light)', color: 'var(--info)' },
  'In Review': { bg: 'var(--warning-light)', color: 'var(--warning)' },
  'Done': { bg: 'var(--success-light)', color: 'var(--success)' },
}

const PRIORITY_COLORS = {
  'Low': 'var(--priority-low)',
  'Medium': 'var(--priority-medium)',
  'High': 'var(--priority-high)',
}

// Slices of the board by when work is due. The dashboard's stat cards
// link straight to these, so the counts there and the board agree.
// `count` names the slice in the header; `empty` explains an empty board.
const DUE_FILTERS = [
  {
    value: 'today', label: 'Due today', count: 'due today',
    empty: { title: 'Nothing due today', desc: 'No open task is due today.' },
  },
  {
    value: 'tomorrow', label: 'Due tomorrow', count: 'due tomorrow',
    empty: { title: 'Nothing due tomorrow', desc: 'No open task is due tomorrow.' },
  },
  {
    value: 'overdue', label: 'Overdue', count: 'overdue',
    empty: { title: 'Nothing overdue', desc: 'Every open task is still within its due date.' },
  },
]

function matchesDue(task, filter) {
  if (filter === 'All') return true
  // Finished work is neither due nor late, whatever its date says.
  if (!task.due_date || task.status === 'Done') return false
  const due = new Date(task.due_date)
  if (filter === 'today') return isToday(due)
  if (filter === 'tomorrow') return isTomorrow(due)
  return isPast(due) && !isToday(due)
}

const EMPTY_FORM = {
  title: '', description: '', status: 'To Do', priority: 'Medium',
  project_id: '', assignee_ids: [], due_date: '', stage: ''
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
  // The due-date filter lives in the URL so the dashboard can link to a
  // slice of the board, Back steps out of it, and a refresh keeps it.
  const [params, setParams] = useSearchParams()
  const rawDue = params.get('due')
  const activeDue = DUE_FILTERS.find(d => d.value === rawDue) || null
  const filterDue = activeDue ? activeDue.value : 'All'
  // Pressing the button that is already on clears it, so the group
  // needs no separate "any due date" control.
  const setFilterDue = (value) => setParams(value === 'All' ? {} : { due: value })
  const toggleDue = (value) => setFilterDue(filterDue === value ? 'All' : value)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [t, p, e] = await Promise.all([
      supabase.from('tasks')
        .select(`*, ${LEAD_SELECT}, project:projects(id,name,color), ${ASSIGNEES_SELECT}`)
        .order('created_at', { ascending: false }),
      supabase.from('projects').select('id,name,color').order('name'),
      supabase.from('employees').select('*').order('name'),
    ])
    if (t.error) console.error('Tasks: tasks query failed —', t.error)
    setTasks(t.data || [])
    setProjects(p.data || [])
    setEmployees(e.data || [])
    setLoading(false)
  }

  function openNew() { setEditing(null); setForm(EMPTY_FORM); setShowModal(true) }
  function openEdit(task) { setEditing(task); setForm({ ...task, project_id: task.project_id || '', assignee_ids: assigneeIdsOf(task), due_date: task.due_date || '', stage: task.stage || '', description: task.description || '' }); setShowModal(true) }
  function closeModal() { setShowModal(false); setEditing(null) }

  async function handleSave() {
    setSaving(true)
    const payload = {
      title: form.title,
      description: form.description,
      status: form.status,
      priority: form.priority,
      project_id: form.project_id || null,
      due_date: form.due_date || null,
      stage: form.stage || null,
      updated_at: new Date().toISOString(),
    }
    // assignee_id is not in there on purpose: it is the lead, derived
    // by the database from the list written below.
    const { data, error } = editing
      ? await supabase.from('tasks').update(payload).eq('id', editing.id).select('id').single()
      : await supabase.from('tasks').insert(payload).select('id').single()

    if (error) {
      setSaving(false)
      alert(`Could not save task: ${error.message}`)
      return
    }

    const { error: peopleError } = await setTaskAssignees(data.id, form.assignee_ids)
    setSaving(false)
    // The task itself is saved by this point — say what did not land
    // rather than implying the whole save was lost.
    if (peopleError) alert(`Task saved, but who is on it was not: ${peopleError.message}`)

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
    // Anybody on it, not just the lead — otherwise filtering to a
    // person hides the shared work, which is the work they most need
    // to see.
    const matchAssignee = filterAssignee === 'All' || isAssignedTo(t, filterAssignee)
    return matchSearch && matchProject && matchAssignee && matchesDue(t, filterDue)
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
    width: 10, height: 10, flexShrink: 0,
    background: STATUS_COLORS[status]?.color || '#ccc'
  })

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-header-title">Tasks</span>
          <span className="page-header-sub">
            {activeDue
              ? `${filtered.length} ${activeDue.count}`
              : `${tasks.filter(t => t.status !== 'Done').length} open tasks`}
          </span>
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
          <select className="form-select form-select-sm" value={filterProject}
            onChange={e => setFilterProject(e.target.value)}>
            <option value="All">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="form-select form-select-sm" value={filterAssignee}
            onChange={e => setFilterAssignee(e.target.value)}>
            <option value="All">All Assignees</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <div className="due-filter-group">
            {DUE_FILTERS.map(d => (
              <button key={d.value} type="button"
                className={`due-filter-btn${filterDue === d.value ? ' active' : ''}`}
                aria-pressed={filterDue === d.value}
                onClick={() => toggleDue(d.value)}>
                {d.label}
              </button>
            ))}
          </div>
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
        ) : activeDue && filtered.length === 0 && !search && filterProject === 'All' && filterAssignee === 'All' ? (
          /* Arriving from the dashboard with nothing to see should say so,
             not leave four empty columns to read as a loading failure. */
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><CheckSquare /></div>
              <div className="empty-state-title">{activeDue.empty.title}</div>
              <div className="empty-state-desc">{activeDue.empty.desc}</div>
              <button className="btn btn-secondary" onClick={() => setFilterDue('All')}>Show all tasks</button>
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
                        <div className="kanban-task-title">
                          {task.title}
                          {task.is_confidential && (
                            <> <ConfidentialIcon size={11} /></>
                          )}
                        </div>
                        <div style={{ width: 8, height: 8, background: PRIORITY_COLORS[task.priority], flexShrink: 0, marginTop: 4 }} title={task.priority + ' priority'} />
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
                          <AvatarStack people={assigneesOf(task)} size="sm" max={3} />
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
            <label className="form-label">Assigned to</label>
            <AssigneePicker
              employees={employees}
              value={form.assignee_ids}
              onChange={ids => setForm(f => ({ ...f, assignee_ids: ids }))}
            />
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
