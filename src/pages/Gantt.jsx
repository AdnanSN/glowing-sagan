import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { STAGES, STAGE_COLORS, PRIORITIES } from '../lib/constants'
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  BarChart2, Users, Filter, RefreshCw, Plus,
  Flag, Check, Calendar, Pencil, X
} from 'lucide-react'
import { format, addDays, startOfWeek, endOfWeek, differenceInDays,
         addWeeks, subWeeks, parseISO, isToday, isWeekend,
         startOfMonth, endOfMonth, isSameMonth } from 'date-fns'

/* ─────────────────────────── helpers ────────────────────────────── */
const CELL_W_DEFAULT = 48   // px per day at zoom=1
const ROW_H          = 52
const LABEL_W        = 260

const PRIORITY_COLORS = { Low: '#4CAF7D', Medium: '#F0A500', High: '#E05252' }
const STATUS_COLORS   = {
  'To Do':      '#9E9E9E',
  'In Progress':'#4A90D9',
  'In Review':  '#8B7EC8',
  'Done':       '#4CAF7D',
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function safeDate(str) {
  if (!str) return null
  try { return parseISO(str) } catch { return null }
}

function dateToX(date, rangeStart, cellW) {
  return differenceInDays(date, rangeStart) * cellW
}

function xToDate(x, rangeStart, cellW) {
  return addDays(rangeStart, Math.round(x / cellW))
}

/* ─────────────────────────── colour utility ──────────────────────── */
function hexToRgb(hex) {
  const m = hex.replace('#','').match(/.{2}/g)
  return m ? m.map(h => parseInt(h,16)) : [200,169,110]
}

/* ─────────────────────────── main component ─────────────────────── */
export function Gantt() {
  /* state */
  const [projects,  setProjects]  = useState([])
  const [tasks,     setTasks]     = useState([])
  const [milestones,setMilestones]= useState([])
  const [employees, setEmployees] = useState([])
  const [loading,   setLoading]   = useState(true)

  const [filterProject, setFilterProject] = useState('all')
  const [filterAssignee,setFilterAssignee]= useState('all')
  const [viewMode,  setViewMode]  = useState('week')   // 'week' | 'month'
  const [cellW,     setCellW]     = useState(CELL_W_DEFAULT)
  const [rangeStart,setRangeStart]= useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [rangeWeeks,setRangeWeeks]= useState(16)

  const [editModal, setEditModal] = useState(null)   // task being edited inline
  const [saving,    setSaving]    = useState(false)

  const scrollRef  = useRef(null)
  const dragRef    = useRef(null)  // { taskId, type: 'move'|'resize-l'|'resize-r', startX, origStart, origEnd }

  const rangeEnd = addDays(rangeStart, rangeWeeks * 7 - 1)
  const totalDays= rangeWeeks * 7
  const totalW   = totalDays * cellW

  /* ── fetch ── */
  async function fetchAll() {
    setLoading(true)
    const [p, t, m, e] = await Promise.all([
      supabase.from('projects').select('id,name,color,start_date,end_date,status').order('name'),
      supabase.from('tasks').select('*, assignee:employees(id,name,color)').order('created_at'),
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
    if (filterProject !== 'all' && t.project_id !== filterProject) return false
    if (filterAssignee !== 'all' && t.assignee_id !== filterAssignee) return false
    return true
  })

  /* group by project */
  const grouped = projects
    .filter(p => filterProject === 'all' || p.id === filterProject)
    .map(proj => ({
      project: proj,
      tasks: filteredTasks.filter(t => t.project_id === proj.id),
      milestones: milestones.filter(m => m.project_id === proj.id),
    }))
    .filter(g => g.tasks.length > 0 || g.milestones.length > 0)

  /* build flat row list */
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
  function zoomIn()    { setCellW(w => clamp(w + 8, 20, 120)) }
  function zoomOut()   { setCellW(w => clamp(w - 8, 20, 120)) }

  /* ── header cols: weeks ── */
  const weekHeaders = []
  let cur = rangeStart
  while (cur <= rangeEnd) {
    const wEnd = endOfWeek(cur, { weekStartsOn: 1 })
    const days  = []
    let d = cur
    while (d <= wEnd && d <= rangeEnd) { days.push(d); d = addDays(d, 1) }
    weekHeaders.push({ weekStart: cur, days })
    cur = addDays(wEnd, 1)
  }

  /* ── drag logic ── */
  const onBarMouseDown = useCallback((e, taskId, type, origStart, origEnd) => {
    e.preventDefault()
    dragRef.current = { taskId, type, startX: e.clientX, origStart, origEnd }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [cellW, rangeStart, tasks])

  const onMouseMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    const dx    = e.clientX - d.startX
    const dDays = Math.round(dx / cellW)

    setTasks(prev => prev.map(t => {
      if (t.id !== d.taskId) return t
      let newS = d.origStart, newE = d.origEnd
      if (d.type === 'move')     { newS = addDays(d.origStart, dDays); newE = addDays(d.origEnd, dDays) }
      if (d.type === 'resize-l') { newS = addDays(d.origStart, dDays); if (newS >= newE) newS = addDays(newE, -1) }
      if (d.type === 'resize-r') { newE = addDays(d.origEnd,   dDays); if (newE <= newS) newE = addDays(newS, 1)  }
      return { ...t, _tempStart: newS, _tempEnd: newE }
    }))
  }, [cellW])

  const onMouseUp = useCallback(async () => {
    const d = dragRef.current
    dragRef.current = null
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    if (!d) return

    /* persist */
    const task = tasks.find(t => t.id === d.taskId)
    if (!task) return
    const newStart = task._tempStart || safeDate(task.start_date)
    const newEnd   = task._tempEnd   || safeDate(task.due_date)
    await supabase.from('tasks').update({
      start_date: newStart ? format(newStart, 'yyyy-MM-dd') : null,
      due_date:   newEnd   ? format(newEnd,   'yyyy-MM-dd') : null,
      updated_at: new Date().toISOString()
    }).eq('id', d.taskId)

    setTasks(prev => prev.map(t => {
      if (t.id !== d.taskId) return t
      return { ...t, start_date: newStart ? format(newStart,'yyyy-MM-dd') : t.start_date, due_date: newEnd ? format(newEnd,'yyyy-MM-dd') : t.due_date, _tempStart: null, _tempEnd: null }
    }))
  }, [tasks, onMouseMove])

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

  /* ── bar positions ── */
  function getBarGeometry(task) {
    const startD = task._tempStart || safeDate(task.start_date) || safeDate(task.created_at)
    const endD   = task._tempEnd   || safeDate(task.due_date)

    if (!startD && !endD) return null
    const s = startD || endD
    const e = endD   || addDays(s, 3)

    const x1 = clamp(dateToX(s, rangeStart, cellW), 0, totalW)
    const x2 = clamp(dateToX(e, rangeStart, cellW), 0, totalW)
    const w  = Math.max(x2 - x1, cellW * 0.5)
    return { x: x1, width: w, startD: s, endD: e }
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

        {/* Project filter */}
        <select className="form-select" style={{ width: 180, height: 34, padding: '0 10px', fontSize: 'var(--text-xs)' }}
          value={filterProject} onChange={e => setFilterProject(e.target.value)}>
          <option value="all">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Assignee filter */}
        <select className="form-select" style={{ width: 160, height: 34, padding: '0 10px', fontSize: 'var(--text-xs)' }}
          value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
          <option value="all">All members</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>

        <div style={{ flex: 1 }} />

        {/* Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="icon-btn" onClick={zoomOut} title="Zoom out"><ZoomOut size={15} /></button>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', minWidth: 28, textAlign: 'center' }}>{Math.round((cellW / CELL_W_DEFAULT) * 100)}%</span>
          <button className="icon-btn" onClick={zoomIn} title="Zoom in"><ZoomIn size={15} /></button>
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="icon-btn" onClick={goBack}><ChevronLeft size={16} /></button>
          <button className="btn btn-sm btn-secondary" onClick={goToday} style={{ minWidth: 64 }}>Today</button>
          <button className="icon-btn" onClick={goForward}><ChevronRight size={16} /></button>
        </div>

        <button className="icon-btn" onClick={fetchAll} title="Refresh"><RefreshCw size={15} /></button>
      </div>

      {/* ── Gantt Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left label panel */}
        <div style={{ width: LABEL_W, flexShrink: 0, borderRight: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
          {/* Header placeholder */}
          <div style={{ height: 72, borderBottom: '1px solid var(--border-light)', flexShrink: 0, padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'flex-end' }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Task / Milestone</span>
          </div>
          {/* Rows */}
          <div style={{ overflowY: 'auto', flex: 1 }} id="gantt-label-scroll">
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
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }} ref={scrollRef}
          onScroll={e => {
            const lbl = document.getElementById('gantt-label-scroll')
            if (lbl) lbl.scrollTop = e.currentTarget.scrollTop
          }}>
          <div style={{ width: totalW, minWidth: '100%', position: 'relative' }}>

            {/* ── Time header ── */}
            <div style={{ height: 72, position: 'sticky', top: 0, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', zIndex: 20 }}>
              {/* Week row */}
              <div style={{ display: 'flex', height: 28, borderBottom: '1px solid var(--border-light)' }}>
                {weekHeaders.map((wh, i) => (
                  <div key={i} style={{ width: wh.days.length * cellW, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 6px', borderRight: '1px solid var(--border-light)', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    {format(wh.weekStart, 'd MMM')} – {format(endOfWeek(wh.weekStart, { weekStartsOn: 1 }), 'd MMM')}
                  </div>
                ))}
              </div>
              {/* Day row */}
              <div style={{ display: 'flex', height: 44 }}>
                {weekHeaders.map((wh, wi) =>
                  wh.days.map((day, di) => {
                    const isWE = isWeekend(day)
                    const isTD = isToday(day)
                    return (
                      <div key={`${wi}-${di}`} style={{
                        width: cellW, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        borderRight: '1px solid rgba(0,0,0,0.04)',
                        background: isTD ? 'rgba(200,169,110,0.12)' : isWE ? 'rgba(0,0,0,0.025)' : 'transparent',
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
              {/* weekend shade columns */}
              {weekHeaders.map((wh, wi) =>
                wh.days.map((day, di) => {
                  if (!isWeekend(day)) return null
                  const x = dateToX(day, rangeStart, cellW)
                  return <div key={`shade-${wi}-${di}`} style={{ position: 'absolute', top: 0, bottom: 0, left: x, width: cellW, background: 'rgba(0,0,0,0.02)', pointerEvents: 'none' }} />
                })
              )}

              {/* today line */}
              {todayX >= 0 && todayX <= totalW && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: todayX + cellW / 2, width: 2, background: 'var(--accent-primary)', opacity: 0.7, zIndex: 10, pointerEvents: 'none' }}>
                  <div style={{ position: 'absolute', top: -6, left: -5, width: 12, height: 12, borderRadius: '50%', background: 'var(--accent-primary)' }} />
                </div>
              )}

              {/* Rows */}
              {rows.map((row, ri) => {
                const isEven = ri % 2 === 0
                if (row.type === 'project-header') {
                  return (
                    <div key={row.id} style={{ height: ROW_H, display: 'flex', alignItems: 'center', background: isEven ? 'var(--bg-tertiary)' : 'rgba(0,0,0,0.015)', borderBottom: '1px solid var(--border-light)', position: 'relative' }}>
                      {/* vertical grid lines */}
                      {weekHeaders.map((wh, wi) => (
                        <div key={wi} style={{ position: 'absolute', left: wh.days.length * cellW * wi + (wi > 0 ? weekHeaders.slice(0,wi).reduce((a,h) => a + h.days.length * cellW, 0) : 0), top: 0, bottom: 0, width: 1, background: 'var(--border-light)', pointerEvents: 'none' }} />
                      ))}
                      {/* project bar spanning project dates */}
                      {(() => {
                        const s = safeDate(row.project.start_date)
                        const e = safeDate(row.project.end_date)
                        if (!s || !e) return null
                        const rgb = hexToRgb(row.project.color)
                        const x1 = clamp(dateToX(s, rangeStart, cellW), 0, totalW)
                        const x2 = clamp(dateToX(e, rangeStart, cellW), 0, totalW)
                        const bw = Math.max(x2 - x1, 4)
                        return (
                          <div style={{ position: 'absolute', left: x1, width: bw, top: 14, height: 24, borderRadius: 4, background: `rgba(${rgb.join(',')},0.18)`, border: `1.5px solid rgba(${rgb.join(',')},0.5)`, pointerEvents: 'none' }} />
                        )
                      })()}
                    </div>
                  )
                }

                if (row.type === 'milestone') {
                  const ms = row.milestone
                  const d  = safeDate(ms.due_date)
                  if (!d) return <div key={row.id} style={{ height: ROW_H, borderBottom: '1px solid var(--border-light)', background: isEven ? 'transparent' : 'rgba(0,0,0,0.015)' }} />
                  const x = clamp(dateToX(d, rangeStart, cellW) + cellW / 2, 0, totalW)
                  return (
                    <div key={row.id} style={{ height: ROW_H, position: 'relative', borderBottom: '1px solid var(--border-light)', background: isEven ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                      {/* diamond milestone marker */}
                      <div style={{ position: 'absolute', left: x - 8, top: ROW_H / 2 - 8, width: 16, height: 16, borderRadius: 2, background: ms.is_completed ? 'var(--success)' : 'var(--accent-primary)', transform: 'rotate(45deg)', zIndex: 5 }} title={ms.title} />
                    </div>
                  )
                }

                /* task row */
                const task = row.task
                const geo  = getBarGeometry(task)
                const rgb  = hexToRgb(row.project.color)

                return (
                  <div key={row.id} style={{ height: ROW_H, position: 'relative', borderBottom: '1px solid var(--border-light)', background: isEven ? 'transparent' : 'rgba(0,0,0,0.015)' }}>

                    {geo && (
                      <div
                        title={`${task.title}\n${format(geo.startD,'d MMM')} → ${format(geo.endD,'d MMM')}`}
                        style={{
                          position: 'absolute', left: geo.x, width: geo.width,
                          top: 10, height: ROW_H - 20,
                          borderRadius: 6,
                          background: task.status === 'Done'
                            ? `rgba(76,175,125,0.18)`
                            : `rgba(${rgb.join(',')},0.15)`,
                          border: `1.5px solid ${task.status === 'Done' ? 'rgba(76,175,125,0.6)' : `rgba(${rgb.join(',')},0.55)`}`,
                          cursor: 'grab',
                          userSelect: 'none',
                          display: 'flex', alignItems: 'center',
                          overflow: 'hidden',
                          zIndex: 5,
                          transition: dragRef.current ? 'none' : 'box-shadow 0.15s',
                        }}
                        onMouseDown={e => onBarMouseDown(e, task.id, 'move', geo.startD, geo.endD)}
                        onDoubleClick={() => setEditModal({ ...task, start_date: task.start_date || '', due_date: task.due_date || '' })}
                      >
                        {/* left resize handle */}
                        <div style={{ width: 8, height: '100%', cursor: 'ew-resize', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onMouseDown={e => { e.stopPropagation(); onBarMouseDown(e, task.id, 'resize-l', geo.startD, geo.endD) }}>
                          <div style={{ width: 2, height: 14, borderRadius: 1, background: `rgba(${rgb.join(',')},0.5)` }} />
                        </div>

                        {/* bar label */}
                        <span style={{ flex: 1, fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 4 }}>
                          {task.status === 'Done' && <Check size={10} style={{ verticalAlign: 'middle', marginRight: 3, color: 'var(--success)' }} />}
                          {geo.width > 60 ? task.title : ''}
                        </span>

                        {/* assignee dot */}
                        {task.assignee && geo.width > 40 && (
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: task.assignee.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: 'white', flexShrink: 0, marginRight: 4 }} title={task.assignee.name}>
                            {task.assignee.name.charAt(0)}
                          </div>
                        )}

                        {/* right resize handle */}
                        <div style={{ width: 8, height: '100%', cursor: 'ew-resize', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onMouseDown={e => { e.stopPropagation(); onBarMouseDown(e, task.id, 'resize-r', geo.startD, geo.endD) }}>
                          <div style={{ width: 2, height: 14, borderRadius: 1, background: `rgba(${rgb.join(',')},0.5)` }} />
                        </div>
                      </div>
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

/* ─────────────────────── Label Row Component ─────────────────────── */
function GanttLabelRow({ row, onEdit }) {
  if (row.type === 'project-header') {
    const p = row.project
    return (
      <div style={{ height: ROW_H, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-4)', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.02em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
      </div>
    )
  }

  if (row.type === 'milestone') {
    const m = row.milestone
    return (
      <div style={{ height: ROW_H, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-4)', borderBottom: '1px solid var(--border-light)', flexShrink: 0 }}>
        <div style={{ width: 12, height: 12, background: m.is_completed ? 'var(--success)' : 'var(--accent-primary)', borderRadius: 2, transform: 'rotate(45deg)', flexShrink: 0, marginLeft: 16 }} />
        <span style={{ fontSize: 'var(--text-xs)', color: m.is_completed ? 'var(--text-muted)' : 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: m.is_completed ? 'line-through' : 'none' }}>
          {m.title}
        </span>
        {m.due_date && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{format(parseISO(m.due_date), 'd MMM')}</span>}
      </div>
    )
  }

  const task = row.task
  const PRIORITY_DOT = { High: '#E05252', Medium: '#F0A500', Low: '#4CAF7D' }

  return (
    <div
      style={{ height: ROW_H, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-3) 0 calc(var(--space-4) + 8px)', borderBottom: '1px solid var(--border-light)', flexShrink: 0, cursor: 'pointer', transition: 'background 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      onDoubleClick={() => onEdit(task)}
    >
      {/* priority dot */}
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: PRIORITY_DOT[task.priority] || '#ccc', flexShrink: 0 }} />

      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: task.status === 'Done' ? 400 : 500, textDecoration: task.status === 'Done' ? 'line-through' : 'none' }}>
        {task.title}
      </span>

      {task.assignee && (
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: task.assignee.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'white', flexShrink: 0 }} title={task.assignee.name}>
          {task.assignee.name.charAt(0)}
        </div>
      )}

      <button className="icon-btn" style={{ padding: 2, opacity: 0.5, flexShrink: 0 }} onClick={e => { e.stopPropagation(); onEdit(task) }}>
        <Pencil size={11} />
      </button>
    </div>
  )
}
