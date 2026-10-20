import { useState } from 'react'
import { CornerDownRight, Pencil, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Modal } from './Modal'
import { AssigneePicker } from './AssigneePicker'
import { AvatarStack } from './Avatar'
import { ConfidentialToggle } from './ConfidentialTag'
import { TASK_STATUSES, PRIORITIES, projectStages } from '../lib/constants'
import { assigneeIdsOf, assigneesOf, setTaskAssignees } from '../lib/assignees'
import { linkStatusAndProgress } from '../lib/gantt'
import { nextSubtaskPosition } from '../lib/subtasks'

/* ────────────────────────────────────────────────────────────────
   THE TASK DIALOG

   One dialog for every board. The project page and the all-projects
   board each used to carry their own, and the two had drifted: one had
   start dates and the stage list, the other a project picker and a
   free-text stage. This is both.

   A main task also lists its sub-tasks — one quick row each for what,
   who, when and how far along — so the three people splitting
   "Presentation - 2" can be set up in one sitting. Everything in the
   dialog, sub-task rows included, is written on Save; Cancel leaves
   the board exactly as it was.

   Mount it with a `key` per task: its state is seeded from props once,
   so switching to another task is a fresh dialog, not a stale one.
   ──────────────────────────────────────────────────────────────── */

const blankRow = (n) => ({
  key: `new-${n}`, id: null, title: '', status: 'To Do', assignee_ids: [], due_date: '',
})

const rowFromTask = (t) => ({
  key: t.id, id: t.id, title: t.title, status: t.status,
  assignee_ids: assigneeIdsOf(t), due_date: t.due_date || '',
})

const sameIds = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

