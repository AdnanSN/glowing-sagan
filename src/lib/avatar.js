import { supabase } from './supabase'

// Profile photos, sized for a free Supabase project (1 GB storage,
// 5 GB egress/month).
//
// Nothing leaves the browser at full size: every picture is centre-
// cropped to a 256px square and re-encoded as WebP before upload, so a
// 4 MB phone photo lands in the bucket at roughly 5–10 KB. Avatars are
// never rendered larger than 48px, so 256 still looks sharp on a
// retina screen with room to spare.
//
// Each person owns exactly ONE object, at a fixed path, uploaded with
// upsert. Changing your picture overwrites it — storage grows with
// headcount, not with vanity. The URL carries a ?v= stamp so the file
// can be cached for a year and still update instantly.

export const AVATAR_BUCKET = 'avatars'
export const AVATAR_SIZE = 256
export const AVATAR_QUALITY = 0.8

// Generous — this is the file coming *off the disk*, before we shrink
// it. Anything larger is almost certainly not a portrait.
const MAX_SOURCE_BYTES = 15 * 1024 * 1024

export const avatarPath = (employeeId) => `${employeeId}/avatar`

function toBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

// createImageBitmap is the fast path and the only one that applies EXIF
// orientation for us; the <img> fallback covers older Safari.
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
      reject(new Error("That file couldn't be read as an image. Try a JPG or PNG."))
    }
    img.src = url
  })
}

// toBlob('image/webp') silently hands back a PNG on browsers without
// WebP encoding, which would be ~8x larger — check what we actually got
// and fall back to JPEG rather than shipping the PNG.
async function encodeSmall(canvas) {
  const webp = await toBlob(canvas, 'image/webp', AVATAR_QUALITY)
  if (webp && webp.type === 'image/webp') return webp

  const jpeg = await toBlob(canvas, 'image/jpeg', 0.85)
  if (jpeg && jpeg.type === 'image/jpeg') return jpeg

  throw new Error("This browser couldn't process that image.")
}

/** Centre-crop to a square and shrink to AVATAR_SIZE. Returns a Blob. */
export async function shrinkToAvatar(file, size = AVATAR_SIZE) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.')
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('That image is over 15 MB. Please pick a smaller one.')
  }

  const source = await loadImage(file)
  const { width, height } = source
  if (!width || !height) throw new Error("That file couldn't be read as an image.")

  const side = Math.min(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size

  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    source,
    (width - side) / 2, (height - side) / 2, side, side,  // square out of the middle
    0, 0, size, size,
  )
  source.close?.()

  return encodeSmall(canvas)
}

/**
 * Shrink, upload (replacing any previous photo), and return the public
 * URL to store on the employee row.
 */
export async function uploadAvatar(employeeId, file) {
  if (!employeeId) throw new Error('No team member to attach this photo to.')

  const blob = await shrinkToAvatar(file)
  const path = avatarPath(employeeId)

  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: blob.type,
    cacheControl: '31536000', // a year — the ?v= stamp below busts it
  })
  if (error) throw error

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

/** Best-effort removal of the stored file. The row is cleared separately. */
export async function deleteAvatarFile(employeeId) {
  if (!employeeId) return
  await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath(employeeId)])
}
