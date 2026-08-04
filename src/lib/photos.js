import { supabase } from './supabase'

// Site photos — what the job actually looks like, taken on a phone
// while standing in the building.
//
// The whole file exists because of one number: a modern phone shoots a
// 12 MP photo at 3–6 MB, and a free Supabase project has 1 GB of
// storage and 5 GB of egress a month. Two hundred of those is a fifth
// of the quota gone on a single site visit. So nothing leaves the
// browser at full size — every photo is re-encoded here first, into
// TWO derivatives:
//
//   full    2048px on the long edge, WebP q0.82, hard-capped at 700 KB.
//           Enough to zoom into a crack, a rebar spacing or a bad
//           joint, which is the entire point of a site record.
//   thumb   480px on the long edge, WebP q0.7 — 20–35 KB.
//
// ≈350–530 KB the pair, so the free tier holds roughly 2,000–2,800
// photos. The original never leaves the phone.
//
// The thumbnail is not a nicety. A project with 200 photos would pull
// ~80 MB every time somebody opened the grid; at thumbnail size the
// same screen costs ~5 MB, and a full image is fetched only when
// somebody actually opens one.
//
// The bucket is PRIVATE, unlike `avatars` — a confidential project must
// not hand out its photos to whoever is holding the URL. Nothing here
// renders without a short-lived signed URL, and RLS on storage.objects
// decides who may be issued one (migration_v10_site_photos.sql).

export const PHOTO_BUCKET = 'site-photos'

export const FULL_MAX_EDGE = 2048
export const FULL_QUALITY = 0.82
// Ceiling per photo, whatever the subject. A busy façade full of
// texture encodes far larger than a flat wall at the same quality, and
// the quota does not care which it was — so quality steps down until
// the file fits rather than the other way round.
export const FULL_BYTE_BUDGET = 700 * 1024
const MIN_QUALITY = 0.55

export const THUMB_MAX_EDGE = 480
export const THUMB_QUALITY = 0.7

// The file coming off the camera, before we shrink it. Generous — a
// 48 MP phone in full-resolution mode lands around 20 MB.
const MAX_SOURCE_BYTES = 50 * 1024 * 1024

// How long a signed URL is good for. Long enough to work through a set
// of photos without re-signing, short enough that a URL copied out of
// the address bar stops working the same day. Objects are written once
// and never overwritten, so a URL can be cached for its whole life.
export const SIGNED_URL_TTL = 2 * 60 * 60

// image/* rather than a list of mime types: it is what makes the iOS
// picker offer the camera roll properly, and it lets Safari hand us a
// converted JPEG for a HEIC original instead of refusing the file.
export const PHOTO_ACCEPT = 'image/*'

/** Human-readable size, for the caption line under a photo. */
export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function toBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

// createImageBitmap is the fast path and the only one that applies EXIF
// orientation for us; the <img> fallback covers older Safari, which
// rotates by itself.
async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall through to the <img> decoder */
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(
        "That file couldn't be read as an image. If it came off an iPhone as " +
        'HEIC, open it once on the phone or save it as JPEG first.'
      ))
    }
    img.src = url
  })
}

function fitWithin(width, height, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function drawTo(source, sw, sh, dw, dh) {
  const canvas = document.createElement('canvas')
  canvas.width = dw
  canvas.height = dh
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, sw, sh, 0, 0, dw, dh)
  return canvas
}

/**
 * Shrink to fit `maxEdge`, halving repeatedly on the way down.
 *
 * One drawImage from 4000px straight to 480px samples far too sparsely
 * and turns brickwork and scaffolding into shimmer. Halving until the
 * target is within reach costs a few milliseconds and keeps the detail
 * that makes a site photo worth taking.
 */
function resizeToCanvas(source, sourceWidth, sourceHeight, maxEdge) {
  const target = fitWithin(sourceWidth, sourceHeight, maxEdge)

  let current = source
  let width = sourceWidth
  let height = sourceHeight

  while (width >= target.width * 2 && height >= target.height * 2) {
    const halfWidth = Math.max(target.width, Math.round(width / 2))
    const halfHeight = Math.max(target.height, Math.round(height / 2))
    current = drawTo(current, width, height, halfWidth, halfHeight)
    width = halfWidth
    height = halfHeight
  }

  return drawTo(current, width, height, target.width, target.height)
}

// toBlob('image/webp') silently hands back a PNG on browsers without
// WebP encoding, which would be several times larger — check what we
// actually got and fall back to JPEG rather than shipping the PNG.
async function encode(canvas, quality) {
  const webp = await toBlob(canvas, 'image/webp', quality)
  if (webp && webp.type === 'image/webp') return webp

  const jpeg = await toBlob(canvas, 'image/jpeg', quality)
  if (jpeg && jpeg.type === 'image/jpeg') return jpeg

  throw new Error("This browser couldn't process that photo.")
}

/** Encode, stepping quality down until the blob fits the budget. */
async function encodeWithinBudget(canvas, startQuality, budget) {
  let quality = startQuality
  let blob = await encode(canvas, quality)

  while (blob.size > budget && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, Math.round((quality - 0.08) * 100) / 100)
    blob = await encode(canvas, quality)
  }

  return blob
}

/**
 * Turn one picked file into the two blobs that get uploaded.
 * Exported on its own so the size of a photo can be shown, or tested,
 * without touching the network.
 */
