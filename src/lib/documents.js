import { supabase } from './supabase'

/**
 * Uploaded project documents.
 *
 * The same shape as photos.js, and for the same reason: a file input
 * and a private bucket need nothing installed on anybody's machine.
 * An earlier attempt stored a path on the office NAS instead, which
 * meant registering a small program on every PC before a link would
 * open - fine in theory, undeployable in a practice where nobody is
 * technical and whoever maintains it is not in the building.
 *
 * The file that lands here is a copy. The NAS stays the working
 * archive; this is the version attached to the project record, which
 * is what a project record should hold - what was issued, not whatever
 * the master has become since.
 */

export const DOCUMENT_BUCKET = 'project-documents'

/** Matches storage.buckets.file_size_limit in migration_v13. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

/**
 * An hour. Long enough to open a 20 MB drawing on office wifi and to
 * still work if somebody wanders off mid-download, short enough that a
 * URL pasted into a chat stops working the same day.
 */
export const SIGNED_URL_TTL = 60 * 60

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** '.pdf' from 'A-101 Rev C.pdf'; '' when there is no extension. */
function extensionOf(name) {
  const dot = (name || '').lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  // Anything odd in an extension is dropped rather than trusted into
  // an object key.
  const ext = name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
  return ext ? `.${ext}` : ''
}

/** A document name worth pre-filling: the file name, minus extension. */
export function suggestedName(fileName) {
  if (!fileName) return ''
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

/**
 * Upload one file and write the row that points at it.
 *
 * The object key is a fresh UUID every time, so nothing is ever
 * overwritten: a document cannot be silently replaced, and a signed
 * URL cannot go stale while it is still valid. The original file name
 * lives in the row instead, because that is what a person downloading
 * it should get back.
 */
export async function uploadDocument(projectId, file, meta = {}) {
  if (!projectId) throw new Error('Choose a project before attaching a file.')
  if (!file) throw new Error('No file was chosen.')
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_DOCUMENT_BYTES)} — ` +
      'attaching the issued PDF rather than the working CAD file is usually the way round it.'
    )
  }

  const storagePath = `${projectId}/${crypto.randomUUID()}${extensionOf(file.name)}`

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('documents')
    .insert({
      project_id: projectId,
      name: meta.name?.trim() || suggestedName(file.name),
      doc_type: meta.doc_type || 'Other',
      uploaded_by: meta.uploaded_by?.trim() || null,
      notes: meta.notes?.trim() || null,
      url: meta.url?.trim() || null,
      storage_path: storagePath,
      file_name: file.name,
      bytes: file.size,
      mime_type: file.type || null,
    })
    .select('*')
    .single()

  if (error) {
    // An object nothing points at is invisible and permanent, so it
    // goes now rather than at some future cleanup.
    await supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath])
    throw error
  }

  return data
}

/**
 * A short-lived URL for one document, asked for at the moment somebody
 * clicks rather than for every row on load - a project with sixty
 * documents should not sign sixty URLs nobody opens.
 *
 * `download` asks storage to send Content-Disposition: attachment with
 * the original file name, which is what makes the browser save
 * "A-101 Rev C.pdf" instead of a UUID.
 */
export async function documentUrl(doc, { download = false } = {}) {
  if (!doc?.storage_path) return null

  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL,
      download ? { download: doc.file_name || true } : undefined)

  if (error) throw error
  return data?.signedUrl || null
}

/**
 * Remove a document, object first.
 *
 * That order matters: the storage policy asks whether the caller may
 * see the project, and the row is what carries the project id.
 */
export async function deleteDocument(doc) {
  if (doc?.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([doc.storage_path])
    if (storageError) throw storageError
  }

  const { error } = await supabase.from('documents').delete().eq('id', doc.id)
  if (error) throw error
}

/**
 * Empty a project's folder in the bucket.
 *
 * Deleting a project cascades the rows away, but a cascade cannot
 * reach into storage - the objects would sit in the quota forever,
 * unreferenced and invisible. Call this BEFORE deleting the project,
 * while the rows the storage policy consults still exist.
 */
export async function deleteProjectDocuments(projectId) {
  if (!projectId) return

  const bucket = supabase.storage.from(DOCUMENT_BUCKET)
  const { data, error } = await bucket.list(projectId, { limit: 1000 })
  if (error || !data?.length) return

  await bucket.remove(data.map(o => `${projectId}/${o.name}`))
}

/**
 * What the practice is using of its storage allowance.
 *
 * Summed from the rows rather than asked of storage, because there is
 * no API for a bucket's size - and the rows are the thing that would
 * be wrong first if an object were ever orphaned.
 */
export async function documentStorageUsage() {
  const { data, error } = await supabase
    .from('documents')
    .select('bytes')
    .not('storage_path', 'is', null)

  if (error) return { bytes: 0, files: 0 }
  return {
    bytes: (data || []).reduce((sum, r) => sum + (r.bytes || 0), 0),
    files: (data || []).length,
  }
}
