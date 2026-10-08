import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Modal } from '../components/Modal'
import {
  Plus, Search, Pencil, Trash2, FolderKanban, Folder, FolderOpen,
  ArrowLeft, FolderPlus, ChevronLeft, ChevronRight,
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
import {
  childFolders, folderPath, folderPathLabel, folderRestricted, descendantIds,
  folderTreeOptions, indentedName,
} from '../lib/folders'

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
  // Folder being dragged, and the card it is currently hovering over.
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
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
  // A new folder lands wherever you are standing, like on the NAS.
  function newFolder() {
    setFolderError('')
    setFolderModal({ name: '', parent_id: realFolderId || '', is_confidential: false })
  }
  function editFolder(e, folder) {
    e.stopPropagation()
    setFolderError('')
    setFolderModal({
      id: folder.id, name: folder.name, parent_id: folder.parent_id || '',
      is_confidential: !!folder.is_confidential,
    })
  }

  // Next free slot at the end of a parent's row of folders.
  const nextPosition = (parentId) =>
    Math.max(0, ...childFolders(folders, parentId).map(f => f.position ?? 0)) + 1

  async function saveFolder() {
    const name = folderModal.name.trim()
    if (!name) return
    setSaving(true)
    setFolderError('')

    const parent_id = folderModal.parent_id || null
    const fields = { name, parent_id, is_confidential: !!folderModal.is_confidential }
    const original = folderModal.id && folderById(folderModal.id)
    // Moving into another folder goes to the end of its new row.
    if (!original || (original.parent_id || null) !== parent_id) {
      fields.position = nextPosition(parent_id)
    }
    const { error } = folderModal.id
      ? await supabase.from('project_folders').update(fields).eq('id', folderModal.id)
      : await supabase.from('project_folders').insert(fields)

    setSaving(false)
    if (error) {
      // The unique index on (parent, lower(name)) is what actually stops
      // duplicates; the loop guard trigger words its own refusal.
      setFolderError(error.code === '23505'
        ? 'A folder with that name already exists in that location.'
        : error.message)
      return
    }
    setFolderModal(null)
    fetchAll()
  }

  // Reorder within one row of sibling folders: move one into another's
  // slot, then renumber that row 1..n. Optimistic — the grid moves at
  // once, and only rows whose position actually changed are written.
  async function moveFolder(fromId, toIndex) {
    const moving = folderById(fromId)
    if (!moving) return
    const siblings = childFolders(folders, moving.parent_id)
    const from = siblings.findIndex(f => f.id === fromId)
    if (toIndex < 0 || toIndex >= siblings.length || from === toIndex) return
    const next = [...siblings]
    next.splice(from, 1)
    next.splice(toIndex, 0, moving)
    const changed = next
      .map((f, i) => ({ ...f, position: i + 1 }))
      .filter(f => folderById(f.id).position !== f.position)
    const newPos = Object.fromEntries(changed.map(f => [f.id, f.position]))
    setFolders(fs => fs.map(f => f.id in newPos ? { ...f, position: newPos[f.id] } : f))

    const results = await Promise.all(changed.map(f =>
      supabase.from('project_folders').update({ position: f.position }).eq('id', f.id)))
    const failed = results.find(r => r.error)
    if (failed) {
      alert(`Could not save the new folder order: ${failed.error.message}`)
      fetchAll()
    }
  }

  function nudgeFolder(e, folder, delta) {
    e.stopPropagation()
    const siblings = childFolders(folders, folder.parent_id)
    moveFolder(folder.id, siblings.findIndex(f => f.id === folder.id) + delta)
  }

  async function deleteFolder(e, folder) {
    e.stopPropagation()
    // Nothing inside is deleted — the database moves it all up a level.
    const subs = childFolders(folders, folder.id).length
    const count = projects.filter(p => p.folder_id === folder.id).length
    const parent = folderById(folder.parent_id)
    const contents = [
      subs && `${subs} subfolder${subs !== 1 ? 's' : ''}`,
      count && `${count} project${count !== 1 ? 's' : ''}`,
    ].filter(Boolean).join(' and ')
    const where = parent ? `"${parent.name}"` : count ? 'the top level (projects to Unfiled)' : 'the top level'
    const warning = contents
      ? `Delete "${folder.name}"? Its ${contents} will move up into ${where} — nothing is deleted.`
      : `Delete "${folder.name}"?`
    if (!confirm(warning)) return
    const { error } = await supabase.from('project_folders').delete().eq('id', folder.id)
    if (error) {
      alert(error.code === '23505'
        ? `Could not delete "${folder.name}": a subfolder has the same name as a folder in ${where}. Rename one of them first.`
        : `Could not delete "${folder.name}": ${error.message}`)
      return
    }
    // Standing inside the folder (or below it)? Step out to its parent.
    if (realFolderId && descendantIds(folders, folder.id).has(realFolderId)) openFolder(folder.parent_id)
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
  // The open folder as a real row — null at the top level and in Unfiled.
  const realFolderId = activeFolder && activeFolder.id !== UNFILED ? activeFolder.id : null
  // Where you are, top first: Projects › 00-ADMIN › HR.
  const trail = realFolderId ? folderPath(folders, realFolderId) : []
  const parentOfActive = trail.length > 1 ? trail[trail.length - 2] : null

  // The folders shown as cards: the top row, or the open folder's own
  // subfolders. Unfiled is a pseudo-folder and never has any.
  const visibleFolders = activeFolder?.id === UNFILED ? [] : childFolders(folders, realFolderId)

  // Searching looks through everything below where you are standing,
  // subfolders included — the whole cabinet from the top level.
  const scope = realFolderId ? descendantIds(folders, realFolderId) : null

  const listed = projects.filter(p => {
    if (!matchesFilters(p)) return false
    if (activeFolder?.id === UNFILED) return !p.folder_id
    if (searching) return !scope || scope.has(p.folder_id)
    return !!realFolderId && p.folder_id === realFolderId
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

  // Why a project is Principal-Architects-only: its own flag, or the
  // folder it is filed in (or any folder above that). null when it is
  // open to the practice.
  const restrictedBy = (p) =>
    p.is_confidential ? 'own' : folderRestricted(folders, p.folder_id) ? 'folder' : null

  // The folder currently picked in the modal already restricts whatever
  // goes into it, so there is nothing left for the toggle to decide.
  const inheritsRestriction = folderRestricted(folders, form.folder_id)
  const folderInheritsRestriction = folderRestricted(folders, folderModal?.parent_id)

  // Every folder, nested, for the two "where does this go" pickers. A
  // folder cannot be moved into itself or anything below it.
  const folderOptions = folderTreeOptions(folders)
  const parentOptions = folderTreeOptions(folders, folderModal?.id)

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
        {saving ? 'Saving…' : folderModal?.id ? 'Save Folder' : 'Create Folder'}
      </button>
    </>
  )

  const plural = (n, word) => `${n} ${word}${n !== 1 ? 's' : ''}`

  // One folder card. Project counts take in everything below it, so a
  // folder whose projects all sit in subfolders still reads as full.
  function renderFolderCard(f, i, siblings) {
    const below = descendantIds(folders, f.id)
    const inside = projects.filter(p => below.has(p.folder_id))
    const open = inside.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled').length
    const subs = childFolders(folders, f.id).length
    const meta = [
      subs && plural(subs, 'folder'),
      inside.length && plural(inside.length, 'project'),
      open && `${open} open`,
    ].filter(Boolean).join(' · ') || 'Empty'
    const cls = ['folder-card',
      dragId === f.id && 'folder-card-dragging',
      dragOverId === f.id && dragId !== f.id && 'folder-card-drop'].filter(Boolean).join(' ')
    return (
      <div key={f.id} className={cls} onClick={() => openFolder(f.id)}
        draggable={canManage}
        onDragStart={e => {
          setDragId(f.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', f.id)
        }}
        onDragOver={e => {
          if (!dragId) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (dragOverId !== f.id) setDragOverId(f.id)
        }}
        onDrop={e => {
          e.preventDefault()
          if (dragId) moveFolder(dragId, i)
          setDragId(null); setDragOverId(null)
        }}
        onDragEnd={() => { setDragId(null); setDragOverId(null) }}>
        <div className="folder-card-top">
          <Folder className="folder-card-icon" size={22} />
          {canManage && (
            <div className="folder-card-actions">
              <button className="icon-btn" title="Move left"
                disabled={i === 0}
                onClick={e => nudgeFolder(e, f, -1)}><ChevronLeft size={12} /></button>
              <button className="icon-btn" title="Move right"
                disabled={i === siblings.length - 1}
                onClick={e => nudgeFolder(e, f, 1)}><ChevronRight size={12} /></button>
              <button className="icon-btn" title="Rename or move folder"
                onClick={e => editFolder(e, f)}><Pencil size={12} /></button>
              <button className="icon-btn" title="Delete folder"
                onClick={e => deleteFolder(e, f)}
                style={{ color: 'var(--danger)', borderColor: 'rgba(224,82,82,0.2)' }}>
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>
        <div className="folder-card-name">{f.name}</div>
        <div className="folder-card-meta">{meta}</div>
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
  }

  const folderGrid = (
    <div className="folder-grid">
      {visibleFolders.map((f, i) => renderFolderCard(f, i, visibleFolders))}

      {/* Top level only, and only worth showing when something actually
          landed there. */}
      {!activeFolder && unfiledCount > 0 && (
        <div className="folder-card folder-card-unfiled" onClick={() => openFolder(UNFILED)}>
          <div className="folder-card-top">
            <FolderOpen className="folder-card-icon" size={22} />
          </div>
          <div className="folder-card-name">Unfiled</div>
          <div className="folder-card-meta">
            {plural(unfiledCount, 'project')} with no folder
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

  // Which folder a hit came from only matters when the list can span
  // more than one of them.
  const showFolderColumn = searching && activeFolder?.id !== UNFILED

  const projectTable = (
    <div className="card">
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              {showFolderColumn && <th>Folder</th>}
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
                {showFolderColumn && (
                  <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    {folderPathLabel(folders, p.folder_id) || 'Unfiled'}
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
  )

  const emptyState = (title, desc, actions) => (
    <div className="card">
      <div className="empty-state">
        <div className="empty-state-icon"><FolderKanban /></div>
        <div className="empty-state-title">{title}</div>
        <div className="empty-state-desc">{desc}</div>
        {actions}
      </div>
    </div>
  )

  // What sits directly in the open folder, for the header line.
  const directProjects = activeFolder?.id === UNFILED
    ? unfiledCount
    : projects.filter(p => p.folder_id === realFolderId).length

  let body
  if (loading) {
    body = <div className="loading-container"><div className="loading-spinner" /><span>Loading…</span></div>
  } else if (searching || activeFolder?.id === UNFILED) {
    // ── Flat list: search results, or the Unfiled pile ──
    body = listed.length > 0 ? projectTable : searching
      ? emptyState('No results found', 'Try a different search or status filter')
      : emptyState('This folder is empty', 'Every project has been filed in a folder')
  } else if (!activeFolder) {
    // ── Top level: the folder cards ──
    body = folders.length === 0 && unfiledCount === 0
      ? emptyState('No projects yet', 'Create your first project to get started tracking your work',
          canManage && <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> New Project</button>)
      : folderGrid
  } else {
    // ── Inside a folder: its subfolders first, then its own projects ──
    body = visibleFolders.length === 0 && listed.length === 0
      ? emptyState('This folder is empty',
          'Add a subfolder or a project here, or move one in from its Edit screen',
          canManage && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={newFolder}><FolderPlus size={15} /> New Folder</button>
              <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> New Project</button>
            </div>
          ))
      : <>
          {visibleFolders.length > 0 && folderGrid}
          {listed.length > 0 && projectTable}
        </>
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-nav">
          {activeFolder && (
            <button className="icon-btn" onClick={() => openFolder(parentOfActive?.id)}
              title={parentOfActive ? `Back to ${parentOfActive.name}` : 'Back to all folders'}
              aria-label={parentOfActive ? `Back to ${parentOfActive.name}` : 'Back to all folders'}>
              <ArrowLeft size={14} />
            </button>
          )}
          <div className="page-header-left">
            {activeFolder ? (
              <>
                <span className="page-header-title">{activeFolder.name}</span>
                <span className="page-header-sub folder-breadcrumb">
                  {/* Where this folder sits — every step is a way back up. */}
                  <nav aria-label="Folder path">
                    <button type="button" onClick={closeFolder}>Projects</button>
                    {trail.slice(0, -1).map(f => (
                      <Fragment key={f.id}>
                        <ChevronRight size={10} aria-hidden />
                        <button type="button" onClick={() => openFolder(f.id)}>{f.name}</button>
                      </Fragment>
                    ))}
                  </nav>
                  <span>
                    · {visibleFolders.length > 0 && `${plural(visibleFolders.length, 'folder')} · `}
                    {plural(directProjects, 'project')}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className="page-header-title">Projects</span>
                <span className="page-header-sub">
                  {plural(projects.length, 'project')} in {plural(folders.length, 'folder')}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={fetchAll} />
          {canManage && activeFolder?.id !== UNFILED && (
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

        {searching && activeFolder?.id !== UNFILED && (
          <div className="folder-search-note">
            {realFolderId
              ? `Showing matches in ${activeFolder.name} and its subfolders.`
              : 'Showing matches across every folder.'}
          </div>
        )}

        {body}
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
              {folderOptions.map(f => <option key={f.id} value={f.id}>{indentedName(f)}</option>)}
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
        title={folderModal?.id ? 'Edit Folder' : 'New Folder'}
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

        <div className="form-group">
          <label className="form-label">Location</label>
          {/* Where the folder lives, like a path on the NAS. Its own
              subfolders are left out — a folder cannot go inside itself. */}
          <select className="form-select" value={folderModal?.parent_id || ''}
            onChange={e => setFolderModal(m => ({ ...m, parent_id: e.target.value }))}>
            <option value="">Top level</option>
            {parentOptions.map(f => <option key={f.id} value={f.id}>{indentedName(f)}</option>)}
          </select>
        </div>

        {canRestrict && (
          <div className="form-group">
            <ConfidentialToggle
              noun="folder"
              inherited={folderInheritsRestriction ? 'folder' : null}
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
