import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Modal } from '../components/Modal'
import { Plus, FileText, ExternalLink, Trash2, Copy, Check, FolderOpen, Settings, HardDrive } from 'lucide-react'
import { RefreshButton } from '../components/RefreshButton'
import { NasPathField } from '../components/NasPathField'
import { format } from 'date-fns'
import { DOC_TYPES } from '../lib/constants'
import {
  normalizeNasPath, nasFullPath, nasFolderPath, nasProtocolUrl,
  fetchNasRoot, saveNasRoot, copyText,
} from '../lib/nas'

const EMPTY_FORM = { name: '', url: '', nas_path: '', doc_type: 'Drawing', project_id: '', uploaded_by: '', notes: '' }

export function Documents() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_documents')
  const [docs, setDocs] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [filterProject, setFilterProject] = useState('All')
  const [saveError, setSaveError] = useState(null)

  // The share root every nas_path hangs off. One value for the whole
  // practice — see migration_v12_nas_links.sql.
  const canManageSettings = hasPermission('manage_settings')
  const [nasRoot, setNasRoot] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [rootDraft, setRootDraft] = useState('')
  const [savingRoot, setSavingRoot] = useState(false)

  // Which row last had something copied, so the button can say so.
  const [copied, setCopied] = useState(null)
  const copiedTimer = useRef(null)

  useEffect(() => { fetchAll() }, [])
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  async function fetchAll() {
    setLoading(true)
    const [d, p, root] = await Promise.all([
      supabase.from('documents').select('*, project:projects(id,name,color)').order('created_at', { ascending: false }),
      supabase.from('projects').select('id,name,color').order('name'),
      fetchNasRoot(),
    ])
    setDocs(d.data || [])
    setProjects(p.data || [])
    setNasRoot(root)
    setLoading(false)
  }

  function openNew() { setEditing(null); setForm(EMPTY_FORM); setSaveError(null); setShowModal(true) }
  function openEdit(doc) {
    setEditing(doc)
    setForm({
      name: doc.name || '', url: doc.url || '', nas_path: doc.nas_path || '',
      doc_type: doc.doc_type || 'Drawing', project_id: doc.project_id || '',
      uploaded_by: doc.uploaded_by || '', notes: doc.notes || '',
    })
    setSaveError(null)
    setShowModal(true)
  }
  function closeModal() { setShowModal(false); setEditing(null) }

  // Checked as it is typed so the modal can explain a bad path while it
  // is still open. The database checks the same thing and is the one
  // that actually holds — see the constraint in migration_v12.
  const pathCheck = normalizeNasPath(form.nas_path, nasRoot)

  async function handleSave() {
    if (pathCheck.error) return
    setSaving(true)
    setSaveError(null)

    // Built column by column rather than spread from `form`: the row
    // read back carries a joined `project` object that is not a column,
    // and PostgREST rejects the whole update when it arrives.
    const payload = {
      name: form.name,
      url: form.url || null,
      nas_path: pathCheck.path,
      doc_type: form.doc_type,
      project_id: form.project_id || null,
      uploaded_by: form.uploaded_by || null,
      notes: form.notes || null,
    }

    const { error } = editing
      ? await supabase.from('documents').update(payload).eq('id', editing.id)
      : await supabase.from('documents').insert(payload)

    setSaving(false)
    if (error) { setSaveError(error.message); return }
    closeModal()
    fetchAll()
  }

  function openSettings() { setRootDraft(nasRoot); setShowSettings(true) }

  async function handleSaveRoot() {
    setSavingRoot(true)
    try {
      await saveNasRoot(rootDraft)
      setNasRoot(rootDraft.trim().replace(/[\\/]+$/, ''))
      setShowSettings(false)
    } catch (e) {
      setSaveError(e.message)
    }
    setSavingRoot(false)
  }

  // The route that needs nothing installed: paste it into Explorer.
  async function handleCopy(doc) {
    const text = nasFullPath(nasRoot, doc.nas_path)
    if (!text) return
    await copyText(text)
    clearTimeout(copiedTimer.current)
    setCopied(doc.id)
    copiedTimer.current = setTimeout(() => setCopied(null), 1500)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this document reference?')) return
    await supabase.from('documents').delete().eq('id', id)
    fetchAll()
  }

  const filtered = filterProject === 'All' ? docs : docs.filter(d => d.project_id === filterProject)

  const grouped = DOC_TYPES.map(type => ({
    type,
    docs: filtered.filter(d => d.doc_type === type)
  })).filter(g => g.docs.length > 0)

  const modalFooter = (
    <>
      <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
      <button className="btn btn-primary" onClick={handleSave} disabled={!form.name || saving || !!pathCheck.error}>
        {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Document'}
      </button>
    </>
  )

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-header-title">Documents</span>
          <span className="page-header-sub">{docs.length} document{docs.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={fetchAll} />
          {canManageSettings && (
            <button className="icon-btn" onClick={openSettings} title="NAS share settings">
              <Settings size={13} />
            </button>
          )}
          {canManage && (
            <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add Document</button>
          )}
        </div>
      </div>

      <div className="page-body">
        <div className="filter-bar">
          <select className="form-select" style={{ width: 'auto', height: 36 }} value={filterProject}
            onChange={e => setFilterProject(e.target.value)}>
            <option value="All">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="loading-container"><div className="loading-spinner" /><span>Loading…</span></div>
        ) : filtered.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><FileText /></div>
              <div className="empty-state-title">No documents yet</div>
              <div className="empty-state-desc">Add links to drawings, contracts, permits, and other project files</div>
              {canManage && <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add Document</button>}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {grouped.length > 0 ? grouped.map(({ type, docs: typeDocs }) => (
              <div key={type}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>{type}</div>
                <div className="card">
                  {typeDocs.map((doc, i) => (
                    <div key={doc.id} style={{ borderBottom: i < typeDocs.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                      <div className="doc-item">
                        <div className="doc-icon"><FileText /></div>
                        <div className="doc-info">
                          <div className="doc-name">{doc.name}</div>
                          <div className="doc-meta">
                            {doc.project?.name && <span>{doc.project.name}</span>}
                            {doc.uploaded_by && <span> · {doc.uploaded_by}</span>}
                            <span> · {format(new Date(doc.created_at), 'd MMM yyyy')}</span>
                          </div>
                          {doc.nas_path && (
                            <div className={`doc-path${nasRoot ? '' : ' doc-path-unset'}`}
                              title={nasRoot ? nasFullPath(nasRoot, doc.nas_path) : doc.nas_path}>
                              <HardDrive size={11} />
                              <span>{nasRoot
                                ? nasFullPath(nasRoot, doc.nas_path)
                                : `${doc.nas_path} — set the share root to use this`}</span>
                            </div>
                          )}
                          {doc.notes && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{doc.notes}</div>}
                        </div>
                        <div className="doc-actions">
                          {doc.nas_path && nasRoot && (
                            <>
                              <a href={nasProtocolUrl(doc.nas_path, 'open')} className="icon-btn"
                                title="Open the file from the NAS (needs the one-time desktop shortcut installed)">
                                <HardDrive size={13} />
                              </a>
                              <a href={nasProtocolUrl(doc.nas_path, 'folder')} className="icon-btn"
                                title={`Open the containing folder — ${nasFolderPath(nasRoot, doc.nas_path)}`}>
                                <FolderOpen size={13} />
                              </a>
                              <button className="icon-btn" onClick={() => handleCopy(doc)}
                                title="Copy the full path — paste it into File Explorer"
                                style={copied === doc.id ? { color: 'var(--success)' } : undefined}>
                                {copied === doc.id ? <Check size={13} /> : <Copy size={13} />}
                              </button>
                            </>
                          )}
                          {doc.url && (
                            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="icon-btn" title="Open link">
                              <ExternalLink size={13} />
                            </a>
                          )}
                          {canManage && <button className="icon-btn" onClick={() => openEdit(doc)} title="Edit"><FileText size={13} /></button>}
                          {canManage && <button className="icon-btn" onClick={() => handleDelete(doc.id)} title="Delete"
                            style={{ color: 'var(--danger)', borderColor: 'rgba(224,82,82,0.2)' }}><Trash2 size={13} /></button>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )) : (
              <div className="card">
                <div className="empty-state">
                  <div className="empty-state-title">No documents for this project</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Document' : 'Add Document'} footer={modalFooter}>
        <div className="form-group">
          <label className="form-label">Document Name *</label>
          <input className="form-input" placeholder="e.g. Ground Floor Plan - Rev 3" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Document Type</label>
            <select className="form-select" value={form.doc_type} onChange={e => setForm(f => ({ ...f, doc_type: e.target.value }))}>
              {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Project</label>
            <select className="form-select" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
              <option value="">— No Project —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">URL / Link</label>
          <input className="form-input" type="url" placeholder="https://drive.google.com/…" value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
          <div className="form-hint">Link to file in Drive, Dropbox, SharePoint, etc.</div>
        </div>
        <NasPathField
          value={form.nas_path}
          onChange={v => setForm(f => ({ ...f, nas_path: v }))}
          nasRoot={nasRoot}
          check={pathCheck}
          onPicked={(rel, suggested) => setForm(f => ({ ...f, nas_path: rel, name: f.name || suggested }))}
        />
        <div className="form-group">
          <label className="form-label">Uploaded By</label>
          <input className="form-input" placeholder="e.g. Ahmed Rahman" value={form.uploaded_by}
            onChange={e => setForm(f => ({ ...f, uploaded_by: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea className="form-textarea" placeholder="Any notes about this document…" value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ minHeight: 60 }} />
        </div>
        {saveError && (
          <div className="form-hint" style={{ color: 'var(--danger)' }}>Could not save: {saveError}</div>
        )}
      </Modal>

      <Modal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        title="NAS share settings"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowSettings(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveRoot} disabled={savingRoot}>
              {savingRoot ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Share root</label>
          <input className="form-input" placeholder="\\NAS01\Projects" value={rootDraft}
            onChange={e => setRootDraft(e.target.value)} />
          <div className="form-hint">
            Every document path is stored relative to this, so changing it repoints them all at once.
            Use the network path — a mapped drive letter like <strong style={{ fontWeight: 500 }}>P:</strong> is
            whatever each machine happened to map, and not everyone mapped the same one.
          </div>
        </div>
        <div className="form-hint">
          The one-click “open” buttons also need the desktop shortcut installed on each office PC, and it
          keeps its own copy of this root — see <strong style={{ fontWeight: 500 }}>nas-handler/README.md</strong>.
          If you change the root here, change it there too. Copy path keeps working either way.
        </div>
      </Modal>
    </>
  )
}
