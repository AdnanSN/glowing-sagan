import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameMonth, isToday } from 'date-fns'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

export function Calendar() {
  const [milestones, setMilestones] = useState([])
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [current, setCurrent] = useState(new Date())
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [m, t, p] = await Promise.all([
      supabase.from('milestones').select('*, project:projects(id,name,color)').order('due_date'),
      supabase.from('tasks').select('id,title,due_date,project:projects(id,name,color)').not('due_date', 'is', null),
      supabase.from('projects').select('id,name,color,end_date').order('name'),
    ])
    setMilestones(m.data || [])
    setTasks(t.data || [])
    setProjects(p.data || [])
    setLoading(false)
  }

  const monthStart = startOfMonth(current)
  const monthEnd = endOfMonth(current)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startPad = getDay(monthStart)
  const paddedDays = [...Array(startPad).fill(null), ...days]

  function getEventsForDay(day) {
    if (!day) return []
    const dayStr = format(day, 'yyyy-MM-dd')
    const events = []
    milestones.filter(m => m.due_date === dayStr).forEach(m =>
      events.push({ label: `🏁 ${m.title}`, color: m.project?.color || '#C8A96E', type: 'milestone' })
    )
    tasks.filter(t => t.due_date === dayStr).forEach(t =>
      events.push({ label: t.title, color: t.project?.color || '#4A90D9', type: 'task' })
    )
    return events
  }

  const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // Upcoming milestones list
  const upcoming = milestones.filter(m => !m.is_completed && m.due_date && new Date(m.due_date) >= new Date()).slice(0, 8)

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-header-title">Calendar</span>
          <span className="page-header-sub">Milestones & task deadlines</span>
        </div>
        <div className="page-header-actions">
          <button className="icon-btn" onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-md)', minWidth: 140, textAlign: 'center' }}>
            {format(current, 'MMMM yyyy')}
          </span>
          <button className="icon-btn" onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
          <button className="btn btn-secondary btn-sm" onClick={() => setCurrent(new Date())}>Today</button>
        </div>
      </div>

      <div className="page-body">
        {loading ? (
          <div className="loading-container"><div className="loading-spinner" /><span>Loading…</span></div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 'var(--space-6)' }}>
            <div className="calendar-grid">
              {DAY_HEADERS.map(d => (
                <div key={d} className="calendar-day-header">{d}</div>
              ))}
              {paddedDays.map((day, i) => {
                const events = getEventsForDay(day)
                return (
                  <div key={i} className={`calendar-day${!day || !isSameMonth(day, current) ? ' other-month' : ''}${day && isToday(day) ? ' today' : ''}`}>
                    {day && <div className="calendar-day-num">{format(day, 'd')}</div>}
                    {events.slice(0, 3).map((ev, ei) => (
                      <div key={ei} className="calendar-event" style={{ background: ev.color }}>{ev.label}</div>
                    ))}
                    {events.length > 3 && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '1px 4px' }}>+{events.length - 3} more</div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <div className="card">
                <div className="card-header"><span className="card-title">Upcoming Milestones</span></div>
                <div className="card-body" style={{ paddingTop: 'var(--space-3)' }}>
                  {upcoming.length === 0 ? (
                    <div className="no-data">No upcoming milestones</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                      {upcoming.map(m => (
                        <div key={m.id} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.project?.color || 'var(--accent-primary)', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{m.title}</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                              {m.project?.name} · {m.due_date ? format(new Date(m.due_date), 'd MMM yyyy') : '—'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><span className="card-title">Projects Deadline</span></div>
                <div className="card-body" style={{ paddingTop: 'var(--space-3)' }}>
                  {projects.filter(p => p.end_date).length === 0 ? (
                    <div className="no-data">No deadlines set</div>
                  ) : (
                    projects.filter(p => p.end_date).slice(0, 6).map(p => (
                      <div key={p.id} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{p.name}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{format(new Date(p.end_date), 'd MMM yyyy')}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
