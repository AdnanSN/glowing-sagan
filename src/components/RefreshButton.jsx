import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

export function RefreshButton({ onRefresh, title = 'Refresh', size = 15 }) {
  const [busy, setBusy] = useState(false)

  async function handle() {
    if (busy) return
    setBusy(true)
    try { await onRefresh() } finally { setBusy(false) }
  }

  return (
    <button
      className="icon-btn"
      onClick={handle}
      disabled={busy}
      title={title}
      aria-label={title}
      style={{ opacity: busy ? 0.7 : 1 }}
    >
      <RefreshCw
        size={size}
        style={{ animation: busy ? 'spin 0.8s linear infinite' : 'none' }}
      />
    </button>
  )
}
