import { useState } from 'react'

// One place that decides what a person looks like: their photo if they
// have uploaded one, otherwise the coloured initial the app has always
// shown. Keeping the fallback inside here means every surface degrades
// the same way — including when a stored URL 404s because the file was
// removed out from under it.

const SIZE_CLASS = {
  sm: 'avatar avatar-sm',
  md: 'avatar',
  lg: 'avatar avatar-lg',
}

export function Avatar({
  name = '',
  src,
  color = '#1A1A1A',
  size = 'md',
  title,
  className = '',
  style,
  ...rest
}) {
  // Track *which* url failed, so swapping in a new photo retries.
  const [failedSrc, setFailedSrc] = useState(null)

  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?'
  const showPhoto = !!src && failedSrc !== src

  return (
    <div
      className={`${SIZE_CLASS[size] || SIZE_CLASS.md}${className ? ` ${className}` : ''}`}
      style={{ background: color, ...style }}
      title={title ?? (name || undefined)}
      {...rest}
    >
      {showPhoto ? (
        <img
          className="avatar-img"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        initial
      )}
    </div>
  )
}

/**
 * Several people in the space one face would take — the list of who is
 * on a task, wherever a row has no room for a column of names.
 *
 * Overflow is a count rather than a smaller face: five overlapping
 * 26px circles are unreadable, and "+3" with the names in the tooltip
 * is the thing you actually wanted to know.
 */
export function AvatarStack({ people = [], size = 'sm', max = 3, title }) {
  if (!people.length) return null
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  const names = people.map(p => p.name).join(', ')

  return (
    <span className="avatar-stack" title={title ?? names}>
      {shown.map(p => (
        <Avatar key={p.id} name={p.name} src={p.avatar_url} color={p.color} size={size} title="" />
      ))}
      {extra > 0 && <span className={`avatar-stack-more avatar-stack-more-${size}`}>+{extra}</span>}
    </span>
  )
}
