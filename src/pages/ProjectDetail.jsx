import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'
import {
  ArrowLeft, Plus, CheckSquare, Check, Pencil, Trash2,
  FileText, ExternalLink, Send, Flag, MapPin, Calendar, DollarSign, Clock
} from 'lucide-react'
import { format, isPast, isToday } from 'date-fns'
import {
  STAGES, STAGE_COLORS, TASK_STATUSES, PRIORITIES, DOC_TYPES,
  getStatusColor
} from '../lib/constants'

const EMPTY_TASK = { title: '', description: '', status: 'To Do', priority: 'Medium', assignee_id: '', due_date: '', stage: '' }
const EMPTY_MILESTONE = { title: '', due_date: '', is_completed: false }
const EMPTY_DOC = { name: '', url: '', doc_type: 'Drawing', uploaded_by: '', notes: '' }

export function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [milestones, setMilestones] = useState([])
  const [documents, setDocuments] = useState([])
  const [comments, setComments] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('tasks')

  // Modals
  const [taskModal, setTaskModal] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [taskForm, setTaskForm] = useState(EMPTY_TASK)

  const [milestoneModal, setMilestoneModal] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState(null)
  const [msForm, setMsForm] = useState(EMPTY_MILESTONE)

  const [docModal, setDocModal] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [docForm, setDocForm] = useState(EMPTY_DOC)

  const [commentText, setCommentText] = useState('')
  const [commentAuthor, setCommentAuthor] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    const [p, t, m, d, c, e] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('tasks').select('*, assignee:employees(id,name,color)').eq('project_id', id).order('created_at'),
      supabase.from('milestones').select('*').eq('project_id', id).order('due_date'),
      supabase.from('documents').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('comments').select('*').eq('project_id', id).order('created_at'),
      supabase.from('employees').select('*').order('name'),
    ])
    if (!p.data) { navigate('/projects'); return }
    setProject(p.data)
    setTasks(t.data || [])
    setMilestones(m.data || [])
    setDocuments(d.data || [])
    setComments(c.data || [])
    setEmployees(e.data || [])
    setLoading(false)
  }

  // === STAGE UPDATE ===
  async function updateStage(stage) {
    await supabase.from('projects').update({ current_stage: stage, updated_at: new Date().toISOString() }).eq('id', id)
    setProject(p => ({ ...p, current_stage: stage }))
  }

  // === TASKS ===
  function openNewTask() { setEditingTask(null); setTaskForm(EMPTY_TASK); setTaskModal(true) }
  function openEditTask(t) { setEditingTask(t); setTaskForm({ ...t, assignee_id: t.assignee_id || '', due_date: t.due_date || '', stage: t.stage || '', description: t.description || '' }); setTaskModal(true) }
  function closeTaskModal() { setTaskModal(false); setEditingTask(null) }

  async function saveTask() {
    setSaving(true)
    const payload = { ...taskForm, project_id: id, assignee_id: taskForm.assignee_id || null, due_date: taskForm.due_date || null, stage: taskForm.stage || null, updated_at: new Date().toISOString() }
    if (editingTask) {
      await supabase.from('tasks').update(payload).eq('id', editingTask.id)
    } else {
      await supabase.from('tasks').insert(payload)
    }
    setSaving(false)
    closeTaskModal()
    fetchAll()
  }

  async function deleteTask(tid) {
    if (!confirm('Delete this task?')) return
    await supabase.from('tasks').delete().eq('id', tid)
    fetchAll()
  }

  async function toggleTaskDone(task) {
    const newStatus = task.status === 'Done' ? 'To Do' : 'Done'
    await supabase.from('tasks').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', task.id)
    fetchAll()
  }

  // === MILESTONES ===
  function openNewMs() { setEditingMilestone(null); setMsForm(EMPTY_MILESTONE); setMilestoneModal(true) }
  function openEditMs(m) { setEditingMilestone(m); setMsForm({ ...m, due_date: m.due_date || '' }); setMilestoneModal(true) }
  function closeMsModal() { setMilestoneModal(false); setEditingMilestone(null) }

  async function saveMs() {
    setSaving(true)
    const payload = { ...msForm, project_id: id, due_date: msForm.due_date || null }
    if (editingMilestone) {
      await supabase.from('milestones').update(payload).eq('id', editingMilestone.id)
    } else {
      await supabase.from('milestones').insert(payload)
    }
    setSaving(false)
    closeMsModal()
    fetchAll()
  }

  async function toggleMilestone(m) {
    await supabase.from('milestones').update({ is_completed: !m.is_completed }).eq('id', m.id)
    fetchAll()
  }

  async function deleteMilestone(mid) {
    if (!confirm('Delete this milestone?')) return
    await supabase.from('milestones').delete().eq('id', mid)
    fetchAll()
  }

  // === DOCUMENTS ===
  function openNewDoc() { setEditingDoc(null); setDocForm(EMPTY_DOC); setDocModal(true) }
  function openEditDoc(d) { setEditingDoc(d); setDocForm({ ...d, url: d.url || '', uploaded_by: d.uploaded_by || '', notes: d.notes || '' }); setDocModal(true) }
  function closeDocModal() { setDocModal(false); setEditingDoc(null) }

  async function saveDoc() {
    setSaving(true)
    const payload = { ...docForm, project_id: id }
    if (editingDoc) {
      await supabase.from('documents').update(payload).eq('id', editingDoc.id)
    } else {
      await supabase.from('documents').insert(payload)
    }
    setSaving(false)
    closeDocModal()
    fetchAll()
  }

  async function deleteDoc(did) {
    if (!confirm('Delete this document?')) return
    await supabase.from('documents').delete().eq('id', did)
    fetchAll()
  }

  // === COMMENTS ===
  async function addComment() {
    if (!commentText.trim()) return
    await supabase.from('comments').insert({
      project_id: id,
      author: commentAuthor.trim() || 'Anonymous',
      content: commentText.trim(),
    })
    setCommentText('')
    fetchAll()
  }

  if (loading) return (
    <div className="page-body">
      <div className="loading-container"><div className="loading-spinner" /><span>Loading project…</span></div>
    </div>
  )
  if (!project) return null

  const doneTasks = tasks.filter(t => t.status === 'Done').length
  const totalTasks = tasks.length
  const taskProgress = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0
  const currentStageIdx = STAGES.indexOf(project.current_stage)

  const taskModalFooter = (
    <>
      <button className="btn btn-secondary" onClick={closeTaskModal}>Cancel</button>
      <button className="btn btn-primary" onClick={saveTask} disabled={!taskForm.title || saving}>
        {saving ? 'Saving…' : editingTask ? 'Save' : 'Add Task'}
      </button>
    </>
  )
  const msModalFooter = (
    <>
      <button className="btn btn-secondary" onClick={closeMsModal}>Cancel</button>
      <button className="btn btn-primary" onClick={saveMs} disabled={!msForm.title || saving}>
        {saving ? 'Saving…' : editingMilestone ? 'Save' : 'Add Milestone'}
      </button>
    </>
  )
  const docModalFooter = (
    <>
      <button className="btn btn-secondary" onClick={closeDocModal}>Cancel</button>
      <button className="btn btn-primary" onClick={saveDoc} disabled={!docForm.name || saving}>
        {saving ? 'Saving…' : editingDoc ? 'Save' : 'Add Document'}
      </button>
    </>
  )

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button className="icon-btn" onClick={() => navigate('/projects')} style={{ marginRight: 'var(--space-1)' }}><ArrowLeft size={15} /></button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: project.color }} />
                <span className="page-header-title">{project.name}</span>
                <span className={`badge ${getStatusColor(project.status)}`}>{project.status}</span>
              </div>
              <span className="page-header-sub">{project.client} {project.location && `· ${project.location}`}</span>
            </div>
          </div>
        </div>
        <div className="page-header-actions">
          <Link to={`/projects`} state={{ edit: project.id }} className="btn btn-secondary btn-sm"><Pencil size={13} /> Edit Project</Link>
        </div>
      </div>

      <div className="page-body">
        {/* Project Info Strip */}
        <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-5) var(--space-6)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-5)' }}>
            {project.budget && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>
                  <DollarSign size={12} /> Budget
                </div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>${Number(project.budget).toLocaleString()}</div>
              </div>
            )}
            {project.start_date && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>
                  <Calendar size={12} /> Start Date
                </div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{format(new Date(project.start_date), 'd MMM yyyy')}</div>
              </div>
            )}
            {project.end_date && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>
                  <Flag size={12} /> Deadline
                </div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: isPast(new Date(project.end_date)) && !isToday(new Date(project.end_date)) ? 'var(--danger)' : 'var(--text-primary)' }}>
                  {format(new Date(project.end_date), 'd MMM yyyy')}
                </div>
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>
                <CheckSquare size={12} /> Tasks
              </div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{doneTasks}/{totalTasks}</div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 4 }}>Task Progress</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div className="progress-bar-container" style={{ flex: 1 }}>
                  <div className="progress-bar-fill" style={{ width: `${taskProgress}%`, background: project.color }} />
                </div>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, minWidth: 30 }}>{taskProgress}%</span>
              </div>
            </div>
          </div>
          {project.description && (
            <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-light)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              {project.description}
            </div>
          )}
        </div>

        {/* Stage Pipeline */}
        <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-5) var(--space-6)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Project Stage</div>
          <div className="stage-pipeline">
            {STAGES.map((stage, i) => (
              <div
                key={stage}
                className={`stage-pill${i < currentStageIdx ? ' done' : ''}${stage === project.current_stage ? ' active' : ''}`}
                onClick={() => updateStage(stage)}
                title={`Set stage to: ${stage}`}
              >
                {i < currentStageIdx && <Check size={11} />}
                {stage}
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs">
          {[
            { key: 'tasks', label: `Tasks (${tasks.length})` },
            { key: 'milestones', label: `Milestones (${milestones.length})` },
            { key: 'documents', label: `Documents (${documents.length})` },
            { key: 'comments', label: `Notes (${comments.length})` },
          ].map(tab => (
            <button key={tab.key} className={`tab-btn${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
          ))}
        </div>

        {/* ===== TASKS TAB ===== */}
        {activeTab === 'tasks' && (
          <div>
            <div className="section-header">
              <span className="section-title">Tasks</span>
              <button className="btn btn-primary btn-sm" onClick={openNewTask}><Plus size={13} /> Add Task</button>
            </div>
            {tasks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><CheckSquare /></div>
                <div className="empty-state-title">No tasks yet</div>
                <div className="empty-state-desc">Add tasks to track your project's deliverables</div>
                <button className="btn btn-primary" onClick={openNewTask}><Plus size={15} /> Add Task</button>
              </div>
            ) : (
              TASK_STATUSES.map(status => {
                const statusTasks = tasks.filter(t => t.status === status)
                if (statusTasks.length === 0) return null
                return (
                  <div key={status} style={{ marginBottom: 'var(--space-5)' }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
                      {status} · {statusTasks.length}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      {statusTasks.map(task => {
                        const isOverdue = task.due_date && isPast(new Date(task.due_date)) && !isToday(new Date(task.due_date)) && task.status !== 'Done'
                        return (
                          <div key={task.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', transition: 'var(--transition)' }}>
                            <div
                              onClick={() => toggleTaskDone(task)}
                              style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${task.status === 'Done' ? 'var(--success)' : 'var(--border-medium)'}`, background: task.status === 'Done' ? 'var(--success)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: 'white', transition: 'var(--transition)' }}
                            >
                              {task.status === 'Done' && <Check size={11} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, textDecoration: task.status === 'Done' ? 'line-through' : 'none', color: task.status === 'Done' ? 'var(--text-muted)' : 'var(--text-primary)' }}>{task.title}</div>
                              {task.description && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{task.description}</div>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0 }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: task.priority === 'High' ? 'var(--danger)' : task.priority === 'Medium' ? 'var(--warning)' : 'var(--success)' }} title={task.priority} />
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
                              <button className="icon-btn" onClick={() => openEditTask(task)}><Pencil size={12} /></button>
                              <button className="icon-btn" onClick={() => deleteTask(task.id)} style={{ color: 'var(--danger)' }}><Trash2 size={12} /></button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ===== MILESTONES TAB ===== */}
        {activeTab === 'milestones' && (
          <div>
            <div className="section-header">
              <span className="section-title">Milestones</span>
              <button className="btn btn-primary btn-sm" onClick={openNewMs}><Plus size={13} /> Add Milestone</button>
            </div>
            {milestones.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><Flag /></div>
                <div className="empty-state-title">No milestones yet</div>
                <div className="empty-state-desc">Track key project dates and deliverables</div>
                <button className="btn btn-primary" onClick={openNewMs}><Plus size={15} /> Add Milestone</button>
              </div>
            ) : (
              <div className="milestone-list">
                {milestones.map(m => {
                  const isOverdue = m.due_date && isPast(new Date(m.due_date)) && !isToday(new Date(m.due_date)) && !m.is_completed
                  return (
                    <div key={m.id} className="milestone-item">
                      <div className={`milestone-check${m.is_completed ? ' done' : ''}`} onClick={() => toggleMilestone(m)}>
                        {m.is_completed && <Check />}
                      </div>
                      <div className="milestone-info">
                        <div className={`milestone-title${m.is_completed ? ' done' : ''}`}>{m.title}</div>
                        {m.due_date && (
                          <div className={`milestone-date${isOverdue ? ' overdue' : ''}`}>
                            {format(new Date(m.due_date), 'd MMMM yyyy')}{isOverdue ? ' · Overdue' : ''}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <button className="icon-btn" onClick={() => openEditMs(m)}><Pencil size={12} /></button>
                        <button className="icon-btn" onClick={() => deleteMilestone(m.id)} style={{ color: 'var(--danger)' }}><Trash2 size={12} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ===== DOCUMENTS TAB ===== */}
        {activeTab === 'documents' && (
          <div>
            <div className="section-header">
              <span className="section-title">Documents</span>
              <button className="btn btn-primary btn-sm" onClick={openNewDoc}><Plus size={13} /> Add Document</button>
            </div>
            {documents.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><FileText /></div>
                <div className="empty-state-title">No documents yet</div>
                <div className="empty-state-desc">Add links to drawings, contracts, and project files</div>
                <button className="btn btn-primary" onClick={openNewDoc}><Plus size={15} /> Add Document</button>
              </div>
            ) : (
              <div className="doc-list">
                {documents.map(doc => (
                  <div key={doc.id} className="doc-item">
                    <div className="doc-icon"><FileText /></div>
                    <div className="doc-info">
                      <div className="doc-name">{doc.name}</div>
                      <div className="doc-meta">
                        <span className="tag" style={{ marginRight: 6 }}>{doc.doc_type}</span>
                        {doc.uploaded_by && `By ${doc.uploaded_by} · `}
                        {format(new Date(doc.created_at), 'd MMM yyyy')}
                      </div>
                      {doc.notes && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{doc.notes}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      {doc.url && <a href={doc.url} target="_blank" rel="noopener noreferrer" className="icon-btn"><ExternalLink size={13} /></a>}
                      <button className="icon-btn" onClick={() => openEditDoc(doc)}><Pencil size={12} /></button>
                      <button className="icon-btn" onClick={() => deleteDoc(doc.id)} style={{ color: 'var(--danger)' }}><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== COMMENTS / NOTES TAB ===== */}
        {activeTab === 'comments' && (
          <div>
            <div className="section-header">
              <span className="section-title">Notes &amp; Comments</span>
            </div>
            <div className="comments-list" style={{ marginBottom: 'var(--space-5)' }}>
              {comments.length === 0 ? (
                <div className="no-data">No notes yet. Add the first one below.</div>
              ) : (
                comments.map(c => (
                  <div key={c.id} className="comment-item">
                    <div className="avatar" style={{ background: 'var(--accent-primary)', flexShrink: 0 }}>{c.author.charAt(0)}</div>
                    <div className="comment-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="comment-author">{c.author}</span>
                        <span className="comment-time">{format(new Date(c.created_at), 'd MMM · HH:mm')}</span>
                      </div>
                      <div className="comment-text">{c.content}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}>
              <div className="form-row" style={{ marginBottom: 'var(--space-3)' }}>
                <input className="form-input" placeholder="Your name" value={commentAuthor}
                  onChange={e => setCommentAuthor(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
                <textarea className="form-textarea" placeholder="Write a note or comment…" value={commentText}
                  onChange={e => setCommentText(e.target.value)} style={{ flex: 1, minHeight: 60, margin: 0 }} />
                <button className="btn btn-primary" onClick={addComment} disabled={!commentText.trim()}>
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Task Modal */}
      <Modal isOpen={taskModal} onClose={closeTaskModal} title={editingTask ? 'Edit Task' : 'New Task'} footer={taskModalFooter}>
        <div className="form-group">
          <label className="form-label">Task Title *</label>
          <input className="form-input" placeholder="e.g. Prepare structural drawings" value={taskForm.title}
            onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-textarea" value={taskForm.description}
            onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} style={{ minHeight: 60 }} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={taskForm.status} onChange={e => setTaskForm(f => ({ ...f, status: e.target.value }))}>
              {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-select" value={taskForm.priority} onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Assignee</label>
            <select className="form-select" value={taskForm.assignee_id} onChange={e => setTaskForm(f => ({ ...f, assignee_id: e.target.value }))}>
              <option value="">— Unassigned —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Due Date</label>
            <input className="form-input" type="date" value={taskForm.due_date} onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Stage</label>
          <select className="form-select" value={taskForm.stage} onChange={e => setTaskForm(f => ({ ...f, stage: e.target.value }))}>
            <option value="">— Any Stage —</option>
            {STAGES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        {editingTask && (
          <button className="btn btn-danger btn-sm" style={{ marginTop: 'var(--space-2)' }}
            onClick={() => { closeTaskModal(); deleteTask(editingTask.id) }}>Delete Task</button>
        )}
      </Modal>

      {/* Milestone Modal */}
      <Modal isOpen={milestoneModal} onClose={closeMsModal} title={editingMilestone ? 'Edit Milestone' : 'New Milestone'} footer={msModalFooter}>
        <div className="form-group">
          <label className="form-label">Milestone Title *</label>
          <input className="form-input" placeholder="e.g. Planning approval received" value={msForm.title}
            onChange={e => setMsForm(f => ({ ...f, title: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Due Date</label>
          <input className="form-input" type="date" value={msForm.due_date} onChange={e => setMsForm(f => ({ ...f, due_date: e.target.value }))} />
        </div>
        <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-3)' }}>
          <input type="checkbox" id="ms-done" checked={msForm.is_completed}
            onChange={e => setMsForm(f => ({ ...f, is_completed: e.target.checked }))} />
          <label htmlFor="ms-done" style={{ fontSize: 'var(--text-sm)', cursor: 'pointer' }}>Mark as completed</label>
        </div>
      </Modal>

      {/* Document Modal */}
      <Modal isOpen={docModal} onClose={closeDocModal} title={editingDoc ? 'Edit Document' : 'Add Document'} footer={docModalFooter}>
        <div className="form-group">
          <label className="form-label">Document Name *</label>
          <input className="form-input" placeholder="e.g. Site Plan Rev 2" value={docForm.name}
            onChange={e => setDocForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select className="form-select" value={docForm.doc_type} onChange={e => setDocForm(f => ({ ...f, doc_type: e.target.value }))}>
            {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">URL</label>
          <input className="form-input" type="url" placeholder="https://…" value={docForm.url}
            onChange={e => setDocForm(f => ({ ...f, url: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Uploaded By</label>
          <input className="form-input" placeholder="e.g. Ahmed" value={docForm.uploaded_by}
            onChange={e => setDocForm(f => ({ ...f, uploaded_by: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" value={docForm.notes}
            onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))} style={{ minHeight: 60 }} />
        </div>
      </Modal>
    </>
  )
}
