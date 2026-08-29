import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { RefreshButton } from '../components/RefreshButton'
import { Avatar } from '../components/Avatar'
import { ConfidentialIcon } from '../components/ConfidentialTag'
import { Modal } from '../components/Modal'
import { TaskNotesPanel } from '../components/TaskNotesPanel'
import {
  Users, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, AlertCircle, X,
  GripVertical, ChevronDown, Search,
} from 'lucide-react'
import {
  addDays, addWeeks, differenceInDays, format, isToday, isWeekend,
  startOfWeek, subWeeks,
} from 'date-fns'
import { TASK_STATUSES, PRIORITIES } from '../lib/constants'
import {
  SCALES, buildColumns, buildMonthGroups, clamp, dateToCol, dateToX, durationDays,
  isOverdue, linkStatusAndProgress, markedColumns, pxToDays, rgba, safeDate,
  slipGeom, toISO, useCompact, xToCol,
} from '../lib/gantt'
import { fetchNoteMarks } from '../lib/notes'
import { AssigneePicker } from '../components/AssigneePicker'
import {
  ASSIGNEES_SELECT, assigneeIdsOf, assigneesOf, setTaskAssignees,
} from '../lib/assignees'

/* ────────────────────────────────────────────────────────────────
   TEAM SCHEDULE

   Who is working on what, and when it is due — the same bars as the
   project timeline, but stacked by person instead of by stage, and
   showing a rolling window rather than one job end to end. This is
   the view for spotting that someone has four things landing in the
   same week, across every project at once.
   ──────────────────────────────────────────────────────────────── */

const ROW_H = { member: 46, task: 40, empty: 36 }
const HEAD_MONTH_H = 24
const HEAD_COL_H = 36
const HEAD_H = HEAD_MONTH_H + HEAD_COL_H

const FULL_COLS = [
  { key: 'task',    w: 252, label: 'Team Member / Task' },
  { key: 'project', w: 150, label: 'Project' },
  { key: 'due',     w: 104, label: 'Due' },
]
const COMPACT_COLS = [
  { key: 'task', w: 214, label: 'Task' },
]

const STATUS_COLORS = {
  'To Do':       '#9CA3AF',
  'In Progress': '#0041C2',
  'In Review':   '#6B5CA5',
  'Done':        '#0F7B55',
}

const UNASSIGNED = '__unassigned__'

