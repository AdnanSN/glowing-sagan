import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Modal } from '../components/Modal'
import {
  Plus, Search, Pencil, Trash2, FolderKanban, Folder, FolderOpen,
  ArrowLeft, FolderPlus,
} from 'lucide-react'
import { RefreshButton } from '../components/RefreshButton'
import { format } from 'date-fns'
import {
  DEFAULT_STAGES, DEFAULT_PROJECT_TYPE, PROJECT_STATUSES, PROJECT_COLORS,
  projectTypeOptions, getStatusColor
} from '../lib/constants'
import { StageEditor } from '../components/StageEditor'
import { ConfidentialTag, ConfidentialIcon, ConfidentialToggle } from '../components/ConfidentialTag'
import { toStageRows, stageNames, stageRenames, stageError } from '../lib/stages'
import { deleteProjectPhotos } from '../lib/photos'

const EMPTY_FORM = {
  name: '', client: '', project_type: DEFAULT_PROJECT_TYPE, status: 'Active',
  current_stage: 'Briefing', color: PROJECT_COLORS[0],
  start_date: '', end_date: '', description: '', location: '', folder_id: '',
  is_confidential: false,
}

// Projects with no folder still have to live somewhere on screen. This
// stands in for "no folder_id" everywhere a real folder id is used.
const UNFILED = '__unfiled__'

