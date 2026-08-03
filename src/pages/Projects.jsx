import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { Modal } from '../components/Modal'
import { Plus, Search, Pencil, Trash2, FolderKanban } from 'lucide-react'
import { RefreshButton } from '../components/RefreshButton'
import { format } from 'date-fns'
import {
  STAGES, PROJECT_TYPES, PROJECT_STATUSES, PROJECT_COLORS, getStatusColor
} from '../lib/constants'

const EMPTY_FORM = {
  name: '', client: '', project_type: 'Residential', status: 'Active',
  current_stage: 'Briefing', color: PROJECT_COLORS[0], budget: '',
  start_date: '', end_date: '', description: '', location: ''
}

export function Projects() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_projects')
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  useEffect(() => { fetchProjects() }, [])

  async function fetchProjects() {
    setLoading(true)
    const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    setProjects(data || [])
    setLoading(false)
  }

  function openNew() { setEditing(null); setForm(EMPTY_FORM); setShowModal(true) }
  function openEdit(e, p) { e.stopPropagation(); setEditing(p); setForm({ ...p, budget: p.budget || '' }); setShowModal(true) }
  function closeModal() { setShowModal(false); setEditing(null) }

  async function handleDelete(e, id) {
    e.stopPropagation()
    if (!confirm('Delete this project? All associated data will be removed.')) return
    await supabase.from('projects').delete().eq('id', id)
    fetchProjects()
  }

  async function handleSave() {
    setSaving(true)
    const payload = {
      ...form,
      budget: form.budget ? parseFloat(form.budget) : null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      updated_at: new Date().toISOString(),
    }
    if (editing) {
      await supabase.from('projects').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('projects').insert(payload)
    }
    setSaving(false)
    closeModal()
    fetchProjects()
  }

  const filtered = projects.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.client.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'All' || p.status === filterStatus
    return matchSearch && matchStatus
  })

  const modalFooter = (
    <>
      <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
      <button className="btn btn-primary" onClick={handleSave} disabled={!form.name || !form.client || saving}>
        {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Project'}
      </button>
    </>
  )

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-header-title">Projects</span>
          <span className="page-header-sub">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={fetchProjects} />
          {canManage && (
            <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> New Project</button>
          )}
        </div>
      </div>

      <div className="page-body">
        <div className="filter-bar">
          <div className="search-bar">
            <Search />
            <input className="form-input" placeholder="Search projects…" value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
          {['All', ...PROJECT_STATUSES].map(s => (
            <button key={s} className={`btn ${filterStatus === s ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => setFilterStatus(s)}>{s}</button>
          ))}
        </div>

        {loading ? (
          <div className="loading-container"><div className="loading-spinner" /><span>Loading…</span></div>
        ) : filtered.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><FolderKanban /></div>
              <div className="empty-state-title">{search || filterStatus !== 'All' ? 'No results found' : 'No projects yet'}</div>
              <div className="empty-state-desc">Create your first project to get started tracking your work</div>
              {!search && filterStatus === 'All' && canManage && (
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
                    <th>Type</th>
                    <th>Stage</th>
                    <th>Status</th>
                    <th>Budget</th>
                    <th>Deadline</th>
                    {canManage && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}`)}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                          <div style={{ width: 10, height: 10, background: p.color, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{p.name}</div>
                            {p.location && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{p.location}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: 'var(--text-sm)' }}>{p.client}</td>
                      <td><span className="tag">{p.project_type}</span></td>
                      <td style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{p.current_stage}</td>
                      <td><span className={`badge ${getStatusColor(p.status)}`}>{p.status}</span></td>
                      <td style={{ fontSize: 'var(--text-sm)' }}>
                        {p.budget ? `$${Number(p.budget).toLocaleString()}` : '—'}
                      </td>
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
            <label className="form-label">Project Type</label>
            <select className="form-select" value={form.project_type}
              onChange={e => setForm(f => ({ ...f, project_type: e.target.value }))}>
              {PROJECT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {PROJECT_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Current Stage</label>
            <select className="form-select" value={form.current_stage}
              onChange={e => setForm(f => ({ ...f, current_stage: e.target.value }))}>
              {STAGES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Budget ($)</label>
            <input className="form-input" type="number" placeholder="e.g. 450000" value={form.budget}
              onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
          </div>
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
          <label className="form-label">Location</label>
          <input className="form-input" placeholder="e.g. Dubai Marina, UAE" value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
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
      </Modal>
    </>
  )
}
