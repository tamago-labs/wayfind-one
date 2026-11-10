import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useAction } from '../../hooks/useAction'
import { inputCls } from '../forms'

export default function ProfileForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName)
  const [saved, setSaved] = useState(false)
  const { busy, busyLabel, error, run } = useAction()

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(t)
  }, [saved])

  return (
    <div className="mt-4">
      <h3 className="font-brico text-base font-bold">Display name</h3>
      <input
        className={inputCls}
        placeholder="e.g. Ada"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setSaved(false)
        }}
        disabled={busy}
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          className="rounded-xl bg-cta px-5 py-2.5 font-bold text-white hover:bg-ctahover disabled:opacity-50"
          disabled={busy || !name.trim()}
          onClick={() =>
            void run('Saving…', () => api('/api/profile', { name: name.trim() })).then((ok) => {
              if (ok) setSaved(true)
            })
          }
        >
          {busy ? busyLabel : 'Save name'}
        </button>
        {saved && !busy && <span className="text-sm font-bold text-bmoss">Saved ✓</span>}
      </div>
      {error && <p className="mt-4 text-sm text-bcoral">{error}</p>}
    </div>
  )
}
