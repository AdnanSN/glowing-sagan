import { useEffect, useMemo, useRef, useState } from 'react'
import { format, isSameDay } from 'date-fns'
import { MessageSquare, X, Trash2, Pencil, Check, AlertCircle } from 'lucide-react'
import { Avatar } from './Avatar'
import { useAuth } from '../lib/AuthContext'
import { safeDate } from '../lib/gantt'
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
   ──────────────────────────────────────────────────────────────── */

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
