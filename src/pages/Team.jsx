import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Modal } from '../components/Modal'
import { Plus, Users, Pencil, Trash2, UsersRound, FolderKanban, Search } from 'lucide-react'
import { RefreshButton } from '../components/RefreshButton'
import { Avatar } from '../components/Avatar'
import { AvatarUploader } from '../components/AvatarUploader'
import { deleteAvatarFile } from '../lib/avatar'
import { PROJECT_COLORS } from '../lib/constants'
import { fetchTeams, teamsByEmployee, saveTeam, deleteTeam, isMissingTable } from '../lib/teams'

const ROLES = [
  'Principal Architect', 'Senior Architect', 'Architect', 'Junior Architect',
  'Interior Designer', 'Structural Engineer', 'Project Manager',
  'CAD Technician', 'Landscape Architect', 'Site Supervisor', 'Other'
]

const EMPTY_FORM = { name: '', role: 'Architect', email: '', color: PROJECT_COLORS[0], avatar_url: null }
const EMPTY_TEAM = { name: '', purpose: '', color: PROJECT_COLORS[1], project_id: '' }

export function Team() {
  const [employees, setEmployees] = useState([])
  const [taskCounts, setTaskCounts] = useState({})
  const [teams, setTeams] = useState([])
  const [projects, setProjects] = useState([])
  // Set when the teams tables aren't in the database yet, so the tab can
  // say which migration to run instead of showing a convincing "no teams".
  const [teamsMissing, setTeamsMissing] = useState(false)
  const [loading, setLoading] = useState(true)

  // Which tab is open lives in the URL, so a link can point at the teams
  // list and Back steps between the two rather than off the page.
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'teams' ? 'teams' : 'members'
  const setTab = (next) => setParams(next === 'teams' ? { tab: 'teams' } : {})

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // The team editor: the row being edited, the people ticked, and a
  // place to show whatever the database says if the save is refused.
  const [teamModal, setTeamModal] = useState(false)
  const [editingTeam, setEditingTeam] = useState(null)
  const [teamForm, setTeamForm] = useState(EMPTY_TEAM)
  const [teamMembers, setTeamMembers] = useState([])
  const [memberSearch, setMemberSearch] = useState('')
  const [teamError, setTeamError] = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [empRes, taskRes, projRes, teamRes] = await Promise.all([
      supabase.from('employees').select('*').order('name'),
      supabase.from('tasks').select('assignee_id, status'),
      supabase.from('projects').select('id, name, color, status').order('name'),
      fetchTeams(),
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
    setProjects(projRes.data || [])
    setTeams(teamRes.teams)
    setTeamsMissing(isMissingTable(teamRes.error))
    setLoading(false)
  }

  const memberTeams = teamsByEmployee(teams)

  // ── Roster ──────────────────────────────────────────────────
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
    const inTeams = (memberTeams[id] || []).length
    const extra = inTeams
      ? ` They will also be removed from ${inTeams} team${inTeams !== 1 ? 's' : ''}.`
      : ''
    if (!confirm(`Remove this team member? Their tasks will become unassigned.${extra}`)) return
    await supabase.from('employees').delete().eq('id', id)
    // Nothing points at the photo any more, so don't leave it in the bucket.
    await deleteAvatarFile(id)
    fetchAll()
  }

  // ── Teams ───────────────────────────────────────────────────
  function openNewTeam() {
    setEditingTeam(null)
    setTeamForm(EMPTY_TEAM)
    setTeamMembers([])
    setMemberSearch('')
    setTeamError('')
    setTeamModal(true)
  }

  function openEditTeam(team) {
    setEditingTeam(team)
    setTeamForm({
      name: team.name,
      purpose: team.purpose || '',
      color: team.color,
      project_id: team.project_id || '',
    })
    setTeamMembers(team.members.map(m => m.id))
    setMemberSearch('')
    setTeamError('')
    setTeamModal(true)
  }

  function closeTeamModal() { setTeamModal(false); setEditingTeam(null) }

  function toggleMember(id) {
    setTeamMembers(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  async function handleSaveTeam() {
    setSaving(true)
    const { error } = await saveTeam({ editing: editingTeam, form: teamForm, memberIds: teamMembers })
    setSaving(false)
    if (error) { setTeamError(error); return }
    closeTeamModal()
    fetchAll()
  }

  async function handleDeleteTeam(team) {
    if (!confirm(`Delete the team "${team.name}"? Its members stay on the roster — only the grouping goes.`)) return
    const { error } = await deleteTeam(team.id)
    if (error) { alert(`Could not delete: ${error}`); return }
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

  const teamFooter = (
    <>
      <button className="btn btn-secondary" onClick={closeTeamModal}>Cancel</button>
      <button className="btn btn-primary" onClick={handleSaveTeam} disabled={!teamForm.name.trim() || saving}>
        {saving ? 'Saving…' : editingTeam ? 'Save Changes' : 'Create Team'}
      </button>
    </>
  )

  const pickerList = employees.filter(e =>
    e.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
    (e.role || '').toLowerCase().includes(memberSearch.toLowerCase())
  )

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-header-title">Team</span>
          <span className="page-header-sub">
            {employees.length} member{employees.length !== 1 ? 's' : ''}
            {teams.length > 0 && ` · ${teams.length} team${teams.length !== 1 ? 's' : ''}`}
          </span>
        </div>
        <div className="page-header-actions">
          <RefreshButton onRefresh={fetchAll} />
          {tab === 'teams' ? (
            <button className="btn btn-primary" onClick={openNewTeam} disabled={teamsMissing}>
              <Plus size={15} /> New Team
            </button>
          ) : (
            <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add Member</button>
          )}
        </div>
      </div>

      <div className="page-body">
        <div className="tabs">
          <button className={`tab-btn${tab === 'members' ? ' active' : ''}`} onClick={() => setTab('members')}>
            Members ({employees.length})
          </button>
          <button className={`tab-btn${tab === 'teams' ? ' active' : ''}`} onClick={() => setTab('teams')}>
            Teams ({teams.length})
          </button>
        </div>

        {loading ? (
          <div className="loading-container"><div className="loading-spinner" /><span>Loading…</span></div>
        ) : tab === 'members' ? (
          employees.length === 0 ? (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-icon"><Users /></div>
                <div className="empty-state-title">No team members yet</div>
                <div className="empty-state-desc">Add your team to assign tasks and track workloads</div>
                <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> Add Member</button>
              </div>
            </div>
          ) : (
            <div className="roster-grid">
              {employees.map(emp => {
                const counts = taskCounts[emp.id] || { total: 0, open: 0 }
                const belongsTo = memberTeams[emp.id] || []
                return (
                  <div key={emp.id} className="card" style={{ padding: 'var(--space-5)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                      <Avatar name={emp.name} src={emp.avatar_url} color={emp.color} size="lg" />
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
                    {/* Which groups this person is in. Clicking one opens the
                        teams tab — the roster card is where you notice
                        somebody is on four jobs at once. */}
                    {belongsTo.length > 0 && (
                      <div className="team-chip-row">
                        {belongsTo.map(t => (
                          <button key={t.id} className="team-chip" onClick={() => { setTab('teams'); openEditTeam(t) }}>
                            <span className="team-chip-dot" style={{ background: t.color }} />
                            {t.name}
                          </button>
                        ))}
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
          )
        ) : teamsMissing ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><UsersRound /></div>
              <div className="empty-state-title">Teams aren't set up yet</div>
              <div className="empty-state-desc">
                Run <code>supabase/migration_v14_teams.sql</code> in the Supabase SQL editor,
                then refresh this page. Nothing else in the app changes until you do.
              </div>
            </div>
          </div>
        ) : teams.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><UsersRound /></div>
              <div className="empty-state-title">No teams yet</div>
              <div className="empty-state-desc">
                Group people into a team — usually the people on one job. Somebody can be
                in as many teams as their week involves.
              </div>
              <button className="btn btn-primary" onClick={openNewTeam}><Plus size={15} /> New Team</button>
            </div>
          </div>
        ) : (
          <div className="roster-grid">
            {teams.map(team => {
              const openWork = team.members.reduce((n, m) => n + (taskCounts[m.id]?.open || 0), 0)
              return (
                <div key={team.id} className="card team-card" style={{ '--team-color': team.color }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-md)' }}>{team.name}</div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                        {team.members.length} member{team.members.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <button className="icon-btn" onClick={() => openEditTeam(team)}><Pencil size={13} /></button>
                      <button className="icon-btn" onClick={() => handleDeleteTeam(team)}
                        style={{ color: 'var(--danger)', borderColor: 'rgba(224,82,82,0.2)' }}><Trash2 size={13} /></button>
                    </div>
                  </div>

                  {team.project ? (
                    <Link to={`/projects/${team.project.id}`} className="tag team-project-tag">
                      <FolderKanban size={11} style={{ marginRight: 4 }} />
                      {team.project.name}
                    </Link>
                  ) : (
                    <span className="tag" style={{ color: 'var(--text-muted)' }}>Standing team</span>
                  )}

                  {team.purpose && (
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-3)' }}>
                      {team.purpose}
                    </div>
                  )}

                  <div style={{ marginTop: 'var(--space-4)' }}>
                    {team.members.length === 0 ? (
                      <div className="no-data" style={{ padding: 'var(--space-4)' }}>Nobody in this team yet</div>
                    ) : (
                      <div className="team-member-list">
                        {team.members.map(m => (
                          <div key={m.id} className="team-member-row">
                            <Avatar name={m.name} src={m.avatar_url} color={m.color} size="sm" />
                            <span className="team-member-name">{m.name}</span>
                            <span className="team-member-role">{m.role}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-light)' }}>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{team.members.length}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Members</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{openWork}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Open Tasks</div>
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
          <label className="form-label">Photo</label>
          {editing ? (
            <AvatarUploader
              employeeId={editing.id}
              name={form.name}
              color={form.color}
              value={form.avatar_url}
              onChange={url => setForm(f => ({ ...f, avatar_url: url }))}
              hint="People can also set their own from the sidebar."
            />
          ) : (
            <div className="no-data" style={{ textAlign: 'left' }}>
              Add the member first, then reopen this to set a photo.
            </div>
          )}
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

      <Modal isOpen={teamModal} onClose={closeTeamModal}
        title={editingTeam ? 'Edit Team' : 'New Team'} footer={teamFooter}>
        <div className="form-group">
          <label className="form-label">Team Name *</label>
          <input className="form-input" placeholder="e.g. Riverside Pavilion" value={teamForm.name}
            onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Project</label>
          <select className="form-select" value={teamForm.project_id}
            onChange={e => setTeamForm(f => ({ ...f, project_id: e.target.value }))}>
            <option value="">No project — a standing team</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="form-hint" style={{ marginTop: 'var(--space-2)' }}>
            Leave this empty for a group that outlives any one job, like Interiors.
            Deleting a project never deletes its team.
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Purpose</label>
          <input className="form-input" placeholder="e.g. Design and site supervision through handover"
            value={teamForm.purpose}
            onChange={e => setTeamForm(f => ({ ...f, purpose: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">
            Members {teamMembers.length > 0 && <span className="chip">{teamMembers.length}</span>}
          </label>
          {employees.length === 0 ? (
            <div className="no-data" style={{ textAlign: 'left' }}>
              Add people to the roster first — a team is picked from it.
            </div>
          ) : (
            <>
              {employees.length > 6 && (
                <div className="search-bar" style={{ marginBottom: 'var(--space-2)' }}>
                  <Search />
                  <input className="form-input" placeholder="Find someone…" value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)} />
                </div>
              )}
              <div className="member-picker">
                {pickerList.length === 0 ? (
                  <div className="no-data" style={{ padding: 'var(--space-4)' }}>Nobody matches that</div>
                ) : pickerList.map(emp => {
                  const checked = teamMembers.includes(emp.id)
                  return (
                    <label key={emp.id} className={`member-picker-row${checked ? ' selected' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleMember(emp.id)} />
                      <Avatar name={emp.name} src={emp.avatar_url} color={emp.color} size="sm" />
                      <span className="member-picker-name">{emp.name}</span>
                      <span className="member-picker-role">{emp.role}</span>
                    </label>
                  )
                })}
              </div>
              <div className="form-hint" style={{ marginTop: 'var(--space-2)' }}>
                Somebody can be in as many teams as you like — ticking them here does not
                take them out of any other.
              </div>
            </>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Colour</label>
          <div className="color-swatch">
            {PROJECT_COLORS.map(c => (
              <div key={c} className={`color-option${teamForm.color === c ? ' selected' : ''}`}
                style={{ background: c }} onClick={() => setTeamForm(f => ({ ...f, color: c }))} />
            ))}
          </div>
        </div>
        {teamError && <div className="stage-editor-error">{teamError}</div>}
      </Modal>
    </>
  )
}
