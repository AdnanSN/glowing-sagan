import { DEFAULT_STAGES } from './constants'

// Helpers for the stage editor. They live here rather than next to the
// component so that file only exports a component (React Fast Refresh
// stops working otherwise).
//
// The editor works on ROWS rather than plain strings because a rename
// has to be traceable — the server needs to know "Tender became
// Tender & Award" so it can re-label the project and its tasks, and it
// cannot work that out from two anonymous string arrays. Each row
// remembers the name it arrived with; original === null means brand new.

let seq = 0
const newId = () => `stage-${++seq}`

/** string[] → editor rows. Call once when opening the editor. */
export const toStageRows = (names) =>
  (names?.length ? names : DEFAULT_STAGES).map(name => ({
    id: newId(), name, original: name,
  }))

/** A blank row to append. */
export const blankStageRow = () => ({ id: newId(), name: '', original: null })

/** Rows → the array to save. */
export const stageNames = (rows) =>
  rows.map(r => r.name.trim()).filter(Boolean)

/** Rows → { oldName: newName } for everything that was renamed. */
export const stageRenames = (rows) =>
  Object.fromEntries(
    rows
      .filter(r => r.original && r.name.trim() && r.name.trim() !== r.original)
      .map(r => [r.original, r.name.trim()])
  )

/** Human-readable reason the list can't be saved, or '' if it's fine. */
export function stageError(rows) {
  const names = rows.map(r => r.name.trim())
  if (!names.length) return 'A project needs at least one stage.'
  if (names.some(n => !n)) return 'Every stage needs a name.'

  const seen = new Set()
  for (const n of names) {
    const key = n.toLowerCase()
    if (seen.has(key)) return `"${n}" is listed twice — stage names must be unique.`
    seen.add(key)
  }
  return ''
}
