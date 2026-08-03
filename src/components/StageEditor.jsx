import { ChevronUp, ChevronDown, Trash2, Plus, RotateCcw } from 'lucide-react'
import { DEFAULT_STAGES } from '../lib/constants'
import { toStageRows, blankStageRow, stageError } from '../lib/stages'

// Editable stage list: rename in place, add, delete, reorder.
// Controlled — the parent owns the rows (see lib/stages.js for the
// row shape and the helpers that turn them back into a saveable list).

export function StageEditor({
  rows,
  onChange,
  currentStage,      // badge the stage the project is sitting on
  taskCounts = {},   // { stageName: n } — warn before the label is dropped
  disabled = false,
}) {
  const rename = (id, name) =>
    onChange(rows.map(r => (r.id === id ? { ...r, name } : r)))

  const move = (i, delta) => {
    const j = i + delta
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  const remove = (id) => onChange(rows.filter(r => r.id !== id))
  const add = () => onChange([...rows, blankStageRow()])
  const reset = () => onChange(toStageRows(DEFAULT_STAGES))

  const error = stageError(rows)

  return (
    <div className="stage-editor">
      <div className="stage-editor-list">
        {rows.map((row, i) => {
          const name = row.name.trim()
          const isCurrent = !!name && name === currentStage
          const affected = row.original ? taskCounts[row.original] || 0 : 0

          return (
            <div className="stage-editor-row" key={row.id}>
              <span className="stage-editor-index">{i + 1}</span>

              <div className="stage-editor-field">
                <input
                  className="form-input"
                  value={row.name}
                  placeholder="Stage name"
                  disabled={disabled}
                  onChange={e => rename(row.id, e.target.value)}
                />
                {(isCurrent || affected > 0) && (
                  <div className="stage-editor-note">
                    {isCurrent && <span className="stage-editor-current">Current stage</span>}
                    {affected > 0 && (
                      <span>{affected} task{affected !== 1 ? 's' : ''} tagged</span>
                    )}
                  </div>
                )}
              </div>

              <div className="stage-editor-controls">
                <button type="button" className="icon-btn" title="Move up"
                  disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                  <ChevronUp size={13} />
                </button>
                <button type="button" className="icon-btn" title="Move down"
                  disabled={disabled || i === rows.length - 1} onClick={() => move(i, 1)}>
                  <ChevronDown size={13} />
                </button>
                <button type="button" className="icon-btn"
                  title={rows.length === 1 ? 'A project needs at least one stage' : 'Delete stage'}
                  disabled={disabled || rows.length === 1}
                  onClick={() => remove(row.id)}
                  style={{ color: 'var(--danger)', borderColor: 'rgba(192,40,28,0.2)' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="stage-editor-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={add} disabled={disabled}>
          <Plus size={13} /> Add Stage
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={disabled}>
          <RotateCcw size={13} /> Reset to Default
        </button>
      </div>

      {error && <div className="stage-editor-error">{error}</div>}
    </div>
  )
}
