import { useSearchParams } from 'react-router-dom'
import { isPast, isToday, isTomorrow } from 'date-fns'

// What the task boards and their page headers share: the status
// colours, and the due-date slices the dashboard links into.

export const STATUS_COLORS = {
  'To Do': { bg: 'var(--bg-tertiary)', color: 'var(--text-secondary)' },
  'In Progress': { bg: 'var(--info-light)', color: 'var(--info)' },
  'In Review': { bg: 'var(--warning-light)', color: 'var(--warning)' },
  'Done': { bg: 'var(--success-light)', color: 'var(--success)' },
}

// Slices of the board by when work is due. The dashboard's stat cards
// link straight to these, so the counts there and the board agree.
// `count` names the slice in a header; `empty` explains an empty board.
export const DUE_FILTERS = [
  {
    value: 'today', label: 'Due today', count: 'due today',
    empty: { title: 'Nothing due today', desc: 'No open task is due today.' },
  },
  {
    value: 'tomorrow', label: 'Due tomorrow', count: 'due tomorrow',
    empty: { title: 'Nothing due tomorrow', desc: 'No open task is due tomorrow.' },
  },
  {
    value: 'overdue', label: 'Overdue', count: 'overdue',
    empty: { title: 'Nothing overdue', desc: 'Every open task is still within its due date.' },
  },
]

export function matchesDue(task, filter) {
  if (filter === 'All') return true
  // Finished work is neither due nor late, whatever its date says.
  if (!task.due_date || task.status === 'Done') return false
  const due = new Date(task.due_date)
  if (filter === 'today') return isToday(due)
  if (filter === 'tomorrow') return isTomorrow(due)
  return isPast(due) && !isToday(due)
}

/** Open and past its due date. */
export const isLate = (task) => matchesDue(task, 'overdue')

/**
 * The due filter, kept in the URL so the dashboard can link to a slice
 * of a board, Back steps out of it, and a refresh keeps it. Only `due`
 * is touched; anything else in the URL stays.
 */
export function useDueFilter() {
  const [params, setParams] = useSearchParams()
  const active = DUE_FILTERS.find(d => d.value === params.get('due')) || null
  const value = active ? active.value : 'All'
  const setValue = (next) => setParams(prev => {
    const out = new URLSearchParams(prev)
    if (next === 'All') out.delete('due')
    else out.set('due', next)
    return out
  })
  return { active, value, setValue }
}
