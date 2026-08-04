import { useCallback, useSyncExternalStore } from 'react'
import {
  addDays, differenceInDays, endOfWeek, format, parseISO, startOfWeek,
} from 'date-fns'

// Geometry and date plumbing shared by the two timeline pages
// (pages/GanttProject.jsx and pages/GanttTeam.jsx).
//
// Everything downstream measures in DAYS and divides by unitDays, so a
// week-per-column chart and a day-per-column chart are the same code
// with one number changed.

export const ISO = 'yyyy-MM-dd'

/* A week per column is how the practice draws a project — a whole job
   fits on one screen. A day per column is for picking a stage apart. */
export const SCALES = {
  week: { key: 'week', label: 'Weeks', unitDays: 7, defaultW: 46, min: 24, max: 140 },
  day:  { key: 'day',  label: 'Days',  unitDays: 1, defaultW: 32, min: 16, max: 80  },
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

/** Anything date-ish → a Date, or null. Never throws. */
export function safeDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : parseISO(String(value))
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
}

export function toISO(d) { return format(d, ISO) }

/**
 * Calendar days, counting both ends — a line that starts and ends on
 * the same day lasts 1 day, which is also exactly how wide its bar is
 * drawn. (The spreadsheet used DAYS360, which counts the gap instead
 * and so disagrees with its own bars by a day.)
 */
export function durationDays(start, end) {
  const s = safeDate(start), e = safeDate(end)
  if (!s || !e) return null
  return Math.max(differenceInDays(e, s) + 1, 1)
}

export function hexToRgb(hex) {
  const m = String(hex || '').replace('#', '').match(/.{2}/g)
  return m && m.length >= 3 ? m.slice(0, 3).map(h => parseInt(h, 16)) : [26, 26, 26]
}

export function rgba(hex, alpha) {
  return `rgba(${hexToRgb(hex).join(',')},${alpha})`
}

/** Left edge, in pixels, of `date` on a chart that starts at `rangeStart`. */
export function dateToX(date, rangeStart, cellW, unitDays) {
  return (differenceInDays(date, rangeStart) / unitDays) * cellW
}

/** Pixels dragged → whole days moved. Bars always snap to a day. */
export function pxToDays(px, cellW, unitDays) {
  return Math.round((px / cellW) * unitDays)
}

/**
 * Which column a date falls in — the square you would point at. Whole
 * columns, unlike dateToX: a note written on the Wednesday of a week
 * column belongs to that column, not to three sevenths across it.
 * Negative, or past the last column, when the date is off the chart.
 */
export function dateToCol(date, rangeStart, unitDays) {
  return Math.floor(differenceInDays(date, rangeStart) / unitDays)
}

/** Where a click landed, as a column index. */
export function xToCol(px, cellW) {
  return Math.floor(px / cellW)
}

/**
 * The columns to put a note marker on, from the days that carry one.
 * Deduplicated, because a week column holding three annotated days is
 * still one square, and clipped to the chart, because the Team Schedule
 * shows a rolling window with notes either side of it.
 */
export function markedColumns(days, rangeStart, unitDays, colCount) {
  if (!days?.size) return []
  const cols = new Set()
  days.forEach(iso => {
    const d = safeDate(iso)
    if (!d) return
    const col = dateToCol(d, rangeStart, unitDays)
    if (col >= 0 && col < colCount) cols.add(col)
  })
  return [...cols]
}

/** One entry per column — a single day, or the week starting that day. */
export function buildColumns(rangeStart, rangeEnd, unitDays) {
  const cols = []
  for (let d = rangeStart; d <= rangeEnd; d = addDays(d, unitDays)) {
    cols.push({ start: d, end: addDays(d, unitDays - 1) })
  }
  return cols
}

/** Those columns folded into the months they fall in, for the top header. */
export function buildMonthGroups(columns) {
  const groups = []
  columns.forEach((col, i) => {
    const key = format(col.start, 'yyyy-MM')
    const last = groups[groups.length - 1]
    if (last && last.key === key) { last.span += 1; return }
    groups.push({
      key, span: 1, firstIndex: i,
      label: format(col.start, 'MMM').toUpperCase(),
      year: format(col.start, 'yyyy'),
    })
  })
  return groups
}

/**
 * Whole weeks either side of a span. Columns then always begin on a
 * Monday, so the month header lines up with the grid and a bar never
 * starts halfway through the first column.
 */
export function padToWeeks(start, end, padWeeks = 1) {
  return {
    start: startOfWeek(addDays(start, -padWeeks * 7), { weekStartsOn: 1 }),
    end:   endOfWeek(addDays(end, padWeeks * 7),      { weekStartsOn: 1 }),
  }
}

/**
 * A stage summarised from its lines: earliest start, latest due, and a
 * progress figure weighted by how long each line runs — so a 30-day
 * item at 0% is not cancelled out by a 1-day item at 100%.
 */
export function rollUp(tasks) {
  let start = null, end = null, weighted = 0, weight = 0
  tasks.forEach(t => {
    const s = safeDate(t.start_date)
    const e = safeDate(t.due_date) || s
    if (s && (!start || s < start)) start = s
    if (e && (!end || e > end)) end = e
    const days = (s && e) ? Math.max(differenceInDays(e, s) + 1, 1) : 1
    weighted += (Number(t.progress) || 0) * days
    weight += days
  })
  return {
    start, end,
    progress: weight ? Math.round(weighted / weight) : 0,
    count: tasks.length,
  }
}

/* Status and progress are two views of the same fact, and a line
   reading "Done · 40%" helps nobody. Whichever the user just changed
   wins; this drags the other one into line. */
export function linkStatusAndProgress(patch, current = {}) {
  const next = { ...patch }
  const status = 'status' in next ? next.status : current.status
  const progress = 'progress' in next ? next.progress : (current.progress ?? 0)

  if ('status' in patch) {
    if (patch.status === 'Done' && progress !== 100) next.progress = 100
    if (patch.status === 'To Do' && progress === 100) next.progress = 0
  }

  if ('progress' in patch) {
    if (patch.progress === 100 && status !== 'Done') next.status = 'Done'
    if (patch.progress > 0 && patch.progress < 100 && (status === 'To Do' || status === 'Done')) {
      next.status = 'In Progress'
    }
    if (patch.progress === 0 && status === 'Done') next.status = 'To Do'
  }

  return next
}

/**
 * True on a narrow screen. The frozen columns down the left of a chart
 * cost 600-odd pixels; below this the chart itself would have nothing
 * left, so the pages drop to a name-and-progress pair of columns and
 * move date editing into the row dialog.
 */
export function useCompact(query = '(max-width: 1080px)') {
  const subscribe = useCallback(onChange => {
    const mq = window.matchMedia(query)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Sort key for line items: hand-set order first, then age. */
export function byPosition(a, b) {
  const pa = a.position ?? 0, pb = b.position ?? 0
  if (pa !== pb) return pa - pb
  return String(a.created_at || '').localeCompare(String(b.created_at || ''))
}
