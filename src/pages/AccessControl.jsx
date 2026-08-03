import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { RefreshButton } from '../components/RefreshButton'
import { ACCESS_ROLES, ACCESS_STATUSES, roleMeta } from '../lib/constants'
import {
  ShieldCheck, UserPlus, Check, X, Ban, RotateCcw, Trash2, AlertCircle, Users,
} from 'lucide-react'

// Admin surface for the whole access model: approve the sign-up queue,
// set what each person may do, suspend or remove them. Every action here
// is also enforced in Postgres — this page cannot grant more than RLS
// allows, it just makes the decisions visible.
export function AccessControl() {
  const { user, refreshProfile } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [pendingRoles, setPendingRoles] = useState({})

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [profRes, empRes] = await Promise.all([
      supabase.from('profiles').select('*').order('requested_at', { ascending: false }),
      supabase.from('employees').select('id, name, role, color').order('name'),
    ])
    if (profRes.error) setError(profRes.error.message)
    setProfiles(profRes.data || [])
    setEmployees(empRes.data || [])
    setLoading(false)
  }

  // Every write goes through here so a rejected policy or a tripped
  // guard trigger (e.g. "last remaining admin") surfaces as a message
  // instead of silently doing nothing.
  async function run(id, fn) {
    setBusyId(id)
    setError('')
    const { error: err } = await fn()
    setBusyId(null)
    if (err) {
      setError(err.message)
      return false
    }
    await fetchAll()
    if (id === user?.id) await refreshProfile()
    return true
  }

  const approve = (profile) => {
    const role = pendingRoles[profile.id] || 'member'
    return run(profile.id, () => supabase.from('profiles').update({
      status: 'approved',
      role,
      approved_at: new Date().toISOString(),
      approved_by: user?.id ?? null,
    }).eq('id', profile.id))
  }

  const setStatus = (profile, status) =>
    run(profile.id, () => supabase.from('profiles').update({ status }).eq('id', profile.id))

  const setRole = (profile, role) =>
    run(profile.id, () => supabase.from('profiles').update({ role }).eq('id', profile.id))

  const setEmployee = (profile, employeeId) =>
    run(profile.id, () => supabase.from('profiles')
      .update({ employee_id: employeeId || null }).eq('id', profile.id))

  async function removeUser(profile) {
    const label = profile.full_name || profile.email
    if (!confirm(`Permanently delete the login for ${label}? They will not be able to sign in again.`)) return
    await run(profile.id, async () => {
      const { error: err } = await supabase.rpc('admin_delete_user', { target: profile.id })
      return { error: err }
    })
  }

  const pending = profiles.filter(p => p.status === 'pending')
  const decided = profiles.filter(p => p.status !== 'pending')

  // An employee record can only be claimed by one login, so hide the
  // ones already taken by somebody else.
  function availableEmployees(profile) {
    const taken = new Set(profiles.filter(p => p.id !== profile.id && p.employee_id).map(p => p.employee_id))
    return employees.filter(e => !taken.has(e.id))
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-header-title">Access</span>
          <span className="page-header-sub">
            {pending.length > 0
              ? `${pending.length} request${pending.length !== 1 ? 's' : ''} waiting`
              : `${decided.length} account${decided.length !== 1 ? 's' : ''}`}
          </span>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={fetchAll} />
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div className="access-error" id="access-error">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button className="icon-btn" onClick={() => setError('')} aria-label="Dismiss"><X size={13} /></button>
          </div>
        )}

        {loading ? (
          <div className="loading-container"><div className="loading-spinner" /><span>Loading…</span></div>
        ) : (
          <>
            {/* ── Pending requests ───────────────────────────── */}
            <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
              <div className="card-header">
                <span className="card-title"><UserPlus size={15} /> Pending requests</span>
                {pending.length > 0 && <span className="access-count">{pending.length}</span>}
              </div>

              {pending.length === 0 ? (
                <div className="empty-state" style={{ padding: 'var(--space-10) var(--space-6)' }}>
                  <div className="empty-state-icon"><ShieldCheck /></div>
                  <div className="empty-state-title">Nothing waiting</div>
                  <div className="empty-state-desc">
                    New sign-ups appear here. Nobody sees any data until you approve them.
                  </div>
                </div>
              ) : (
                <div className="access-request-list">
                  {pending.map(p => (
                    <div className="access-request" key={p.id}>
                      <div className="access-request-who">
                        <div className="avatar" style={{ background: '#1A1A1A' }}>
                          {(p.full_name || p.email || '?').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="access-request-name">{p.full_name || '—'}</div>
                          <div className="access-request-email">{p.email}</div>
                        </div>
                      </div>

                      <div className="access-request-meta">
                        Requested {new Date(p.requested_at).toLocaleDateString()}
                      </div>

                      <div className="access-request-actions">
                        <select
                          className="form-select"
                          value={pendingRoles[p.id] || 'member'}
                          onChange={e => setPendingRoles(r => ({ ...r, [p.id]: e.target.value }))}
                          aria-label={`Access level for ${p.email}`}
                        >
                          {ACCESS_ROLES.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <button className="btn btn-primary btn-sm" disabled={busyId === p.id}
                          onClick={() => approve(p)}>
                          <Check size={13} /> Approve
                        </button>
                        <button className="btn btn-danger btn-sm" disabled={busyId === p.id}
                          onClick={() => setStatus(p, 'rejected')}>
                          <X size={13} /> Decline
                        </button>
                      </div>

                      <div className="access-request-hint">
                        {roleMeta(pendingRoles[p.id] || 'member').description}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Everyone else ──────────────────────────────── */}
            <div className="card">
              <div className="card-header">
                <span className="card-title"><Users size={15} /> Accounts</span>
              </div>

              {decided.length === 0 ? (
                <div className="empty-state" style={{ padding: 'var(--space-10) var(--space-6)' }}>
                  <div className="empty-state-icon"><Users /></div>
                  <div className="empty-state-title">No accounts yet</div>
                </div>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Access level</th>
                        <th>Team record</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {decided.map(p => {
                        const isSelf = p.id === user?.id
                        const meta = roleMeta(p.role)
                        const statusMeta = ACCESS_STATUSES[p.status] || ACCESS_STATUSES.pending
                        return (
                          <tr key={p.id}>
                            <td>
                              <div className="access-person">
                                <div className="avatar avatar-sm" style={{ background: meta.color }}>
                                  {(p.full_name || p.email || '?').charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div className="access-person-name">
                                    {p.full_name || '—'}
                                    {isSelf && <span className="access-self">You</span>}
                                  </div>
                                  <div className="access-person-email">{p.email}</div>
                                </div>
                              </div>
                            </td>

                            <td>
                              <select
                                className="form-select"
                                value={p.role}
                                disabled={isSelf || busyId === p.id || p.status !== 'approved'}
                                onChange={e => setRole(p, e.target.value)}
                                aria-label={`Access level for ${p.email}`}
                              >
                                {ACCESS_ROLES.map(r => (
                                  <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                              </select>
                            </td>

                            <td>
                              <select
                                className="form-select"
                                value={p.employee_id || ''}
                                disabled={busyId === p.id}
                                onChange={e => setEmployee(p, e.target.value)}
                                aria-label={`Team record for ${p.email}`}
                              >
                                <option value="">Not linked</option>
                                {availableEmployees(p).map(e => (
                                  <option key={e.id} value={e.id}>{e.name}</option>
                                ))}
                              </select>
                            </td>

                            <td>
                              <span className={`badge ${statusMeta.badge}`}>{statusMeta.label}</span>
                            </td>

                            <td>
                              <div className="access-row-actions">
                                {p.status === 'approved' && !isSelf && (
                                  <button className="btn btn-secondary btn-sm" disabled={busyId === p.id}
                                    onClick={() => setStatus(p, 'suspended')} title="Revoke access">
                                    <Ban size={13} /> Suspend
                                  </button>
                                )}
                                {(p.status === 'suspended' || p.status === 'rejected') && (
                                  <button className="btn btn-secondary btn-sm" disabled={busyId === p.id}
                                    onClick={() => setStatus(p, 'approved')} title="Restore access">
                                    <RotateCcw size={13} /> Reinstate
                                  </button>
                                )}
                                {!isSelf && (
                                  <button className="icon-btn" disabled={busyId === p.id}
                                    onClick={() => removeUser(p)} title="Delete login"
                                    style={{ color: 'var(--danger)', borderColor: 'rgba(192,40,28,0.2)' }}>
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── What the levels mean ───────────────────────── */}
            <div className="card" style={{ marginTop: 'var(--space-6)' }}>
              <div className="card-header">
                <span className="card-title"><ShieldCheck size={15} /> What each level can do</span>
              </div>
              <div className="access-legend">
                {ACCESS_ROLES.map(r => (
                  <div className="access-legend-row" key={r.value}>
                    <span className="access-legend-dot" style={{ background: r.color }} />
                    <span className="access-legend-name">{r.label}</span>
                    <span className="access-legend-desc">{r.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
