import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, CheckSquare, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { AvatarStack } from './Avatar'
import { ConfidentialIcon } from './ConfidentialTag'
import { TaskModal } from './TaskModal'
import { TASK_STATUSES } from '../lib/constants'
import { assigneesOf, isAssignedTo } from '../lib/assignees'
import { folderRestricted } from '../lib/folders'
import { peopleAcross, splitSubtasks } from '../lib/subtasks'
import { DUE_FILTERS, STATUS_COLORS, isLate, matchesDue, useDueFilter } from '../lib/taskFilters'

/* ────────────────────────────────────────────────────────────────
   THE TASK BOARD

   To Do / In Progress / In Review / Done. It used to be its own page
   under "Tasks"; it now lives inside each project — Projects › folder
   › project › this — with the all-projects board kept as the one
   place to see what is late across the practice.

   A main task is one card. Its sub-tasks fold up inside it behind a
   "1/3" count, so a job three people are splitting reads as one job
   with three parts rather than four unrelated cards.
   ──────────────────────────────────────────────────────────────── */

const PRIORITY_COLORS = {
  'Low': 'var(--priority-low)',
  'Medium': 'var(--priority-medium)',
  'High': 'var(--priority-high)',
}

export function TaskBoard({
  tasks,                 // every task on this board, sub-tasks included
  employees = [],
  projects = [],         // a project's own board passes just that project
  folders = [],          // for working out restrictions inherited from a folder
  scopeProject = null,   // set on a project's own board
  canManage = false,
  canRestrict = false,
  onChanged,             // after any write; the page re-reads
}) {
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('All')
  const [filterAssignee, setFilterAssignee] = useState('All')
  const due = useDueFilter()
  // Pressing the button that is already on clears it, so the group
  // needs no separate "any due date" control.
  const toggleDue = (value) => due.setValue(due.value === value ? 'All' : value)

  // Cards opened or closed by hand. Kept apart so a filter can open a
  // card to show the sub-task it matched without overriding a choice.
  const [openIds, setOpenIds] = useState(() => new Set())
  const [closedIds, setClosedIds] = useState(() => new Set())

  // { key, task, defaults } — the task dialog, when open.
  const [dialog, setDialog] = useState(null)
  const dialogSeq = useRef(0)

  const byId = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])
  const { mains, subsOf } = useMemo(() => {
    const split = splitSubtasks(tasks)
    // Newest first, as the board has always been.
    split.mains.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    return split
  }, [tasks])

  /* ── filtering ──
     A main task stays on the board when it matches, or when any of its
     sub-tasks does: filtering to Priya has to show the job she is one
     third of, opened at her part. */
  const needle = search.trim().toLowerCase()
  const filtering = !!needle || filterAssignee !== 'All' || due.value !== 'All'
  const hit = (t) =>
    (!needle || t.title.toLowerCase().includes(needle)) &&
    (filterAssignee === 'All' || isAssignedTo(t, filterAssignee)) &&
    matchesDue(t, due.value)

  const cards = mains
    .filter(m => filterProject === 'All' || m.project_id === filterProject)
    .map(m => {
      const subs = subsOf.get(m.id) || []
      const subHits = filtering ? subs.filter(hit) : []
      return {
        task: m, subs,
        shown: !filtering || hit(m) || subHits.length > 0,
        matched: new Set(subHits.map(s => s.id)),
      }
    })
    .filter(c => c.shown)

  const columns = TASK_STATUSES.map(status => ({
    status,
    cards: cards.filter(c => c.task.status === status),
  }))

  function isOpen(card) {
    if (openIds.has(card.task.id)) return true
    if (closedIds.has(card.task.id)) return false
    return card.matched.size > 0
  }
  function toggleCard(card) {
    const id = card.task.id
    const opening = !isOpen(card)
    setOpenIds(prev => { const n = new Set(prev); opening ? n.add(id) : n.delete(id); return n })
    setClosedIds(prev => { const n = new Set(prev); opening ? n.delete(id) : n.add(id); return n })
  }

  /* ── the dialog ── */
  const nextKey = () => `new-${++dialogSeq.current}`
  const openTask = (task) => setDialog({ key: task.id, task })
  const newTask = (status = 'To Do') => setDialog({
    key: nextKey(), task: null,
    defaults: { status, project_id: scopeProject?.id || (filterProject !== 'All' ? filterProject : '') },
  })
  const newSubtask = (main) => setDialog({
    key: nextKey(), task: null,
    defaults: { parent_task_id: main.id, project_id: main.project_id, siblings: subsOf.get(main.id) || [] },
  })

  const dialogParentId = dialog?.task?.parent_task_id || dialog?.defaults?.parent_task_id || null
  const dialogParent = dialogParentId ? byId.get(dialogParentId) || null : null
  const dialogSubs = dialog?.task && !dialogParent ? subsOf.get(dialog.task.id) || [] : []

  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])
  // Restricted on its own, or by any folder above where it is filed.
  const projectRestricted = (id) => {
    const p = projectById.get(id)
    return !!p && (p.is_confidential || folderRestricted(folders, p.folder_id))
  }

  const colStatusStyle = (status) => ({
    width: 10, height: 10, flexShrink: 0,
    background: STATUS_COLORS[status]?.color || 'var(--border-medium)',
  })

  const noOtherFilters = !needle && filterProject === 'All' && filterAssignee === 'All'

  return (
    <>
      <div className="filter-bar">
        <div className="search-bar">
          <Search />
          <input className="form-input" placeholder="Search tasks…" value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
        {!scopeProject && (
          <select className="form-select form-select-sm" value={filterProject}
            onChange={e => setFilterProject(e.target.value)}>
            <option value="All">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select className="form-select form-select-sm" value={filterAssignee}
          onChange={e => setFilterAssignee(e.target.value)}>
          <option value="All">All Assignees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <div className="due-filter-group">
          {DUE_FILTERS.map(d => (
            <button key={d.value} type="button"
              className={`due-filter-btn${due.value === d.value ? ' active' : ''}`}
              aria-pressed={due.value === d.value}
              onClick={() => toggleDue(d.value)}>
              {d.label}
            </button>
          ))}
        </div>
        {canManage && (
          <button className="btn btn-primary btn-sm task-board-add" onClick={() => newTask()}>
            <Plus size={13} /> Add Task
          </button>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"><CheckSquare /></div>
            <div className="empty-state-title">No tasks yet</div>
            <div className="empty-state-desc">
              {scopeProject ? "Add tasks to track this project's deliverables" : 'Add tasks and assign them to team members'}
            </div>
            {canManage && <button className="btn btn-primary" onClick={() => newTask()}><Plus size={15} /> Add Task</button>}
          </div>
        </div>
      ) : due.active && cards.length === 0 && noOtherFilters ? (
        /* Arriving from the dashboard with nothing to see should say so,
           not leave four empty columns to read as a loading failure. */
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"><CheckSquare /></div>
            <div className="empty-state-title">{due.active.empty.title}</div>
            <div className="empty-state-desc">{due.active.empty.desc}</div>
            <button className="btn btn-secondary" onClick={() => due.setValue('All')}>Show all tasks</button>
          </div>
        </div>
      ) : (
        <div className="kanban-board">
          {columns.map(({ status, cards: colCards }) => (
            <div key={status} className="kanban-column">
              <div className="kanban-col-header">
                <div className="kanban-col-title">
                  <div style={colStatusStyle(status)} />
                  {status}
                </div>
                <span className="kanban-col-count">{colCards.length}</span>
              </div>
              {colCards.map(card => (
                <TaskCard
                  key={card.task.id}
                  card={card}
                  open={isOpen(card)}
                  showProject={!scopeProject}
                  canManage={canManage}
                  onToggle={() => toggleCard(card)}
                  onOpen={openTask}
                  onAddSubtask={newSubtask}
                />
              ))}
              {canManage && (
                <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 'var(--space-2)' }}
                  onClick={() => newTask(status)}>
                  <Plus size={13} /> Add
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <TaskModal
          key={dialog.key}
          task={dialog.task}
          defaults={dialog.defaults}
          parent={dialogParent}
          subtasks={dialogSubs}
          projects={projects}
          lockProject={!!scopeProject}
          employees={employees}
          canManage={canManage}
          canRestrict={canRestrict}
          projectRestricted={projectRestricted}
          onClose={() => setDialog(null)}
          onSaved={onChanged}
          onOpenTask={openTask}
        />
      )}
    </>
  )
}

/* One card: a main task, with its sub-tasks folded inside. */
function TaskCard({ card, open, showProject, canManage, onToggle, onOpen, onAddSubtask }) {
  const { task, subs, matched } = card
  const done = subs.filter(s => s.status === 'Done').length
  const pct = subs.length ? Math.round((done / subs.length) * 100) : 0
  const late = isLate(task)

  return (
    <div className="kanban-task-card" onClick={() => canManage && onOpen(task)}
      style={{ cursor: canManage ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <div className="kanban-task-title">
          {task.title}
          {task.is_confidential && <> <ConfidentialIcon size={11} /></>}
        </div>
        <div style={{ width: 8, height: 8, background: PRIORITY_COLORS[task.priority], flexShrink: 0, marginTop: 4 }} title={task.priority + ' priority'} />
      </div>
      {task.description && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
          {task.description.slice(0, 80)}{task.description.length > 80 ? '…' : ''}
        </div>
      )}

      {subs.length > 0 && (
        <div className="subtask-strip" onClick={e => e.stopPropagation()}>
          <button type="button" className="subtask-toggle" aria-expanded={open} onClick={onToggle}>
            <ChevronRight size={12} className={`subtask-chevron${open ? ' open' : ''}`} />
            <span>Sub-tasks</span>
            <span className="subtask-count">{done}/{subs.length}</span>
            <span className="subtask-progress"><span style={{ width: `${pct}%` }} /></span>
          </button>
          {open && (
            <div className="subtask-list">
              {subs.map(s => {
                const sLate = isLate(s)
                const body = (
                  <>
                    <span className="subtask-dot" title={s.status}
                      style={{ background: STATUS_COLORS[s.status]?.color || 'var(--border-medium)' }} />
                    <span className={`subtask-title${s.status === 'Done' ? ' done' : ''}`}>{s.title}</span>
                    {s.is_confidential && <ConfidentialIcon size={10} />}
                    {s.due_date && (
                      <span className={`subtask-due${sLate ? ' late' : ''}`}>{format(new Date(s.due_date), 'd MMM')}</span>
                    )}
                    <AvatarStack people={assigneesOf(s)} size="sm" max={2} />
                  </>
                )
                const cls = `subtask-item${matched.has(s.id) ? ' is-match' : ''}`
                return canManage ? (
                  <button key={s.id} type="button" className={cls} title={`${s.title} · ${s.status}`}
                    onClick={() => onOpen(s)}>{body}</button>
                ) : (
                  <div key={s.id} className={cls} title={`${s.title} · ${s.status}`}>{body}</div>
                )
              })}
              {canManage && (
                <button type="button" className="subtask-add" onClick={() => onAddSubtask(task)}>
                  <Plus size={12} /> Add sub-task
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="kanban-task-meta">
        {/* On the all-projects board, the way into the job itself. */}
        {showProject && task.project && (
          <Link to={`/projects/${task.project.id}`} className="kanban-task-project"
            title={`Open ${task.project.name}`} onClick={e => e.stopPropagation()}>
            {task.project.name}
          </Link>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginLeft: 'auto' }}>
          {task.due_date && (
            <span style={{ fontSize: 'var(--text-xs)', color: late ? 'var(--danger)' : 'var(--text-muted)', fontWeight: late ? 600 : 400 }}>
              {format(new Date(task.due_date), 'd MMM')}
            </span>
          )}
          {/* Everyone doing the job, sub-tasks included. */}
          <AvatarStack people={peopleAcross(task, subs)} size="sm" max={3} />
        </div>
      </div>
    </div>
  )
}