export function TaskModal({
  isOpen = true,
  task = null,          // the row being edited; null for a new one
  defaults = {},        // a new one's starting fields: project_id, status, parent_task_id
  parent = null,        // the main task, when this is (or will be) a sub-task
  subtasks = [],        // this task's own sub-tasks, when it is a main task
  projects = [],        // what the project picker offers (and where stages come from)
  lockProject = false,  // a project's own board: the project is not a choice
  employees = [],
  canManage = false,
  canRestrict = false,
  projectRestricted = () => false,
  onClose,
  onSaved,
  onOpenTask,           // switch the dialog to another task
}) {
  const editing = !!task
  const isSub = !!parent

  const [initial] = useState(() => ({
    form: {
      title: task?.title || '',
      description: task?.description || '',
      status: task?.status || defaults.status || 'To Do',
      priority: task?.priority || 'Medium',
      project_id: parent?.project_id || task?.project_id || defaults.project_id || '',
      assignee_ids: task ? assigneeIdsOf(task) : [],
      start_date: task?.start_date || '',
      due_date: task?.due_date || '',
      stage: parent ? (parent.stage || '') : (task?.stage || ''),
      is_confidential: !!task?.is_confidential,
    },
    rows: subtasks.map(rowFromTask),
  }))
  const [form, setForm] = useState(initial.form)
  const [rows, setRows] = useState(initial.rows)
  const [removed, setRemoved] = useState([])  // ids of saved sub-tasks taken off
  const [draftTitle, setDraftTitle] = useState('')
  const [rowSeq, setRowSeq] = useState(0)
  const [saving, setSaving] = useState(false)

  const set = (field) => (value) => setForm(f => ({ ...f, [field]: value }))

  const project = projects.find(p => p.id === form.project_id) || null
  // The project's stages, plus whatever the task already says if that
  // is not one of them — a stage renamed away, or typed on the old
  // free-text board. Dropping it silently would be the dialog editing
  // something nobody touched.
  const stageOptions = project ? [...projectStages(project)] : []
  if (form.stage && !stageOptions.includes(form.stage)) stageOptions.push(form.stage)

  // Sub-tasks are one level deep: a sub-task's dialog has no list of
  // its own.
  const showSubtasks = !isSub && canManage
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initial.form) ||
    JSON.stringify(rows) !== JSON.stringify(initial.rows) ||
    removed.length > 0 || draftTitle.trim() !== ''

  const inheritedRestriction =
    isSub && parent.is_confidential ? 'task'
      : projectRestricted(form.project_id) ? 'project'
        : null

  /* ── sub-task rows ── */
  function addRow() {
    const title = draftTitle.trim()
    if (!title) return
    setRows(rs => [...rs, { ...blankRow(rowSeq), title }])
    setRowSeq(n => n + 1)
    setDraftTitle('')
  }

  const patchRow = (key, patch) =>
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))

  function removeRow(row) {
    setRows(rs => rs.filter(r => r.key !== row.key))
    if (row.id) setRemoved(ids => [...ids, row.id])
  }

  /* Leaving for another task drops whatever was typed here. */
  function openOther(t) {
    if (dirty && !confirm('Discard your changes to this task?')) return
    onOpenTask?.(t)
  }

  /* ── writes ── */
  async function writeSubtasks(mainId, list) {
    const problems = []
    const now = new Date().toISOString()
    const before = new Map(subtasks.map(t => [t.id, t]))

    if (removed.length) {
      const { error } = await supabase.from('tasks').delete().in('id', removed)
      if (error) problems.push(`removing sub-tasks: ${error.message}`)
    }

    let position = nextSubtaskPosition(subtasks)
    for (const row of list) {
      const title = row.title.trim()
      if (!title) continue

      if (row.id) {
        const was = before.get(row.id)
        if (!was) continue
        const patch = {}
        if (title !== was.title) patch.title = title
        if ((row.due_date || null) !== (was.due_date || null)) patch.due_date = row.due_date || null
        if (row.status !== was.status) Object.assign(patch, linkStatusAndProgress({ status: row.status }, was))
        if (Object.keys(patch).length) {
          const { error } = await supabase.from('tasks')
            .update({ ...patch, updated_at: now }).eq('id', row.id)
          if (error) problems.push(`"${title}": ${error.message}`)
        }
        if (!sameIds(row.assignee_ids, assigneeIdsOf(was))) {
          const { error } = await setTaskAssignees(row.id, row.assignee_ids)
          if (error) problems.push(`who is on "${title}": ${error.message}`)
        }
        continue
      }

      // project_id and stage are set by the database from the main task
      // whatever is sent; they go along so the row passes the same
      // checks on the way in that it will on the way out.
      const { data, error } = await supabase.from('tasks').insert({
        parent_task_id: mainId,
        project_id: form.project_id || null,
        stage: form.stage || null,
        title,
        status: row.status,
        priority: 'Medium',
        due_date: row.due_date || null,
        position: position++,
        ...linkStatusAndProgress({ status: row.status }, { progress: 0 }),
      }).select('id').single()
      if (error) { problems.push(`"${title}": ${error.message}`); continue }
      if (row.assignee_ids.length) {
        const { error: pe } = await setTaskAssignees(data.id, row.assignee_ids)
        if (pe) problems.push(`who is on "${title}": ${pe.message}`)
      }
    }
    return problems
  }

  async function save() {
    setSaving(true)

    const payload = {
      title: form.title.trim(),
      description: form.description || '',
      status: form.status,
      priority: form.priority,
      project_id: form.project_id || null,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      stage: form.stage || null,
      updated_at: new Date().toISOString(),
    }
    // Status and the timeline's progress figure are one fact; keep them
    // agreeing when status is what changed here.
    if (!editing || form.status !== task.status) {
      Object.assign(payload, linkStatusAndProgress({ status: form.status }, editing ? task : { progress: 0 }))
    }
    // Only the people who can see the control send it, so nobody else's
    // save can clear a flag they were never shown.
    if (canRestrict) payload.is_confidential = !!form.is_confidential
    if (!editing && isSub) {
      payload.parent_task_id = parent.id
      payload.position = nextSubtaskPosition(defaults.siblings || [])
    }

    // assignee_id is not in there on purpose: it is the lead, derived by
    // the database from the list written straight after.
    const { data, error } = editing
      ? await supabase.from('tasks').update(payload).eq('id', task.id).select('id').single()
      : await supabase.from('tasks').insert(payload).select('id').single()

    if (error) {
      setSaving(false)
      alert(`Could not save task: ${error.message}`)
      return
    }

    const problems = []
    const { error: peopleError } = await setTaskAssignees(data.id, form.assignee_ids)
    if (peopleError) problems.push(`who is on it: ${peopleError.message}`)
    if (showSubtasks) problems.push(...await writeSubtasks(data.id, rowsWithDraft()))

    setSaving(false)
    // The task itself is saved by this point — say what did not land
    // rather than implying the whole save was lost.
    if (problems.length) alert(`Task saved, but not everything did:\n• ${problems.join('\n• ')}`)
    onSaved?.()
    onClose()
  }

  // A sub-task title typed but not yet added with Enter still counts —
  // it is obviously meant to be there.
  function rowsWithDraft() {
    const title = draftTitle.trim()
    return title ? [...rows, { ...blankRow(rowSeq), title }] : rows
  }

  async function remove() {
    const n = subtasks.length
    const message = n
      ? `Delete "${task.title}" and its ${n} sub-task${n !== 1 ? 's' : ''}?`
      : `Delete "${task.title}"?`
    if (!confirm(message)) return
    const { error } = await supabase.from('tasks').delete().eq('id', task.id)
    if (error) alert(`Could not delete task: ${error.message}`)
    onSaved?.()
    onClose()
  }

  const title = editing
    ? (isSub ? 'Edit Sub-task' : 'Edit Task')
    : (isSub ? 'New Sub-task' : 'New Task')

  const footer = (
    <>
      <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" onClick={save}
        disabled={!form.title.trim() || !form.project_id || saving}>
        {saving ? 'Saving…' : editing ? 'Save Changes' : isSub ? 'Add Sub-task' : 'Add Task'}
      </button>
    </>
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} footer={footer} size={showSubtasks ? 'lg' : ''}>
      {isSub && (
        <div className="task-parent-banner">
          <CornerDownRight size={13} />
          <span>Sub-task of</span>
          {editing && onOpenTask ? (
            <button type="button" className="task-parent-link" onClick={() => openOther(parent)}>
              {parent.title}
            </button>
          ) : (
            <strong>{parent.title}</strong>
          )}
        </div>
      )}

      <div className="form-group">
        <label className="form-label">{isSub ? 'Sub-task Title *' : 'Task Title *'}</label>
        <input className="form-input" autoFocus={!editing}
          placeholder={isSub ? 'e.g. Render the street elevation' : 'e.g. Prepare floor plan drawings'}
          value={form.title} onChange={e => set('title')(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Description</label>
        <textarea className="form-textarea" placeholder="Add details…" style={{ minHeight: 60 }}
          value={form.description} onChange={e => set('description')(e.target.value)} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-select" value={form.status} onChange={e => set('status')(e.target.value)}>
            {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Priority</label>
          <select className="form-select" value={form.priority} onChange={e => set('priority')(e.target.value)}>
            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {!lockProject && !isSub && (
        <div className="form-group">
          <label className="form-label">Project *</label>
          <select className="form-select" value={form.project_id}
            onChange={e => {
              const id = e.target.value
              const next = projects.find(p => p.id === id)
              // A stage only means something inside its own project.
              setForm(f => ({
                ...f, project_id: id,
                stage: next && projectStages(next).includes(f.stage) ? f.stage : '',
              }))
            }}>
            <option value="">Choose a project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {editing && !task.project_id && (
            <div className="form-hint">Every task belongs to a project now — pick one to save this.</div>
          )}
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Assigned to</label>
        <AssigneePicker employees={employees} value={form.assignee_ids} onChange={set('assignee_ids')} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Start Date</label>
          <input className="form-input" type="date" value={form.start_date}
            onChange={e => set('start_date')(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Due Date</label>
          <input className="form-input" type="date" value={form.due_date}
            onChange={e => set('due_date')(e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Stage</label>
        <select className="form-select" value={form.stage} disabled={isSub || !project}
          onChange={e => set('stage')(e.target.value)}>
          <option value="">— Any Stage —</option>
          {stageOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {isSub && <div className="form-hint">A sub-task is always in the same stage as its main task.</div>}
      </div>

      {canRestrict && (
        <div className="form-group">
          <ConfidentialToggle
            noun="task"
            inherited={inheritedRestriction}
            checked={form.is_confidential}
            disabled={saving}
            onChange={set('is_confidential')}
          />
        </div>
      )}

      {showSubtasks && (
        <div className="form-group subtask-editor">
          <label className="form-label">
            Sub-tasks{rows.length > 0 && ` · ${rows.filter(r => r.status === 'Done').length}/${rows.length} done`}
          </label>

          {rows.length > 0 && (
            <div className="subtask-rows">
              {rows.map(row => {
                const saved = row.id && subtasks.find(t => t.id === row.id)
                // A sub-task shared by several people keeps its list; a
                // one-line picker could only ever say one of them.
                const several = row.assignee_ids.length > 1
                return (
                  <div key={row.key} className="subtask-row">
                    <select className="form-select subtask-row-status" value={row.status}
                      aria-label="Status"
                      onChange={e => patchRow(row.key, { status: e.target.value })}>
                      {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                    <input className="form-input subtask-row-title" value={row.title}
                      aria-label="Sub-task title" placeholder="Sub-task title"
                      onChange={e => patchRow(row.key, { title: e.target.value })} />
                    {several && saved ? (
                      <div className="subtask-row-people" title="Open the sub-task to change who is on it">
                        <AvatarStack people={assigneesOf(saved)} size="sm" max={3} />
                      </div>
                    ) : (
                      <select className="form-select subtask-row-person" value={row.assignee_ids[0] || ''}
                        aria-label="Assigned to"
                        onChange={e => patchRow(row.key, { assignee_ids: e.target.value ? [e.target.value] : [] })}>
                        <option value="">Nobody yet</option>
                        {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                      </select>
                    )}
                    <input className="form-input subtask-row-due" type="date" value={row.due_date}
                      aria-label="Due date"
                      onChange={e => patchRow(row.key, { due_date: e.target.value })} />
                    <div className="subtask-row-actions">
                      {saved && onOpenTask && (
                        <button type="button" className="icon-btn" title="Open this sub-task"
                          onClick={() => openOther(saved)}><Pencil size={12} /></button>
                      )}
                      <button type="button" className="icon-btn subtask-row-remove" title="Remove this sub-task"
                        onClick={() => removeRow(row)}><X size={13} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="subtask-add-row">
            <input className="form-input" placeholder="Add a sub-task and press Enter…"
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRow() } }} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={addRow} disabled={!draftTitle.trim()}>
              <Plus size={13} /> Add
            </button>
          </div>
          <div className="form-hint">
            Each sub-task gets its own person, status and due date. Removed sub-tasks
            are deleted when you save.
          </div>
        </div>
      )}

      {editing && canManage && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <button className="btn btn-danger btn-sm" onClick={remove}>
            {isSub ? 'Delete Sub-task' : 'Delete Task'}
          </button>
        </div>
      )}
    </Modal>
  )
}
