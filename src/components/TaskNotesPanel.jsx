import { useEffect, useMemo, useRef, useState } from 'react'
import { differenceInDays, format, isSameDay, startOfDay } from 'date-fns'
import {
  MessageSquare, X, Trash2, Pencil, Check, AlertCircle, ChevronDown, Lock,
} from 'lucide-react'
import { Avatar } from './Avatar'
import { useAuth } from '../lib/AuthContext'
import { durationDays, isOverdue, safeDate } from '../lib/gantt'
import { assigneesOf } from '../lib/assignees'
import { addNote, deleteNote, fetchTaskNotes, noteDay, updateNote } from '../lib/notes'

/* ────────────────────────────────────────────────────────────────
   NOTES ON A SQUARE

   Click Tuesday 30 July on "Design & build tenders" and this opens
   beside the chart with whatever has been written on that day, and a
   box to add to it.

   It is docked rather than modal on purpose: the point of writing a
   note is that you are reading the chart, and a dialog over the top of
   the thing you are annotating would mean closing it to look at the
   next square. Clicking another square just swaps what is in here.

   Above the notes sits the line item itself — status, dates, who has
   it, what it actually says — because the question a square raises is
   usually about the task, and reading it off a 40-pixel bar is not
   reading. It sits above rather than below because it is the context
   you read the notes against, and anything under a scrolling list is
   something nobody finds. It is a read-out, not a form: double-clicking
   the row still opens the editor.
   ──────────────────────────────────────────────────────────────── */

const STATUS_TONE = {
  'To Do':       { bg: '#F3F4F6',              color: '#6B7280' },
  'In Progress': { bg: 'var(--info-light)',    color: 'var(--info)' },
  'In Review':   { bg: 'var(--warning-light)', color: 'var(--warning)' },
  'Done':        { bg: 'var(--success-light)', color: 'var(--success)' },
}

