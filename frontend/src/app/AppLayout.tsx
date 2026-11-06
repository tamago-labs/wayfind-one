import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { Logo } from '../components/landing/Header'

interface SwarmStatus {
  nodeId: string
  teamName: string
  joined: boolean
  peers: { id: string }[]
}

export default function AppLayout() {
  const [status, setStatus] = useState<SwarmStatus | null>(null)

  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const res = await fetch('/api/status')
        if (res.ok && !stop) setStatus(await res.json())
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

  return (
    <div className="flex min-h-screen flex-col bg-herobg font-brico text-navy">
      <header className="border-b border-navy/10 bg-herobg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <div className="flex items-center gap-4 text-sm">
            <span className="text-heroslate">
              {status ? `${status.teamName} · ${status.peers.length} peer${status.peers.length === 1 ? '' : 's'}` : 'daemon offline'}
            </span>
            <Link to="/docs" className="font-medium hover:opacity-60">
              Docs
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
