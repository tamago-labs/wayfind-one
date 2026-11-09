export interface TeamRef {
  id: string
  name: string
  active: boolean
}

export interface Peer {
  id: string
  rttMs: number | null
}

export interface Member {
  nodeId: string
  displayName: string
  updatedAt: number
}

export interface Status {
  team: { name: string; id: string } | null
  nodeId?: string
  joined: boolean
  topic?: string | null
  peers: Peer[]
  store?: { writable: boolean }
  computer?: { state: string; container?: string; image?: string; workspace?: string; error?: string }
  provider?: { provider: string; model: string; hasKey: boolean } | null
  members: Member[]
  invites?: unknown[]
  teams: TeamRef[]
}

export interface Bot {
  id: string
  name: string
  role: string
  isChiefOfStaff?: boolean
  color: string
  shape: string
  msgs: { t: string; x?: string }[]
}

export async function api<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `request failed (${res.status})`
    throw new Error(msg)
  }
  return data as T
}
