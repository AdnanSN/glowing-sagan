import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { RefreshButton } from '../components/RefreshButton'
import { ConfidentialIcon } from '../components/ConfidentialTag'
import { Modal } from '../components/Modal'
import { TaskNotesPanel } from '../components/TaskNotesPanel'
import {
  GanttChart, Plus, Trash2, ZoomIn, ZoomOut, CalendarClock,
  AlertCircle, X, Check, GripVertical,
} from 'lucide-react'
import { addDays, differenceInDays, format, isToday, isWeekend } from 'date-fns'
import { projectStages, STAGE_COLORS, TASK_STATUSES, PRIORITIES } from '../lib/constants'
import {
  SCALES, buildColumns, buildMonthGroups, byPosition, clamp, dateToCol, dateToX,
  durationDays, linkStatusAndProgress, markedColumns, padToWeeks, pxToDays, rgba,
  isOverdue, rollUp, safeDate, slipGeom, toISO, useCompact, xToCol,
} from '../lib/gantt'
import { fetchNoteMarks } from '../lib/notes'

/* ────────────────────────────────────────────────────────────────
   PROJECT TIMELINE

   One project, laid out the way the practice's timeline spreadsheet
   is: every stage of the job numbered down the left, its line items
   under it, and a bar per line running across a calendar that spans
   the whole project rather than a scrolling window. The chart is
   drawn once at the start of a job and edited in place from there,
   so nothing here pages through time — the deadline is on screen
   from day one.
   ──────────────────────────────────────────────────────────────── */

const ROW_H = { stage: 36, task: 40, adder: 34, section: 36, milestone: 38 }
const HEAD_MONTH_H = 24
const HEAD_COL_H = 36
const HEAD_H = HEAD_MONTH_H + HEAD_COL_H

// Frozen columns down the left. `compact` keeps the chart usable on a
// laptop-width screen; the dates it drops are still editable from the
// row dialog.
const FULL_COLS = [
  { key: 'num',   w: 52,  label: 'No.'        },
  { key: 'title', w: 216, label: 'Task Title' },
  { key: 'start', w: 108, label: 'Start Date' },
  { key: 'due',   w: 108, label: 'Due Date'   },
  { key: 'dur',   w: 62,  label: 'Days'       },
  { key: 'prog',  w: 76,  label: 'Progress'   },
]
const COMPACT_COLS = [
  { key: 'num',   w: 40,  label: 'No.'        },
  { key: 'title', w: 178, label: 'Task Title' },
  { key: 'prog',  w: 64,  label: '%'          },
]

const MILESTONE_KEY = '__milestones__'

