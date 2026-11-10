import { useCallback, useEffect, useState } from 'react'
import { api, type ChatFrom, type DmThread } from '../lib/api'

export interface DmTarget {
  kind: 'human' | 'bot'
  id: string
}

export function useDMs(active: boolean) {
  const [threads, setThreads] = useState<Record<string, DmThread>>({})
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!active) return
    try {
      const d = await api<{ threads: Record<string, DmThread> }>('/api/dms')
      setThreads(d.threads)
    } catch {
      /* daemon away */
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    void refresh()
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [active, refresh])

  const sendDm = useCallback(async (to: DmTarget, text: string): Promise<string | null> => {
    setBusy(true)
    try {
      const d = await api<{ threads: Record<string, DmThread> }>('/api/dms', { to, text })
      setThreads(d.threads)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Send failed.'
    } finally {
      setBusy(false)
    }
  }, [])

  const markRead = useCallback(async (key: string) => {
    try {
      const d = await api<{ thread: DmThread | null }>('/api/dms/read', { key })
      if (d.thread) {
        setThreads((prev) => ({ ...prev, [key]: { ...d.thread as DmThread, unread: 0 } }))
      }
    } catch {
      /* best effort */
    }
  }, [])

  const dmUnread = Object.values(threads).reduce((n, t) => n + (t.unread ?? 0), 0)

  return { threads, busy, dmUnread, sendDm, markRead, refresh }
}

export type DMs = ReturnType<typeof useDMs>
export type { ChatFrom }
