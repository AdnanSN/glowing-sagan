import { Lock } from 'lucide-react'

// The marker on anything Principal-Architects-only. Nobody else is ever
// sent these rows (see migration_v8_confidential.sql), so this is not a
// warning — it tells an admin which of the things in front of them the
// rest of the practice cannot see.

const label = (reason) =>
  reason === 'folder'
    ? 'Restricted by its folder — Principal Architects only'
    : 'Principal Architects only'

export function ConfidentialTag({ reason, size = 11 }) {
  return (
    <span className="confidential-tag" title={label(reason)}>
      <Lock size={size} />
      {reason === 'folder' ? 'Folder restricted' : 'Restricted'}
    </span>
  )
}

const DESC = {
  folder: 'Hides this folder, and every project filed in it, from everyone below Principal Architect.',
  project: 'Hides this project and all of its tasks, milestones, documents and comments from everyone below Principal Architect.',
  task: 'Hides this one task from everyone below Principal Architect, even though the project itself is open.',
}

// Where a restriction came from when it was not set on the thing itself.
const INHERITED = {
  folder: 'is filed in a restricted folder',
  project: 'belongs to a restricted project',
}

/**
 * The control that sets it. Only rendered for Principal Architects —
 * the database refuses the change for anyone else regardless.
 * `inherited` ('folder' | 'project') is for something already
 * restricted from above: there is nothing left to decide, so it says
 * so instead of offering a checkbox that would do nothing.
 */
export function ConfidentialToggle({ checked, onChange, disabled, noun = 'project', inherited = null }) {
  if (inherited) {
    return (
      <div className="confidential-toggle confidential-toggle-locked">
        <Lock size={14} style={{ marginTop: 2, flexShrink: 0, color: 'var(--warning)' }} />
        <div>
          <div className="confidential-toggle-title">Principal Architects only</div>
          <div className="confidential-toggle-desc">
            This {noun} {INHERITED[inherited]}, so it is already hidden
            from everyone else.
          </div>
        </div>
      </div>
    )
  }

  return (
    <label className="confidential-toggle">
      <input type="checkbox" checked={!!checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)} />
      <div>
        <div className="confidential-toggle-title">
          <Lock size={13} /> Principal Architects only
        </div>
        <div className="confidential-toggle-desc">{DESC[noun]}</div>
      </div>
    </label>
  )
}

/** Bare padlock, for rows too tight for the word. */
export function ConfidentialIcon({ reason, size = 12 }) {
  return (
    <span className="confidential-icon" title={label(reason)} role="img" aria-label={label(reason)}>
      <Lock size={size} />
    </span>
  )
}