export function GanttProject() {
  const { hasPermission } = useAuth()
  const canEditTasks      = hasPermission('manage_tasks')
  const canEditProject    = hasPermission('manage_projects')
  const canEditMilestones = hasPermission('manage_milestones')

  const compact = useCompact()
  const cols    = compact ? COMPACT_COLS : FULL_COLS
  const labelW  = cols.reduce((sum, c) => sum + c.w, 0)

  const [projects,   setProjects]   = useState([])
  const [employees,  setEmployees]  = useState([])
  const [chosenId,   setChosenId]   = useState(() => localStorage.getItem('nhn.timeline.project') || '')
  const [tasks,      setTasks]      = useState([])
  const [milestones, setMilestones] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [loadingRows, setLoadingRows] = useState(false)
  const [error,      setError]      = useState('')

  const [scaleKey, setScaleKey] = useState('week')
  const [cellW,    setCellW]    = useState(SCALES.week.defaultW)
  const scale = SCALES[scaleKey]
  const unitDays = scale.unitDays

  const [editRow,    setEditRow]    = useState(null)  // line open in the dialog
  const [saving,     setSaving]     = useState(false)
  const [focusId,    setFocusId]    = useState(null)  // newly added line, to select its title
  const [draggingId, setDraggingId] = useState(null)

  /* The square whose notes are open, held as dates rather than as a
     column index so that zooming or switching scale does not point the
     panel at a different week. */
  const [noteCell,  setNoteCell]  = useState(null)   // { taskId, start, end }
  const [noteMarks, setNoteMarks] = useState(new Map()) // task id → Set of ISO days

  function changeScale(key) {
    setScaleKey(key)
    setCellW(SCALES[key].defaultW)
  }

  /* Live handlers read these rather than state, so a drag in flight
     always sees the current zoom instead of the value it closed over. */
  const dragRef  = useRef(null)
  const cellWRef = useRef(cellW)
  const unitRef  = useRef(unitDays)
  // A drag ends in a click on the row underneath. Without this, letting
  // go of a bar would also open the notes for whatever square the mouse
  // happened to land on.
  const swallowClickRef = useRef(false)
  useEffect(() => { cellWRef.current = cellW },    [cellW])
  useEffect(() => { unitRef.current  = unitDays }, [unitDays])

  const [dragTip, setDragTip] = useState(null)
  const scrollRef  = useRef(null)
  const centredRef = useRef(false)

  /* The remembered project may have been deleted, or the list may not
     have arrived yet — derive the one actually on screen rather than
     writing a corrected id back into state. */
  const project = projects.find(p => p.id === chosenId) || projects[0] || null
  const projectId = project?.id || ''

  function selectProject(id) {
    setChosenId(id)
    localStorage.setItem('nhn.timeline.project', id)
  }

  /* ── data ── */
  async function fetchProjects() {
    const { data, error: err } = await supabase.from('projects').select('*').order('name')
    if (err) setError(err.message)
    setProjects(data || [])
    setLoading(false)
  }

  async function fetchEmployees() {
    const { data } = await supabase.from('employees')
      .select('id,name,role,color,avatar_url').order('name')
    setEmployees(data || [])
  }

  async function fetchRows(id) {
    if (!id) { setTasks([]); setMilestones([]); return }
    setLoadingRows(true)
    const [t, m] = await Promise.all([
      supabase.from('tasks')
        .select('*, assignee:employees(id,name,color,avatar_url)')
        .eq('project_id', id).order('created_at'),
      supabase.from('milestones').select('*').eq('project_id', id).order('due_date'),
    ])
    setTasks(t.data || [])
    setMilestones(m.data || [])
    setLoadingRows(false)

    // Which squares to put a marker on. One query for the project, and
    // only the two columns needed to place a corner triangle.
    const { marks } = await fetchNoteMarks((t.data || []).map(row => row.id))
    setNoteMarks(marks)
  }

  useEffect(() => { fetchProjects(); fetchEmployees() }, [])

  useEffect(() => {
    if (!projectId) return
    centredRef.current = false
    fetchRows(projectId)
  }, [projectId])

  /* ── rows ── */
  const stages = useMemo(() => projectStages(project), [project])

  const groups = useMemo(() => {
    const sorted = [...tasks].sort(byPosition)
    const buckets = new Map(stages.map(s => [s, []]))
    const loose = []
    sorted.forEach(t => {
      const bucket = t.stage && buckets.has(t.stage) ? buckets.get(t.stage) : loose
      bucket.push(t)
    })
    const out = stages.map((name, i) => ({
      key: name, name, label: name, index: i + 1,
      color: STAGE_COLORS[i % STAGE_COLORS.length],
      tasks: buckets.get(name),
    }))
    // Lines whose stage was renamed away, or that were never given one.
    if (loose.length) {
      out.push({
        key: '__loose__', name: null, label: 'Not in a stage',
        index: stages.length + 1, color: '#9CA3AF', tasks: loose,
      })
    }
    return out
  }, [tasks, stages])

  const rows = useMemo(() => {
    const list = []
    groups.forEach(group => {
      list.push({ type: 'stage', id: `stage-${group.key}`, group })
      group.tasks.forEach((task, i) => {
        list.push({ type: 'task', id: task.id, task, group, number: `${group.index}.${i + 1}` })
      })
      if (canEditTasks && group.name) {
        list.push({ type: 'adder', id: `add-${group.key}`, group })
      }
    })
    if (milestones.length || canEditMilestones) {
      list.push({ type: 'section', id: MILESTONE_KEY, label: 'Milestones' })
      milestones.forEach(ms => list.push({ type: 'milestone', id: `ms-${ms.id}`, milestone: ms }))
      if (canEditMilestones) list.push({ type: 'adder', id: 'add-milestone', milestone: true })
    }
    return list
  }, [groups, milestones, canEditTasks, canEditMilestones])

  /* ── the span the chart covers ──
     Committed dates only. A bar being dragged writes to _tempStart /
     _tempEnd, so the calendar underneath it never shifts mid-drag. */
  const range = useMemo(() => {
    const dates = []
    const push = v => { const d = safeDate(v); if (d) dates.push(d) }
    push(project?.start_date); push(project?.end_date)
    tasks.forEach(t => { push(t.start_date); push(t.due_date) })
    milestones.forEach(m => push(m.due_date))
    /* A chart that stops before today would clip the overdue tails off
       at the edge, right where the whole point of them starts. */
    if (tasks.some(t => isOverdue(t))) dates.push(new Date())

    if (!dates.length) {
      const today = new Date()
      return padToWeeks(today, addDays(today, 12 * 7), 0)
    }
    const min = new Date(Math.min(...dates))
    const max = new Date(Math.max(...dates))
    // A one-week job would otherwise render as a single column.
    const end = differenceInDays(max, min) < 21 ? addDays(min, 21) : max
    return padToWeeks(min, end)
  }, [project?.start_date, project?.end_date, tasks, milestones])

  const columns     = useMemo(() => buildColumns(range.start, range.end, unitDays), [range, unitDays])
  const monthGroups = useMemo(() => buildMonthGroups(columns), [columns])
  const totalW      = columns.length * cellW
  const todayX      = dateToX(new Date(), range.start, cellW, unitDays) + (cellW / unitDays) / 2
  const todayInView = todayX >= 0 && todayX <= totalW

  /* Open on today rather than on the far past of a long job. */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || centredRef.current || loadingRows || !rows.length) return
    if (todayInView) el.scrollLeft = Math.max(0, todayX - el.clientWidth / 3)
    centredRef.current = true
  }, [todayX, todayInView, loadingRows, rows.length])

  function scrollToToday() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: Math.max(0, todayX - el.clientWidth / 3), behavior: 'smooth' })
  }

  /* ── writes ── */
  async function patchTask(id, patch) {
    const current = tasks.find(t => t.id === id)
    const full = linkStatusAndProgress(patch, current)

    // `assignee` is the joined row the bar draws its face from; the
    // column that actually moves is assignee_id. Resolve the join here
    // so the avatar changes with the save rather than on the next load
    // — and keep it out of the payload, since it is not a column.
    const local = 'assignee_id' in full
      ? { ...full, assignee: employees.find(e => e.id === full.assignee_id) || null }
      : full

    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...local } : t)))
    const { error: err } = await supabase.from('tasks')
      .update({ ...full, updated_at: new Date().toISOString() }).eq('id', id)
    if (err) { setError(err.message); fetchRows(projectId) }
  }

  async function addTask(group) {
    const position = group.tasks.reduce((max, t) => Math.max(max, t.position || 0), 0) + 1
    const roll = rollUp(group.tasks)
    // Start where the stage left off, so a new line lands somewhere
    // sensible on the chart instead of having no bar at all.
    const start = roll.end ? addDays(roll.end, 1) : (safeDate(project?.start_date) || new Date())
    const { data, error: err } = await supabase.from('tasks').insert({
      project_id: projectId,
      title: 'New line item',
      stage: group.name,
      position,
      status: 'To Do',
      priority: 'Medium',
      progress: 0,
      start_date: toISO(start),
      due_date: toISO(addDays(start, 4)),
    }).select('*, assignee:employees(id,name,color,avatar_url)').single()

    if (err) { setError(err.message); return }
    setTasks(prev => [...prev, data])
    setFocusId(data.id)
  }

  async function deleteTask(task) {
    if (!confirm(`Delete "${task.title}" from the timeline?`)) return
    setTasks(prev => prev.filter(t => t.id !== task.id))
    if (noteCell?.taskId === task.id) setNoteCell(null)
    const { error: err } = await supabase.from('tasks').delete().eq('id', task.id)
    if (err) { setError(err.message); fetchRows(projectId) }
  }

  async function patchProject(patch) {
    setProjects(prev => prev.map(p => (p.id === projectId ? { ...p, ...patch } : p)))
    const { error: err } = await supabase.from('projects')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', projectId)
    if (err) { setError(err.message); fetchProjects() }
  }

  async function patchMilestone(id, patch) {
    setMilestones(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)))
    const { error: err } = await supabase.from('milestones').update(patch).eq('id', id)
    if (err) { setError(err.message); fetchRows(projectId) }
  }

  async function addMilestone() {
    const base = safeDate(project?.end_date) || new Date()
    const { data, error: err } = await supabase.from('milestones').insert({
      project_id: projectId, title: 'New milestone', due_date: toISO(base), is_completed: false,
    }).select().single()
    if (err) { setError(err.message); return }
    setMilestones(prev => [...prev, data])
    setFocusId(data.id)
  }

  async function deleteMilestone(ms) {
    if (!confirm(`Delete milestone "${ms.title}"?`)) return
    setMilestones(prev => prev.filter(m => m.id !== ms.id))
    const { error: err } = await supabase.from('milestones').delete().eq('id', ms.id)
    if (err) { setError(err.message); fetchRows(projectId) }
  }

  function openRow(task) {
    setEditRow({
      ...task,
      assignee_id: task.assignee_id || '',
      start_date: task.start_date || '',
      due_date: task.due_date || '',
      progress: task.progress ?? 0,
    })
  }

  async function saveDialog() {
    if (!editRow) return
    setSaving(true)
    await patchTask(editRow.id, {
      title: editRow.title,
      assignee_id: editRow.assignee_id || null,
      start_date: editRow.start_date || null,
      due_date: editRow.due_date || null,
      status: editRow.status,
      priority: editRow.priority,
      progress: clamp(Number(editRow.progress) || 0, 0, 100),
      stage: editRow.stage || null,
    })
    setSaving(false)
    setEditRow(null)
  }

  /* ── notes on a square ──
     A click anywhere along a line's row — on the bar or on the empty
     calendar either side of it — opens that day's notes. The column is
     worked out from where the click landed rather than from a grid of
     clickable cells: a year-long job at day scale would otherwise be
     several hundred divs per row, all of them doing nothing. */
  function openCell(task, clientX, rowEl) {
    if (swallowClickRef.current) return
    const i = xToCol(clientX - rowEl.getBoundingClientRect().left, cellW)
    const col = columns[i]
    if (!col) return
    setNoteCell({ taskId: task.id, start: col.start, end: col.end })
  }

  /* The panel has just written something — mark the squares it now
     covers, without re-reading the table. */
  function applyNoteDays(taskId, days) {
    setNoteMarks(prev => {
      const next = new Map(prev)
      if (days.length) next.set(taskId, new Set(days))
      else next.delete(taskId)
      return next
    })
  }

  const noteTask = noteCell ? tasks.find(t => t.id === noteCell.taskId) : null

  /* ── dragging a bar ── */
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
      // The click that follows this mouseup is the tail of a drag, not
      // somebody asking for the notes on the square they finished over.
      // Cleared on the next tick, by which time that click has fired.
      swallowClickRef.current = true
      setTimeout(() => { swallowClickRef.current = false }, 0)
      await patchTask(d.id, { start_date: toISO(d.newStart), due_date: toISO(d.newEnd) })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* ── geometry ── */
  function barGeom(startVal, endVal) {
    const s = safeDate(startVal)
    const e = safeDate(endVal) || s
    if (!s) return null
    const x1 = dateToX(s, range.start, cellW, unitDays)
    const x2 = dateToX(addDays(e, 1), range.start, cellW, unitDays)
    return { x: x1, w: Math.max(x2 - x1, 6), start: s, end: e }
  }

  function taskGeom(task) {
    return barGeom(task._tempStart || task.start_date, task._tempEnd || task.due_date)
  }

  const rowHeight = row => ROW_H[row.type] || 40

  /* ── render ── */
  if (loading) return (
    <div className="page-body">
      <div className="loading-container"><div className="loading-spinner" /><span>Loading timeline…</span></div>
    </div>
  )

  if (!projects.length) return (
    <>
      <div className="page-header">
        <div className="page-header-left"><span className="page-header-title">Project Timeline</span></div>
      </div>
      <div className="page-body">
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon"><GanttChart /></div>
            <div className="empty-state-title">No projects yet</div>
            <div className="empty-state-desc">Create a project first — its timeline is built from its stages.</div>
          </div>
        </div>
      </div>
    </>
  )

  const summary = rollUp(tasks)

  return (
    <div className="gantt-page">
      {/* ── toolbar ── */}
      <div className="gantt-toolbar">
        <div className="gantt-toolbar-title">
          <GanttChart size={17} />
          <span>Project Timeline</span>
        </div>

        <select
          className="form-select gantt-project-select"
          value={projectId}
          onChange={e => selectProject(e.target.value)}
        >
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div className="gantt-toolbar-spacer" />

        <div className="gantt-scale-toggle">
          {Object.values(SCALES).map(s => (
            <button
              key={s.key}
              className={`gantt-scale-btn${scaleKey === s.key ? ' active' : ''}`}
              onClick={() => changeScale(s.key)}
            >{s.label}</button>
          ))}
        </div>

        <div className="gantt-zoom">
          <button className="icon-btn" title="Zoom out"
            onClick={() => setCellW(w => clamp(w - 8, scale.min, scale.max))}><ZoomOut size={15} /></button>
          <span className="gantt-zoom-value">{Math.round((cellW / scale.defaultW) * 100)}%</span>
          <button className="icon-btn" title="Zoom in"
            onClick={() => setCellW(w => clamp(w + 8, scale.min, scale.max))}><ZoomIn size={15} /></button>
        </div>

        <button className="btn btn-secondary btn-sm" onClick={scrollToToday} disabled={!todayInView}>
          <CalendarClock size={14} /> Today
        </button>

        <RefreshButton onRefresh={() => { fetchProjects(); fetchRows(projectId) }} />
      </div>

      {error && (
        <div className="gantt-error">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button className="icon-btn" onClick={() => setError('')}><X size={13} /></button>
        </div>
      )}

      {/* ── sheet header, as the spreadsheet has it ── */}
      {project && (
        <SheetHeader
          project={project}
          summary={summary}
          editable={canEditProject}
          onChange={patchProject}
        />
      )}

      {/* ── the chart, with the note panel docked beside it ── */}
      <div className="gantt-body">
        <div className="gantt-scroll" ref={scrollRef}>
          <div className="gantt-canvas" style={{ width: labelW + totalW }}>

            {/* frozen columns */}
            <div className="gantt-frozen" style={{ width: labelW }}>
              <div className="gantt-frozen-head" style={{ height: HEAD_H }}>
                {cols.map(c => (
                  <div key={c.key} className={`gantt-cell gantt-head-cell gantt-cell-${c.key}`} style={{ width: c.w }}>
                    {c.label}
                  </div>
                ))}
              </div>

              {rows.map(row => (
                <LabelRow
                  key={row.id}
                  row={row}
                  cols={cols}
                  height={rowHeight(row)}
                  canEditTasks={canEditTasks}
                  canEditMilestones={canEditMilestones}
                  autoFocus={focusId === row.task?.id || focusId === row.milestone?.id}
                  onFocused={() => setFocusId(null)}
                  onPatchTask={patchTask}
                  onDeleteTask={deleteTask}
                  onPatchMilestone={patchMilestone}
                  onDeleteMilestone={deleteMilestone}
                  onAddTask={addTask}
                  onAddMilestone={addMilestone}
                  onOpen={openRow}
                />
              ))}
            </div>

            {/* calendar */}
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
                      <div
                        key={i}
                        className={`gantt-col-cell${weekend ? ' weekend' : ''}${today ? ' today' : ''}`}
                        style={{ width: cellW }}
                      >
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
                {/* grid + today, drawn once behind every row */}
                <div className="gantt-gridlines">
                  {columns.map((col, i) => (
                    <div
                      key={i}
                      className={`gantt-gridline${unitDays === 1 && isWeekend(col.start) ? ' weekend' : ''}`}
                      style={{ left: i * cellW, width: cellW }}
                    />
                  ))}
                </div>
                {todayInView && <div className="gantt-today-line" style={{ left: todayX }} />}

                {rows.map(row => (
                  <ChartRow
                    key={row.id}
                    row={row}
                    height={rowHeight(row)}
                    cellW={cellW}
                    unitDays={unitDays}
                    totalW={totalW}
                    rangeStart={range.start}
                    taskGeom={taskGeom}
                    barGeom={barGeom}
                    draggingId={draggingId}
                    canEditTasks={canEditTasks}
                    noteDays={row.task ? noteMarks.get(row.task.id) : null}
                    selectedCol={
                      noteCell && row.task?.id === noteCell.taskId
                        ? dateToCol(noteCell.start, range.start, unitDays)
                        : null
                    }
                    onDrag={beginDrag}
                    onOpen={openRow}
                    onCellClick={openCell}
                  />
                ))}

                {!rows.length && (
                  <div className="gantt-empty-chart">
                    {loadingRows ? 'Loading…' : 'This project has no stages yet.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {noteTask && (
          <TaskNotesPanel
            key={noteTask.id}
            task={noteTask}
            cell={noteCell}
            subtitle={project?.name}
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

      {/* ── row dialog — the way dates are edited on a narrow screen ── */}
      <Modal
        isOpen={!!editRow}
        onClose={() => setEditRow(null)}
        title="Edit Line Item"
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
            <div className="form-group">
              <label className="form-label">Assigned To</label>
              <select className="form-select" value={editRow.assignee_id}
                onChange={e => setEditRow(r => ({ ...r, assignee_id: e.target.value }))}>
                <option value="">— Unassigned —</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}{emp.role ? ` · ${emp.role}` : ''}
                  </option>
                ))}
              </select>
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
                <label className="form-label">Stage</label>
                <select className="form-select" value={editRow.stage || ''}
                  onChange={e => setEditRow(r => ({ ...r, stage: e.target.value }))}>
                  <option value="">— Not in a stage —</option>
                  {stages.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Progress (%)</label>
                <input className="form-input" type="number" min="0" max="100" step="5"
                  value={editRow.progress}
                  onChange={e => setEditRow(r => ({ ...r, progress: e.target.value }))} />
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
            <div className="gantt-dialog-hint">
              Duration is worked out from the dates — {durationDays(editRow.start_date, editRow.due_date) ?? '—'} day
              {durationDays(editRow.start_date, editRow.due_date) === 1 ? '' : 's'}.
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}

