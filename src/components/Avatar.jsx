const SIZE_CLASS = { sm: 'avatar-sm', md: '', lg: 'avatar-lg' }

export function Avatar({ name = '', color = '#C8A96E', avatarUrl, size = 'md', title, style, className = '' }) {
  const initial = (name.charAt(0) || '?').toUpperCase()
  const cls = ['avatar', SIZE_CLASS[size] || '', className].filter(Boolean).join(' ')

  if (avatarUrl) {
    return (
      <div
        className={cls}
        title={title || name}
        style={{
          backgroundColor: color,
          backgroundImage: `url("${avatarUrl}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          color: 'transparent',
          ...style,
        }}
      >
        {initial}
      </div>
    )
  }

  return (
    <div
      className={cls}
      title={title || name}
      style={{ background: color, ...style }}
    >
      {initial}
    </div>
  )
}