export function TaskNotesPanel({ task, cell, onClose, onNotesChanged, subtitle }) {
  const { user, userEmployee, profile, hasPermission } = useAuth()
  const canWrite     = hasPermission('add_task_notes')
  const canDeleteAny = hasPermission('delete_any_note')

  const from = noteDay(cell.start)
  const to   = noteDay(cell.end)
  const oneDay = isSameDay(cell.start, cell.end)
  const square = `${task.id}|${from}|${to}`

  /* Everything below is keyed to the square rather than reset when it
     changes: clicking along a bar swaps what the panel is showing on
     the next render, with no effect firing in between. The half-typed
     note in the box is the one thing deliberately left alone. */
  const [loaded,  setLoaded]  = useState(null)   // { taskId, notes }
  const [error,   setError]   = useState('')
  const [busy,    setBusy]    = useState(false)

  const [draft,     setDraft]     = useState('')
  const [dated,     setDated]     = useState(null) // { square, value }
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  const [allFor,    setAllFor]    = useState(null) // square shown whole

  const listRef = useRef(null)

  const notes   = useMemo(() => (loaded?.taskId === task.id ? loaded.notes : []), [loaded, task.id])
  const loading = loaded?.taskId !== task.id
  // A new square files its note on the day you clicked, unless you have
  // said otherwise since.
  const draftDate = dated?.square === square ? dated.value : from
  // Widened from the clicked square to the whole line item.
  const showAll = allFor === square

  /* Notes are loaded per task and filtered to the square here — a line
     has tens at most, and having them already in hand is what makes
     "show everything" instant. */
  useEffect(() => {
    let live = true
    fetchTaskNotes(task.id).then(({ notes: rows, error: err }) => {
      if (!live) return
      if (err) setError(err.message)
      setLoaded({ taskId: task.id, notes: rows })
    })
    return () => { live = false }
  }, [task.id])

  const visible = useMemo(
    () => (showAll ? notes : notes.filter(n => n.note_date >= from && n.note_date <= to)),
    [notes, showAll, from, to]
  )

  // Newest first: on a day with a running commentary, the last word is
  // the one you came to read.
  const ordered = useMemo(
    () => [...visible].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    [visible]
  )

  const elsewhere = notes.length - notes.filter(n => n.note_date >= from && n.note_date <= to).length

  /* Tell the chart which squares to mark, without it having to re-read
     the table after every keystroke's worth of work. */
  function publish(next) {
    setLoaded({ taskId: task.id, notes: next })
    onNotesChanged?.(task.id, [...new Set(next.map(n => n.note_date))])
  }

  async function submit() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setError('')
    const { note, error: err } = await addNote({
      taskId: task.id,
      date: draftDate || from,
      body,
      author: userEmployee,
      authorName: profile?.full_name || user?.email || 'Unknown',
    })
    setBusy(false)
    if (err) { setError(err.message); return }
    setDraft('')
    publish([...notes, note])
    // A note filed on a day outside the square would otherwise save into
    // silence — widen so it is visible where it landed.
    if (note.note_date < from || note.note_date > to) setAllFor(square)
    listRef.current?.scrollTo({ top: 0 })
  }

  async function saveEdit(note) {
    const body = editDraft.trim()
    if (!body) return
    if (body === note.body) { setEditingId(null); return }
    setBusy(true)
    const { note: saved, error: err } = await updateNote(note.id, { body })
    setBusy(false)
    if (err) { setError(err.message); return }
    setEditingId(null)
    publish(notes.map(n => (n.id === note.id ? saved : n)))
  }

  async function remove(note) {
    if (!confirm('Delete this note?')) return
    const keep = notes.filter(n => n.id !== note.id)
    publish(keep)
    const { error: err } = await deleteNote(note.id)
    if (err) { setError(err.message); publish(notes) }
  }

  const mine = note => note.created_by && note.created_by === user?.id

  const heading = oneDay
    ? format(cell.start, 'EEEE, d MMMM yyyy')
    : `${format(cell.start, 'd MMM')} – ${format(cell.end, 'd MMM yyyy')}`

  return (
    <aside className="gantt-notes" aria-label="Notes">
      <div className="gantt-notes-head">
        <div className="gantt-notes-head-text">
          <span className="gantt-notes-task" title={task.title}>{task.title}</span>
          <span className="gantt-notes-day">
            <MessageSquare size={11} />
            {showAll ? 'Every note on this line' : heading}
          </span>
          {subtitle && <span className="gantt-notes-sub">{subtitle}</span>}
        </div>
        <button className="icon-btn" onClick={onClose} title="Close notes"><X size={15} /></button>
      </div>

      {error && (
        <div className="gantt-notes-error">
          <AlertCircle size={13} />
          <span>{error}</span>
        </div>
      )}

      {canWrite && (
        <div className="gantt-notes-compose">
          <textarea
            className="gantt-notes-input"
            rows={3}
            placeholder={oneDay
              ? `What happened on ${format(cell.start, 'EEEE d MMM')}?`
              : 'Write a note for this week…'}
            value={draft}
            disabled={busy}
            onChange={e => setDraft(e.target.value)}
            // Ctrl/⌘+Enter posts. Plain Enter is a new line — these run
            // to a paragraph more often than a chat message does.
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
            }}
          />
          <div className="gantt-notes-compose-row">
            <input
              className="gantt-notes-date"
              type="date"
              value={draftDate || ''}
              disabled={busy}
              title="The day this note is about"
              onChange={e => setDated({ square, value: e.target.value })}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={!draft.trim() || busy}
              onClick={submit}
            >
              {busy ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </div>
      )}

      <TaskDetails task={task} canEdit={hasPermission('manage_tasks')} />

      <div className="gantt-notes-list" ref={listRef}>
        {loading && <div className="gantt-notes-empty">Loading notes…</div>}

        {!loading && !ordered.length && (
          <div className="gantt-notes-empty">
            {showAll
              ? 'Nothing has been noted on this line item yet.'
              : `No notes on ${oneDay ? 'this day' : 'these dates'} yet.`}
          </div>
        )}

        {!loading && ordered.map(note => {
          const when = safeDate(note.created_at)
          const edited = note.updated_at && note.updated_at !== note.created_at
          const editing = editingId === note.id

          return (
            <div className="gantt-note" key={note.id}>
              <div className="gantt-note-head">
                <Avatar
                  name={note.author?.name || note.author_name || '?'}
                  src={note.author?.avatar_url}
                  color={note.author?.color || '#6B7280'}
                  size="sm"
                />
                <span className="gantt-note-author">
                  {note.author?.name || note.author_name || 'Unknown'}
                </span>
                <span className="gantt-note-when">
                  {when ? format(when, 'd MMM, HH:mm') : ''}{edited ? ' · edited' : ''}
                </span>

                {/* Which square it is on only matters when the list is
                    showing more than one. */}
                {showAll && (
                  <span className="gantt-note-tag">
                    {format(safeDate(note.note_date), 'd MMM')}
                  </span>
                )}

                <span className="gantt-note-actions">
                  {mine(note) && !editing && (
                    <button className="gantt-note-btn" title="Edit note"
                      onClick={() => { setEditingId(note.id); setEditDraft(note.body) }}>
                      <Pencil size={12} />
                    </button>
                  )}
                  {(mine(note) || canDeleteAny) && (
                    <button className="gantt-note-btn danger" title="Delete note"
                      onClick={() => remove(note)}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </span>
              </div>

              {editing ? (
                <div className="gantt-note-edit">
                  <textarea
                    className="gantt-notes-input"
                    rows={3}
                    value={editDraft}
                    autoFocus
                    onChange={e => setEditDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(note) }
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                  <div className="gantt-note-edit-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                    <button className="btn btn-primary btn-sm"
                      disabled={!editDraft.trim() || busy} onClick={() => saveEdit(note)}>
                      <Check size={13} /> Save
                    </button>
                  </div>
                </div>
              ) : (
                <p className="gantt-note-body">{note.body}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* The way back to a note you know exists but cannot find the
          square for. */}
      {!loading && (showAll || elsewhere > 0) && (
        <button className="gantt-notes-scope" onClick={() => setAllFor(showAll ? null : square)}>
          {showAll
            ? `Show only ${oneDay ? 'this day' : 'these dates'}`
            : `Show all ${notes.length} notes on this line item`}
        </button>
      )}

      {!canWrite && (
        <div className="gantt-notes-foot">Your role can read notes but not write them.</div>
      )}
    </aside>
  )
}

/**
 * The line item behind the square, read-only. Collapsible because on a
 * laptop the notes and this are competing for the same 500 pixels, and
 * which one you want depends on why you opened the panel.
 */
function TaskDetails({ task, canEdit }) {
  const [open, setOpen] = useState(true)

  const start = safeDate(task.start_date)
  const due   = safeDate(task.due_date)
  const days  = durationDays(task.start_date, task.due_date)
  const late  = isOverdue(task)
  const lateBy = late ? differenceInDays(startOfDay(new Date()), startOfDay(due)) : 0
  const pct   = Math.max(0, Math.min(100, Number(task.progress) || 0))
  const people = assigneesOf(task)
  const tone  = STATUS_TONE[task.status] || STATUS_TONE['To Do']

  return (
    <div className="gantt-details">
      <button
        className="gantt-details-toggle"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <ChevronDown size={13} style={{ transform: open ? 'none' : 'rotate(-90deg)' }} />
        <span>Task details</span>
        {!open && (
          <span className="gantt-details-peek" style={{ color: tone.color }}>
            {task.status} · {pct}%
          </span>
        )}
      </button>

      {open && (
        <div className="gantt-details-body">
          <dl className="gantt-details-grid">
            <dt>Status</dt>
            <dd>
              <span className="gantt-details-chip" style={{ background: tone.bg, color: tone.color }}>
                {task.status}
              </span>
            </dd>

            <dt>Priority</dt>
            <dd className={`gantt-details-priority priority-${String(task.priority || '').toLowerCase()}`}>
              <span className="priority-dot" />{task.priority || '—'}
            </dd>

            <dt>Progress</dt>
            <dd className="gantt-details-progress">
              <span className="progress-bar-container">
                <span className="progress-bar-fill" style={{ display: 'block', width: `${pct}%` }} />
              </span>
              <span className="gantt-details-pct">{pct}%</span>
            </dd>

            <dt>Start</dt>
            <dd>{start ? format(start, 'd MMM yyyy') : '—'}</dd>

            <dt>Due</dt>
            <dd className={late ? 'gantt-details-late' : undefined}>
              {due ? format(due, 'd MMM yyyy') : '—'}
              {late && <span className="gantt-details-lateby">{lateBy}d late</span>}
            </dd>

            <dt>Duration</dt>
            <dd>{days ? `${days} day${days === 1 ? '' : 's'}` : '—'}</dd>

            {/* Named in full rather than stacked: this is the one place
                with room for it, and "who is actually on this" is half
                of why the panel gets opened. */}
            <dt>{people.length > 1 ? 'Assigned to' : 'Assignee'}</dt>
            <dd className="gantt-details-people">
              {people.length ? people.map(p => (
                <span key={p.id} className="gantt-details-person">
                  <Avatar name={p.name} src={p.avatar_url} color={p.color} size="sm" />
                  <span>{p.name}</span>
                </span>
              )) : 'Unassigned'}
            </dd>

            {/* Only one of these is ever set per page — the project
                timeline groups by stage, the team schedule spans
                projects — so whichever is there is the one that
                places the line. */}
            {task.stage && (<><dt>Stage</dt><dd>{task.stage}</dd></>)}
            {task.project?.name && (<><dt>Project</dt><dd>{task.project.name}</dd></>)}
          </dl>

          {task.description && (
            <div className="gantt-details-desc">
              <span className="gantt-details-desc-head">Description</span>
              <p>{task.description}</p>
            </div>
          )}

          {task.is_confidential && (
            <div className="gantt-details-locked">
              <Lock size={11} /> Principal Architects only
            </div>
          )}

          {canEdit && (
            <div className="gantt-details-hint">Double-click the row to edit it.</div>
          )}
        </div>
      )}
    </div>
  )
}
