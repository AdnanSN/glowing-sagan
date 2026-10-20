import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Modal } from '../components/Modal'
import {
  ArrowLeft, Plus, CheckSquare, Check, Pencil, Trash2,
  FileText, ExternalLink, Send, Flag, MapPin, Calendar, Clock, Settings2,
  FolderOpen
} from 'lucide-react'
import { RefreshButton } from '../components/RefreshButton'
import { format, isPast, isToday } from 'date-fns'
import {
  DOC_TYPES, DEFAULT_PROJECT_TYPE, PROJECT_STATUSES, PROJECT_COLORS,
  projectStages, projectTypeOptions, getStatusColor
} from '../lib/constants'
import { DocumentLocationModal } from '../components/DocumentLocationModal'
import { StageEditor } from '../components/StageEditor'
import { ASSIGNEES_SELECT, LEAD_SELECT } from '../lib/assignees'
import { SitePhotos } from '../components/SitePhotos'
import { TaskBoard } from '../components/TaskBoard'
import { ConfidentialTag, ConfidentialToggle } from '../components/ConfidentialTag'
import { toStageRows, stageNames, stageRenames, stageError } from '../lib/stages'
import { folderRestricted } from '../lib/folders'

const EMPTY_MILESTONE = { title: '', due_date: '', is_completed: false }
const EMPTY_DOC = { name: '', url: '', doc_type: 'Drawing', uploaded_by: '', notes: '' }

