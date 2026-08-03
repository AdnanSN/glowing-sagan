import { useRef, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { Avatar } from './Avatar'
import { uploadAvatar, deleteAvatarFile, AVATAR_SIZE } from '../lib/avatar'

// Picks a file, shrinks it, uploads it, and hands the resulting URL to
// the parent — which decides how it gets persisted (an RPC for your own
// photo, a plain row update when an admin edits somebody else).
//
// The upload happens on pick rather than on save. Because every person
// writes to the same fixed path, a cancelled edit leaves at most one
// stale file that the next upload overwrites — not worth a cleanup
// dance for a ~10 KB object.

export function AvatarUploader({
  employeeId,
  name,
  color,
  value,
  onChange,
  disabled = false,
  hint,
}) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handlePick(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file twice still fires
    if (!file) return

    setBusy(true)
    setError('')
    try {
      onChange(await uploadAvatar(employeeId, file))
    } catch (err) {
      setError(err.message || 'Upload failed.')
    }
    setBusy(false)
  }

  async function handleRemove() {
    setBusy(true)
    setError('')
    try {
      await deleteAvatarFile(employeeId)
      onChange(null)
    } catch (err) {
      setError(err.message || 'Could not remove the photo.')
    }
    setBusy(false)
  }

  const locked = disabled || busy || !employeeId

  return (
    <div className="avatar-uploader">
      <Avatar name={name} src={value} color={color} size="lg" />

      <div className="avatar-uploader-actions">
        <div className="avatar-uploader-buttons">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => inputRef.current?.click()}
            disabled={locked}
          >
            <Camera size={13} />
            {busy ? 'Uploading…' : value ? 'Change photo' : 'Upload photo'}
          </button>

          {value && (
            <button
              type="button"
              className="icon-btn"
              onClick={handleRemove}
              disabled={locked}
              title="Remove photo"
              style={{ color: 'var(--danger)', borderColor: 'rgba(192,40,28,0.2)' }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        <div className="avatar-uploader-hint">
          {error
            ? <span style={{ color: 'var(--danger)' }}>{error}</span>
            : hint || `Square crop, resized to ${AVATAR_SIZE}px. JPG, PNG or WebP.`}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handlePick}
        style={{ display: 'none' }}
      />
    </div>
  )
}