/* ─────────────────── sheet header ─────────────────── */
function SheetHeader({ project, summary, editable, onChange }) {
  const fields = [
    { key: 'name',           label: 'Project Name',    placeholder: 'Project title' },
    { key: 'project_number', label: 'Project Number',  placeholder: 'e.g. NHN-2026-014' },
    { key: 'location',       label: 'Project Address', placeholder: 'Site address' },
    { key: 'client',         label: 'Client',          placeholder: "Client's name" },
    { key: 'revision',       label: 'Revision',        placeholder: 'e.g. Rev C' },
  ]

  return (
    <div className="gantt-sheet-header">
      <div className="gantt-sheet-fields">
        {fields.map(f => (
          <div className="gantt-sheet-field" key={f.key}>
            <span className="gantt-sheet-label">{f.label}</span>
            <EditableText
              value={project[f.key] || ''}
              placeholder={f.placeholder}
              disabled={!editable}
              onCommit={v => onChange({ [f.key]: v || null })}
            />
          </div>
        ))}
        <div className="gantt-sheet-field">
          <span className="gantt-sheet-label">Programme</span>
          <div className="gantt-sheet-dates">
            <input
              className="gantt-inline-input" type="date" disabled={!editable}
              value={project.start_date || ''}
              onChange={e => onChange({ start_date: e.target.value || null })}
            />
            <span className="gantt-sheet-arrow">→</span>
            <input
              className="gantt-inline-input" type="date" disabled={!editable}
              value={project.end_date || ''}
              onChange={e => onChange({ end_date: e.target.value || null })}
            />
          </div>
        </div>
      </div>

      <div className="gantt-sheet-summary">
        <div className="gantt-sheet-stat">
          <span className="gantt-sheet-stat-value">{summary.count}</span>
          <span className="gantt-sheet-stat-label">Line items</span>
        </div>
        <div className="gantt-sheet-stat">
          <span className="gantt-sheet-stat-value">{summary.progress}%</span>
          <span className="gantt-sheet-stat-label">Complete</span>
        </div>
        <div className="gantt-sheet-progress">
          <div className="gantt-sheet-progress-fill" style={{ width: `${summary.progress}%` }} />
        </div>
      </div>
    </div>
  )
}

