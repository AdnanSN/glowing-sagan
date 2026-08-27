import { useState } from 'react'
import { FolderSearch, ClipboardPaste } from 'lucide-react'
import {
  nasFullPath, nasPickUrl, nasParentRelative, nasSuggestedName,
  parsePickedPath, readClipboard, launchNasUrl,
} from '../lib/nas'

/**
 * The "which file on the NAS" field, shared by the Documents page and
 * the project's Documents tab.
 *
 * WHY BROWSING TAKES TWO CLICKS
 *   Windows can launch the handler but gives it no way to answer the
 *   page, so the picked path comes back on the clipboard. Browse opens
 *   the dialog; the second click reads what it left. It is one more
 *   click than a file input, and it is the only arrangement that ends
 *   with a real path in the field - a file input would hand back
 *   "C:\fakepath\A-101.pdf" and nothing else.
 *
 *   Typing or pasting still works, and is the whole story on a machine
 *   that never had the handler installed. Explorer's "Copy as path"
 *   (Shift+right-click) pastes straight in.
 */
export function NasPathField({ value, onChange, nasRoot, check, onPicked }) {
  // Two-state button: Browse, then Use picked file.
  const [awaitingPick, setAwaitingPick] = useState(false)
  const [hint, setHint] = useState(null)

  async function handleClick() {
    if (!awaitingPick) {
      setHint('Choose the file in the Windows dialog, then click “Use picked file”.')
      setAwaitingPick(true)
      launchNasUrl(nasPickUrl(nasParentRelative(check?.path || value)))
      return
    }

    const { text, error } = await readClipboard()
    if (error) { setHint(error); return }

    const picked = parsePickedPath(text)
    if (picked.error) { setHint(picked.error); return }

    onPicked(picked.path, nasSuggestedName(picked.path))
    setAwaitingPick(false)
    setHint(null)
  }

  return (
    <div className="form-group">
      <label className="form-label">File on the office NAS</label>
      <div className="nas-field">
        <input
          className="form-input"
          placeholder="RIY-2024-017/Drawings/A-101.pdf"
          value={value}
          onChange={e => { onChange(e.target.value); setAwaitingPick(false); setHint(null) }}
        />
        <button type="button" className="btn btn-secondary" onClick={handleClick} disabled={!nasRoot}
          title={nasRoot
            ? 'Opens a Windows file dialog on the NAS (needs the one-time desktop shortcut installed)'
            : 'Set the share root first'}>
          {awaitingPick
            ? <><ClipboardPaste size={14} /> Use picked file</>
            : <><FolderSearch size={14} /> Browse…</>}
        </button>
      </div>

      {hint ? (
        <div className="form-hint">{hint}</div>
      ) : check?.error ? (
        <div className="form-hint" style={{ color: 'var(--danger)' }}>{check.error}</div>
      ) : !nasRoot ? (
        <div className="form-hint">No share root set yet — a Principal Architect sets it from the gear on the Documents page.</div>
      ) : check?.path ? (
        <div className="form-hint">Opens <strong style={{ fontWeight: 500 }}>{nasFullPath(nasRoot, check.path)}</strong></div>
      ) : (
        <div className="form-hint">Browse the NAS, or paste a path — Explorer’s “Copy as path” works.</div>
      )}
    </div>
  )
}
