import { supabase } from './supabase'
import { format, parseISO } from 'date-fns'
import { ISO } from './gantt'

// Notes written on one square of a timeline chart — one line item, one
// day. Shared by the Project Timeline and the Team Schedule, which open
// the same panel from the same click.
//
// A line item runs for weeks; what happens on it does not. "Contractor
// says the steel is late" belongs to a Tuesday, and a flat list of
// comments on the task loses that as soon as there are three of them.
// So the day is part of the key, which is also what lets the chart draw
// a marker back onto the exact square a note was written on.
//
// The week-per-column chart asks for a seven-day range and the
// day-per-column chart asks for one day. Nothing here knows which — the
// column width is a view setting, not a property of a note.

const SELECT = `
  id, task_id, note_date, body, author_id, author_name, created_by,
  created_at, updated_at,
  author:employees(id, name, color, avatar_url)
`

/** A date, however it arrives, as the `yyyy-MM-dd` the column stores. */
export function noteDay(value) {
  if (!value) return null
  const d = value instanceof Date ? value : parseISO(String(value))
  return Number.isNaN(d.getTime()) ? null : format(d, ISO)
}

/**
 * Which squares carry a note, so the chart can mark them.
 *
 * Two columns and nothing else: this runs for every task on screen and
 * is only ever asked "is there anything here", so pulling note bodies
 * would be several hundred KB to render a 6px triangle.
 *
 * `taskIds` null means every note the reader is allowed to see — the
 * Team Schedule spans every project at once and listing its task ids
 * would put hundreds of uuids in a URL. RLS filters either way.
 *
 * → Map<taskId, Set<'yyyy-MM-dd'>>
 */
export async function fetchNoteMarks(taskIds = null) {
  let query = supabase.from('task_notes').select('task_id, note_date')
  if (taskIds) {
    if (!taskIds.length) return { marks: new Map(), error: null }
    query = query.in('task_id', taskIds)
  }

  const { data, error } = await query
  // No rows is the normal case on a chart nobody has annotated yet, and
  // the un-configured stub client answers with nothing at all.
  if (error || !Array.isArray(data)) return { marks: new Map(), error: error || null }

  const marks = new Map()
  data.forEach(({ task_id, note_date }) => {
    if (!marks.has(task_id)) marks.set(task_id, new Set())
    marks.get(task_id).add(note_date)
  })
  return { marks, error: null }
}

/**
 * Every note on one line item, oldest first.
 *
 * The whole task rather than just the clicked square: a line has tens
 * of notes at most, the panel filters to the day itself in memory, and
 * having them all already loaded is what makes "show everything on this
 * task" instant instead of a second round trip.
 */
export async function fetchTaskNotes(taskId) {
  const { data, error } = await supabase
    .from('task_notes')
    .select(SELECT)
    .eq('task_id', taskId)
    .order('note_date')
    .order('created_at')
  return { notes: data || [], error }
}

/**
 * @param author  the writer's employee row, if their login is linked to
 *                one — the avatar comes from it while they are still on
 *                the team. `name` is copied in either way, so the note
 *                still says who wrote it once the row is gone.
 */
export async function addNote({ taskId, date, body, author, authorName }) {
  const { data, error } = await supabase
    .from('task_notes')
    .insert({
      task_id: taskId,
      note_date: noteDay(date),
      body: body.trim(),
      author_id: author?.id || null,
      author_name: author?.name || authorName || null,
    })
    .select(SELECT)
    .single()
  return { note: data, error }
}

export async function updateNote(id, patch) {
  const payload = { ...patch }
  if ('body' in payload) payload.body = payload.body.trim()
  if ('note_date' in payload) payload.note_date = noteDay(payload.note_date)

  const { data, error } = await supabase
    .from('task_notes')
    .update(payload)
    .eq('id', id)
    .select(SELECT)
    .single()
  return { note: data, error }
}

export async function deleteNote(id) {
  const { error } = await supabase.from('task_notes').delete().eq('id', id)
  return { error }
}