/* A text cell that behaves like a spreadsheet one: type, then Enter or
   click away to commit, Escape to put it back. */
function EditableText({
  value, placeholder, disabled, onCommit,
  className = 'gantt-inline-input', autoFocus, onAutoFocused,
}) {
  const [draft, setDraft] = useState(value)
  const ref = useRef(null)
  useEffect(() => { setDraft(value) }, [value])

  // A line added from the "+" button opens with its placeholder title
  // selected, so the first thing typed replaces it.
  useEffect(() => {
    if (!autoFocus || !ref.current) return
    ref.current.focus()
    ref.current.select()
    onAutoFocused?.()
  }, [autoFocus]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      ref={ref}
      className={className}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft.trim()) }}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur() }
      }}
    />
  )
}

/* ─────────────────── frozen-column rows ─────────────────── */
function LabelRow({
  row, cols, height, canEditTasks, canEditMilestones, autoFocus, onFocused,
  onPatchTask, onDeleteTask, onPatchMilestone, onDeleteMilestone,
  onAddTask, onAddMilestone, onOpen,
}) {
  const width = key => cols.find(c => c.key === key)?.w
  const has = key => cols.some(c => c.key === key)

  if (row.type === 'stage') {
    const { group } = row
    const roll = rollUp(group.tasks)
    return (
      <div className="gantt-row gantt-row-stage" style={{ height }}>
        <div className="gantt-cell gantt-cell-num" style={{ width: width('num') }}>{group.index}</div>
        <div className="gantt-cell gantt-cell-title" style={{ width: width('title') }}>
          <span className="gantt-stage-swatch" style={{ background: group.color }} />
          <span className="gantt-stage-name">{group.label}</span>
        </div>
        {has('start') && (
          <div className="gantt-cell gantt-cell-start" style={{ width: width('start') }}>
            {roll.start ? format(roll.start, 'd MMM yy') : '—'}
          </div>
        )}
        {has('due') && (
          <div className="gantt-cell gantt-cell-due" style={{ width: width('due') }}>
            {roll.end ? format(roll.end, 'd MMM yy') : '—'}
          </div>
        )}
        {has('dur') && (
          <div className="gantt-cell gantt-cell-dur" style={{ width: width('dur') }}>
            {durationDays(roll.start, roll.end) ?? '—'}
          </div>
        )}
        <div className="gantt-cell gantt-cell-prog" style={{ width: width('prog') }}>
          <span className="gantt-stage-pct">{roll.progress}%</span>
        </div>
      </div>
    )
  }

  if (row.type === 'section') {
    const total = cols.reduce((s, c) => s + c.w, 0)
    return (
      <div className="gantt-row gantt-row-section" style={{ height }}>
        <div className="gantt-cell gantt-cell-section" style={{ width: total }}>{row.label}</div>
      </div>
    )
  }

  if (row.type === 'adder') {
    const total = cols.reduce((s, c) => s + c.w, 0)
    return (
      <div className="gantt-row gantt-row-adder" style={{ height }}>
        <button
          className="gantt-add-btn"
          style={{ width: total }}
          onClick={() => (row.milestone ? onAddMilestone() : onAddTask(row.group))}
        >
          <Plus size={12} /> {row.milestone ? 'Add milestone' : `Add line to ${row.group.label}`}
        </button>
      </div>
    )
  }

  if (row.type === 'milestone') {
    const ms = row.milestone
    return (
      <div className="gantt-row gantt-row-milestone" style={{ height }}>
        <div className="gantt-cell gantt-cell-num" style={{ width: width('num') }}>
          <span className={`gantt-diamond-mini${ms.is_completed ? ' done' : ''}`} />
        </div>
        <div className="gantt-cell gantt-cell-title" style={{ width: width('title') }}>
          <EditableText
            value={ms.title}
            disabled={!canEditMilestones}
            autoFocus={autoFocus}
            onAutoFocused={onFocused}
            onCommit={v => v && onPatchMilestone(ms.id, { title: v })}
            className={`gantt-inline-input gantt-title-input${ms.is_completed ? ' done' : ''}`}
          />
          {canEditMilestones && (
            <button className="gantt-row-delete" title="Delete milestone"
              onClick={() => onDeleteMilestone(ms)}><Trash2 size={12} /></button>
          )}
        </div>
        {has('start') && <div className="gantt-cell gantt-cell-start" style={{ width: width('start') }}>—</div>}
        {has('due') && (
          <div className="gantt-cell gantt-cell-due" style={{ width: width('due') }}>
            <input className="gantt-inline-input" type="date" disabled={!canEditMilestones}
              value={ms.due_date || ''}
              onChange={e => onPatchMilestone(ms.id, { due_date: e.target.value || null })} />
          </div>
        )}
        {has('dur') && <div className="gantt-cell gantt-cell-dur" style={{ width: width('dur') }}>—</div>}
        <div className="gantt-cell gantt-cell-prog" style={{ width: width('prog') }}>
          <button
            className={`gantt-ms-check${ms.is_completed ? ' done' : ''}`}
            disabled={!canEditMilestones}
            title={ms.is_completed ? 'Mark as outstanding' : 'Mark as reached'}
            onClick={() => onPatchMilestone(ms.id, { is_completed: !ms.is_completed })}
          >
            <Check size={12} />
          </button>
        </div>
      </div>
    )
  }

  /* line item */
  const task = row.task
  const dur = durationDays(task.start_date, task.due_date)

  return (
    <div className="gantt-row gantt-row-task" style={{ height }} onDoubleClick={() => onOpen(task)}>
      <div className="gantt-cell gantt-cell-num" style={{ width: width('num') }}>{row.number}</div>

      <div className="gantt-cell gantt-cell-title" style={{ width: width('title') }}>
        <EditableText
          value={task.title}
          disabled={!canEditTasks}
          autoFocus={autoFocus}
          onAutoFocused={onFocused}
          onCommit={v => v && onPatchTask(task.id, { title: v })}
          className={`gantt-inline-input gantt-title-input${task.status === 'Done' ? ' done' : ''}`}
        />
        {task.is_confidential && <ConfidentialIcon size={11} />}
        {canEditTasks && (
          <button className="gantt-row-delete" title="Delete line"
            onClick={() => onDeleteTask(task)}><Trash2 size={12} /></button>
        )}
      </div>

      {has('start') && (
        <div className="gantt-cell gantt-cell-start" style={{ width: width('start') }}>
          <input className="gantt-inline-input" type="date" disabled={!canEditTasks}
            value={task.start_date || ''}
            onChange={e => onPatchTask(task.id, { start_date: e.target.value || null })} />
        </div>
      )}

      {has('due') && (
        <div className="gantt-cell gantt-cell-due" style={{ width: width('due') }}>
          <input className="gantt-inline-input" type="date" disabled={!canEditTasks}
            value={task.due_date || ''}
            onChange={e => onPatchTask(task.id, { due_date: e.target.value || null })} />
        </div>
      )}

      {has('dur') && (
        <div className="gantt-cell gantt-cell-dur" style={{ width: width('dur') }}>{dur ?? '—'}</div>
      )}

      <div className="gantt-cell gantt-cell-prog" style={{ width: width('prog') }}>
        <ProgressCell
          value={task.progress ?? 0}
          disabled={!canEditTasks}
          onCommit={v => onPatchTask(task.id, { progress: v })}
        />
      </div>
    </div>
  )
}

