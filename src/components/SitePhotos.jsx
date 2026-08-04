import { useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, ImageOff, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { PhotoLightbox } from './PhotoLightbox'
import {
  uploadSitePhoto, signPhotoUrls, deleteSitePhoto,
  formatBytes, PHOTO_ACCEPT, FULL_MAX_EDGE,
} from '../lib/photos'

// The Site Photos tab.
//
// Built for the phone first, because that is where every one of these
// photos is taken. Picking a photo uploads it — there is no form to
// fill in and no Save button to find while holding a hard hat. A
// caption can be added later by tapping the photo; most never get one
// and that is fine, since the date, the stage and the person are
// recorded on their own.
//
// Uploads run one at a time on purpose: shrinking a 12 MP photo is
// canvas work on the main thread, and eight of them at once will stall
// or crash an older phone.

export function SitePhotos({ projectId, stages = [], currentStage, onCountChange }) {
  const { hasPermission, userEmployee } = useAuth()
  const canAdd = hasPermission('add_site_photos')
  const canDeleteAny = hasPermission('delete_any_photo')

  const [photos, setPhotos] = useState([])
  const [urls, setUrls] = useState({})
  // Which project the rows in state belong to. Deriving `loading` from
  // it rather than keeping a flag means switching projects can never
  // show the previous one's photos while the new ones are on the way.
  const [loadedFor, setLoadedFor] = useState(null)
  const loading = loadedFor !== projectId
  const [error, setError] = useState('')
  const [failures, setFailures] = useState([])
  const [progress, setProgress] = useState(null)   // { done, total }
  const [filterStage, setFilterStage] = useState('')
  const [lightboxIndex, setLightboxIndex] = useState(null)

  const cameraRef = useRef(null)
  const libraryRef = useRef(null)

  // The camera button is only offered where there is a camera to open.
  // On a desktop browser `capture` is ignored and the button would be a
  // second, identical file picker.
  const [isTouch] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  )

  useEffect(() => {
    let active = true
    loadPhotos(projectId).then(result => {
      if (!active) return   // moved on to another project mid-flight
      setPhotos(result.rows)
      setUrls(result.urls)
      setError(result.error)
      setLoadedFor(projectId)
    })
    return () => { active = false }
  }, [projectId])

  // Keeps the count in the tab label honest as photos come and go,
  // without the parent having to refetch anything.
  useEffect(() => { onCountChange?.(photos.length) }, [photos.length, onCountChange])

  async function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''  // so picking the same photo twice still fires
    if (files.length === 0) return

    setFailures([])
    setError('')
    setProgress({ done: 0, total: files.length })

    const problems = []
    for (const [i, file] of files.entries()) {
      try {
        const row = await uploadSitePhoto(projectId, file, {
          // On site you are photographing the stage the job is at, so
          // that is the default. It can be changed on the photo after.
          stage: currentStage || null,
          employeeId: userEmployee?.id,
        })
        // Signed and shown one by one rather than after the whole batch:
        // on a slow connection, seeing the first photo land is what
        // tells you it is working.
        const rowUrls = await signPhotoUrls([row])
        setUrls(u => ({ ...u, ...rowUrls }))
        setPhotos(list => sortPhotos([row, ...list]))
      } catch (err) {
        problems.push(`${file.name}: ${err.message || 'upload failed'}`)
      }
      setProgress({ done: i + 1, total: files.length })
    }

    setProgress(null)
    setFailures(problems)
  }

  async function saveDetails(photo, { caption, stage }) {
    const { data, error: err } = await supabase
      .from('site_photos')
      .update({ caption: caption || null, stage: stage || null })
      .eq('id', photo.id)
      .select('*, uploader:employees(id,name,color,avatar_url)')
      .single()

    if (err) { setError(err.message); return }
    setPhotos(list => list.map(p => (p.id === photo.id ? data : p)))
  }

  async function removePhoto(photo) {
    if (!confirm('Delete this photo? This cannot be undone.')) return
    try {
      await deleteSitePhoto(photo)
    } catch (err) {
      setError(err.message || 'Could not delete that photo.')
      return
    }

    const remaining = photos.filter(p => p.id !== photo.id)
    setPhotos(remaining)
    // Stay put and show whatever slid into this position; close only
    // when the one just deleted was the last of them.
    const stillShown = filterStage
      ? remaining.filter(p => p.stage === filterStage).length
      : remaining.length
    setLightboxIndex(i => (i === null || stillShown === 0 ? null : Math.min(i, stillShown - 1)))
  }

  const mine = (photo) => !!userEmployee?.id && photo.uploaded_by === userEmployee.id
  const canEditPhoto = (photo) => canDeleteAny || mine(photo)
  const canDeletePhoto = (photo) => canDeleteAny || mine(photo)

  const usedStages = [...new Set(photos.map(p => p.stage).filter(Boolean))]
  const visible = filterStage ? photos.filter(p => p.stage === filterStage) : photos
  const totalBytes = photos.reduce((sum, p) => sum + (p.bytes || 0), 0)

  const pickers = (
    <>
      {isTouch && (
        <button className="btn btn-primary btn-sm" onClick={() => cameraRef.current?.click()} disabled={!!progress}>
          <Camera size={14} /> Take Photo
        </button>
      )}
      <button
        className={`btn btn-sm ${isTouch ? 'btn-secondary' : 'btn-primary'}`}
        onClick={() => libraryRef.current?.click()}
        disabled={!!progress}
      >
        <ImagePlus size={14} /> Add Photos
      </button>
    </>
  )

  if (loading) {
    return <div className="loading-container"><div className="loading-spinner" /><span>Loading photos…</span></div>
  }

  return (
    <div>
      <div className="section-header">
        <span className="section-title">Site Photos</span>
        {canAdd && <div className="photo-actions">{pickers}</div>}
      </div>

      {progress && (
        <div className="photo-progress">
          <div className="photo-progress-label">
            Uploading {progress.done} of {progress.total}…
            <span className="photo-progress-note">Shrinking each photo before it is sent — keep this tab open.</span>
          </div>
          <div className="progress-bar-container">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {error && <div className="photo-error"><AlertTriangle size={14} /> {error}</div>}

      {failures.length > 0 && (
        <div className="photo-error">
          <AlertTriangle size={14} />
          <div>
            {failures.length} photo{failures.length !== 1 ? 's' : ''} could not be uploaded:
            <ul className="photo-error-list">
              {failures.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        </div>
      )}

      {photos.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><ImageOff /></div>
          <div className="empty-state-title">No site photos yet</div>
          <div className="empty-state-desc">
            {canAdd
              ? 'Photograph progress, defects and site conditions straight from your phone.'
              : 'Nothing has been photographed on this project yet.'}
          </div>
          {canAdd && <div className="photo-actions">{pickers}</div>}
        </div>
      ) : (
        <>
          {usedStages.length > 1 && (
            <div className="photo-filter">
              <select
                className="form-select"
                value={filterStage}
                onChange={e => setFilterStage(e.target.value)}
              >
                <option value="">All stages ({photos.length})</option>
                {usedStages.map(s => (
                  <option key={s} value={s}>
                    {s} ({photos.filter(p => p.stage === s).length})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="photo-grid">
            {visible.map(photo => (
              <button
                key={photo.id}
                className="photo-tile"
                onClick={() => setLightboxIndex(visible.indexOf(photo))}
                title={photo.caption || 'Open photo'}
              >
                <img
                  src={urls[photo.thumb_path]}
                  alt={photo.caption || 'Site photo'}
                  loading="lazy"
                  decoding="async"
                />
                <span className="photo-tile-date">
                  {format(new Date(photo.taken_at || photo.created_at), 'd MMM')}
                </span>
                {photo.caption && <span className="photo-tile-caption">{photo.caption}</span>}
              </button>
            ))}
          </div>

          <div className="photo-footprint">
            {photos.length} photo{photos.length !== 1 ? 's' : ''} · {formatBytes(totalBytes)} stored ·
            each one resized to {FULL_MAX_EDGE}px before upload
          </div>
        </>
      )}

      {/* Two inputs rather than one: `capture` opens the camera straight
          away, which is the whole point on site, but it also hides the
          camera roll — so the library needs its own. */}
      <input
        ref={cameraRef}
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        onChange={handleFiles}
        style={{ display: 'none' }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept={PHOTO_ACCEPT}
        multiple
        onChange={handleFiles}
        style={{ display: 'none' }}
      />

      {/* The filtered list, not all of them: swiping should walk the
          set of photos you are actually looking at. */}
      {lightboxIndex !== null && visible[lightboxIndex] && (
        <PhotoLightbox
          photos={visible}
          index={lightboxIndex}
          urls={urls}
          stages={stages}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onSaveDetails={saveDetails}
          onDelete={removePhoto}
          canEdit={canEditPhoto}
          canDelete={canDeletePhoto}
        />
      )}
    </div>
  )
}

// Read outside the component and returned whole, so the effect above
// has nothing to set until the answer is actually back.
async function loadPhotos(projectId) {
  const empty = { rows: [], urls: {}, error: '' }

  const { data, error } = await supabase
    .from('site_photos')
    .select('*, uploader:employees(id,name,color,avatar_url)')
    .eq('project_id', projectId)
    .order('taken_at', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return { ...empty, error: error.message }

  const rows = data || []
  try {
    return { rows, urls: await signPhotoUrls(rows), error: '' }
  } catch (err) {
    // The rows are fine, it is the signing that failed — show the count
    // and say why the pictures are missing rather than an empty tab.
    return { rows, urls: {}, error: err.message || 'Could not load the photos.' }
  }
}

// Newest first, matching the query — a photo added now belongs at the
// top even if its camera timestamp is older than the one above it.
function sortPhotos(list) {
  return [...list].sort((a, b) =>
    new Date(b.taken_at || b.created_at) - new Date(a.taken_at || a.created_at)
  )
}
