import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  BarChart2, RefreshCw, Check, Pencil, X, GripVertical
} from 'lucide-react'
import { format, addDays, startOfWeek, endOfWeek, differenceInDays,
         addWeeks, subWeeks, parseISO, isToday, isWeekend } from 'date-fns'

/* ─────────────────────────── helpers ────────────────────────────── */
const CELL_W_DEFAULT = 48   // px per day at zoom=1
const ROW_H          = 56
const LABEL_W        = 400
const TASK_COL_W     = 250
const ASSIGNEE_COL_W = 150
const HEADER_H       = 72

const STATUS_COLORS = {
  'To Do':       '#9E9E9E',
  'In Progress': '#4A90D9',
  'In Review':   '#8B7EC8',
  'Done':        '#4CAF7D',
}
const STATUS_PROGRESS = { 'To Do': 0, 'In Progress': 0.5, 'In Review': 0.85, 'Done': 1 }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function safeDate(str) {
  if (!str) return null
  try { return parseISO(str) } catch { return null }
}

function dateToX(date, rangeStart, cellW) {
  return differenceInDays(date, rangeStart) * cellW
}

function hexToRgb(hex) {
  if (!hex) return [42, 39, 34]
  const m = hex.replace('#','').match(/.{2}/g)
  return m ? m.map(h => parseInt(h,16)) : [42, 39, 34]
}

