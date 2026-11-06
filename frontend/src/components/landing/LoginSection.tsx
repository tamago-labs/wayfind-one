import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Mascot from '../Mascot'

interface SwarmStatus {
  nodeId: string
  teamName: string
  topic: string | null
  joined: boolean
  peers: { id: string; rttMs: number | null }[]
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export default function LoginSection() {
  const navigate = useNavigate()
  const [team, setTeam] = useState('')
  const [status, setStatus] = useState<SwarmStatus | null>(null)
  const [daemonOnline, setDaemonOnline] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const s = await api<SwarmStatus>('/api/status')
        if (!stop) {
          setStatus(s)
          setDaemonOnline(true)
        }
      } catch {
        if (!stop) {
          setDaemonOnline(false)
        }
      }
    }
    void poll()
    const t = setInterval(() => void poll(), 3000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  function cont(e: React.FormEvent) {
    e.preventDefault()
    if (team.trim()) localStorage.setItem('wf-team', team.trim())
    navigate('/docs/quickstart')
  }

  async function connect() {
    setBusy(true)
    try {
      const s = await api<SwarmStatus>('/api/swarm/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      setStatus(s)
    } catch {
      setDaemonOnline(false)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    try {
      const s = await api<SwarmStatus>('/api/swarm/leave', { method: 'POST' })
      setStatus(s)
    } catch {
      setDaemonOnline(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="grid flex-1 place-items-center bg-herobg px-6 pb-6 pt-6 text-navy">
      <div className="mx-auto w-full max-w-[420px] rounded-3xl bg-white p-10 text-center shadow-card">
        <div className="mb-4 flex justify-center -space-x-2">
          {(['amber', 'moss', 'lagoon', 'ash'] as const).map((color, i) => (
            <Mascot key={color} color={color} size="sm" motion="none" blinkDelay={`-${i * 1.4}s`} className="ring-[3px] ring-white" />
          ))}
        </div>
        <h1 className="mt-4 font-brico text-3xl font-extrabold tracking-tight text-navy">Welcome back</h1>
        <p className="mt-2 text-heroslate">Your team&apos;s private AI workspace. No accounts, no central server.</p>
        <form onSubmit={cont} className="mt-6 grid gap-3 text-left">
          <label className="grid gap-1.5 text-sm font-bold">
            Team name
            <input
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="Acme Finance"
              className="rounded-lg border border-navy/15 px-3 py-2.5 text-[15px] font-normal"
            />
          </label>
          <button
            type="submit"
            disabled={!team.trim()}
            className="rounded-full bg-cta px-8 py-3 font-semibold text-white hover:bg-ctahover transition-colors disabled:opacity-40"
          >
            Continue
          </button>
        </form>

        <div className="mt-6 border-t border-navy/10 pt-4 text-left">
          <p className="text-xs font-extrabold uppercase tracking-wider text-heroslate">Daemon</p>
          {daemonOnline === null && <p className="mt-2 text-sm text-heroslate">Checking…</p>}
          {daemonOnline === false && (
            <p className="mt-2 text-sm text-heroslate">
              Offline — run <code className="font-mono text-[13px]">wayfind-one up</code> to connect.
            </p>
          )}
          {daemonOnline && status && (
            <div className="mt-2 text-sm">
              <p>
                <span className={`mr-2 inline-block h-2 w-2 rounded-full ${status.joined ? 'bg-emerald-500' : 'bg-bash'}`} />
                {status.joined ? `Online · ${status.peers.length} peer${status.peers.length === 1 ? '' : 's'}` : 'Disconnected'}
              </p>
              <p className="mt-1 font-mono text-xs text-heroslate">
                {status.nodeId.slice(0, 16)}… · {status.teamName}
              </p>
              {status.peers.length > 0 && (
                <ul className="mt-2 space-y-1 font-mono text-xs">
                  {status.peers.map((p) => (
                    <li key={p.id}>
                      {p.id.slice(0, 16)}…{p.rttMs !== null ? ` · ${p.rttMs}ms` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                {status.joined ? (
                  <button onClick={() => void disconnect()} disabled={busy} className="rounded-full border-2 border-navy px-5 py-2 text-sm font-semibold hover:bg-navy hover:text-white transition-colors disabled:opacity-40">
                    Disconnect
                  </button>
                ) : (
                  <button onClick={() => void connect()} disabled={busy} className="rounded-full bg-navy px-5 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-40">
                    Connect
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-[13px] text-heroslate">Demo without setup: npx wayfind-one demo</p>
      </div>
    </section>
  )
}
