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
