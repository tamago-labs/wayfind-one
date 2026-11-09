import { useState } from 'react'
import { api } from '../../lib/api'
import type { Status } from '../../lib/api'
import { useAction } from '../../hooks/useAction'
import { inputCls, buttonCls } from '../forms'

type Mode = 'create' | 'join' | 'resume' | null

export default function TeamSetup({ status, onDone }: { status: Status | null; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const { busy, busyLabel, error, run } = useAction()

  async function done(label: string, fn: () => Promise<unknown>) {
    if (await run(label, fn)) onDone()
  }

  const teams = status?.teams ?? []

  return (
    <>
      {mode === null && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            className="rounded-2xl border border-navy/15 p-4 text-left hover:border-cta"
            onClick={() => setMode('create')}
          >
            <span className="text-2xl">＋</span>
            <p className="mt-1 font-bold">Create</p>
            <p className="text-xs text-heroslate">Start a new team here</p>
          </button>
          <button
            className="rounded-2xl border border-navy/15 p-4 text-left hover:border-cta"
            onClick={() => setMode('join')}
          >
            <span className="text-2xl">✉</span>
            <p className="mt-1 font-bold">Join</p>
            <p className="text-xs text-heroslate">Redeem an invite code</p>
          </button>
          {teams.length > 0 && (
            <button
              className="col-span-2 rounded-2xl border border-navy/15 p-4 text-left hover:border-cta"
              onClick={() => setMode('resume')}
            >
              <p className="font-bold">Resume a team on this machine →</p>
              <p className="text-xs text-heroslate">
                {teams.length} team{teams.length === 1 ? '' : 's'}: {teams.map((t) => t.name).join(', ')}
              </p>
            </button>
          )}
        </div>
      )}

      {mode !== null && (
        <button
          className="mt-5 text-sm font-bold text-heroslate hover:text-navy"
          onClick={() => setMode(null)}
        >
          ← Back
        </button>
      )}

      {mode === 'create' && (
        <div className="mt-2">
          <h3 className="font-brico text-base font-bold">Create a team</h3>
          <input
            className={inputCls}
            placeholder="Team name (e.g. Acme Finance)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          <button
            className={buttonCls}
            disabled={busy || !name.trim()}
            onClick={() => void done('Creating team…', () => api('/api/teams', { name: name.trim() }))}
          >
            {busy ? busyLabel : 'Create team'}
          </button>
        </div>
      )}

      {mode === 'join' && (
        <div className="mt-2">
          <h3 className="font-brico text-base font-bold">Join with an invite code</h3>
          <input
            className={inputCls}
            placeholder="Paste invite code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
          />
          <button
            className={buttonCls}
            disabled={busy || !code.trim()}
            onClick={() =>
              void done('Finding inviter… (can take ~20 s first time)', () =>
                api('/api/join', { code: code.trim() })
              )
            }
          >
            {busy ? busyLabel : 'Join team'}
          </button>
        </div>
      )}

      {mode === 'resume' && (
        <div className="mt-2">
          <h3 className="font-brico text-base font-bold">Teams on this machine</h3>
          {teams.map((t) => (
            <div key={t.id} className="flex items-center justify-between border-b border-navy/10 py-2 text-sm">
              <span>{t.name}</span>
              <button
                className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => void done('Starting…', () => api('/api/teams/activate', { id: t.id }))}
              >
                Start
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-4 text-sm text-bcoral">{error}</p>}
    </>
  )
}
