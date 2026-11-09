import { useState } from 'react'
import { api } from '../../lib/api'
import type { Status } from '../../lib/api'
import { useAction } from '../../hooks/useAction'
import { inputCls, buttonCls } from '../forms'

export default function TeamSetup({ status }: { status: Status | null }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const { busy, busyLabel, error, run } = useAction()

  return (
    <>
      <div className="mt-5">
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
          onClick={() => void run('Creating team…', () => api('/api/teams', { name: name.trim() }))}
        >
          {busy ? busyLabel : 'Create team'}
        </button>
      </div>
      <div className="mt-5 border-t border-navy/10 pt-4">
        <h3 className="font-brico text-base font-bold">Or join with an invite code</h3>
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
            void run('Finding inviter… (can take ~20 s first time)', () =>
              api('/api/join', { code: code.trim() })
            )
          }
        >
          {busy ? busyLabel : 'Join team'}
        </button>
      </div>
      {(status?.teams.length ?? 0) > 0 && (
        <div className="mt-5 border-t border-navy/10 pt-4">
          <h3 className="font-brico text-base font-bold">Teams on this machine</h3>
          {(status?.teams ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between border-b border-navy/10 py-2 text-sm">
              <span>{t.name}</span>
              <button
                className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => void run('Starting…', () => api('/api/teams/activate', { id: t.id }))}
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
