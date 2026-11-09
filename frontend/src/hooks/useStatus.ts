import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Status } from '../lib/api'

export function useStatus() {
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const s = await api<Status>('/api/status')
        if (!stop) setStatus(s)
      } catch {
        if (!stop) setStatus(null)
      }
    }
    void poll()
    const t = setInterval(() => void poll(), 3000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  return status
}

// Verified display name from the shared store, or a node-ID fallback.
export function displayNameOf(status: Status | null): string {
  if (!status?.nodeId) return '…'
  const self = status.members.find((m) => m.nodeId === status.nodeId)
  return self?.displayName || `node-${status.nodeId.slice(0, 6)}`
}
