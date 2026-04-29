import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Modal } from '../components/Modal'
import { Plus, FileText, ExternalLink, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { DOC_TYPES } from '../lib/constants'

const EMPTY_FORM = { name: '', url: '', doc_type: 'Drawing', project_id: '', uploaded_by: '', notes: '' }

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

  function openNew() { setEditing(null); setForm(EMPTY_FORM); setShowModal(true) }
  function openEdit(doc) { setEditing(doc); setForm({ ...doc, project_id: doc.project_id || '', uploaded_by: doc.uploaded_by || '', notes: doc.notes || '' }); setShowModal(true) }
  function closeModal() { setShowModal(false); setEditing(null) }

  async function handleSave() {
    setSaving(true)
    const payload = { ...form, project_id: form.project_id || null, uploaded_by: form.uploaded_by || null, notes: form.notes || null }
    if (editing) {
      await supabase.from('documents').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('documents').insert(payload)
    }
    setSaving(false)
    closeModal()
    fetchAll()
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
      <button className="btn btn-primary" onClick={handleSave} disabled={!form.name || saving}>
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
        {canManage && (
          <div className="page-header-actions">
            <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add Document</button>
          </div>
        )}
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
                          {doc.notes && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{doc.notes}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
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
      </Modal>
    </>
  )
}
