import { useState } from 'react'
import { Modal } from './Modal'
import { AvatarUploader } from './AvatarUploader'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

// Self-service photo change, reachable from the sidebar so it does not
// depend on the Team page (which is admin-only).
//
// The write goes through set_my_avatar() rather than a table update:
// `employees` is admin-write only, and that RPC is the narrow exception
// that lets a person touch avatar_url on their own linked row.
export function ProfilePhotoModal({ isOpen, onClose }) {
  const { userEmployee, refreshProfile } = useAuth()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function persist(url) {
    setSaving(true)
    setError('')
    const { error: err } = await supabase.rpc('set_my_avatar', { p_url: url })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    await refreshProfile()
  }

  // No linked employee record means there is no row to hang the photo
  // on — say so plainly instead of failing on save.
  if (!userEmployee) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Your photo">
        <div className="no-data" style={{ textAlign: 'left' }}>
          Your login isn’t linked to a team member yet, so there’s nowhere to
          put a photo. Ask an administrator to link it on the Access page.
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Your photo"
      footer={<button className="btn btn-secondary" onClick={onClose}>Done</button>}
    >
      <div className="form-group">
        <label className="form-label">Profile photo</label>
        <AvatarUploader
          employeeId={userEmployee.id}
          name={userEmployee.name}
          color={userEmployee.color}
          value={userEmployee.avatar_url}
          onChange={persist}
          disabled={saving}
          hint="Shown next to every task you’re assigned to."
        />
      </div>

      {error && (
        <div style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>{error}</div>
      )}
    </Modal>
  )
}
