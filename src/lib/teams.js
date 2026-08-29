import { supabase } from './supabase'

// A team is a named group cut out of the roster — usually the people on
// one job, sometimes a standing group like Interiors that outlives any
// one job. Membership is its own table, so a person belongs to as many
// teams as their week actually involves. See migration_v14_teams.sql.

const SELECT = `
  id, name, purpose, color, project_id, created_at,
  project:projects(id, name, color, status),
  members:team_members(employee_id, employee:employees(id, name, role, color, avatar_url))
`

// Postgres for "that table isn't there". Until migration_v14 has been
// run against the database this is the only error the page will ever
// see, and it needs different words from a real failure — nothing is
// broken, a step just hasn't been taken yet.
const UNDEFINED_TABLE = '42P01'
const UNIQUE_VIOLATION = '23505'

export function isMissingTable(error) {
  return error?.code === UNDEFINED_TABLE
}

/**
 * Every team with its people attached, sorted by name.
 *
 * Returns `{ teams, error }` rather than throwing: a missing table is a
 * state the page renders, not an exception it recovers from.
 */
export async function fetchTeams() {
  const { data, error } = await supabase.from('teams').select(SELECT).order('name')
  if (error) return { teams: [], error }

  const teams = (data || []).map(t => ({
    ...t,
    // The join rows carry nothing we want past the employee itself.
    // A member whose employee row has gone is dropped rather than
    // rendered as a blank avatar.
    members: (t.members || []).map(m => m.employee).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
  return { teams, error: null }
}

/** Which teams each employee is in, keyed by employee id. */
export function teamsByEmployee(teams) {
  const map = {}
  teams.forEach(team => {
    team.members.forEach(m => {
      (map[m.id] ||= []).push(team)
    })
  })
  return map
}

/**
 * Create or update a team and reconcile its membership in one go.
 *
 * Membership is written as a diff rather than delete-then-reinsert, so
 * `added_at` survives on people who were already in the team and a
 * failure halfway cannot leave a team briefly empty.
 *
 * @param {object} args
 * @param {object|null} args.editing  The team being edited, or null to create
 * @param {object} args.form          { name, purpose, color, project_id }
 * @param {string[]} args.memberIds   Employee ids the team should end up with
 * @returns {Promise<{ error: string|null }>} A message ready to show, or null
 */
export async function saveTeam({ editing, form, memberIds }) {
  const row = {
    name: form.name.trim(),
    purpose: form.purpose?.trim() || null,
    color: form.color,
    project_id: form.project_id || null,
  }

  let teamId = editing?.id
  if (editing) {
    const { error } = await supabase.from('teams').update(row).eq('id', editing.id)
    if (error) return { error: writeMessage(error, row.name) }
  } else {
    const { data, error } = await supabase.from('teams').insert(row).select('id').single()
    if (error) return { error: writeMessage(error, row.name) }
    teamId = data.id
  }

  const before = new Set((editing?.members || []).map(m => m.id))
  const after = new Set(memberIds)
  const toAdd = [...after].filter(id => !before.has(id))
  const toRemove = [...before].filter(id => !after.has(id))

  if (toAdd.length) {
    const { error } = await supabase.from('team_members')
      .insert(toAdd.map(employee_id => ({ team_id: teamId, employee_id })))
    if (error) return { error: `Team saved, but adding members failed: ${error.message}` }
  }
  if (toRemove.length) {
    const { error } = await supabase.from('team_members')
      .delete().eq('team_id', teamId).in('employee_id', toRemove)
    if (error) return { error: `Team saved, but removing members failed: ${error.message}` }
  }

  return { error: null }
}

/** Deleting a team takes its membership rows and nothing else. */
export async function deleteTeam(id) {
  const { error } = await supabase.from('teams').delete().eq('id', id)
  return { error: error ? error.message : null }
}

function writeMessage(error, name) {
  if (isMissingTable(error)) {
    return 'The teams tables are not in the database yet — run supabase/migration_v14_teams.sql.'
  }
  if (error.code === UNIQUE_VIOLATION) {
    return `A team called "${name}" already exists on that project. Give this one a different name.`
  }
  return error.message
}