/* ─────────────────────────── main component ─────────────────────── */
export function Gantt() {
  /* state */
  const [projects,   setProjects]   = useState([])
  const [tasks,      setTasks]      = useState([])
  const [milestones, setMilestones] = useState([])
  const [employees,  setEmployees]  = useState([])
  const [loading,    setLoading]    = useState(true)

  const [filterProject,  setFilterProject]  = useState('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [cellW,          setCellW]          = useState(CELL_W_DEFAULT)
  const [rangeStart,     setRangeStart]     = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [rangeWeeks]                        = useState(16)

  const [editModal, setEditModal] = useState(null)
  const [saving,    setSaving]    = useState(false)

  /* drag state — kept in refs so live event handlers always read fresh values */
  const dragRef    = useRef(null)
  const cellWRef   = useRef(cellW)
  const [dragTip, setDragTip] = useState(null)   // { x, y, text }
  useEffect(() => { cellWRef.current = cellW }, [cellW])

  const labelScrollRef = useRef(null)
  const chartScrollRef = useRef(null)

  const rangeEnd = addDays(rangeStart, rangeWeeks * 7 - 1)
  const totalDays = rangeWeeks * 7
  const totalW    = totalDays * cellW

  /* ── fetch ── */
  async function fetchAll() {
    setLoading(true)
    const [p, t, m, e] = await Promise.all([
      supabase.from('projects').select('id,name,color,start_date,end_date,status').order('name'),
      supabase.from('tasks').select('*, assignee:employees(id,name,color,avatar_url)').order('created_at'),
      supabase.from('milestones').select('*').order('due_date'),
      supabase.from('employees').select('*').order('name'),
    ])
    setProjects(p.data || [])
    setTasks(t.data || [])
    setMilestones(m.data || [])
    setEmployees(e.data || [])
    setLoading(false)
  }
  useEffect(() => { fetchAll() }, [])

  /* ── computed rows ── */
  const filteredTasks = tasks.filter(t => {
    if (filterProject  !== 'all' && t.project_id  !== filterProject)  return false
    if (filterAssignee !== 'all' && t.assignee_id !== filterAssignee) return false
    return true
  })

  const grouped = projects
    .filter(p => filterProject === 'all' || p.id === filterProject)
    .map(proj => ({
      project: proj,
      tasks: filteredTasks.filter(t => t.project_id === proj.id),
      milestones: milestones.filter(m => m.project_id === proj.id),
    }))
    .filter(g => g.tasks.length > 0 || g.milestones.length > 0)

  const rows = []
  grouped.forEach(g => {
    rows.push({ type: 'project-header', project: g.project, id: `ph-${g.project.id}` })
    g.tasks.forEach(t => rows.push({ type: 'task', task: t, project: g.project, id: t.id }))
    g.milestones.forEach(m => rows.push({ type: 'milestone', milestone: m, project: g.project, id: `ms-${m.id}` }))
  })

  /* ── navigate ── */
  function goBack()    { setRangeStart(d => subWeeks(d, Math.ceil(rangeWeeks / 4))) }
  function goForward() { setRangeStart(d => addWeeks(d, Math.ceil(rangeWeeks / 4))) }
  function goToday()   { setRangeStart(startOfWeek(new Date(), { weekStartsOn: 1 })) }
  function zoomIn()    { setCellW(w => clamp(w + 8, 24, 120)) }
  function zoomOut()   { setCellW(w => clamp(w - 8, 24, 120)) }

  /* ── header rows ── */
  const weekHeaders = []
  let cur = rangeStart
  while (cur <= rangeEnd) {
    const wEnd = endOfWeek(cur, { weekStartsOn: 1 })
    const days = []
    let d = cur
    while (d <= wEnd && d <= rangeEnd) { days.push(d); d = addDays(d, 1) }
    weekHeaders.push({ weekStart: cur, days })
    cur = addDays(wEnd, 1)
  }

  /* ── drag (self-contained closure, fixes stale-state bug) ── */
  const beginDrag = useCallback((e, task, type, origStart, origEnd) => {
    e.preventDefault()
    e.stopPropagation()
    const taskId = task.id
    dragRef.current = {
      taskId, type,
      startX: e.clientX,
      origStart, origEnd,
      newStart: origStart, newEnd: origEnd,
    }
    document.body.style.cursor = type === 'move' ? 'grabbing' : 'ew-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev) => {
      const d = dragRef.current
      if (!d) return
      const dDays = Math.round((ev.clientX - d.startX) / cellWRef.current)
      let newS = d.origStart, newE = d.origEnd
      if (d.type === 'move')     { newS = addDays(d.origStart, dDays); newE = addDays(d.origEnd,   dDays) }
      if (d.type === 'resize-l') { newS = addDays(d.origStart, dDays); if (newS >= d.origEnd)   newS = addDays(d.origEnd,   -1) }
      if (d.type === 'resize-r') { newE = addDays(d.origEnd,   dDays); if (newE <= d.origStart) newE = addDays(d.origStart,  1) }
      d.newStart = newS; d.newEnd = newE

      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, _tempStart: newS, _tempEnd: newE } : t))
      setDragTip({
        x: ev.clientX, y: ev.clientY,
        text: `${format(newS, 'd MMM')} → ${format(newE, 'd MMM')}  (${differenceInDays(newE, newS) + 1}d)`,
      })
    }

    const onUp = async () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDragTip(null)
      const d = dragRef.current
      dragRef.current = null
      if (!d) return
      const movedDays = differenceInDays(d.newStart, d.origStart) + differenceInDays(d.newEnd, d.origEnd)
      if (movedDays === 0) {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, _tempStart: null, _tempEnd: null } : t))
        return
      }
      const sStr = format(d.newStart, 'yyyy-MM-dd')
      const eStr = format(d.newEnd,   'yyyy-MM-dd')
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, start_date: sStr, due_date: eStr, _tempStart: null, _tempEnd: null } : t
      ))
      await supabase.from('tasks').update({
        start_date: sStr, due_date: eStr, updated_at: new Date().toISOString()
      }).eq('id', taskId)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
  }, [])

  /* ── save edit modal ── */
  async function saveEdit() {
    if (!editModal) return
    setSaving(true)
    await supabase.from('tasks').update({
      title: editModal.title,
      assignee_id: editModal.assignee_id || null,
      start_date: editModal.start_date || null,
      due_date: editModal.due_date || null,
      status: editModal.status,
      priority: editModal.priority,
      updated_at: new Date().toISOString()
    }).eq('id', editModal.id)
    setSaving(false)
    setEditModal(null)
    fetchAll()
  }

  /* ── bar geometry ── */
  function getBarGeometry(task) {
    const startD = task._tempStart || safeDate(task.start_date) || safeDate(task.created_at)
    const endD   = task._tempEnd   || safeDate(task.due_date)
    if (!startD && !endD) return null
    const s = startD || endD
    const e = endD   || addDays(s, 3)
    const x1 = dateToX(s, rangeStart, cellW)
    const x2 = dateToX(addDays(e, 1), rangeStart, cellW)   // +1 so the bar fills the end day
    const w  = Math.max(x2 - x1, cellW * 0.6)
    return { x: x1, width: w, startD: s, endD: e }
  }

  /* ── two-way scroll sync ── */
  function syncFromChart(e) {
    if (labelScrollRef.current && labelScrollRef.current.scrollTop !== e.currentTarget.scrollTop)
      labelScrollRef.current.scrollTop = e.currentTarget.scrollTop
  }
  function syncFromLabel(e) {
    if (chartScrollRef.current && chartScrollRef.current.scrollTop !== e.currentTarget.scrollTop)
      chartScrollRef.current.scrollTop = e.currentTarget.scrollTop
  }

  if (loading) return (
    <div className="page-body">
      <div className="loading-container"><div className="loading-spinner" /><span>Loading Gantt…</span></div>
    </div>
  )

  const todayX = dateToX(new Date(), rangeStart, cellW)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-primary)' }}>

      {/* ── Top Bar ── */}
      <div style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', padding: '0 var(--space-6)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', height: 60, flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <BarChart2 size={18} color="var(--accent-primary)" />
          <span style={{ fontWeight: 700, fontSize: 'var(--text-md)', letterSpacing: '-0.01em' }}>Gantt Chart</span>
        </div>

        <select className="form-select" style={{ width: 180, height: 34, padding: '0 10px', fontSize: 'var(--text-xs)' }}
          value={filterProject} onChange={e => setFilterProject(e.target.value)}>
          <option value="all">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select className="form-select" style={{ width: 160, height: 34, padding: '0 10px', fontSize: 'var(--text-xs)' }}
          value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
          <option value="all">All members</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>
          Drag bars to move · drag edges to resize · double-click to edit
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="icon-btn" onClick={zoomOut} title="Zoom out"><ZoomOut size={15} /></button>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', minWidth: 32, textAlign: 'center' }}>{Math.round((cellW / CELL_W_DEFAULT) * 100)}%</span>
          <button className="icon-btn" onClick={zoomIn} title="Zoom in"><ZoomIn size={15} /></button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="icon-btn" onClick={goBack} title="Previous"><ChevronLeft size={16} /></button>
          <button className="btn btn-sm btn-secondary" onClick={goToday} style={{ minWidth: 64 }}>Today</button>
          <button className="icon-btn" onClick={goForward} title="Next"><ChevronRight size={16} /></button>
        </div>

        <button className="icon-btn" onClick={fetchAll} title="Refresh"><RefreshCw size={15} /></button>
      </div>

      {/* ── Gantt Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left label panel */}
        <div style={{ width: LABEL_W, flexShrink: 0, borderRight: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
          <div style={{ height: HEADER_H, borderBottom: '1px solid var(--border-light)', flexShrink: 0, display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: TASK_COL_W, padding: 'var(--space-3) var(--space-4)', flexShrink: 0 }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Task / Milestone</span>
            </div>
            <div style={{ width: ASSIGNEE_COL_W, padding: 'var(--space-3) var(--space-4)', flexShrink: 0, borderLeft: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Assignee</span>
            </div>
          </div>
          <div style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'thin' }} ref={labelScrollRef} onScroll={syncFromLabel}>
            {rows.map(row => (
              <GanttLabelRow key={row.id} row={row} onEdit={t => setEditModal({ ...t, start_date: t.start_date || '', due_date: t.due_date || '' })} />
            ))}
            {rows.length === 0 && (
              <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                No tasks with dates found.<br />Add start/due dates to tasks to see them here.
              </div>
            )}
          </div>
        </div>

        {/* Right scrollable chart */}
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }} ref={chartScrollRef} onScroll={syncFromChart}>
          <div style={{ width: totalW, minWidth: '100%', position: 'relative' }}>

            {/* ── Time header ── */}
            <div style={{ height: HEADER_H, position: 'sticky', top: 0, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', zIndex: 20 }}>
              <div style={{ display: 'flex', height: 28, borderBottom: '1px solid var(--border-light)' }}>
                {weekHeaders.map((wh, i) => (
                  <div key={i} style={{ width: wh.days.length * cellW, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 8px', borderRight: '1px solid var(--border-light)', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    {format(wh.weekStart, 'd MMM')} – {format(endOfWeek(wh.weekStart, { weekStartsOn: 1 }), 'd MMM')}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', height: 44 }}>
                {weekHeaders.map((wh, wi) =>
                  wh.days.map((day, di) => {
                    const isWE = isWeekend(day)
                    const isTD = isToday(day)
                    return (
                      <div key={`${wi}-${di}`} style={{
                        width: cellW, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        borderRight: '1px solid rgba(0,0,0,0.04)',
                        background: isTD ? 'rgba(42,39,34,0.10)' : isWE ? 'rgba(0,0,0,0.025)' : 'transparent',
                      }}>
                        <span style={{ fontSize: 9, color: isWE ? 'var(--text-muted)' : 'var(--text-secondary)', fontWeight: 500, textTransform: 'uppercase' }}>{format(day, 'EEE')}</span>
                        <span style={{ fontSize: 11, fontWeight: isTD ? 700 : 400, color: isTD ? 'var(--accent-primary)' : isWE ? 'var(--text-muted)' : 'var(--text-primary)', lineHeight: 1.2 }}>{format(day, 'd')}</span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* ── Grid + Bars ── */}
            <div style={{ position: 'relative' }}>
              {/* Vertical day grid lines (rendered once across all rows) */}
              {Array.from({ length: totalDays + 1 }).map((_, i) => {
                const day = addDays(rangeStart, i)
                const isWeekStart = i % 7 === 0
                if (i === totalDays) return null
                return (
                  <div key={`vg-${i}`} style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: i * cellW, width: cellW,
                    borderRight: isWeekStart && i > 0 ? '1px solid var(--border-light)' : '1px solid rgba(0,0,0,0.03)',
                    background: isWeekend(day) ? 'rgba(0,0,0,0.018)' : 'transparent',
                    pointerEvents: 'none',
                  }} />
                )
              })}

              {/* today line */}
              {todayX >= 0 && todayX <= totalW && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: todayX + cellW / 2 - 1, width: 2, background: 'var(--accent-primary)', opacity: 0.85, zIndex: 10, pointerEvents: 'none', boxShadow: '0 0 8px rgba(42,39,34,0.35)' }}>
                  <div style={{ position: 'absolute', top: -2, left: -4, width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-primary)', boxShadow: '0 0 0 3px rgba(42,39,34,0.18)' }} />
                </div>
              )}

              {/* Rows */}
              {rows.map((row, ri) => {
                const isEven = ri % 2 === 0
                const rowBg  = isEven ? 'transparent' : 'rgba(0,0,0,0.012)'

                if (row.type === 'project-header') {
                  const rgb = hexToRgb(row.project.color)
                  return (
                    <div key={row.id} style={{ height: ROW_H, display: 'flex', alignItems: 'center', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-light)', position: 'relative' }}>
                      {(() => {
                        const s = safeDate(row.project.start_date)
                        const e = safeDate(row.project.end_date)
                        if (!s || !e) return null
                        const x1 = clamp(dateToX(s, rangeStart, cellW), 0, totalW)
                        const x2 = clamp(dateToX(addDays(e, 1), rangeStart, cellW), 0, totalW)
                        const bw = Math.max(x2 - x1, 4)
                        return (
                          <div style={{ position: 'absolute', left: x1, width: bw, top: 18, height: 20, borderRadius: 5,
                            background: `linear-gradient(180deg, rgba(${rgb.join(',')},0.22), rgba(${rgb.join(',')},0.14))`,
                            border: `1px solid rgba(${rgb.join(',')},0.45)`, pointerEvents: 'none' }} />
                        )
                      })()}
                    </div>
                  )
                }

                if (row.type === 'milestone') {
                  const ms = row.milestone
                  const d  = safeDate(ms.due_date)
                  if (!d) return <div key={row.id} style={{ height: ROW_H, borderBottom: '1px solid var(--border-light)', background: rowBg }} />
                  const x = clamp(dateToX(d, rangeStart, cellW) + cellW / 2, 0, totalW)
                  const c = ms.is_completed ? 'var(--success)' : 'var(--accent-primary)'
                  return (
                    <div key={row.id} style={{ height: ROW_H, position: 'relative', borderBottom: '1px solid var(--border-light)', background: rowBg }}>
                      <div title={`${ms.title} · ${format(d, 'd MMM yyyy')}`} style={{
                        position: 'absolute', left: x - 9, top: ROW_H / 2 - 9, width: 18, height: 18,
                        background: c, transform: 'rotate(45deg)', zIndex: 5,
                        boxShadow: `0 2px 6px rgba(0,0,0,0.15), 0 0 0 3px rgba(255,255,255,0.9), 0 0 0 4px ${c}40`,
                        borderRadius: 3,
                      }} />
                    </div>
                  )
                }

                /* task row */
                const task = row.task
                const geo  = getBarGeometry(task)
                const rgb  = hexToRgb(row.project.color)
                const statusC = STATUS_COLORS[task.status] || '#9E9E9E'
                const isDone = task.status === 'Done'
                const isDragging = dragRef.current && dragRef.current.taskId === task.id
                const progress = STATUS_PROGRESS[task.status] ?? 0

                return (
                  <div key={row.id} style={{ height: ROW_H, position: 'relative', borderBottom: '1px solid var(--border-light)', background: rowBg }}>
                    {geo && (
                      <TaskBar
                        task={task}
                        geo={geo}
                        rgb={rgb}
                        statusC={statusC}
                        isDone={isDone}
                        isDragging={isDragging}
                        progress={progress}
                        rowH={ROW_H}
                        onMouseDown={(e, type) => beginDrag(e, task, type, geo.startD, geo.endD)}
                        onDoubleClick={() => setEditModal({ ...task, start_date: task.start_date || '', due_date: task.due_date || '' })}
                      />
                    )}
                  </div>
                )
              })}

              {rows.length === 0 && (
                <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  No tasks match the current filters.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Drag Tooltip ── */}
      {dragTip && (
        <div style={{
          position: 'fixed', left: dragTip.x + 14, top: dragTip.y + 14,
          background: 'var(--text-primary)', color: 'white',
          padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
          pointerEvents: 'none', zIndex: 1000, whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        }}>{dragTip.text}</div>
      )}

      {/* ── Edit Modal ── */}
      {editModal && (
        <div className="modal-overlay" onClick={() => setEditModal(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-header-title">Edit Task</span>
              <button className="modal-close-btn" onClick={() => setEditModal(null)}><X size={14} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label className="form-label">Task Title *</label>
                <input className="form-input" value={editModal.title} onChange={e => setEditModal(m => ({ ...m, title: e.target.value }))} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Start Date</label>
                  <input className="form-input" type="date" value={editModal.start_date} onChange={e => setEditModal(m => ({ ...m, start_date: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Due Date</label>
                  <input className="form-input" type="date" value={editModal.due_date} onChange={e => setEditModal(m => ({ ...m, due_date: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={editModal.status} onChange={e => setEditModal(m => ({ ...m, status: e.target.value }))}>
                    {['To Do','In Progress','In Review','Done'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={editModal.priority} onChange={e => setEditModal(m => ({ ...m, priority: e.target.value }))}>
                    {['Low','Medium','High'].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Assignee</label>
                <select className="form-select" value={editModal.assignee_id || ''} onChange={e => setEditModal(m => ({ ...m, assignee_id: e.target.value }))}>
                  <option value="">— Unassigned —</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={!editModal.title || saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────── Task Bar Component ─────────────────────── */
function TaskBar({ task, geo, rgb, statusC, isDone, isDragging, progress, rowH, onMouseDown, onDoubleClick }) {
  const [hover, setHover] = useState(false)
  const barH = rowH - 22
  const showLabel = geo.width > 70
  const showAssignee = task.assignee && geo.width > 50

  const baseRgba = (a) => `rgba(${rgb.join(',')},${a})`
  const doneRgba = (a) => `rgba(76,175,125,${a})`

  const fillBg = isDone
    ? `linear-gradient(180deg, ${doneRgba(0.28)} 0%, ${doneRgba(0.18)} 100%)`
    : `linear-gradient(180deg, ${baseRgba(0.30)} 0%, ${baseRgba(0.18)} 100%)`

  const borderC = isDone ? doneRgba(0.7) : baseRgba(0.65)

  return (
    <div
      title={`${task.title}\n${format(geo.startD,'d MMM')} → ${format(geo.endD,'d MMM')}\nStatus: ${task.status} · Priority: ${task.priority}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={e => onMouseDown(e, 'move')}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute', left: geo.x, width: geo.width,
        top: 11, height: barH,
        borderRadius: 7,
        background: fillBg,
        border: `1px solid ${borderC}`,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        display: 'flex', alignItems: 'center',
        overflow: 'hidden',
        zIndex: isDragging ? 8 : (hover ? 7 : 5),
        boxShadow: isDragging
          ? `0 6px 16px rgba(0,0,0,0.18), 0 0 0 2px ${baseRgba(0.4)}`
          : hover
            ? `0 3px 10px rgba(0,0,0,0.12)`
            : `0 1px 2px rgba(0,0,0,0.06)`,
        transform: hover && !isDragging ? 'translateY(-1px)' : 'none',
        transition: isDragging ? 'none' : 'box-shadow 0.15s, transform 0.15s',
      }}
    >
      {/* progress fill */}
      {progress > 0 && progress < 1 && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0,
          width: `${progress * 100}%`,
          background: `linear-gradient(180deg, ${baseRgba(0.18)}, ${baseRgba(0.10)})`,
          pointerEvents: 'none',
        }} />
      )}

      {/* status stripe (left) */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
        background: statusC, borderTopLeftRadius: 7, borderBottomLeftRadius: 7,
        pointerEvents: 'none',
      }} />

      {/* left resize handle */}
      <div
        onMouseDown={e => onMouseDown(e, 'resize-l')}
        style={{ width: 10, height: '100%', cursor: 'ew-resize', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 4, opacity: hover ? 1 : 0.0, transition: 'opacity 0.15s' }}
      >
        <GripVertical size={12} color={baseRgba(0.7)} />
      </div>

      {/* label */}
      <span style={{
        flex: 1, fontSize: 11, fontWeight: 600, color: 'var(--text-primary)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        paddingLeft: hover ? 2 : 10, paddingRight: 6,
        textDecoration: isDone ? 'line-through' : 'none',
        opacity: isDone ? 0.7 : 1,
        transition: 'padding-left 0.15s',
        position: 'relative', zIndex: 1,
      }}>
        {isDone && <Check size={11} style={{ verticalAlign: 'middle', marginRight: 4, color: 'var(--success)' }} />}
        {showLabel ? task.title : ''}
      </span>

      {/* assignee dot */}
      {showAssignee && (
        <div style={{
          width: 20, height: 20, borderRadius: '50%',
          background: task.assignee.color,
          backgroundImage: task.assignee.avatar_url ? `url("${task.assignee.avatar_url}")` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700, color: task.assignee.avatar_url ? 'transparent' : 'white', flexShrink: 0, marginRight: 6,
          boxShadow: '0 0 0 2px rgba(255,255,255,0.95)',
          position: 'relative', zIndex: 1,
        }} title={task.assignee.name}>
          {task.assignee.name.charAt(0)}
        </div>
      )}

      {/* right resize handle */}
      <div
        onMouseDown={e => onMouseDown(e, 'resize-r')}
        style={{ width: 10, height: '100%', cursor: 'ew-resize', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 4, opacity: hover ? 1 : 0.0, transition: 'opacity 0.15s' }}
      >
        <GripVertical size={12} color={baseRgba(0.7)} />
      </div>
    </div>
  )
}

/* ─────────────────────── Label Row Component ─────────────────────── */
function GanttLabelRow({ row, onEdit }) {
  if (row.type === 'project-header') {
    const p = row.project
    return (
      <div style={{ height: ROW_H, display: 'flex', alignItems: 'center', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
        <div style={{ width: TASK_COL_W, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-4)', flexShrink: 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
        </div>
        <div style={{ width: ASSIGNEE_COL_W, flexShrink: 0, borderLeft: '1px solid var(--border-light)' }} />
      </div>
    )
  }

  if (row.type === 'milestone') {
    const m = row.milestone
    return (
      <div style={{ height: ROW_H, display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
        <div style={{ width: TASK_COL_W, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-4)', flexShrink: 0 }}>
          <div style={{ width: 12, height: 12, background: m.is_completed ? 'var(--success)' : 'var(--accent-primary)', borderRadius: 2, transform: 'rotate(45deg)', flexShrink: 0, marginLeft: 16 }} />
          <span style={{ fontSize: 'var(--text-xs)', color: m.is_completed ? 'var(--text-muted)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: m.is_completed ? 'line-through' : 'none', flex: 1 }}>
            {m.title}
          </span>
          {m.due_date && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{format(parseISO(m.due_date), 'd MMM')}</span>}
        </div>
        <div style={{ width: ASSIGNEE_COL_W, flexShrink: 0, borderLeft: '1px solid var(--border-light)' }} />
      </div>
    )
  }

  const task = row.task
  const PRIORITY_DOT = { High: '#E05252', Medium: '#F0A500', Low: '#4CAF7D' }

  return (
    <div
      style={{ height: ROW_H, display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-light)', flexShrink: 0, cursor: 'pointer', transition: 'background 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      onDoubleClick={() => onEdit(task)}
    >
      <div style={{ width: TASK_COL_W, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-3) 0 calc(var(--space-4) + 8px)', flexShrink: 0, overflow: 'hidden' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: PRIORITY_DOT[task.priority] || '#ccc', flexShrink: 0 }} />

        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: task.status === 'Done' ? 400 : 500, textDecoration: task.status === 'Done' ? 'line-through' : 'none' }}>
          {task.title}
        </span>

        <button className="icon-btn" style={{ padding: 2, opacity: 0.5, flexShrink: 0 }} onClick={e => { e.stopPropagation(); onEdit(task) }}>
          <Pencil size={11} />
        </button>
      </div>

      <div style={{ width: ASSIGNEE_COL_W, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-3)', flexShrink: 0, borderLeft: '1px solid var(--border-light)', overflow: 'hidden' }}>
        {task.assignee ? (
          <>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: task.assignee.color,
              backgroundImage: task.assignee.avatar_url ? `url("${task.assignee.avatar_url}")` : undefined,
              backgroundSize: 'cover', backgroundPosition: 'center',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 700, color: task.assignee.avatar_url ? 'transparent' : 'white', flexShrink: 0
            }}>
              {task.assignee.name.charAt(0)}
            </div>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
              {task.assignee.name}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>Unassigned</span>
        )}
      </div>
    </div>
  )
}
