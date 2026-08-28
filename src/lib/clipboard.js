/**
 * Copy text, with the old execCommand path kept as a fallback.
 *
 * navigator.clipboard only exists in a secure context. Production is
 * https so it is there — the fallback is what keeps the button working
 * if the app is ever served over plain http on the office network,
 * which is exactly the deployment somebody will try one day.
 *
 * Returns whether it worked, so a button can say so rather than
 * silently doing nothing.
 */
export async function copyText(text) {
  if (!text) return false

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

/** Whether a stored location is a web link rather than a file path. */
export function isWebLink(value) {
  return /^https?:\/\//i.test((value || '').trim())
}
