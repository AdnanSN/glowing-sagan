import { useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Trash2, Pencil, Download, Check } from 'lucide-react'
import { format } from 'date-fns'
import { formatBytes } from '../lib/photos'

// One site photo, full screen. This is the half of the feature that is
// actually used on site: the grid is for finding a photo, this is for
// looking at it — so the image gets the whole viewport and everything
// else sits over it.
//
// Navigation is swipe first, arrows second. Somebody standing on a
// slab in gloves is not going to hit a 32px chevron.

const SWIPE_THRESHOLD = 48

export function PhotoLightbox({
  photos,
  index,
  urls,
  onIndexChange,
  onClose,
  onSaveDetails,
  onDelete,
  canEdit,
  canDelete,
  stages = [],
}) {
  const photo = photos[index]

  const [caption, setCaption] = useState('')
  const [stage, setStage] = useState('')
  const [saving, setSaving] = useState(false)
  const touchStart = useRef(null)

  // Both of these are held as "which photo is this true of" rather than
  // as plain booleans, so swiping to the next photo resets them on its
  // own — no effect firing after the render to undo the last one.
  const [loadedId, setLoadedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const loaded = !!photo && loadedId === photo.id
  const editing = !!photo && editingId === photo.id

  const hasPrev = index > 0
  const hasNext = index < photos.length - 1

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { editing ? setEditingId(null) : onClose(); return }
      if (editing) return  // arrows belong to the text field while it's open
      if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1)
      if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, hasPrev, hasNext, editing, onClose, onIndexChange])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  if (!photo) return null

  function startEdit() {
    setCaption(photo.caption || '')
    setStage(photo.stage || '')
    setEditingId(photo.id)
  }

  async function saveEdit() {
    setSaving(true)
    await onSaveDetails(photo, { caption: caption.trim(), stage: stage || null })
    setSaving(false)
    setEditingId(null)
  }

  function handleTouchStart(e) {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
  }

  function handleTouchEnd(e) {
    if (!touchStart.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStart.current.x
    const dy = t.clientY - touchStart.current.y
    touchStart.current = null

    // Vertical wins ties, so scrolling the caption never flips the photo.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return
    if (dx > 0 && hasPrev) onIndexChange(index - 1)
    if (dx < 0 && hasNext) onIndexChange(index + 1)
  }

  const fullUrl = urls[photo.storage_path]
  const thumbUrl = urls[photo.thumb_path]
  const takenAt = photo.taken_at || photo.created_at

  return (
    <div className="lightbox" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="lightbox-bar">
        <span className="lightbox-count">{index + 1} / {photos.length}</span>
        <div className="lightbox-bar-actions">
          {fullUrl && (
            <a
              className="lightbox-btn"
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open full size"
            >
              <Download size={16} />
            </a>
          )}
          {canEdit(photo) && !editing && (
            <button className="lightbox-btn" onClick={startEdit} title="Edit caption">
              <Pencil size={16} />
            </button>
          )}
          {canDelete(photo) && (
            <button
              className="lightbox-btn lightbox-btn-danger"
              onClick={() => onDelete(photo)}
              title="Delete photo"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button className="lightbox-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        className="lightbox-stage"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* The thumbnail is already in cache from the grid, so it paints
            instantly and the full image fades in over it — on site data
            that is the difference between "instant" and "blank screen". */}
        {thumbUrl && !loaded && (
          <img src={thumbUrl} alt="" className="lightbox-img lightbox-img-placeholder" />
        )}
        {fullUrl && (
          <img
            key={photo.id}
            src={fullUrl}
            alt={photo.caption || 'Site photo'}
            className="lightbox-img"
            style={{ opacity: loaded ? 1 : 0 }}
            onLoad={() => setLoadedId(photo.id)}
          />
        )}

        {hasPrev && (
          <button className="lightbox-nav lightbox-nav-prev" onClick={() => onIndexChange(index - 1)}>
            <ChevronLeft size={22} />
          </button>
        )}
        {hasNext && (
          <button className="lightbox-nav lightbox-nav-next" onClick={() => onIndexChange(index + 1)}>
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      <div className="lightbox-footer">
        {editing ? (
          <div className="lightbox-edit">
            <input
              className="form-input"
              placeholder="What does this photo show?"
              value={caption}
              autoFocus
              onChange={e => setCaption(e.target.value)}
            />
            {stages.length > 0 && (
              <select className="form-select" value={stage} onChange={e => setStage(e.target.value)}>
                <option value="">— No stage —</option>
                {stages.map(s => <option key={s}>{s}</option>)}
              </select>
            )}
            <div className="lightbox-edit-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving}>
                <Check size={13} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="lightbox-caption">
              {photo.caption || <span className="lightbox-caption-empty">No caption</span>}
            </div>
            <div className="lightbox-meta">
              {photo.stage && <span className="lightbox-meta-stage">{photo.stage}</span>}
              <span>{format(new Date(takenAt), 'd MMM yyyy · HH:mm')}</span>
              {photo.uploader?.name && <span>{photo.uploader.name}</span>}
              {photo.width && <span>{photo.width}×{photo.height}</span>}
              {photo.bytes && <span>{formatBytes(photo.bytes)}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
