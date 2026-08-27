import { supabase } from './supabase'

/**
 * Documents that live on the office NAS.
 *
 * Every office machine already reaches the share over the LAN, so a
 * document row stores an address rather than a copy — see
 * migration_v12_nas_links.sql for why a second copy of a drawing is the
 * thing worth avoiding.
 *
 * THE ONE CONSTRAINT EVERYTHING HERE WORKS AROUND
 *   A browser will not follow \\NAS01\... or file:// from an https
 *   page. That is a security boundary in Chrome and Edge, not a setting
 *   somebody can turn off, and being on the same LAN does not change
 *   it. So the UI offers two routes to the same file:
 *
 *     Copy path   — always works, nothing to install, paste in Explorer.
 *     nhn:/// link — one click, but the machine needs the handler in
 *                    nas-handler/ registered first.
 *
 *   Both are offered on every row on purpose. The copy button is what a
 *   machine that never had the handler installed falls back to, and it
 *   is the thing that still works when someone opens the system on a
 *   laptop that is new that week.
 *
 * PATH FORM
 *   Stored relative to the share root with forward slashes; rendered
 *   with backslashes because that is what Explorer expects pasted in.
 *   Windows accepts either, so storing one form means the value does
 *   not depend on who typed it.
 */

/** URL scheme the handler in nas-handler/ registers. */
export const NAS_PROTOCOL = 'nhn'

/** app_settings key holding the share root, e.g. \\NAS01\Projects */
export const NAS_ROOT_KEY = 'nas_root'

/** Trailing separators trimmed so joining never doubles one. */
export function normalizeNasRoot(root) {
  return (root || '').trim().replace(/[\\/]+$/, '')
}

/** Comparable form: separators and case flattened, for prefix tests. */
function comparable(value) {
  return value.replace(/\\/g, '/').toLowerCase()
}

/**
 * Clean up what somebody typed into the path field.
 *
 * Forgiving in exactly one way that matters: people copy the full path
 * out of Explorer's address bar, because that is the path they can
 * see. If it starts with the configured root, the root is stripped
 * rather than rejected — refusing the most natural gesture to teach a
 * storage convention is how a field stops getting used.
 *
 * Returns { path, error }; `path` is null when the field is empty.
 * The rules mirror the check constraint in migration_v12 — this copy
 * exists to say what is wrong while the modal is still open.
 */
export function normalizeNasPath(input, root) {
  // Windows Explorer's "Copy as path" (Shift+right-click) wraps the
  // path in double quotes. That is the easiest way to get a real path
  // out of Explorer, so the quotes come off rather than being an error.
  const raw = (input || '').trim().replace(/^"(.*)"$/s, '$1').trim()
  if (!raw) return { path: null, error: null }

  let value = raw.replace(/\\/g, '/').replace(/\/{2,}/g, (m, i) => (i === 0 ? m : '/'))

  // A pasted full path, against the root we know about.
  const cleanRoot = normalizeNasRoot(root)
  if (cleanRoot) {
    const rootCmp = comparable(cleanRoot)
    if (comparable(value) === rootCmp) {
      return { path: null, error: 'That is the share root itself, not a file inside it.' }
    }
    if (comparable(value).startsWith(rootCmp + '/')) {
      value = value.slice(cleanRoot.length + 1)
    }
  }

  value = value.replace(/\/{2,}/g, '/').replace(/\/+$/, '')

  if (!value) return { path: null, error: null }

  if (/(^|\/)\.\.(\/|$)/.test(value)) {
    return { path: null, error: 'A path cannot step outside the share with “..”.' }
  }
  if (/^[/\\]/.test(value)) {
    return {
      path: null,
      error: cleanRoot
        ? `That path is not inside ${cleanRoot}. Check the share root in settings.`
        : 'Set the share root in settings first, then paste the full path here.',
    }
  }
  if (/^[A-Za-z]:/.test(value)) {
    return {
      path: null,
      error: 'Use the network path (\\\\NAS01\\Projects\\…), not a mapped drive letter — the letter differs per machine.',
    }
  }

  return { path: value, error: null }
}

/** \\NAS01\Projects\RIY-2024-017\Drawings\A-101.pdf */
export function nasFullPath(root, rel) {
  const cleanRoot = normalizeNasRoot(root)
  if (!cleanRoot || !rel) return ''
  return `${cleanRoot}\\${rel.replace(/\//g, '\\')}`
}

/** The containing folder — where the other revisions are sitting. */
export function nasFolderPath(root, rel) {
  const full = nasFullPath(root, rel)
  if (!full) return ''
  const cut = full.lastIndexOf('\\')
  return cut > 1 ? full.slice(0, cut) : full
}