export async function prepareSitePhoto(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a photo.')
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('That photo is over 50 MB. Please pick a smaller one.')
  }

  const source = await loadImage(file)
  const sourceWidth = source.width
  const sourceHeight = source.height
  if (!sourceWidth || !sourceHeight) {
    throw new Error("That file couldn't be read as an image.")
  }

  const fullCanvas = resizeToCanvas(source, sourceWidth, sourceHeight, FULL_MAX_EDGE)
  const full = await encodeWithinBudget(fullCanvas, FULL_QUALITY, FULL_BYTE_BUDGET)

  // Derived from the already-shrunk canvas rather than the original:
  // one less decode, and the halving above has done most of the work.
  const thumbCanvas = resizeToCanvas(
    fullCanvas, fullCanvas.width, fullCanvas.height, THUMB_MAX_EDGE,
  )
  const thumb = await encode(thumbCanvas, THUMB_QUALITY)

  source.close?.()

  return {
    full,
    thumb,
    width: fullCanvas.width,
    height: fullCanvas.height,
    // A camera capture stamps the file with the moment it was taken, so
    // a batch uploaded that evening still sorts by when it was shot.
    // Anything implausible (0, or a clock set ahead) falls back to now.
    takenAt: file.lastModified > 0 && file.lastModified <= Date.now()
      ? new Date(file.lastModified).toISOString()
      : new Date().toISOString(),
  }
}

const extensionFor = (blob) => (blob.type === 'image/jpeg' ? 'jpg' : 'webp')

/**
 * Shrink one photo, upload both derivatives, and insert the row.
 * Returns the saved row (with its uploader joined) so the grid can show
 * it without a full refetch.
 */
export async function uploadSitePhoto(projectId, file, { caption, stage, employeeId } = {}) {
  if (!projectId) throw new Error('No project to attach this photo to.')

  const { full, thumb, width, height, takenAt } = await prepareSitePhoto(file)

  // A fresh key every time — nothing is ever overwritten, so a photo
  // cannot be silently replaced and a signed URL never goes stale.
  const key = crypto.randomUUID()
  const storagePath = `${projectId}/${key}.${extensionFor(full)}`
  const thumbPath = `${projectId}/${key}-thumb.${extensionFor(thumb)}`

  const bucket = supabase.storage.from(PHOTO_BUCKET)
  const options = { contentType: full.type, cacheControl: '31536000', upsert: false }

  const [fullUpload, thumbUpload] = await Promise.all([
    bucket.upload(storagePath, full, options),
    bucket.upload(thumbPath, thumb, { ...options, contentType: thumb.type }),
  ])
  const uploadError = fullUpload.error || thumbUpload.error
  if (uploadError) {
    // Whichever half made it is dead weight — the row that would have
    // pointed at it is never written.
    await bucket.remove([storagePath, thumbPath])
    throw uploadError
  }

  const { data, error } = await supabase
    .from('site_photos')
    .insert({
      project_id: projectId,
      storage_path: storagePath,
      thumb_path: thumbPath,
      caption: caption?.trim() || null,
      stage: stage || null,
      taken_at: takenAt,
      bytes: full.size,
      width,
      height,
      uploaded_by: employeeId || null,
    })
    .select('*, uploader:employees(id,name,color,avatar_url)')
    .single()

  if (error) {
    // Same reasoning: an object nothing points at is invisible and
    // permanent, so it goes now rather than at some future cleanup.
    await bucket.remove([storagePath, thumbPath])
    throw error
  }

  return data
}

/**
 * Signed URLs for a batch of photo rows, as a { path: url } object.
 *
 * Both sizes are signed in one round trip even though the grid only
 * renders thumbnails: signing costs nothing but the request, and it
 * means opening a photo is instant. The full image is not *downloaded*
 * until something actually renders it, which is where the egress
 * saving lives.
 */
export async function signPhotoUrls(photos) {
  const paths = photos.flatMap(p => [p.thumb_path, p.storage_path]).filter(Boolean)
  if (paths.length === 0) return {}

  const bucket = supabase.storage.from(PHOTO_BUCKET)
  const urls = {}

  // Chunked so a project with hundreds of photos doesn't send one
  // enormous request.
  for (let i = 0; i < paths.length; i += 100) {
    const { data, error } = await bucket.createSignedUrls(paths.slice(i, i + 100), SIGNED_URL_TTL)
    if (error) throw error
    for (const entry of data || []) {
      if (entry.signedUrl && !entry.error) urls[entry.path] = entry.signedUrl
    }
  }

  return urls
}

/**
 * Remove one photo, objects first.
 *
 * That order matters: the storage policy asks `site_photos` whether the
 * caller uploaded this photo, so the row has to still be there when the
 * objects go.
 */
export async function deleteSitePhoto(photo) {
  const { error: storageError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .remove([photo.storage_path, photo.thumb_path].filter(Boolean))
  if (storageError) throw storageError

  const { error } = await supabase.from('site_photos').delete().eq('id', photo.id)
  if (error) throw error
}

/**
 * Empty a project's folder in the bucket.
 *
 * Deleting a project cascades the rows away, but a cascade cannot reach
 * into storage — the objects would sit in the quota forever, invisible
 * and unreferenced. Call this BEFORE deleting the project, while the
 * rows the storage policy consults still exist.
 */
export async function deleteProjectPhotos(projectId) {
  if (!projectId) return

  const bucket = supabase.storage.from(PHOTO_BUCKET)
  const { data, error } = await bucket.list(projectId, { limit: 1000 })
  if (error || !data?.length) return

  await bucket.remove(data.map(o => `${projectId}/${o.name}`))
}
