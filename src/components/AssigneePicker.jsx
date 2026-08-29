import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Avatar } from './Avatar'

/* ────────────────────────────────────────────────────────────────
   WHO IS ON THIS

   The replacement for the single-assignee dropdown. It opens showing
   only who is already on the task, because most work is one person's
   and a checklist of the whole practice is a worse way to say that
   than a name and a face. "Add someone" opens the roster.

   Order is kept, not sorted: the first name picked is the lead, and
   the lead is whose face gets drawn where there is only room for one.
   ──────────────────────────────────────────────────────────────── */

const SEARCHABLE_FROM = 8

export function AssigneePicker({ employees = [], value = [], onChange, disabled = false }) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState('')

  const byId = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees])
  // Selection order is the lead order, so this walks `value`, not the
  // roster. An id whose employee has since been archived just drops out.
  const chosen = value.map(id => byId.get(id)).filter(Boolean)

  const roster = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return employees
    return employees.filter(e => e.name.toLowerCase().includes(needle))
  }, [employees, search])

  function toggle(id) {
    if (disabled) return
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id])
  }

  return (
    <div className="assignee-picker">
      {chosen.length > 0 && (
        <div className="assignee-chips">
          {chosen.map((emp, i) => (
            <span key={emp.id} className="assignee-chip">
              <Avatar name={emp.name} src={emp.avatar_url} color={emp.color} size="sm" />
              <span className="assignee-chip-name">{emp.name}</span>
              {/* Only worth saying once there is somebody to be ahead of. */}
              {i === 0 && chosen.length > 1 && <span className="assignee-chip-lead">Lead</span>}
              {!disabled && (
                <button type="button" className="assignee-chip-remove"
                  title={`Take ${emp.name} off this task`}
                  onClick={() => toggle(emp.id)}>
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!disabled && (
        <button type="button" className="assignee-add" onClick={() => setOpen(o => !o)}>
          {open ? 'Done' : chosen.length ? 'Add someone else' : 'Assign someone'}
        </button>
      )}

      {open && !disabled && (
        <>
          {employees.length >= SEARCHABLE_FROM && (
            <div className="search-bar assignee-search">
              <Search />
              <input className="form-input" placeholder="Find someone…" value={search}
                onChange={e => setSearch(e.target.value)} />
            </div>
          )}

          <div className="member-picker">
            {roster.length === 0 ? (
              <div className="no-data" style={{ padding: 'var(--space-4)' }}>Nobody matches that</div>
            ) : roster.map(emp => {
              const checked = value.includes(emp.id)
              return (
                <label key={emp.id} className={`member-picker-row${checked ? ' selected' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(emp.id)} />
                  <Avatar name={emp.name} src={emp.avatar_url} color={emp.color} size="sm" />
                  <span className="member-picker-name">{emp.name}</span>
                  {emp.role && <span className="member-picker-role">{emp.role}</span>}
                </label>
              )
            })}
          </div>
        </>
      )}

      {!chosen.length && !open && (
        <div className="assignee-empty">Nobody is on this yet.</div>
      )}
    </div>
  )
}