/**
 * nhn:///open?path=… for the protocol handler.
 *
 * The whole relative path goes through encodeURIComponent, so it lands
 * in the URL as one opaque value with no slashes of its own. That
 * sidesteps Windows treating the first segment after `//` as a host
 * name and lower-casing or mangling it.
 *
 * The root is deliberately NOT in the URL. The handler holds its own
 * copy and joins them itself — a root that arrived from the page would
 * be a root an attacker could choose.
 */
export function nasProtocolUrl(rel, action = 'open') {
  if (!rel) return ''
  return `${NAS_PROTOCOL}:///${action}?path=${encodeURIComponent(rel)}`
}

/**
 * nhn:///pick - ask the handler to open a Windows file dialog.
 *
 * WHY THE PICKER IS NOT IN THE BROWSER
 *   A web page cannot learn a file's path. A file input hands back the
 *   bytes and the name and reports the path as the literal string
 *   "C:\fakepath\...", by design, so that sites cannot map your disk.
 *   The handler is an ordinary Windows program with no such limit, so
 *   the dialog lives there.
 *
 * `startRelative` is only a convenience - the folder the dialog opens
 * in. The handler validates it like any other path, and validates
 * whatever comes back out of the dialog too, because the person can
 * browse anywhere from it.
 */
export function nasPickUrl(startRelative) {
  return startRelative
    ? `${NAS_PROTOCOL}:///pick?path=${encodeURIComponent(startRelative)}`
    : `${NAS_PROTOCOL}:///pick`
}

/** The folder part of a relative path, for opening the picker nearby. */
export function nasParentRelative(rel) {
  if (!rel) return ''
  const parts = rel.replace(/\\/g, '/').split('/')
  parts.pop()
  return parts.join('/')
}

/** 'RIY/Drawings/A-101.pdf' -> 'A-101', a starting document name. */
export function nasSuggestedName(rel) {
  if (!rel) return ''
  const file = rel.replace(/\\/g, '/').split('/').pop() || ''
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(0, dot) : file
}

/**
 * How long a picked path stays usable.
 *
 * The clipboard is the only way back from the handler: Windows can
 * launch it but gives it no channel to answer the page. So the handler
 * stamps what it writes, and anything older than this is treated as
 * stale rather than used. Without that, cancelling the dialog and
 * clicking "use picked file" would silently attach whatever was picked
 * last time - the wrong drawing on the right project, which is exactly
 * the mistake that would go unnoticed.
 */
export const PICK_MAX_AGE_MS = 2 * 60 * 1000

/**
 * Read what the handler left on the clipboard.
 *
 * Text without the marker is passed through untouched rather than
 * refused: it is almost certainly a path from Explorer's "Copy as
 * path", which is a perfectly good way to fill this field, and the
 * field's own validation will judge it.
 */
export function parsePickedPath(text) {
  const raw = (text || '').trim()
  if (!raw) return { path: null, fromPicker: false, error: 'The clipboard is empty. Pick a file in the dialog first.' }

  const match = /^nhn-pick:(\d+):([\s\S]+)$/.exec(raw)
  if (!match) return { path: raw, fromPicker: false, error: null }

  if (Date.now() - Number(match[1]) * 1000 > PICK_MAX_AGE_MS) {
    return { path: null, fromPicker: true, error: 'That was picked a while ago. Click Browse and choose the file again.' }
  }
  return { path: match[2].trim(), fromPicker: true, error: null }
}

/** Clipboard read needs a user gesture and a secure context. */
export async function readClipboard() {
  if (!navigator.clipboard?.readText) {
    return { text: null, error: 'This browser will not let the page read the clipboard. Paste into the field with Ctrl+V instead.' }
  }
  try {
    return { text: await navigator.clipboard.readText(), error: null }
  } catch {
    return { text: null, error: 'The browser blocked reading the clipboard. Allow it for this site, or paste with Ctrl+V.' }
  }
}

/**
 * Hand a nhn:// URL to Windows.
 *
 * Assigning to location.href is what fires a protocol handler; the
 * page itself does not navigate, so the modal and everything typed
 * into it stay exactly where they were.
 */
export function launchNasUrl(url) {
  if (url) window.location.href = url
}

/** The practice-wide share root. Empty string when nobody has set it. */
export async function fetchNasRoot() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', NAS_ROOT_KEY)
    .single()

  if (error) return ''
  return normalizeNasRoot(data?.value)
}

/** Principal Architects only — RLS refuses everyone else. */
export async function saveNasRoot(root) {
  const { error } = await supabase
    .from('app_settings')
    .update({ value: normalizeNasRoot(root), updated_at: new Date().toISOString() })
    .eq('key', NAS_ROOT_KEY)

  if (error) throw error
}

/**
 * Copy, with the old execCommand path kept as a fallback.
 *
 * navigator.clipboard only exists in a secure context. Production is
 * https so it is there — but the fallback is what keeps the button
 * working if this is ever served over plain http on the LAN, which is
 * exactly the deployment somebody will try one day.
 */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permission refused or no secure context — fall through.
    }
  }

  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(field)
  return ok
}
