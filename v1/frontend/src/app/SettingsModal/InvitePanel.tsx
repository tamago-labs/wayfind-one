import { useState } from 'react'
import { api } from '../../lib/api'
import { useAction } from '../../hooks/useAction'
import { buttonCls } from '../forms'

export default function InvitePanel() {
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const { busy, busyLabel, error, run } = useAction()

  return (
    <div className="mt-4">
      <h3 className="font-brico text-base font-bold">Invite a teammate</h3>
      {!inviteCode ? (
        <button
          className={buttonCls}
          disabled={busy}
          onClick={() =>
            void run('Creating invite…', () =>
              api<{ code: string }>('/api/invite', {}).then((d) => setInviteCode(d.code))
            )
          }
        >
          {busy ? busyLabel : 'Create invite code'}
        </button>
      ) : (
        <div>
          <p className="mt-2 text-xs text-heroslate">One-time use. Share it privately — you must stay online.</p>
          <code className="mt-2 block break-all rounded-lg border border-navy/15 bg-ice p-3 font-mono text-xs">
            {inviteCode}
          </code>
          <button
            className={`${buttonCls} bg-navy hover:bg-navy`}
            disabled={busy}
            onClick={() => setInviteCode(null)}
          >
            New code
          </button>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-bcoral">{error}</p>}
    </div>
  )
}
