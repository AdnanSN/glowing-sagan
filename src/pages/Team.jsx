import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'
import { Plus, Users, Pencil, Trash2 } from 'lucide-react'
import { PROJECT_COLORS } from '../lib/constants'

const ROLES = [
  'Principal Architect', 'Senior Architect', 'Architect', 'Junior Architect',
  'Interior Designer', 'Structural Engineer', 'Project Manager',
  'CAD Technician', 'Landscape Architect', 'Site Supervisor', 'Other'
]

const EMPTY_FORM = { name: '', role: 'Architect', email: '', color: PROJECT_COLORS[0] }

export function Team() {
  const [employees, setEmployees] = useState([])
  const [taskCounts, setTaskCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [empRes, taskRes] = await Promise.all([
      supabase.from('employees').select('*').order('name'),
      supabase.from('tasks').select('assignee_id, status'),
    ])
    const emps = empRes.data || []
    const tasks = taskRes.data || []
    const counts = {}
    emps.forEach(e => {
      counts[e.id] = {
        total: tasks.filter(t => t.assignee_id === e.id).length,
        open: tasks.filter(t => t.assignee_id === e.id && t.status !== 'Done').length,
      }
    })
    setEmployees(emps)
    setTaskCounts(counts)
    setLoading(false)
  }

  function openNew() { setEditing(null); setForm(EMPTY_FORM); setShowModal(true) }
  function openEdit(emp) { setEditing(emp); setForm({ ...emp, email: emp.email || '' }); setShowModal(true) }
  function closeModal() { setShowModal(false); setEditing(null) }

  async function handleSave() {
    setSaving(true)
    if (editing) {
      await supabase.from('employees').update(form).eq('id', editing.id)
    } else {
      await supabase.from('employees').insert(form)
    }
    setSaving(false)
    closeModal()
    fetchAll()
  }

  async function handleDelete(id) {
    if (!confirm('Remove this team member? Their tasks will become unassigned.')) return
    await supabase.from('employees').delete().eq('id', id)
    fetchAll()
  }

  const modalFooter = (
    <>
      <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
      <button className="btn btn-primary" onClick={handleSave} disabled={!form.name || !form.role || saving}>
        {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Member'}
      </button>
    </>
  )

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-header-title">Team</span>
          <span className="page-header-sub">{employees.length} member{employees.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add Member</button>
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="loading-container"><div className="loading-spinner" /><span>Loading…</span></div>
        ) : employees.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><Users /></div>
              <div className="empty-state-title">No team members yet</div>
              <div className="empty-state-desc">Add your team to assign tasks and track workloads</div>
              <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add Member</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-5)' }}>
            {employees.map(emp => {
              const counts = taskCounts[emp.id] || { total: 0, open: 0 }
              return (
                <div key={emp.id} className="card" style={{ padding: 'var(--space-5)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                    <div className="avatar avatar-lg" style={{ background: emp.color }}>
                      {emp.name.charAt(0)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{emp.name}</div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{emp.role}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <button className="icon-btn" onClick={() => openEdit(emp)}><Pencil size={13} /></button>
                      <button className="icon-btn" onClick={() => handleDelete(emp.id)}
                        style={{ color: 'var(--danger)', borderColor: 'rgba(224,82,82,0.2)' }}><Trash2 size={13} /></button>
                    </div>
                  </div>
                  {emp.email && (
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
                      {emp.email}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-light)' }}>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)' }}>{counts.open}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Open Tasks</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)' }}>{counts.total}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Total Tasks</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal isOpen={showModal} onClose={closeModal} title={editing ? 'Edit Team Member' : 'Add Team Member'} footer={modalFooter}>
        <div className="form-group">
          <label className="form-label">Full Name *</label>
          <input className="form-input" placeholder="e.g. Sarah Al-Mansouri" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Role *</label>
          <select className="form-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            {ROLES.map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" placeholder="e.g. sarah@studio.com" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Avatar Color</label>
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
