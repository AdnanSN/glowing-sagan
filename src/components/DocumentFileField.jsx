import { useRef, useState } from 'react'
import { Upload, FileText, X, Paperclip } from 'lucide-react'
import { formatBytes, MAX_DOCUMENT_BYTES } from '../lib/documents'

/**
 * Choose a file to attach to a document.
 *
 * A plain file input behind a large drop area. Nothing clever: this is
 * used by people who are not going to read an instruction, so the
 * whole control is one obvious target that also happens to accept a
 * dragged file.
 *
 * When editing a document that already has a file, the file is shown
 * and cannot be swapped. Replacing it would leave the old object
 * orphaned in the bucket and would quietly change what a link handed
 * to somebody last week points at - deleting the document and adding
 * it again is the honest way to do that.
 */
export function DocumentFileField({ file, onFile, existing, disabled, disabledReason }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [tooBig, setTooBig] = useState(null)

  function choose(candidate) {
    if (!candidate) return
    if (candidate.size > MAX_DOCUMENT_BYTES) {
      setTooBig(`${candidate.name} is ${formatBytes(candidate.size)}. The limit is ${formatBytes(MAX_DOCUMENT_BYTES)}.`)
      return
    }
    setTooBig(null)
    onFile(candidate)
  }

  // Already uploaded: show what is attached, and leave it alone.
  if (existing?.storage_path) {
    return (
      <div className="form-group">
        <label className="form-label">Attached file</label>
        <div className="file-chosen">
          <FileText size={16} />
          <div className="file-chosen-info">
            <div className="file-chosen-name">{existing.file_name || 'File'}</div>
            <div className="file-chosen-size">{formatBytes(existing.bytes)}</div>
          </div>
        </div>
        <div className="form-hint">
          To attach a different file, delete this document and add it again — that keeps
          old links from quietly pointing at something new.
        </div>
      </div>
    )
  }

  return (
    <div className="form-group">
      <label className="form-label">File</label>

      {file ? (
        <div className="file-chosen">
          <FileText size={16} />
          <div className="file-chosen-info">
            <div className="file-chosen-name">{file.name}</div>
            <div className="file-chosen-size">{formatBytes(file.size)}</div>
          </div>
          <button type="button" className="icon-btn" title="Choose a different file"
            onClick={() => { onFile(null); setTooBig(null) }}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`file-drop${dragging ? ' file-drop-over' : ''}${disabled ? ' file-drop-off' : ''}`}
          onClick={() => !disabled && inputRef.current?.click()}
          onDragOver={e => { if (!disabled) { e.preventDefault(); setDragging(true) } }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            if (disabled) return
            e.preventDefault()
            setDragging(false)
            choose(e.dataTransfer.files?.[0])
          }}
          disabled={disabled}
        >
          <Upload size={20} />
          <span className="file-drop-title">
            {disabled ? (disabledReason || 'Not available yet') : 'Choose a file'}
          </span>
          {!disabled && (
            <span className="file-drop-sub">or drag one here · up to {formatBytes(MAX_DOCUMENT_BYTES)}</span>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={e => { choose(e.target.files?.[0]); e.target.value = '' }}
      />

      {tooBig ? (
        <div className="form-hint" style={{ color: 'var(--danger)' }}>{tooBig}</div>
      ) : (
        <div className="form-hint">
          <Paperclip size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
          Optional — a document can be just a link instead.
        </div>
      )}
    </div>
  )
}
