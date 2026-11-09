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
  members: Member[]
  invites?: unknown[]
  teams: TeamRef[]
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
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