export function GanttTeam() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('manage_tasks')

  const compact = useCompact()
  const cols = compact ? COMPACT_COLS : FULL_COLS
  const labelW = cols.reduce((sum, c) => sum + c.w, 0)

  const [employees, setEmployees] = useState([])
  const [projects,  setProjects]  = useState([])
  const [tasks,     setTasks]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')

  const [search,        setSearch]        = useState('')
  const [filterProject, setFilterProject] = useState('all')
  const [filterStatus,  setFilterStatus]  = useState('open')
  const [collapsed,     setCollapsed]     = useState(() => new Set())

  const [scaleKey, setScaleKey] = useState('day')
  const [cellW,    setCellW]    = useState(SCALES.day.defaultW)
  const scale = SCALES[scaleKey]
  const unitDays = scale.unitDays
  const windowWeeks = scaleKey === 'day' ? 8 : 26

  /* Open a week in the past, not on today. The first thing this view
     is asked is "what is late", and anything overdue sits to the left
     of today — starting the window there would hide it. */
  const [rangeStart, setRangeStart] = useState(
    () => subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1)
  )
  const [editRow,    setEditRow]    = useState(null)
  const [saving,     setSaving]     = useState(false)
  const [draggingId, setDraggingId] = useState(null)

  /* The square whose notes are open. Held as dates, not as a column
     index — this view pages through time, and the panel must keep
     pointing at the day it was opened on. */
  const [noteCell,  setNoteCell]  = useState(null)   // { taskId, start, end }
  const [noteMarks, setNoteMarks] = useState(new Map()) // task id → Set of ISO days

  function changeScale(key) {
    setScaleKey(key)
    setCellW(SCALES[key].defaultW)
  }

  const dragRef  = useRef(null)
  const cellWRef = useRef(cellW)
  const unitRef  = useRef(unitDays)
  useEffect(() => { cellWRef.current = cellW },    [cellW])
  useEffect(() => { unitRef.current  = unitDays }, [unitDays])
  const [dragTip, setDragTip] = useState(null)
  // Letting go of a bar must not also open the notes for the square the
  // mouse finished over.
  const swallowClickRef = useRef(false)

  const scrollRef = useRef(null)

  /* ── data ── */
  async function fetchAll() {
    setLoading(true)
    const [e, p, t] = await Promise.all([
      supabase.from('employees').select('*').order('name'),
      supabase.from('projects').select('id,name,color').order('name'),
      supabase.from('tasks')
        .select(`*, assignee:employees(id,name,color,avatar_url), project:projects(id,name,color), ${ASSIGNEES_SELECT}`)
        .order('due_date', { nullsFirst: false }),
    ])
    setEmployees(e.data || [])
    setProjects(p.data || [])
    setTasks(t.data || [])
    setLoading(false)

    // Which squares carry a note. No id list: this view spans every
    // project at once, and RLS already limits what comes back.
    const { marks } = await fetchNoteMarks()
    setNoteMarks(marks)
  }

  useEffect(() => { fetchAll() }, [])

  /* ── filtering & grouping ── */
  const visibleTasks = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return tasks.filter(t => {
      if (filterProject !== 'all' && t.project_id !== filterProject) return false
      if (filterStatus === 'open' && t.status === 'Done') return false
      if (filterStatus !== 'open' && filterStatus !== 'all' && t.status !== filterStatus) return false
      if (needle && !t.title.toLowerCase().includes(needle)) return false
      return true
    })
  }, [tasks, filterProject, filterStatus, search])

  const groups = useMemo(() => {
    /* A shared task is listed under everybody on it, deliberately. The
       question this view answers is "what is on Priya's plate this
       fortnight", and a job she is half of is still on it. The row
       carries the same task object either way, so editing from one
       block updates both. */
    const byPerson = new Map()
    visibleTasks.forEach(t => {
      const keys = assigneeIdsOf(t)
      ;(keys.length ? keys : [UNASSIGNED]).forEach(key => {
        if (!byPerson.has(key)) byPerson.set(key, [])
        byPerson.get(key).push(t)
      })
    })

    const sortTasks = list => [...list].sort((a, b) => {
      const ad = safeDate(a.start_date) || safeDate(a.due_date)
      const bd = safeDate(b.start_date) || safeDate(b.due_date)
      if (ad && bd) return ad - bd
      if (ad) return -1
      if (bd) return 1
      return a.title.localeCompare(b.title)
    })

    const out = employees
      .filter(emp => byPerson.has(emp.id))
      .map(emp => ({ key: emp.id, employee: emp, tasks: sortTasks(byPerson.get(emp.id)) }))

    if (byPerson.has(UNASSIGNED)) {
      out.push({ key: UNASSIGNED, employee: null, tasks: sortTasks(byPerson.get(UNASSIGNED)) })
    }
    return out
  }, [visibleTasks, employees])

  const rows = useMemo(() => {
    const list = []
    groups.forEach(group => {
      list.push({ type: 'member', id: `m-${group.key}`, group })
      if (collapsed.has(group.key)) return
      // Keyed by person as well as task: one shared line is two rows.
      group.tasks.forEach(task => list.push({
        type: 'task', id: `${group.key}:${task.id}`, task, group,
      }))
    })
    return list
  }, [groups, collapsed])

  /* ── the visible window ── */
  const range = useMemo(() => ({
    start: rangeStart,
    end: addDays(rangeStart, windowWeeks * 7 - 1),
  }), [rangeStart, windowWeeks])

  const columns     = useMemo(() => buildColumns(range.start, range.end, unitDays), [range, unitDays])
  const monthGroups = useMemo(() => buildMonthGroups(columns), [columns])
  const totalW      = columns.length * cellW
  const todayX      = dateToX(new Date(), range.start, cellW, unitDays) + (cellW / unitDays) / 2
  const todayInView = todayX >= 0 && todayX <= totalW

  function toggleGroup(key) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  /* ── writes ── */
  async function patchTask(id, patch) {
    const current = tasks.find(t => t.id === id)
    const full = linkStatusAndProgress(patch, current)
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...full } : t)))
    const { error: err } = await supabase.from('tasks')
      .update({ ...full, updated_at: new Date().toISOString() }).eq('id', id)
    if (err) { setError(err.message); fetchAll() }
  }

  async function saveDialog() {
    if (!editRow) return
    setSaving(true)
    // Reassigning has to refetch: the row moves to another person's
    // block — or into two of them — and nothing local can work that out
    // from a patch.
    const reassigned =
      editRow.assignee_ids.join() !== (editRow._originalAssignees || []).join()
    if (reassigned) {
      const { error: err } = await setTaskAssignees(editRow.id, editRow.assignee_ids)
      if (err) setError(err.message)
    }
    await patchTask(editRow.id, {
      title: editRow.title,
      description: editRow.description || '',
      start_date: editRow.start_date || null,
      due_date: editRow.due_date || null,
      status: editRow.status,
      priority: editRow.priority,
      progress: clamp(Number(editRow.progress) || 0, 0, 100),
    })
    setSaving(false)
    setEditRow(null)
    if (reassigned) fetchAll()
  }

  function openDialog(task) {
    setEditRow({
      ...task,
      start_date: task.start_date || '',
      due_date: task.due_date || '',
      description: task.description || '',
      assignee_ids: assigneeIdsOf(task),
      progress: task.progress ?? 0,
      _originalAssignees: assigneeIdsOf(task),
    })
  }

  /* ── dragging ── */
  function beginDrag(e, task, mode, origStart, origEnd) {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      id: task.id, mode, startX: e.clientX,
      origStart, origEnd, newStart: origStart, newEnd: origEnd,
    }
    setDraggingId(task.id)
    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize'
    document.body.style.userSelect = 'none'

    const onMove = ev => {
      const d = dragRef.current
      if (!d) return
      const days = pxToDays(ev.clientX - d.startX, cellWRef.current, unitRef.current)
      let s = d.origStart, en = d.origEnd
      if (d.mode === 'move')     { s = addDays(d.origStart, days); en = addDays(d.origEnd, days) }
      if (d.mode === 'resize-l') { s = addDays(d.origStart, days); if (s > d.origEnd) s = d.origEnd }
      if (d.mode === 'resize-r') { en = addDays(d.origEnd, days);  if (en < d.origStart) en = d.origStart }
      d.newStart = s; d.newEnd = en

      setTasks(prev => prev.map(t => (t.id === d.id ? { ...t, _tempStart: s, _tempEnd: en } : t)))
      setDragTip({
        x: ev.clientX, y: ev.clientY,
        text: `${format(s, 'd MMM')} → ${format(en, 'd MMM')} · ${differenceInDays(en, s) + 1}d`,
      })
    }

    const onUp = async () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDragTip(null)
      setDraggingId(null)
      const d = dragRef.current
      dragRef.current = null
      if (!d) return

      const moved = differenceInDays(d.newStart, d.origStart) || differenceInDays(d.newEnd, d.origEnd)
      setTasks(prev => prev.map(t => (t.id === d.id ? { ...t, _tempStart: null, _tempEnd: null } : t)))
      if (!moved) return
      // Cleared on the next tick, by which time the click that trails
      // this mouseup has already been swallowed.
      swallowClickRef.current = true
      setTimeout(() => { swallowClickRef.current = false }, 0)
      await patchTask(d.id, { start_date: toISO(d.newStart), due_date: toISO(d.newEnd) })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* ── notes on a square ──
     Clicking any day of a person's row opens what has been written on
     that day of that task. The column comes from where the click landed
     rather than from a grid of cells — eight weeks of days across forty
     rows would be several thousand divs that exist only to be clicked. */
  function openCell(task, clientX, rowEl) {
    if (swallowClickRef.current) return
    const i = xToCol(clientX - rowEl.getBoundingClientRect().left, cellW)
    const col = columns[i]
    if (!col) return
    setNoteCell({ taskId: task.id, start: col.start, end: col.end })
  }

  function applyNoteDays(taskId, days) {
    setNoteMarks(prev => {
      const next = new Map(prev)
      if (days.length) next.set(taskId, new Set(days))
      else next.delete(taskId)
      return next
    })
  }

  /* A filter, or collapsing the person, can take the open task off
     screen — the panel goes with it rather than sitting there
     describing a row nobody can see. */
  const noteTask = noteCell
    ? rows.find(r => r.type === 'task' && r.task.id === noteCell.taskId)?.task
    : null

  /* A task with only one date still gets a bar — a due date on its own
     is a deadline, and drawing nothing would hide it entirely. */
  function taskGeom(task) {
    const rawStart = task._tempStart || safeDate(task.start_date)
    const rawEnd   = task._tempEnd   || safeDate(task.due_date)
    if (!rawStart && !rawEnd) return null
    const start = rawStart || addDays(rawEnd, -2)
    const end   = rawEnd   || addDays(rawStart, 2)
    const x1 = dateToX(start, range.start, cellW, unitDays)
    const x2 = dateToX(addDays(end, 1), range.start, cellW, unitDays)
    if (x2 <= 0 || x1 >= totalW) return null
    const left = clamp(x1, 0, totalW)
    return {
      x: left,
      w: Math.max(clamp(x2, 0, totalW) - left, 6),
      start, end,
      clippedLeft: x1 < 0,
      clippedRight: x2 > totalW,
      dateless: !rawStart || !rawEnd,
    }
  }

  const rowHeight = row => ROW_H[row.type] || 40

  if (loading) return (
    <div className="page-body">
      <div className="loading-container"><div className="loading-spinner" /><span>Loading schedule…</span></div>
    </div>
  )

  const openCount = visibleTasks.filter(t => t.status !== 'Done').length
  const overdueCount = visibleTasks.filter(t => isOverdue(t)).length

  return (
    <div className="gantt-page">
      {/* ── toolbar ── */}
      <div className="gantt-toolbar">
        <div className="gantt-toolbar-title">
          <Users size={17} />
          <span>Team Schedule</span>
        </div>

        <div className="gantt-search">
          <Search size={13} />
          <input
            className="gantt-search-input"
            placeholder="Find a task…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select className="form-select gantt-filter-select" value={filterProject}
          onChange={e => setFilterProject(e.target.value)}>
          <option value="all">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select className="form-select gantt-filter-select" value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}>
          <option value="open">Open only</option>
          <option value="all">All statuses</option>
          {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="gantt-toolbar-spacer" />

        <span className="gantt-toolbar-stat">
          {openCount} open
          {overdueCount > 0 && <span className="gantt-overdue-pill">{overdueCount} overdue</span>}
        </span>

        <div className="gantt-scale-toggle">
          {Object.values(SCALES).map(s => (
            <button key={s.key}
              className={`gantt-scale-btn${scaleKey === s.key ? ' active' : ''}`}
              onClick={() => changeScale(s.key)}>{s.label}</button>
          ))}
        </div>

        <div className="gantt-zoom">
          <button className="icon-btn" title="Zoom out"
            onClick={() => setCellW(w => clamp(w - 6, scale.min, scale.max))}><ZoomOut size={15} /></button>
          <span className="gantt-zoom-value">{Math.round((cellW / scale.defaultW) * 100)}%</span>
          <button className="icon-btn" title="Zoom in"
            onClick={() => setCellW(w => clamp(w + 6, scale.min, scale.max))}><ZoomIn size={15} /></button>
        </div>

        <div className="gantt-pager">
          <button className="icon-btn" title="Earlier"
            onClick={() => setRangeStart(d => subWeeks(d, Math.max(1, Math.round(windowWeeks / 3))))}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn btn-secondary btn-sm"
            onClick={() => setRangeStart(subWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1))}>Today</button>
          <button className="icon-btn" title="Later"
            onClick={() => setRangeStart(d => addWeeks(d, Math.max(1, Math.round(windowWeeks / 3))))}>
            <ChevronRight size={16} />
          </button>
        </div>

        <RefreshButton onRefresh={fetchAll} />
      </div>

      {error && (
        <div className="gantt-error">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button className="icon-btn" onClick={() => setError('')}><X size={13} /></button>
        </div>
      )}

      {/* ── the chart, with the note panel docked beside it ── */}
      <div className="gantt-body">
        <div className="gantt-scroll" ref={scrollRef}>
          <div className="gantt-canvas" style={{ width: labelW + totalW }}>

            <div className="gantt-frozen" style={{ width: labelW }}>
              <div className="gantt-frozen-head" style={{ height: HEAD_H }}>
                {cols.map(c => (
                  <div key={c.key} className={`gantt-cell gantt-head-cell gantt-cell-${c.key}`} style={{ width: c.w }}>
                    {c.label}
                  </div>
                ))}
              </div>

              {rows.map(row => (
                <TeamLabelRow
                  key={row.id}
                  row={row}
                  cols={cols}
                  height={rowHeight(row)}
                  collapsed={collapsed.has(row.group.key)}
                  onToggle={() => toggleGroup(row.group.key)}
                  onOpen={openDialog}
                  canEdit={canEdit}
                />
              ))}

              {!rows.length && (
                <div className="gantt-row gantt-row-empty" style={{ height: ROW_H.empty, width: labelW }}>
                  <span className="gantt-empty-note">Nothing matches these filters.</span>
                </div>
              )}
            </div>

            <div className="gantt-chart" style={{ width: totalW }}>
              <div className="gantt-chart-head" style={{ height: HEAD_H }}>
                <div className="gantt-month-row" style={{ height: HEAD_MONTH_H }}>
                  {monthGroups.map(m => (
                    <div key={m.key} className="gantt-month-cell" style={{ width: m.span * cellW }}>
                      {m.label} <span className="gantt-month-year">{m.year}</span>
                    </div>
                  ))}
                </div>
                <div className="gantt-col-row" style={{ height: HEAD_COL_H }}>
                  {columns.map((col, i) => {
                    const weekend = unitDays === 1 && isWeekend(col.start)
                    const today = unitDays === 1
                      ? isToday(col.start)
                      : (new Date() >= col.start && new Date() <= addDays(col.end, 1))
                    return (
                      <div key={i}
                        className={`gantt-col-cell${weekend ? ' weekend' : ''}${today ? ' today' : ''}`}
                        style={{ width: cellW }}>
                        {unitDays === 1 ? (
                          <>
                            <span className="gantt-col-dow">{format(col.start, 'EEEEE')}</span>
                            <span className="gantt-col-num">{format(col.start, 'd')}</span>
                          </>
                        ) : (
                          <span className="gantt-col-num">{format(col.start, 'd MMM')}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="gantt-chart-body">
                <div className="gantt-gridlines">
                  {columns.map((col, i) => (
                    <div key={i}
                      className={`gantt-gridline${unitDays === 1 && isWeekend(col.start) ? ' weekend' : ''}`}
                      style={{ left: i * cellW, width: cellW }} />
                  ))}
                </div>
                {todayInView && <div className="gantt-today-line" style={{ left: todayX }} />}

                {rows.map(row => {
                  if (row.type === 'member') {
                    return <div key={row.id} className="gantt-row gantt-row-member" style={{ height: rowHeight(row) }} />
                  }
                  const task = row.task
                  const geo = taskGeom(task)
                  /* Late lines keep growing to today — see slipGeom. */
                  const slip = slipGeom(task, range.start, cellW, unitDays, totalW)
                  const marked = markedColumns(noteMarks.get(task.id), range.start, unitDays, columns.length)
                  const picked = noteCell?.taskId === task.id
                    ? dateToCol(noteCell.start, range.start, unitDays)
                    : -1

                  /* The whole row is the target, bar included — the day
                     under the pointer is worked out from where the
                     click landed. */
                  return (
                    <div
                      key={row.id}
                      className="gantt-row gantt-row-task"
                      style={{ height: rowHeight(row) }}
                      onClick={e => openCell(task, e.clientX, e.currentTarget)}
                    >
                      {picked >= 0 && picked < columns.length && (
                        <div className="gantt-cell-pick" style={{ left: picked * cellW, width: cellW }} />
                      )}

                      {slip && (
                        <div
                          className={`gantt-bar-slip${slip.clippedRight ? ' clip-r' : ''}`}
                          style={{ left: slip.x, width: slip.w, height: rowHeight(row) - 14, top: 7 }}
                          title={`${task.title}
Overdue — ${slip.days} day${slip.days === 1 ? '' : 's'} past ${format(slip.due, 'd MMM yyyy')}`}
                        >
                          {slip.w > 34 && <span className="gantt-slip-label">{slip.days}d late</span>}
                        </div>
                      )}

                      {geo && (
                        <TeamBar
                          task={task}
                          geo={geo}
                          height={rowHeight(row)}
                          dragging={draggingId === task.id}
                          editable={canEdit}
                          onDrag={beginDrag}
                          onOpen={openDialog}
                        />
                      )}

                      {/* A corner fold on any square that has been
                          written on — otherwise a note is only findable
                          by opening every day of the bar. */}
                      {marked.map(col => (
                        <span key={col} className="gantt-note-mark"
                          style={{ left: col * cellW + cellW - 7 }} />
                      ))}
                    </div>
                  )
                })}

                {!rows.length && <div className="gantt-row" style={{ height: ROW_H.empty }} />}
              </div>
            </div>
          </div>
        </div>

        {noteTask && (
          <TaskNotesPanel
            key={noteTask.id}
            task={noteTask}
            cell={noteCell}
            subtitle={noteTask.project?.name}
            onClose={() => setNoteCell(null)}
            onNotesChanged={applyNoteDays}
          />
        )}
      </div>

      {dragTip && (
        <div className="gantt-drag-tip" style={{ left: dragTip.x + 14, top: dragTip.y + 16 }}>
          {dragTip.text}
        </div>
      )}

      <Modal
        isOpen={!!editRow}
        onClose={() => setEditRow(null)}
        title="Edit Task"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setEditRow(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveDialog} disabled={!editRow?.title || saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {editRow && (
          <>
            <div className="form-group">
              <label className="form-label">Task Title *</label>
              <input className="form-input" value={editRow.title}
                onChange={e => setEditRow(r => ({ ...r, title: e.target.value }))} />
            </div>
            {/* Same reasoning as the project timeline's: a title has
                to fit a narrow column and a bar, and everything that
                will not ends up here. */}
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-textarea" placeholder="Add details…"
                style={{ minHeight: 68 }}
                value={editRow.description}
                onChange={e => setEditRow(r => ({ ...r, description: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Assigned to</label>
              <AssigneePicker
                employees={employees}
                value={editRow.assignee_ids}
                onChange={ids => setEditRow(r => ({ ...r, assignee_ids: ids }))}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Date</label>
                <input className="form-input" type="date" value={editRow.start_date}
                  onChange={e => setEditRow(r => ({ ...r, start_date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Due Date</label>
                <input className="form-input" type="date" value={editRow.due_date}
                  onChange={e => setEditRow(r => ({ ...r, due_date: e.target.value }))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-select" value={editRow.status}
                  onChange={e => setEditRow(r => ({ ...r, status: e.target.value }))}>
                  {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Priority</label>
                <select className="form-select" value={editRow.priority}
                  onChange={e => setEditRow(r => ({ ...r, priority: e.target.value }))}>
                  {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Progress (%)</label>
              <input className="form-input" type="number" min="0" max="100" step="5"
                value={editRow.progress}
                onChange={e => setEditRow(r => ({ ...r, progress: e.target.value }))} />
            </div>
            <div className="gantt-dialog-hint">
              {durationDays(editRow.start_date, editRow.due_date)
                ? `${durationDays(editRow.start_date, editRow.due_date)} days on the schedule.`
                : 'Give it both dates to draw a bar on the schedule.'}
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

/* ─────────────────── frozen-column rows ─────────────────── */
function TeamLabelRow({ row, cols, height, collapsed, onToggle, onOpen, canEdit }) {
  const width = key => cols.find(c => c.key === key)?.w
  const has = key => cols.some(c => c.key === key)
  const total = cols.reduce((s, c) => s + c.w, 0)

  if (row.type === 'member') {
    const { employee, tasks } = row.group
    const overdue = tasks.filter(t => isOverdue(t)).length
    const open = tasks.filter(t => t.status !== 'Done').length

    return (
      <div className="gantt-row gantt-row-member" style={{ height, width: total }}>
        <button className="gantt-member-toggle" onClick={onToggle}
          title={collapsed ? 'Show tasks' : 'Hide tasks'}>
          <ChevronDown size={13} style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }} />
        </button>

        {employee ? (
          <Avatar name={employee.name} src={employee.avatar_url} color={employee.color} size="sm" />
        ) : (
          <span className="gantt-member-avatar-blank">?</span>
        )}

        <div className="gantt-member-text">
          <span className="gantt-member-name">{employee ? employee.name : 'Unassigned'}</span>
          {employee?.role && <span className="gantt-member-role">{employee.role}</span>}
        </div>

        <span className="gantt-member-count">{open}</span>
        {overdue > 0 && <span className="gantt-overdue-pill">{overdue}</span>}
      </div>
    )
  }

  const task = row.task
  const due = safeDate(task.due_date)
  const overdue = isOverdue(task)
  const pct = clamp(Number(task.progress) || 0, 0, 100)

  return (
    <div className="gantt-row gantt-row-task" style={{ height }}
      onDoubleClick={() => canEdit && onOpen(task)}>
      <div className="gantt-cell gantt-cell-task" style={{ width: width('task') }}>
        <span className="gantt-status-dot" style={{ background: STATUS_COLORS[task.status] || '#9CA3AF' }}
          title={task.status} />
        <span className={`gantt-team-title${task.status === 'Done' ? ' done' : ''}`}>{task.title}</span>
        {task.is_confidential && <ConfidentialIcon size={11} />}
        {pct > 0 && pct < 100 && <span className="gantt-team-pct">{pct}%</span>}
      </div>

      {has('project') && (
        <div className="gantt-cell gantt-cell-project" style={{ width: width('project') }}>
          {task.project ? (
            <>
              <span className="gantt-project-swatch" style={{ background: task.project.color }} />
              <span className="gantt-project-name">{task.project.name}</span>
            </>
          ) : <span className="gantt-muted">No project</span>}
        </div>
      )}

      {has('due') && (
        <div className="gantt-cell gantt-cell-due" style={{ width: width('due') }}>
          <span className={overdue ? 'gantt-due-overdue' : 'gantt-due'}>
            {due ? format(due, 'd MMM yy') : '—'}
          </span>
        </div>
      )}
    </div>
  )
}

function TeamBar({ task, geo, height, dragging, editable, onDrag, onOpen }) {
  const [hover, setHover] = useState(false)
  const color = task.project?.color || '#4B5563'
  const pct = clamp(Number(task.progress) || 0, 0, 100)
  const done = task.status === 'Done' || pct >= 100
  const overdue = isOverdue(task)
  const showLabel = geo.w > 70

  return (
    <div
      className={[
        'gantt-bar',
        dragging && 'dragging',
        hover && 'hover',
        done && 'done',
        overdue && 'overdue',
        geo.clippedLeft && 'clip-l',
        geo.clippedRight && 'clip-r',
        geo.dateless && 'dateless',
      ].filter(Boolean).join(' ')}
      style={{
        left: geo.x, width: geo.w, height: height - 14, top: 7,
        background: rgba(done ? '#0F7B55' : color, 0.16),
        borderColor: overdue ? 'var(--danger)' : rgba(done ? '#0F7B55' : color, 0.6),
        cursor: editable ? (dragging ? 'grabbing' : 'grab') : 'default',
      }}
      title={[
        task.title,
        task.project ? `Project: ${task.project.name}` : null,
        assigneesOf(task).length
          ? `Assigned to ${assigneesOf(task).map(p => p.name).join(', ')}`
          : 'Unassigned',
        `${format(geo.start, 'd MMM yyyy')} → ${format(geo.end, 'd MMM yyyy')}`,
        `${pct}% · ${task.status} · ${task.priority} priority`,
        geo.dateless ? 'Only one date set — drag to give it a span' : null,
      ].filter(Boolean).join('\n')}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={e => editable && onDrag(e, task, 'move', geo.start, geo.end)}
      onDoubleClick={() => onOpen(task)}
    >
      <div className="gantt-bar-fill"
        style={{ width: `${pct}%`, background: rgba(done ? '#0F7B55' : color, 0.55) }} />

      {editable && !geo.clippedLeft && (
        <span className="gantt-bar-handle left"
          onMouseDown={e => onDrag(e, task, 'resize-l', geo.start, geo.end)}>
          <GripVertical size={11} />
        </span>
      )}

      {showLabel && <span className="gantt-bar-label">{task.title}</span>}

      {geo.w > 110 && <BarFaces people={assigneesOf(task)} />}

      {editable && !geo.clippedRight && (
        <span className="gantt-bar-handle right"
          onMouseDown={e => onDrag(e, task, 'resize-r', geo.start, geo.end)}>
          <GripVertical size={11} />
        </span>
      )}
    </div>
  )
}

/* The faces on a bar — two, then a count. Same reasoning as the
   project timeline's: the title has to survive. */
function BarFaces({ people }) {
  if (!people.length) return null
  const shown = people.slice(0, 2)
  const extra = people.length - shown.length
  return (
    <span className="gantt-bar-faces" title={people.map(p => p.name).join(', ')}>
      {shown.map(p => (
        <span key={p.id} className="gantt-bar-avatar" style={{ background: p.color }}>
          {p.name.charAt(0)}
        </span>
      ))}
      {extra > 0 && <span className="gantt-bar-avatar more">+{extra}</span>}
    </span>
  )
}
