import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useAction } from '../../hooks/useAction'
import { buttonCls } from '../forms'

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function AdvancedPanel({ onTeamGone }: { onTeamGone: () => void }) {
  const [storage, setStorage] = useState<{ home: string; bytes: number } | null>(null)
  const [confirm, setConfirm] = useState<'leave' | 'reset' | null>(null)
  const action = useAction()

  useEffect(() => {
    let stop = false
    api<{ home: string; bytes: number }>('/api/storage')
      .then((s) => {
        if (!stop) setStorage(s)
      })
      .catch(() => {})
    return () => {
      stop = true
    }
  }, [])

  async function leave() {
    await action.run('Leaving…', () => api('/api/teams/leave', {}))
    onTeamGone()
  }

  async function reset() {
    await action.run('Resetting…', () => api('/api/workspace/reset', {}))
    onTeamGone()
  }

  return (
    <div className="mt-4">
      <h3 className="font-brico text-base font-bold">Storage</h3>
      <p className="mt-1 font-mono text-xs text-heroslate">
        {storage ? `${storage.home} · ${formatBytes(storage.bytes)}` : '…'}
      </p>

      <div className="mt-5 border-t border-bcoral/30 pt-4">
        <h3 className="font-brico text-base font-bold text-bcoral">Danger zone</h3>

        <button
          className={`${buttonCls} bg-navy hover:bg-navy`}
          disabled={action.busy}
          onClick={() => {
            if (confirm === 'leave') void leave()
            else setConfirm('leave')
          }}
        >
          {action.busy ? action.busyLabel : confirm === 'leave' ? 'Click again to leave' : 'Leave team'}
        </button>
        <p className="mt-1 text-xs text-heroslate">
          Stops syncing. Team data stays on this machine — rejoin from the setup any time.
        </p>

        <button
          className={`${buttonCls} bg-bcoral hover:bg-bcoral`}
          disabled={action.busy}
          onClick={() => {
            if (confirm === 'reset') void reset()
            else setConfirm('reset')
          }}
        >
          {action.busy ? action.busyLabel : confirm === 'reset' ? 'Click again to wipe everything' : 'Reset workspace'}
        </button>
        <p className="mt-1 text-xs text-heroslate">
          Deletes all teams, identities and synced data on this machine, then stops the daemon. Restart it to start
          fresh.
        </p>
      </div>
      {action.error && <p className="mt-4 text-sm text-bcoral">{action.error}</p>}
    </div>
  )
}
