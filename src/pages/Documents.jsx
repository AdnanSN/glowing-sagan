import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Modal } from '../components/Modal'
import { Plus, FileText, Pencil, Trash2, FolderOpen } from 'lucide-react'
import { RefreshButton } from '../components/RefreshButton'
import { DocumentLocationModal } from '../components/DocumentLocationModal'
import { format } from 'date-fns'
import { DOC_TYPES } from '../lib/constants'

const EMPTY_FORM = { name: '', url: '', doc_type: 'Drawing', project_id: '', uploaded_by: '', notes: '' }

/**
 * Documents are references, not files.
 *
 * A row records what a document is called, where it lives, and who
 * added it. Nothing is uploaded and nothing is stored: the file itself
 * stays wherever the practice already keeps it, and this is the index
 * that says where that is.
 *
 * Clicking one opens a panel with the location to copy, because a
 * browser will not open a network path from a web page — that is a
 * security boundary in Chrome and Edge, not a setting.
 */
export function Documents() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_documents')

  const [docs, setDocs] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterProject, setFilterProject] = useState('All')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // The document whose location panel is open.
  const [viewing, setViewing] = useState(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [d, p] = await Promise.all([
      supabase.from('documents').select('*, project:projects(id,name,color)').order('created_at', { ascending: false }),
      supabase.from('projects').select('id,name,color').order('name'),
    ])
    setDocs(d.data || [])
    setProjects(p.data || [])
    setLoading(false)
  }

  function openNew() { setEditing(null); setForm(EMPTY_FORM); setSaveError(null); setShowModal(true) }

  function openEdit(doc) {
    setEditing(doc)
    setForm({
      name: doc.name || '',
      url: doc.url || '',
      doc_type: doc.doc_type || 'Drawing',
      project_id: doc.project_id || '',
      uploaded_by: doc.uploaded_by || '',
      notes: doc.notes || '',
    })
    setSaveError(null)
    setShowModal(true)
  }

  function closeModal() { setShowModal(false); setEditing(null) }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)

    // Built column by column rather than spread from `form`: a row read
    // back carries a joined `project` object that is not a column, and
    // PostgREST rejects the whole update when it arrives.
    const payload = {
      name: form.name.trim(),
      url: form.url.trim() || null,
      doc_type: form.doc_type,
      project_id: form.project_id || null,
      uploaded_by: form.uploaded_by.trim() || null,
      notes: form.notes.trim() || null,
    }

    const { error } = editing
      ? await supabase.from('documents').update(payload).eq('id', editing.id)
      : await supabase.from('documents').insert(payload)

    setSaving(false)
    if (error) { setSaveError(error.message); return }
    closeModal()
    fetchAll()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this document reference? The file itself is not touched.')) return
    const { error } = await supabase.from('documents').delete().eq('id', id)
    if (error) { alert(`Could not delete: ${error.message}`); return }
    fetchAll()
  }

  const filtered = filterProject === 'All' ? docs : docs.filter(d => d.project_id === filterProject)

  const grouped = DOC_TYPES.map(type => ({
    type,
    docs: filtered.filter(d => d.doc_type === type),
  })).filter(g => g.docs.length > 0)

  const modalFooter = (
    <>
      <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
      <button className="btn btn-primary" onClick={handleSave} disabled={!form.name.trim() || saving}>
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
          {canManage && (
            <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add Document</button>
          )}
        </div>
      </div>

      <div className="page-body">
        <div className="filter-bar">
          <select className="form-select form-select-sm" value={filterProject}
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
              <div className="empty-state-desc">Record where drawings, contracts and permits live so everyone can find them</div>
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
                        {/* The whole row opens the location panel — that is
                            the one thing everybody comes here to do. */}
                        <button className="doc-open" onClick={() => setViewing(doc)} title="Show where this file is">
                          <div className="doc-icon"><FileText /></div>
                          <div className="doc-info">
                            <div className="doc-name">{doc.name}</div>
                            <div className="doc-meta">
                              {doc.project?.name && <span>{doc.project.name}</span>}
                              {doc.uploaded_by && <span> · {doc.uploaded_by}</span>}
                              <span> · {format(new Date(doc.created_at), 'd MMM yyyy')}</span>
                            </div>
                            {doc.notes && <div className="doc-note">{doc.notes}</div>}
                          </div>
                        </button>
                        <div className="doc-actions">
                          <button className="icon-btn" onClick={() => setViewing(doc)} title="Show file location">
                            <FolderOpen size={13} />
                          </button>
                          {canManage && (
                            <button className="icon-btn" onClick={() => openEdit(doc)} title="Edit">
                              <Pencil size={13} />
                            </button>
                          )}
                          {canManage && (
                            <button className="icon-btn" onClick={() => handleDelete(doc.id)} title="Delete"
                              style={{ color: 'var(--danger)', borderColor: 'rgba(224,82,82,0.2)' }}>
                              <Trash2 size={13} />
                            </button>
                          )}
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
          <label className="form-label">File Location</label>
          <input className="form-input" placeholder="\\NAS01\Projects\RIY-2024-017\Drawings\A-101.pdf" value={form.url}
            onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
          <div className="form-hint">
            Where the file lives — a network path, or a web link. In File Explorer,
            Shift+right-click the file and choose “Copy as path”, then paste it here.
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Added By</label>
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

      <DocumentLocationModal doc={viewing} onClose={() => setViewing(null)} />
    </>
  )
}
