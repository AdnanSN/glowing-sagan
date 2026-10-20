import { byPosition } from './gantt'
import { assigneesOf } from './assignees'

// Sub-tasks: a task row whose parent_task_id points at its main task.
// One level only — the database refuses anything deeper (see
// migration_v17_subtasks.sql) — so every helper here is a flat split
// into main tasks and the sub-tasks hanging off each.

/** True for a sub-task. */
export const isSubtask = (task) => !!task?.parent_task_id

/**
 * Split a flat list into main tasks and each one's sub-tasks.
 *
 * A sub-task whose main task is not in the list — filtered out by the
 * caller, or a row read mid-change — is treated as a main task of its
 * own rather than dropped: losing work off the screen is worse than
 * showing it one level too high.
 *
 * → { mains: task[], subsOf: Map<mainId, task[]> }  (subs in position order)
 */
export function splitSubtasks(tasks) {
  const ids = new Set(tasks.map(t => t.id))
  const mains = []
  const subsOf = new Map()
  tasks.forEach(t => {
    if (t.parent_task_id && ids.has(t.parent_task_id)) {
      if (!subsOf.has(t.parent_task_id)) subsOf.set(t.parent_task_id, [])
      subsOf.get(t.parent_task_id).push(t)
    } else {
      mains.push(t)
    }
  })
  subsOf.forEach(list => list.sort(byPosition))
  return { mains, subsOf }
}

/** id → title, for labelling a sub-task with its main task. */
export function titlesById(tasks) {
  return new Map(tasks.map(t => [t.id, t.title]))
}

/** "Presentation - 2 › Renders" when a main task title is known. */
export function subtaskLabel(task, titles) {
  const parent = task?.parent_task_id ? titles.get(task.parent_task_id) : null
  return parent ? `${parent} › ${task.title}` : task.title
}

/**
 * Everyone on a main task or any of its sub-tasks, main task's people
 * first — the faces a board card shows, since the people doing the
 * sub-tasks are the people doing the job.
 */
export function peopleAcross(task, subs = []) {
  const seen = new Map()
  ;[task, ...subs].forEach(t => assigneesOf(t).forEach(p => {
    if (!seen.has(p.id)) seen.set(p.id, p)
  }))
  return [...seen.values()]
}

/** The next free position at the end of a main task's sub-tasks. */
export function nextSubtaskPosition(subs = []) {
  return subs.reduce((max, t) => Math.max(max, t.position || 0), 0) + 1
}