export function Projects() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_projects')
  // Principal Architects only. Anyone else is never sent a restricted
  // row in the first place, so they have nothing to mark or unmark.
  const canRestrict = hasPermission('manage_confidential')
  const [projects, setProjects] = useState([])
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [folderModal, setFolderModal] = useState(null) // { id?, name }
  const [folderError, setFolderError] = useState('')
  const [saveError, setSaveError] = useState('')
  // Stages for whichever project the modal is showing — the defaults when
  // creating, the project's own list when editing.
  const [stageRows, setStageRows] = useState([])
  // { stageName: n } for the project being edited, so the editor can warn
  // before a delete strips the label off tasks. Fetched on open; the
  // list page does not otherwise load tasks.
  const [stageTaskCounts, setStageTaskCounts] = useState({})
  // Which project the in-flight count query belongs to, so a slow
  // response for a project you have since closed cannot land.
  const countsFor = useRef(null)
  const navigate = useNavigate()

  // Which folder is open and which status is filtered both live in the
  // URL, so browser Back steps out of either, a refresh keeps you where
  // you were, and the dashboard can link straight to "Active".
  const [params, setParams] = useSearchParams()
  const openFolderId = params.get('folder')
  const rawStatus = params.get('status')
  const filterStatus = PROJECT_STATUSES.includes(rawStatus) ? rawStatus : 'All'

  // Changing one of the two never drops the other.
  function setUrl(changes) {
    const next = { folder: openFolderId, status: filterStatus, ...changes }
    const out = {}
    if (next.folder) out.folder = next.folder
    if (next.status && next.status !== 'All') out.status = next.status
    setParams(out)
  }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [projRes, folderRes] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: false }),
      supabase.from('project_folders').select('*').order('position').order('name'),
    ])
    setProjects(projRes.data || [])
    setFolders(folderRes.data || [])
    setLoading(false)
  }

  function openFolder(id) { setUrl({ folder: id || null }) }
  function closeFolder() { setUrl({ folder: null }) }
  function setFilterStatus(status) { setUrl({ status }) }

  // ── Projects ────────────────────────────────────────────────
  function openNew() {
    setEditing(null)
    setSaveError('')
    // Creating from inside a folder should file it there by default.
    const preset = openFolderId && openFolderId !== UNFILED ? openFolderId : ''
    setForm({ ...EMPTY_FORM, folder_id: preset })
    setStageRows(toStageRows(DEFAULT_STAGES))
    setStageTaskCounts({})
    countsFor.current = null
    setShowModal(true)
  }

  async function openEdit(e, p) {
    e.stopPropagation()
    setSaveError('')
    setEditing(p)
    setForm({ ...p, folder_id: p.folder_id || '' })
    setStageRows(toStageRows(p.stages))
    setStageTaskCounts({})
    countsFor.current = p.id
    setShowModal(true)

    const { data } = await supabase.from('tasks').select('stage').eq('project_id', p.id)
    if (countsFor.current !== p.id) return
    setStageTaskCounts((data || []).reduce((acc, t) => {
      if (t.stage) acc[t.stage] = (acc[t.stage] || 0) + 1
      return acc
    }, {}))
  }

  function closeModal() {
    setShowModal(false)
    setEditing(null)
    countsFor.current = null
  }

  async function handleDelete(e, id) {
    e.stopPropagation()
    if (!confirm('Delete this project? All associated data will be removed.')) return
    // Site photos go first, and deliberately before the project row.
    // The cascade removes the site_photos rows but cannot reach into
    // storage, and the storage policy needs those rows to decide the
    // caller may remove the objects — do it after and they sit in the
    // quota forever, invisible and unreferenced.
    await deleteProjectPhotos(id)
    await supabase.from('projects').delete().eq('id', id)
    fetchAll()
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    const stages = stageNames(stageRows)
    const payload = {
      ...form,
      // Free text, so it can arrive padded or blank.
      project_type: form.project_type.trim() || DEFAULT_PROJECT_TYPE,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      folder_id: form.folder_id || null,
      updated_at: new Date().toISOString(),
    }
    // The stage picker was populated from this same list, but the list
    // can be edited after a pick — never save a stage that isn't in it.
    if (!stages.includes(payload.current_stage)) payload.current_stage = stages[0]

    if (editing) {
      // Stages go through the function rather than the row: a rename has
      // to re-label this project's tasks in the same transaction. It runs
      // first, so a rejected stage change doesn't leave the other fields
      // saved on their own.
      delete payload.stages
      const { error } = await supabase.rpc('update_project_stages', {
        p_project: editing.id,
        p_stages: stages,
        p_renames: stageRenames(stageRows),
      })
      if (error) {
        setSaving(false)
        setSaveError(error.message)
        return
      }
      await supabase.from('projects').update(payload).eq('id', editing.id)
    } else {
      payload.stages = stages
      await supabase.from('projects').insert(payload)
    }

    setSaving(false)
    closeModal()
    fetchAll()
  }

  // ── Folders ─────────────────────────────────────────────────
  function newFolder() {
    setFolderError('')
    setFolderModal({ name: '', is_confidential: false })
  }
  function renameFolder(e, folder) {
    e.stopPropagation()
    setFolderError('')
    setFolderModal({ id: folder.id, name: folder.name, is_confidential: !!folder.is_confidential })
  }

  async function saveFolder() {
    const name = folderModal.name.trim()
    if (!name) return
    setSaving(true)
    setFolderError('')

    const fields = { name, is_confidential: !!folderModal.is_confidential }
    const { error } = folderModal.id
      ? await supabase.from('project_folders').update(fields).eq('id', folderModal.id)
      : await supabase.from('project_folders')
          .insert({ ...fields, position: folders.length + 1 })

    setSaving(false)
    if (error) {
      // The unique index on lower(name) is what actually stops duplicates.
      setFolderError(error.code === '23505'
        ? 'A folder with that name already exists.'
        : error.message)
      return
    }
    setFolderModal(null)
    fetchAll()
  }

  async function deleteFolder(e, folder) {
    e.stopPropagation()
    const count = projects.filter(p => p.folder_id === folder.id).length
    const warning = count
      ? `Delete "${folder.name}"? Its ${count} project${count !== 1 ? 's' : ''} will move to Unfiled — nothing is deleted.`
      : `Delete "${folder.name}"?`
    if (!confirm(warning)) return
    await supabase.from('project_folders').delete().eq('id', folder.id)
    if (openFolderId === folder.id) closeFolder()
    fetchAll()
  }

  // ── Filtering ───────────────────────────────────────────────
  const matchesFilters = (p) => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q)
    const matchStatus = filterStatus === 'All' || p.status === filterStatus
    return matchSearch && matchStatus
  }

  const searching = search.trim() !== '' || filterStatus !== 'All'
  const unfiledCount = projects.filter(p => !p.folder_id).length

  const activeFolder = openFolderId === UNFILED
    ? { id: UNFILED, name: 'Unfiled' }
    : folders.find(f => f.id === openFolderId) || null

  // A search should look through the whole cabinet, not just the drawer
  // you happen to have open — so filtering flattens back to a flat list.
  const showingList = !!activeFolder || searching

  const listed = projects.filter(p => {
    if (!matchesFilters(p)) return false
    if (searching && !activeFolder) return true
    if (!activeFolder) return false
    return activeFolder.id === UNFILED ? !p.folder_id : p.folder_id === activeFolder.id
  })

  // Keep the Current Stage picker pointing at a stage that still exists.
  // Tracked by ROW rather than by name, so renaming the picked stage
  // carries the selection along instead of orphaning it, and deleting it
  // falls back to the first stage — both the moment it happens, rather
  // than being quietly repaired at save time.
  function handleStageChange(rows) {
    const owner = stageRows.find(r => r.name.trim() === form.current_stage)
    setStageRows(rows)

    const names = stageNames(rows)
    if (!names.length) return

    const stillThere = owner ? rows.find(r => r.id === owner.id) : null

    if (stillThere) {
      const renamed = stillThere.name.trim()
      // Mid-typing the name can be empty; leave the picker alone until
      // there is something to point at (Save is blocked meanwhile).
      if (renamed && renamed !== form.current_stage) {
        setForm(f => ({ ...f, current_stage: renamed }))
      }
      return
    }

    if (!names.includes(form.current_stage)) {
      setForm(f => ({ ...f, current_stage: names[0] }))
    }
  }

  const folderById = (id) => folders.find(f => f.id === id)
  const folderName = (id) => folderById(id)?.name

  // Why a project is Principal-Architects-only: its own flag, or the
  // folder it is filed in. null when it is open to the practice.
  const restrictedBy = (p) =>
    p.is_confidential ? 'own' : folderById(p.folder_id)?.is_confidential ? 'folder' : null

  // The folder currently picked in the modal already restricts whatever
  // goes into it, so there is nothing left for the toggle to decide.
  const inheritsRestriction = !!folderById(form.folder_id)?.is_confidential

  // Standard types plus every custom one already in use, so a type
  // somebody typed on one project is a click away on the next.
  const typeOptions = projectTypeOptions(projects.map(p => p.project_type))

  // Whatever the editor below currently holds, for both new and existing.
  const modalStages = stageNames(stageRows)
  const stagesInvalid = !!stageError(stageRows)

  const modalFooter = (
    <>
      <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
      <button className="btn btn-primary" onClick={handleSave}
        disabled={!form.name || !form.client || saving || stagesInvalid}>
        {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Project'}
      </button>
    </>
  )

  const folderFooter = (
    <>
      <button className="btn btn-secondary" onClick={() => setFolderModal(null)}>Cancel</button>
      <button className="btn btn-primary" onClick={saveFolder}
        disabled={!folderModal?.name.trim() || saving}>
        {saving ? 'Saving…' : folderModal?.id ? 'Save Name' : 'Create Folder'}
      </button>
    </>
  )

  return (
    <>
      <div className="page-header">
        <div className="page-header-nav">
          {activeFolder && (
            <button className="icon-btn" onClick={closeFolder} title="Back to all folders"
              aria-label="Back to all folders">
              <ArrowLeft size={14} />
            </button>
          )}
          <div className="page-header-left">
            {activeFolder ? (
              <>
                <span className="page-header-title">{activeFolder.name}</span>
                <span className="page-header-sub">
                  {listed.length} project{listed.length !== 1 ? 's' : ''}
                </span>
              </>
            ) : (
              <>
                <span className="page-header-title">Projects</span>
                <span className="page-header-sub">
                  {projects.length} project{projects.length !== 1 ? 's' : ''} in {folders.length} folder{folders.length !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={fetchAll} />
          {canManage && !activeFolder && (
            <button className="btn btn-secondary" onClick={newFolder}>
              <FolderPlus size={15} /> New Folder
            </button>
          )}
          {canManage && (
            <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> New Project</button>
          )}
        </div>
      </div>

      <div className="page-body">
        <div className="filter-bar">
          <div className="search-bar">
            <Search />
            {/* Search is scoped to whatever you are looking at, so say so
                rather than promising "all projects" from inside a folder. */}
            <input className="form-input" value={search}
              placeholder={activeFolder ? `Search in ${activeFolder.name}…` : 'Search all projects…'}
              onChange={e => setSearch(e.target.value)} />
          </div>
          {['All', ...PROJECT_STATUSES].map(s => (
            <button key={s} className={`btn ${filterStatus === s ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => setFilterStatus(s)}>{s}</button>
          ))}
        </div>

        {searching && !activeFolder && (
          <div className="folder-search-note">
            Showing matches across every folder.
          </div>
        )}

        {loading ? (
          <div className="loading-container"><div className="loading-spinner" /><span>Loading…</span></div>

        /* ── Folder grid ─────────────────────────────────────── */
        ) : !showingList ? (
          folders.length === 0 && unfiledCount === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon"><FolderKanban /></div>
                <div className="empty-state-title">No projects yet</div>
                <div className="empty-state-desc">Create your first project to get started tracking your work</div>
                {canManage && (
                  <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> New Project</button>
                )}
              </div>
            </div>
          ) : (
            <div className="folder-grid">
              {folders.map(f => {
                const inside = projects.filter(p => p.folder_id === f.id)
                const open = inside.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled').length
                return (
                  <div key={f.id} className="folder-card" onClick={() => openFolder(f.id)}>
                    <div className="folder-card-top">
                      <Folder className="folder-card-icon" size={22} />
                      {canManage && (
                        <div className="folder-card-actions">
                          <button className="icon-btn" title="Rename folder"
                            onClick={e => renameFolder(e, f)}><Pencil size={12} /></button>
                          <button className="icon-btn" title="Delete folder"
                            onClick={e => deleteFolder(e, f)}
                            style={{ color: 'var(--danger)', borderColor: 'rgba(224,82,82,0.2)' }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="folder-card-name">{f.name}</div>
                    <div className="folder-card-meta">
                      {inside.length === 0
                        ? 'Empty'
                        : `${inside.length} project${inside.length !== 1 ? 's' : ''}${open ? ` · ${open} open` : ''}`}
                    </div>
                    {f.is_confidential && (
                      <div style={{ marginTop: 'var(--space-2)' }}><ConfidentialTag /></div>
                    )}
                    <div className="folder-card-strip">
                      {inside.slice(0, 12).map(p => (
                        <span key={p.id} className="folder-card-dot"
                          style={{ background: p.color }} title={p.name} />
                      ))}
                    </div>
                  </div>
                )
              })}

              {/* Only worth showing when something actually landed there. */}
              {unfiledCount > 0 && (
                <div className="folder-card folder-card-unfiled" onClick={() => openFolder(UNFILED)}>
                  <div className="folder-card-top">
                    <FolderOpen className="folder-card-icon" size={22} />
                  </div>
                  <div className="folder-card-name">Unfiled</div>
                  <div className="folder-card-meta">
                    {unfiledCount} project{unfiledCount !== 1 ? 's' : ''} with no folder
                  </div>
                  <div className="folder-card-strip">
                    {projects.filter(p => !p.folder_id).slice(0, 12).map(p => (
                      <span key={p.id} className="folder-card-dot"
                        style={{ background: p.color }} title={p.name} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )

        /* ── Project list ────────────────────────────────────── */
        ) : listed.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><FolderKanban /></div>
              <div className="empty-state-title">
                {searching ? 'No results found' : 'This folder is empty'}
              </div>
              <div className="empty-state-desc">
                {searching
                  ? 'Try a different search or status filter'
                  : 'Create a project here, or move one in from its Edit screen'}
              </div>
              {!searching && canManage && (
                <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> New Project</button>
              )}
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Client</th>
                    {/* Which folder a hit came from only matters when
                        you are looking across all of them. */}
                    {searching && !activeFolder && <th>Folder</th>}
                    <th>Type</th>
                    <th>Stage</th>
                    <th>Status</th>
                    <th>Deadline</th>
                    {canManage && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {listed.map(p => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}`)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                          <div style={{ width: 10, height: 10, background: p.color, flexShrink: 0 }} />
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                              {p.name}
                              {restrictedBy(p) && <ConfidentialIcon reason={restrictedBy(p)} />}
                            </div>
                            {p.location && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{p.location}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: 'var(--text-sm)' }}>{p.client}</td>
                      {searching && !activeFolder && (
                        <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                          {folderName(p.folder_id) || 'Unfiled'}
                        </td>
                      )}
                      <td><span className="tag">{p.project_type}</span></td>
                      <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{p.current_stage}</td>
                      <td><span className={`badge ${getStatusColor(p.status)}`}>{p.status}</span></td>
                      <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                        {p.end_date ? format(new Date(p.end_date), 'd MMM yyyy') : '—'}
                      </td>
                      {canManage && (
                        <td>
                          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                            <button className="icon-btn" onClick={e => openEdit(e, p)} title="Edit"><Pencil size={13} /></button>
                            <button className="icon-btn" onClick={e => handleDelete(e, p.id)} title="Delete"
                              style={{ color: 'var(--danger)', borderColor: 'rgba(224,82,82,0.2)' }}><Trash2 size={13} /></button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Project' : 'New Project'} size="lg" footer={modalFooter}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Project Name *</label>
            <input className="form-input" placeholder="e.g. Meridian Residence" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Client Name *</label>
            <input className="form-input" placeholder="e.g. Al-Rashid Family" value={form.client}
              onChange={e => setForm(f => ({ ...f, client: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Folder</label>
            <select className="form-select" value={form.folder_id}
              onChange={e => setForm(f => ({ ...f, folder_id: e.target.value }))}>
              <option value="">Unfiled</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Project Type</label>
            {/* A list + input rather than a select: the standard types are
                still one click away, but anything else can be typed. */}
            <input className="form-input" list="project-type-options"
              placeholder="Pick one or type your own"
              value={form.project_type}
              onChange={e => setForm(f => ({ ...f, project_type: e.target.value }))} />
            <datalist id="project-type-options">
              {typeOptions.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>
        </div>

        {canRestrict && (
          <div className="form-group">
            <ConfidentialToggle
              noun="project"
              inherited={inheritsRestriction ? 'folder' : null}
              checked={form.is_confidential}
              disabled={saving}
              onChange={v => setForm(f => ({ ...f, is_confidential: v }))}
            />
          </div>
        )}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {PROJECT_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Current Stage</label>
            <select className="form-select" value={form.current_stage}
              onChange={e => setForm(f => ({ ...f, current_stage: e.target.value }))}>
              {/* An existing project's saved stage may have been renamed
                  since; keep it selectable rather than silently jumping. */}
              {!modalStages.includes(form.current_stage) && form.current_stage && (
                <option>{form.current_stage}</option>
              )}
              {modalStages.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Location</label>
          <input className="form-input" placeholder="e.g. Dubai Marina, UAE" value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Start Date</label>
            <input className="form-input" type="date" value={form.start_date}
              onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">End Date</label>
            <input className="form-input" type="date" value={form.end_date}
              onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-textarea" placeholder="Brief project overview…" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Project Color</label>
          <div className="color-swatch">
            {PROJECT_COLORS.map(c => (
              <div key={c} className={`color-option${form.color === c ? ' selected' : ''}`}
                style={{ background: c }} onClick={() => setForm(f => ({ ...f, color: c }))} />
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Project Stages</label>
          <div className="stage-editor-intro">
            {editing
              ? 'These stages belong to this project only. Renaming one keeps every task that referenced it; deleting one only removes the label.'
              : 'Starts from the standard set — add, rename, reorder or remove any of them for this project.'}
          </div>
          <StageEditor
            rows={stageRows}
            onChange={handleStageChange}
            currentStage={editing ? form.current_stage : undefined}
            taskCounts={stageTaskCounts}
            disabled={saving}
          />
        </div>

        {saveError && <div className="stage-editor-error">{saveError}</div>}
      </Modal>

      <Modal
        isOpen={!!folderModal}
        onClose={() => setFolderModal(null)}
        title={folderModal?.id ? 'Rename Folder' : 'New Folder'}
        footer={folderFooter}
      >
        <div className="form-group">
          <label className="form-label">Folder Name *</label>
          <input className="form-input" placeholder="e.g. Ongoing" autoFocus
            value={folderModal?.name || ''}
            onChange={e => setFolderModal(m => ({ ...m, name: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') saveFolder() }} />
          {folderError && (
            <div style={{ color: 'var(--danger)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
              {folderError}
            </div>
          )}
        </div>

        {canRestrict && (
          <div className="form-group">
            <ConfidentialToggle
              noun="folder"
              checked={folderModal?.is_confidential}
              disabled={saving}
              onChange={v => setFolderModal(m => ({ ...m, is_confidential: v }))}
            />
          </div>
        )}
      </Modal>
    </>
  )
}
