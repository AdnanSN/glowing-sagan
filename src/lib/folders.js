// Project folders nest like the NAS: each row has an optional parent_id
// (null = top level). These helpers work on the flat list the page
// already holds — the tree is small enough that walking it in memory
// beats asking the database for every path.

const byPosition = (a, b) =>
  (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name)

/** Direct children of `parentId` (null for the top level), in display order. */
export function childFolders(folders, parentId) {
  return folders
    .filter(f => (f.parent_id || null) === (parentId || null))
    .sort(byPosition)
}

/**
 * The folder and every folder above it, top first. A parent the user
 * cannot see (restricted) simply ends the walk — and the seen set stops
 * a corrupt loop from spinning forever.
 */
export function folderPath(folders, id) {
  const path = []
  const seen = new Set()
  let current = folders.find(f => f.id === id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = folders.find(f => f.id === current.parent_id)
  }
  return path
}

/** "00-ADMIN / HR" — for places with room for one line. */
export function folderPathLabel(folders, id) {
  return folderPath(folders, id).map(f => f.name).join(' / ')
}

/** True when the folder, or any folder above it, is restricted. */
export function folderRestricted(folders, id) {
  return folderPath(folders, id).some(f => f.is_confidential)
}

/** The folder's id plus the ids of everything nested under it. */
export function descendantIds(folders, id) {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
    }
  }
  return out
}

/**
 * The whole tree flattened in display order, each with its depth — for
 * a <select>. `excludeId` drops that folder and everything under it,
 * which is what a "move this folder into…" picker must not offer.
 */
export function folderTreeOptions(folders, excludeId = null) {
  const skip = excludeId ? descendantIds(folders, excludeId) : new Set()
  const out = []
  const walk = (parentId, depth) => {
    for (const f of childFolders(folders, parentId)) {
      if (skip.has(f.id)) continue
      out.push({ ...f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** Option text that shows nesting inside a native <select>. */
export const indentedName = (f) => `${'    '.repeat(f.depth)}${f.depth ? '└ ' : ''}${f.name}`