export function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_projects')
  // Tasks sit a rung lower than the project itself, as they always did
  // on the Tasks board: members work the board, leads edit the job.
  const canEditTasks = hasPermission('manage_tasks')
  // Principal Architects only — see Projects.jsx for the same note.
  const canRestrict = hasPermission('manage_confidential')

  const [project, setProject] = useState(null)
  // The whole (visible) folder tree: a restriction can come from any
  // folder above the one the project is filed in, not just that one.
  const [folders, setFolders] = useState([])
  const [tasks, setTasks] = useState([])
  const [milestones, setMilestones] = useState([])
  const [documents, setDocuments] = useState([])
  // Only the number — the photos themselves load with their tab, so an
  // unopened tab never signs a URL or pulls a thumbnail.
  const [photoCount, setPhotoCount] = useState(0)
  const [comments, setComments] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('tasks')

  // Modals
  const [milestoneModal, setMilestoneModal] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState(null)
  const [msForm, setMsForm] = useState(EMPTY_MILESTONE)

  const [docModal, setDocModal] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [docForm, setDocForm] = useState(EMPTY_DOC)
  const [docSaveError, setDocSaveError] = useState(null)
  // The document whose location panel is open.
  const [viewingDoc, setViewingDoc] = useState(null)

  const [stageModal, setStageModal] = useState(false)
  const [stageRows, setStageRows] = useState([])
  const [stageSaveError, setStageSaveError] = useState('')

  const [projectModal, setProjectModal] = useState(false)
  const [projectForm, setProjectForm] = useState(null)

  const [commentText, setCommentText] = useState('')
  const [commentAuthor, setCommentAuthor] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    const [p, t, m, d, c, e, ph, fo] = await Promise.all([
      // The folder comes along because it can restrict the project on
      // its own, and the header and edit modal both have to say so.
      supabase.from('projects')
        .select('*, folder:project_folders(id,name,is_confidential)')
        .eq('id', id).single(),
      tasksQuery(),
      supabase.from('milestones').select('*').eq('project_id', id).order('due_date'),
      supabase.from('documents').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('comments').select('*').eq('project_id', id).order('created_at'),
      supabase.from('employees').select('*').order('name'),
      // head:true — the tab label needs the count, nothing else does.
      supabase.from('site_photos').select('id', { count: 'exact', head: true }).eq('project_id', id),
      supabase.from('project_folders').select('id,name,parent_id,is_confidential'),
    ])
    if (!p.data) { navigate('/projects'); return }
    setProject(p.data)
    if (t.error) console.error('ProjectDetail: tasks query failed —', t.error)
    setTasks(t.data || [])
    setMilestones(m.data || [])
    setDocuments(d.data || [])
    setComments(c.data || [])
    setEmployees(e.data || [])
    setPhotoCount(ph.count || 0)
    setFolders(fo.data || [])
    setLoading(false)
  }

  // Sub-tasks come along with everything else: the board folds them
  // into their main task's card.
  function tasksQuery() {
    return supabase.from('tasks')
      .select(`*, ${LEAD_SELECT}, ${ASSIGNEES_SELECT}`)
      .eq('project_id', id).order('created_at', { ascending: false })
  }

  // After a save on the board: tasks only, and no spinner, so the board
  // stays mounted and keeps its search and open cards.
  async function refreshTasks() {
    const { data, error } = await tasksQuery()
    if (error) { console.error('ProjectDetail: tasks query failed —', error); return }
    setTasks(data || [])
  }

  // === STAGE UPDATE ===
  // === STAGES ===
  function openStageModal() {
    setStageSaveError('')
    setStageRows(toStageRows(project.stages))
    setStageModal(true)
  }

  async function saveStages() {
    setSaving(true)
    setStageSaveError('')
    // One call: the function renames, re-points current_stage and
    // re-labels tasks in the same transaction.
    const { error } = await supabase.rpc('update_project_stages', {
      p_project: id,
      p_stages: stageNames(stageRows),
      p_renames: stageRenames(stageRows),
    })
    setSaving(false)
    if (error) {
      setStageSaveError(error.message)
      return
    }
    setStageModal(false)
    fetchAll()
  }

  async function updateStage(stage) {
    await supabase.from('projects').update({ current_stage: stage, updated_at: new Date().toISOString() }).eq('id', id)
    setProject(p => ({ ...p, current_stage: stage }))
  }

  // === PROJECT EDIT ===
  function openEditProject() {
    setProjectForm({ ...project })
    setProjectModal(true)
  }
  function closeProjectModal() { setProjectModal(false); setProjectForm(null) }

  async function saveProject() {
    setSaving(true)
    const payload = {
      name: projectForm.name,
      client: projectForm.client,
      // Free text, so it can arrive padded or blank.
      project_type: projectForm.project_type.trim() || DEFAULT_PROJECT_TYPE,
      status: projectForm.status,
      current_stage: projectForm.current_stage,
      color: projectForm.color,
      is_confidential: !!projectForm.is_confidential,
      start_date: projectForm.start_date || null,
      end_date: projectForm.end_date || null,
      description: projectForm.description || '',
      location: projectForm.location || '',
      updated_at: new Date().toISOString(),
    }
    await supabase.from('projects').update(payload).eq('id', id)
    setSaving(false)
    closeProjectModal()
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
  function openNewDoc() { setEditingDoc(null); setDocForm(EMPTY_DOC); setDocSaveError(null); setDocModal(true) }
  function openEditDoc(d) {
    setEditingDoc(d)
    setDocForm({
      name: d.name || '', url: d.url || '',
      doc_type: d.doc_type || 'Drawing', uploaded_by: d.uploaded_by || '', notes: d.notes || '',
    })
    setDocSaveError(null)
    setDocModal(true)
  }
  function closeDocModal() { setDocModal(false); setEditingDoc(null) }

  async function saveDoc() {
    setSaving(true)
    setDocSaveError(null)

    // Column by column rather than spread from the form: the row read
    // back carries id and created_at, and a future join would add a
    // field that is not a column at all.
    const payload = {
      project_id: id,
      name: docForm.name.trim(),
      url: docForm.url.trim() || null,
      doc_type: docForm.doc_type,
      uploaded_by: docForm.uploaded_by.trim() || null,
      notes: docForm.notes.trim() || null,
    }

    const { error } = editingDoc
      ? await supabase.from('documents').update(payload).eq('id', editingDoc.id)
      : await supabase.from('documents').insert(payload)

    setSaving(false)
    if (error) { setDocSaveError(error.message); return }
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
  const stages = projectStages(project)
  const currentStageIdx = stages.indexOf(project.current_stage)

  // Why this project is Principal-Architects-only: its own flag, or the
  // folder it is filed in (or one above that). null when it is open to
  // the practice.
  const folderRestricts = folderRestricted(folders, project.folder_id)
  const projectRestrictedBy =
    project.is_confidential ? 'own' : folderRestricts ? 'folder' : null

  // How many tasks carry each stage label, so the editor can warn
  // before a delete strips them.
  const stageTaskCounts = tasks.reduce((acc, t) => {
    if (t.stage) acc[t.stage] = (acc[t.stage] || 0) + 1
    return acc
  }, {})

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
      <button className="btn btn-primary" onClick={saveDoc} disabled={!docForm.name.trim() || saving}>
        {saving ? 'Saving…' : editingDoc ? 'Save' : 'Add Document'}
      </button>
    </>
  )
  const projectModalFooter = projectForm && (
    <>
      <button className="btn btn-secondary" onClick={closeProjectModal}>Cancel</button>
      <button className="btn btn-primary" onClick={saveProject} disabled={!projectForm.name || !projectForm.client || saving}>
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </>
  )

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button className="icon-btn" title="Back to its folder"
              onClick={() => navigate(project.folder_id ? `/projects?folder=${project.folder_id}` : '/projects')} style={{ marginRight: 'var(--space-1)' }}><ArrowLeft size={15} /></button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <div style={{ width: 10, height: 10, background: project.color }} />
                <span className="page-header-title">{project.name}</span>
                <span className={`badge ${getStatusColor(project.status)}`}>{project.status}</span>
                {projectRestrictedBy && (
                  <ConfidentialTag reason={projectRestrictedBy === 'folder' ? 'folder' : undefined} />
                )}
              </div>
              <span className="page-header-sub">{project.client} {project.location && `· ${project.location}`}</span>
            </div>
          </div>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={fetchAll} />
          {canManage && (
            <button className="btn btn-secondary btn-sm" onClick={openEditProject}><Pencil size={13} /> Edit Project</button>
          )}
        </div>
      </div>

      <div className="page-body">
        {/* Project Info Strip */}
        <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-5) var(--space-6)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-5)' }}>
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
          <div className="stage-card-header">
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Project Stage</span>
            {canManage && (
              <button className="btn btn-ghost btn-sm" onClick={openStageModal}>
                <Settings2 size={13} /> Edit Stages
              </button>
            )}
          </div>
          <div className="stage-pipeline">
            {stages.map((stage, i) => (
              <div
                key={stage}
                className={`stage-pill${i < currentStageIdx ? ' done' : ''}${stage === project.current_stage ? ' active' : ''}`}
                onClick={() => canManage && updateStage(stage)}
                title={canManage ? `Set stage to: ${stage}` : stage}
                style={{ cursor: canManage ? 'pointer' : 'default' }}
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
            { key: 'photos', label: `Site Photos (${photoCount})` },
            { key: 'documents', label: `Documents (${documents.length})` },
            { key: 'comments', label: `Notes (${comments.length})` },
          ].map(tab => (
            <button key={tab.key} className={`tab-btn${activeTab === tab.key ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
          ))}
        </div>

        {/* ===== TASKS TAB =====
            The same board as everywhere else, held to this project. */}
        {activeTab === 'tasks' && (
          <TaskBoard
            tasks={tasks}
            employees={employees}
            projects={[project]}
            folders={folders}
            scopeProject={project}
            canManage={canEditTasks}
            canRestrict={canRestrict}
            onChanged={refreshTasks}
          />
        )}

        {/* ===== MILESTONES TAB ===== */}
        {activeTab === 'milestones' && (
          <div>
            <div className="section-header">
              <span className="section-title">Milestones</span>
              {canManage && <button className="btn btn-primary btn-sm" onClick={openNewMs}><Plus size={13} /> Add Milestone</button>}
            </div>
            {milestones.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><Flag /></div>
                <div className="empty-state-title">No milestones yet</div>
                <div className="empty-state-desc">Track key project dates and deliverables</div>
                {canManage && <button className="btn btn-primary" onClick={openNewMs}><Plus size={15} /> Add Milestone</button>}
              </div>
            ) : (
              <div className="milestone-list">
                {milestones.map(m => {
                  const isOverdue = m.due_date && isPast(new Date(m.due_date)) && !isToday(new Date(m.due_date)) && !m.is_completed
                  return (
                    <div key={m.id} className="milestone-item">
                      <div className={`milestone-check${m.is_completed ? ' done' : ''}`} onClick={() => canManage && toggleMilestone(m)} style={{ cursor: canManage ? 'pointer' : 'default' }}>
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
                      {canManage && (
                        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                          <button className="icon-btn" onClick={() => openEditMs(m)}><Pencil size={12} /></button>
                          <button className="icon-btn" onClick={() => deleteMilestone(m.id)} style={{ color: 'var(--danger)' }}><Trash2 size={12} /></button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ===== SITE PHOTOS TAB ===== */}
        {activeTab === 'photos' && (
          <SitePhotos
            projectId={id}
            stages={stages}
            currentStage={project.current_stage}
            onCountChange={setPhotoCount}
          />
        )}

        {/* ===== DOCUMENTS TAB ===== */}
        {activeTab === 'documents' && (
          <div>
            <div className="section-header">
              <span className="section-title">Documents</span>
              {canManage && <button className="btn btn-primary btn-sm" onClick={openNewDoc}><Plus size={13} /> Add Document</button>}
            </div>
            {documents.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon"><FileText /></div>
                <div className="empty-state-title">No documents yet</div>
                <div className="empty-state-desc">Add links to drawings, contracts, and project files</div>
                {canManage && <button className="btn btn-primary" onClick={openNewDoc}><Plus size={15} /> Add Document</button>}
              </div>
            ) : (
              <div className="doc-list">
                {documents.map(doc => (
                  <div key={doc.id} className="doc-item">
                    {/* The whole row opens the location panel — that is
                        the one thing everybody comes here to do. */}
                    <button className="doc-open" onClick={() => setViewingDoc(doc)} title="Show where this file is">
                      <div className="doc-icon"><FileText /></div>
                      <div className="doc-info">
                        <div className="doc-name">{doc.name}</div>
                        <div className="doc-meta">
                          <span className="tag" style={{ marginRight: 6 }}>{doc.doc_type}</span>
                          {doc.uploaded_by && `By ${doc.uploaded_by} · `}
                          {format(new Date(doc.created_at), 'd MMM yyyy')}
                        </div>
                        {doc.notes && <div className="doc-note">{doc.notes}</div>}
                      </div>
                    </button>
                    <div className="doc-actions">
                      <button className="icon-btn" onClick={() => setViewingDoc(doc)} title="Show file location">
                        <FolderOpen size={13} />
                      </button>
                      {canManage && <button className="icon-btn" onClick={() => openEditDoc(doc)} title="Edit"><Pencil size={12} /></button>}
                      {canManage && <button className="icon-btn" onClick={() => deleteDoc(doc.id)} title="Delete" style={{ color: 'var(--danger)' }}><Trash2 size={12} /></button>}
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
          <label className="form-label">File Location</label>
          <input className="form-input" placeholder="\\\\NAS01\\Projects\\RIY-2024-017\\Drawings\\A-101.pdf" value={docForm.url}
            onChange={e => setDocForm(f => ({ ...f, url: e.target.value }))} />
          <div className="form-hint">
            Where the file lives — a network path, or a web link. In File Explorer,
            Shift+right-click the file and choose “Copy as path”, then paste it here.
          </div>
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
        {docSaveError && (
          <div className="form-hint" style={{ color: 'var(--danger)' }}>Could not save: {docSaveError}</div>
        )}
      </Modal>

      <DocumentLocationModal doc={viewingDoc} onClose={() => setViewingDoc(null)} />

      {/* Project Edit Modal */}
      <Modal isOpen={projectModal} onClose={closeProjectModal} title="Edit Project" size="lg" footer={projectModalFooter}>
        {projectForm && (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Project Name *</label>
                <input className="form-input" value={projectForm.name}
                  onChange={e => setProjectForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Client Name *</label>
                <input className="form-input" value={projectForm.client}
                  onChange={e => setProjectForm(f => ({ ...f, client: e.target.value }))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Project Type</label>
                {/* A list + input rather than a select: the standard types
                    are still one click away, but anything else can be typed. */}
                <input className="form-input" list="project-type-options"
                  placeholder="Pick one or type your own"
                  value={projectForm.project_type}
                  onChange={e => setProjectForm(f => ({ ...f, project_type: e.target.value }))} />
                <datalist id="project-type-options">
                  {projectTypeOptions([project.project_type]).map(t => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-select" value={projectForm.status}
                  onChange={e => setProjectForm(f => ({ ...f, status: e.target.value }))}>
                  {PROJECT_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Current Stage</label>
              <select className="form-select" value={projectForm.current_stage}
                onChange={e => setProjectForm(f => ({ ...f, current_stage: e.target.value }))}>
                {stages.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            {canRestrict && (
              <div className="form-group">
                <ConfidentialToggle
                  noun="project"
                  inherited={folderRestricts ? 'folder' : null}
                  checked={projectForm.is_confidential}
                  disabled={saving}
                  onChange={v => setProjectForm(f => ({ ...f, is_confidential: v }))}
                />
              </div>
            )}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input className="form-input" type="date" value={projectForm.start_date || ''}
                  onChange={e => setProjectForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">End Date</label>
                <input className="form-input" type="date" value={projectForm.end_date || ''}
                  onChange={e => setProjectForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Location</label>
              <input className="form-input" value={projectForm.location || ''}
                onChange={e => setProjectForm(f => ({ ...f, location: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-textarea" value={projectForm.description || ''}
                onChange={e => setProjectForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Project Color</label>
              <div className="color-swatch">
                {PROJECT_COLORS.map(c => (
                  <div key={c} className={`color-option${projectForm.color === c ? ' selected' : ''}`}
                    style={{ background: c }} onClick={() => setProjectForm(f => ({ ...f, color: c }))} />
                ))}
              </div>
            </div>
          </>
        )}
      </Modal>

      <Modal
        isOpen={stageModal}
        onClose={() => setStageModal(false)}
        title="Edit Project Stages"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setStageModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveStages}
              disabled={saving || !!stageError(stageRows)}>
              {saving ? 'Saving…' : 'Save Stages'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <div className="stage-editor-intro">
            These stages belong to this project only. Renaming one keeps every
            task that referenced it; deleting one only removes the label.
          </div>
          <StageEditor
            rows={stageRows}
            onChange={setStageRows}
            currentStage={project.current_stage}
            taskCounts={stageTaskCounts}
            disabled={saving}
          />
        </div>
        {stageSaveError && <div className="stage-editor-error">{stageSaveError}</div>}
      </Modal>
    </>
  )
}
