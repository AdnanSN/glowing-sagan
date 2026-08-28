import { useEffect, useRef, useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { Modal } from './Modal'
import { copyText, isWebLink } from '../lib/clipboard'

/**
 * Where a document lives.
 *
 * The system stores an address, never a file — for most of these that
 * address is a path on the office network, and a browser cannot open
 * one of those from a web page. So the path is shown to be copied and
 * pasted into File Explorer.
 *
 * A web link gets an Open button as well, since that one the browser
 * can follow.
 */
export function DocumentLocationModal({ doc, onClose }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  const pathRef = useRef(null)

  const location = doc?.url?.trim() || ''
  const web = isWebLink(location)

  // Pre-select the path so Ctrl+C works even if the button somehow
  // cannot reach the clipboard.
  useEffect(() => {
    if (doc && pathRef.current) {
      const range = document.createRange()
      range.selectNodeContents(pathRef.current)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    }
    setCopied(false)
  }, [doc])

  useEffect(() => () => clearTimeout(timer.current), [])

  async function handleCopy() {
    const ok = await copyText(location)
    if (!ok) return
    clearTimeout(timer.current)
    setCopied(true)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal
      isOpen={!!doc}
      onClose={onClose}
      title={doc?.name || 'Document'}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          {web && (
            <a className="btn btn-secondary" href={location} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /> Open link
            </a>
          )}
          {location && (
            <button className="btn btn-primary" onClick={handleCopy}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy location</>}
            </button>
          )}
        </>
      }
    >
      {location ? (
        <>
          <div className="form-group">
            <label className="form-label">File location</label>
            <div className="doc-location" ref={pathRef}>{location}</div>
          </div>
          <div className="form-hint">
            {web
              ? 'Open the link, or copy it to share with someone.'
              : 'Copy this, then paste it into the address bar of File Explorer to open the file.'}
          </div>
        </>
      ) : (
        <div className="form-hint">
          No location was recorded for this document. Edit it to add one.
        </div>
      )}

      {(doc?.notes || doc?.uploaded_by) && (
        <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
          {doc.notes && <div style={{ fontSize: 'var(--text-sm)' }}>{doc.notes}</div>}
          {doc.uploaded_by && <div className="form-hint">Added by {doc.uploaded_by}</div>}
        </div>
      )}
    </Modal>
  )
}