/* The spreadsheet's PROGRESS cell: a number you type over, tinted by
   how far along it is. */
function ProgressCell({ value, disabled, onCommit }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])

  const commit = () => {
    const n = clamp(Math.round(Number(draft) || 0), 0, 100)
    if (n !== value) onCommit(n)
    setDraft(String(n))
  }

  const pct = clamp(Number(draft) || 0, 0, 100)
  const tone = pct >= 100 ? 'var(--success)' : pct > 0 ? 'var(--accent-primary)' : 'var(--text-muted)'

  return (
    <div className="gantt-progress-cell" style={{ '--pct': `${pct}%`, '--tone': tone }}>
      <input
        className="gantt-progress-input"
        value={draft}
        disabled={disabled}
        inputMode="numeric"
        onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setDraft(String(value)); e.currentTarget.blur() }
        }}
      />
      <span className="gantt-progress-pct">%</span>
    </div>
  )
}

/* ─────────────────── calendar-side rows ─────────────────── */
function ChartRow({
  row, height, cellW, unitDays, totalW, rangeStart,
  taskGeom, barGeom, draggingId, canEditTasks, noteDays, selectedCol,
  onDrag, onOpen, onCellClick,
}) {
  if (row.type === 'stage') {
    const roll = rollUp(row.group.tasks)
    const geo = roll.start ? barGeom(roll.start, roll.end) : null
    return (
      <div className="gantt-row gantt-row-stage" style={{ height }}>
        {geo && (
          <div
            className="gantt-stage-bar"
            style={{
              left: geo.x, width: geo.w,
              background: rgba(row.group.color, 0.14),
              borderColor: rgba(row.group.color, 0.5),
            }}
            title={`${row.group.label} · ${format(geo.start, 'd MMM')} → ${format(geo.end, 'd MMM')}`}
          >
            <div className="gantt-stage-bar-fill"
              style={{ width: `${roll.progress}%`, background: rgba(row.group.color, 0.4) }} />
          </div>
        )}
      </div>
    )
  }

  if (row.type === 'section') return <div className="gantt-row gantt-row-section" style={{ height }} />
  if (row.type === 'adder')   return <div className="gantt-row gantt-row-adder" style={{ height }} />

  if (row.type === 'milestone') {
    const d = safeDate(row.milestone.due_date)
    const x = d
      ? clamp(dateToX(d, rangeStart, cellW, unitDays) + (cellW / unitDays) / 2, 0, totalW)
      : null
    return (
      <div className="gantt-row gantt-row-milestone" style={{ height }}>
        {x !== null && (
          <div
            className={`gantt-diamond${row.milestone.is_completed ? ' done' : ''}`}
            style={{ left: x - 8, top: height / 2 - 8 }}
            title={`${row.milestone.title} · ${format(d, 'd MMM yyyy')}`}
          />
        )}
      </div>
    )
  }

  const task = row.task
  const geo = taskGeom(task)
  /* Late lines keep growing to today — see slipGeom. */
  const slip = slipGeom(task, rangeStart, cellW, unitDays, totalW)
  const color = row.group.color
  const colCount = Math.round(totalW / cellW)
  const marked = markedColumns(noteDays, rangeStart, unitDays, colCount)
  const picked = selectedCol !== null && selectedCol >= 0 && selectedCol < colCount

  /* The whole row is the target, bar included: clicking a square is how
     notes are read and written, and the day under the pointer is worked
     out from where the click landed. */
  return (
    <div
      className="gantt-row gantt-row-task"
      style={{ height }}
      onClick={e => onCellClick(task, e.clientX, e.currentTarget)}
    >
      {picked && (
        <div className="gantt-cell-pick" style={{ left: selectedCol * cellW, width: cellW }} />
      )}

      {slip && (
        <div
          className={`gantt-bar-slip${slip.clippedRight ? ' clip-r' : ''}`}
          style={{ left: slip.x, width: slip.w, height: height - 16, top: 8 }}
          title={`${task.title}
Overdue — ${slip.days} day${slip.days === 1 ? '' : 's'} past ${format(slip.due, 'd MMM yyyy')}`}
        >
          {slip.w > 34 && <span className="gantt-slip-label">{slip.days}d late</span>}
        </div>
      )}

      {geo && (
        <TaskBar
          task={task}
          geo={geo}
          color={color}
          height={height}
          dragging={draggingId === task.id}
          editable={canEditTasks}
          onDrag={onDrag}
          onOpen={onOpen}
        />
      )}

      {/* A corner fold on any square that has been written on — the
          spreadsheet convention, and the only way to find a note again
          without opening every day of a six-week bar. */}
      {marked.map(col => (
        <span key={col} className="gantt-note-mark" style={{ left: col * cellW + cellW - 7 }} />
      ))}
    </div>
  )
}

