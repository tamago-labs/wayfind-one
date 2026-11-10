import { useCallback, useEffect, useState } from 'react'
import { api, type ChatFrom, type DmThread, type GroupMsg } from '../lib/api'

const SEEN_KEY = 'wayfind-group-seen'

export interface DmTarget {
  kind: 'human' | 'bot'
  id: string
}

export function useTeamChat(active: boolean) {
  const [group, setGroup] = useState<GroupMsg[]>([])
  const [queued, setQueued] = useState<number>(0)
  const [threads, setThreads] = useState<Record<string, DmThread>>({})
  const [busy, setBusy] = useState(false)
  const [groupSeen, setGroupSeen] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(SEEN_KEY) ?? 0)
    } catch {
      return 0
    }
  })

  const refresh = useCallback(async () => {
    if (!active) return
    try {
      const g = await api<{ msgs: GroupMsg[]; outbox: unknown[] }>('/api/group')
      setGroup(g.msgs)
      setQueued(g.outbox.length)
    } catch {
      /* daemon away */
    }
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

  const markGroupSeen = useCallback(() => {
    const now = Date.now()
    setGroupSeen(now)
    try {
      localStorage.setItem(SEEN_KEY, String(now))
    } catch {
      /* private mode */
    }
  }, [])

  const sendGroup = useCallback(
    async (text: string): Promise<string | null> => {
      setBusy(true)
      try {
        const g = await api<{ msgs: GroupMsg[]; outbox: unknown[] }>('/api/group', { text })
        setGroup(g.msgs)
        setQueued(g.outbox.length)
        markGroupSeen()
        return null
      } catch (err) {
        return err instanceof Error ? err.message : 'Send failed.'
      } finally {
        setBusy(false)
      }
    },
    [markGroupSeen],
  )

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
  const groupUnread = group.filter((m) => m.ts > groupSeen).length

  return { group, queued, threads, busy, dmUnread, groupUnread, groupSeen, markGroupSeen, sendGroup, sendDm, markRead, refresh }
}

export type TeamChat = ReturnType<typeof useTeamChat>
export type { ChatFrom }
