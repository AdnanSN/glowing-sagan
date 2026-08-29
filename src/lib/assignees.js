import { supabase } from './supabase'

// Who is on a line item.
//
// A task used to point at one employee through tasks.assignee_id, and
// real work does not: a set of drawings goes to two people, a site
// visit goes to whoever is going. task_assignees holds the whole list
// (see migration_v15_task_assignees.sql).
//
// assignee_id survives as the LEAD — the first name on that list — and
// the database derives it with a trigger. Every surface with room for
// exactly one face still reads it and still works. Nothing in the app
// writes it any more: write the list with setTaskAssignees() and the
// column follows.

/**
 * Embeds for a task query. Both name the foreign key they travel, and
 * the hints are not decoration.
 *
 * task_assignees is a junction table — two foreign keys and a composite
 * primary key over them — which PostgREST reads as a many-to-many
 * relationship between tasks and employees. From the moment it exists,
 * a plain `employees(...)` embed on a task query has two ways to
 * resolve: the assignee_id foreign key, or that many-to-many. PostgREST
 * refuses ambiguity with a 300 rather than guessing, and it refuses the
 * WHOLE query — which is why creating this table made every task in the
 * app disappear at once. `!assignee_id` says which one.
 */
export const LEAD_SELECT =
  'assignee:employees!assignee_id(id,name,color,avatar_url)'

export const ASSIGNEES_SELECT =
  'assignees:task_assignees(position, employee:employees!employee_id(id,name,color,avatar_url))'

/**
 * The people on a task, in order, from a row fetched with
 * ASSIGNEES_SELECT.
 *
 * Falls back to the joined lead when the list is not loaded, so a query
 * that has not been widened yet — or one run against a database where
 * the migration has not been applied — still shows the one person it
 * knows about rather than an empty seat.
 */
export function assigneesOf(task) {
  const rows = task?.assignees
  if (!Array.isArray(rows)) return task?.assignee ? [task.assignee] : []
  return rows
    .filter(r => r?.employee)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(r => r.employee)
}

/** Their ids, for "is this person on it" without walking the objects. */
export function assigneeIdsOf(task) {
  return assigneesOf(task).map(e => e.id)
}

/** True when `employeeId` is on the task at all, lead or not. */
export function isAssignedTo(task, employeeId) {
  return assigneeIdsOf(task).includes(employeeId)
}

/**
 * The list as this app writes it back: `assignees` rebuilt from a set
 * of ids, so a saved row renders from what was just picked without
 * waiting for a re-read.
 */
export function assigneesFromIds(ids, employees) {
  const byId = new Map((employees || []).map(e => [e.id, e]))
  return ids
    .map((id, position) => ({ position, employee: byId.get(id) || null }))
    .filter(r => r.employee)
}

/**
 * Replace who is on a task.
 *
 * Delete-then-insert rather than a diff: the list is two or three rows,
 * the round trip is the cost either way, and a diff has to be right
 * about ordering as well as membership. `position` is written from the
 * order given, which is what decides the lead.
 */
export async function setTaskAssignees(taskId, employeeIds) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))]

  const { error: clearError } = await supabase
    .from('task_assignees')
    .delete()
    .eq('task_id', taskId)
  if (clearError) return { error: clearError }

  if (!ids.length) return { error: null }

  const { error } = await supabase
    .from('task_assignees')
    .insert(ids.map((employee_id, position) => ({
      task_id: taskId, employee_id, position,
    })))
  return { error }
}

/**
 * Who is on each of a set of tasks — for the pages that count work per
 * person (the roster, the dashboard) and never load the tasks
 * themselves.
 *
 * `taskIds` null means every assignment the reader is allowed to see;
 * RLS filters it either way.
 *
 * → Map<taskId, employeeId[]>
 */
export async function fetchAssigneeMap(taskIds = null) {
  let query = supabase
    .from('task_assignees')
    .select('task_id, employee_id, position')
    .order('position')

  if (taskIds) {
    if (!taskIds.length) return { map: new Map(), error: null }
    query = query.in('task_id', taskIds)
  }

  const { data, error } = await query
  // No rows is the normal case before anything has been assigned, and
  // the un-configured stub client answers with nothing at all.
  if (error || !Array.isArray(data)) return { map: new Map(), error: error || null }

  const map = new Map()
  data.forEach(({ task_id, employee_id }) => {
    if (!map.has(task_id)) map.set(task_id, [])
    map.get(task_id).push(employee_id)
  })
  return { map, error: null }
}
