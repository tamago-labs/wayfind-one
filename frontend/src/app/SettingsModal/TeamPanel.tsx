import { api } from '../../lib/api'
import type { Status } from '../../lib/api'
import { useAction } from '../../hooks/useAction'
import InvitePanel from './InvitePanel'

export default function TeamPanel({ status }: { status: Status }) {
  const { busy, busyLabel, run, error } = useAction()
  const otherTeams = (status.teams ?? []).filter((t) => t.id !== status.team?.id)

  return (
    <>
      <InvitePanel />
      {otherTeams.length > 0 && (
        <div className="mt-5 border-t border-navy/10 pt-4">
          <h3 className="font-brico text-base font-bold">Switch team</h3>
          {otherTeams.map((t) => (
            <div key={t.id} className="flex items-center justify-between border-b border-navy/10 py-2 text-sm">
              <span>{t.name}</span>
              <button
                className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => void run('Starting…', () => api('/api/teams/activate', { id: t.id }))}
              >
                {busy ? busyLabel : 'Switch'}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-5 border-t border-navy/10 pt-4">
        <h3 className="font-brico text-base font-bold">Members · {(status.members ?? []).length}</h3>
        {(status.members ?? []).map((m) => (
          <div key={m.nodeId} className="flex items-center gap-3 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy font-brico text-sm font-bold text-white">
              {(m.displayName || '?').slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {m.displayName}
                {m.nodeId === status.nodeId && <span className="ml-2 text-xs font-normal text-heroslate">you</span>}
              </p>
              <p className="truncate font-mono text-[11px] text-heroslate">{m.nodeId.slice(0, 12)}…</p>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-4 text-sm text-bcoral">{error}</p>}
    </>
  )
}