function TaskBar({ task, geo, color, height, dragging, editable, onDrag, onOpen }) {
  const [hover, setHover] = useState(false)
  const pct = clamp(Number(task.progress) || 0, 0, 100)
  const done = pct >= 100 || task.status === 'Done'
  const overdue = isOverdue(task)
  const showLabel = geo.w > 64

  return (
    <div
      className={`gantt-bar${dragging ? ' dragging' : ''}${hover ? ' hover' : ''}${done ? ' done' : ''}`}
      style={{
        left: geo.x, width: geo.w, height: height - 16, top: 8,
        background: rgba(done ? '#0F7B55' : color, 0.16),
        borderColor: rgba(done ? '#0F7B55' : color, overdue ? 0.9 : 0.6),
        cursor: editable ? (dragging ? 'grabbing' : 'grab') : 'default',
      }}
      title={[
        task.title,
        `${format(geo.start, 'd MMM yyyy')} → ${format(geo.end, 'd MMM yyyy')}`,
        `${pct}% complete · ${task.status}`,
        task.assignee ? `Assigned to ${task.assignee.name}` : 'Unassigned',
      ].join('\n')}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={e => editable && onDrag(e, task, 'move', geo.start, geo.end)}
      onDoubleClick={() => onOpen(task)}
    >
      <div className="gantt-bar-fill"
        style={{ width: `${pct}%`, background: rgba(done ? '#0F7B55' : color, 0.55) }} />

      {editable && (
        <span className="gantt-bar-handle left"
          onMouseDown={e => onDrag(e, task, 'resize-l', geo.start, geo.end)}>
          <GripVertical size={11} />
        </span>
      )}

      {showLabel && <span className="gantt-bar-label">{task.title}</span>}

      {task.assignee && geo.w > 96 && (
        <span className="gantt-bar-avatar" style={{ background: task.assignee.color }}
          title={task.assignee.name}>{task.assignee.name.charAt(0)}</span>
      )}

      {editable && (
        <span className="gantt-bar-handle right"
          onMouseDown={e => onDrag(e, task, 'resize-r', geo.start, geo.end)}>
          <GripVertical size={11} />
        </span>
      )}
    </div>
  )
}
