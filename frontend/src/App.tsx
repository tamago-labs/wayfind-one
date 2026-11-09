import { useEffect, useState } from 'react'

interface TeamRef {
  id: string
  name: string
  active: boolean
}

interface Peer {
  id: string
  rttMs: number | null
}

interface Status {
  team: { name: string; id: string } | null
  nodeId?: string
  joined: boolean
  peers: Peer[]
  teams: TeamRef[]
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'system-ui, sans-serif',
  background: '#0a0a0b',
  color: '#fafafa',
  padding: '2rem',
}

const card: React.CSSProperties = { maxWidth: '28rem', width: '100%', textAlign: 'left' }
const input: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.8rem',
  borderRadius: '0.5rem',
  border: '1px solid #333',
  background: '#131316',
  color: '#fafafa',
  marginTop: '0.5rem',
}
const button: React.CSSProperties = {
  padding: '0.6rem 1.2rem',
  borderRadius: '0.5rem',
  border: 'none',
  background: '#fafafa',
  color: '#0a0a0b',
  fontWeight: 700,
  cursor: 'pointer',
  marginTop: '0.75rem',
}
const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.5rem 0',
  borderBottom: '1px solid #222',
}

async function api(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`)
  return data
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('Working…')

  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const s = await api('/api/status')
        if (!stop) {
          setStatus(s)
          setError(null)
        }
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

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    setBusyLabel(label)
    setError(null)
    try {
      const s = await fn()
      setStatus(s as Status)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <main style={page}>
        <div style={card}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>Wayfind ONE</h1>
          <p style={{ opacity: 0.6 }}>Daemon offline — run the CLI, then refresh.</p>
        </div>
      </main>
    )
  }

  if (!status.team) {
    return (
      <main style={page}>
        <div style={card}>
          <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>Wayfind ONE</h1>
          <p style={{ opacity: 0.6 }}>No team yet. Create one, or pick an existing team on this machine.</p>
          <input
            style={input}
            placeholder="Team name (e.g. Acme Finance)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          <button style={button} disabled={busy || !name.trim()} onClick={() => void run('Creating team…', () => api('/api/teams', { name: name.trim() }))}>
            {busy ? busyLabel : 'Create team'}
          </button>
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #222' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Or join with an invite code</h2>
            <input
              style={input}
              placeholder="Paste invite code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
            />
            <button
              style={button}
              disabled={busy || !code.trim()}
              onClick={() => void run('Finding inviter… (can take ~20 s first time)', () => api('/api/join', { code: code.trim() }))}
            >
              {busy ? busyLabel : 'Join team'}
            </button>
          </div>
          {status.teams.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Teams on this machine</h2>
              {status.teams.map((t) => (
                <div key={t.id} style={row}>
                  <span>{t.name}</span>
                  <button
                    style={{ ...button, marginTop: 0, padding: '0.35rem 0.8rem' }}
                    disabled={busy}
                    onClick={() => void run('Starting…', () => api('/api/teams/activate', { id: t.id }))}
                  >
                    Start
                  </button>
                </div>
              ))}
            </div>
          )}
          {error && <p style={{ color: '#f87171', marginTop: '1rem' }}>{error}</p>}
        </div>
      </main>
    )
  }

  return (
    <main style={page}>
      <div style={card}>
        <h1 style={{ fontSize: '2rem', fontWeight: 800 }}>{status.team.name}</h1>
        <p style={{ opacity: 0.6 }}>
          node <code>{status.nodeId?.slice(0, 16)}…</code>
          {' · '}
          {status.joined ? `online · ${status.peers.length} peer${status.peers.length === 1 ? '' : 's'}` : 'starting…'}
        </p>
        {status.peers.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            {status.peers.map((p) => (
              <div key={p.id} style={row}>
                <code>{p.id.slice(0, 16)}…</code>
                {p.rttMs !== null && <span style={{ opacity: 0.6 }}>{p.rttMs} ms</span>}
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #222' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Invite a teammate</h2>
          {!inviteCode ? (
            <button style={button} disabled={busy} onClick={() => void run('Creating invite…', () => api('/api/invite', {}).then((d) => {
              setInviteCode((d as { code: string }).code)
              return api('/api/status')
            }))}>
              {busy ? busyLabel : 'Create invite code'}
            </button>
          ) : (
            <div>
              <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>One-time use. Share it privately — the inviter must stay online.</p>
              <code style={{ display: 'block', wordBreak: 'break-all', background: '#131316', border: '1px solid #333', borderRadius: '0.5rem', padding: '0.6rem 0.8rem', marginTop: '0.5rem' }}>{inviteCode}</code>
              <button style={{ ...button, background: '#222', color: '#fafafa' }} disabled={busy} onClick={() => setInviteCode(null)}>
                New code
              </button>
            </div>
          )}
        </div>
        {status.teams.length > 1 && (
          <div style={{ marginTop: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Switch team</h2>
            {status.teams
              .filter((t) => t.id !== status.team?.id)
              .map((t) => (
                <div key={t.id} style={row}>
                  <span>{t.name}</span>
                  <button
                    style={{ ...button, marginTop: 0, padding: '0.35rem 0.8rem' }}
                    disabled={busy}
                    onClick={() => void run('Starting…', () => api('/api/teams/activate', { id: t.id }))}
                  >
                    Switch
                  </button>
                </div>
              ))}
          </div>
        )}
        {error && <p style={{ color: '#f87171', marginTop: '1rem' }}>{error}</p>}
      </div>
    </main>
  )
}
