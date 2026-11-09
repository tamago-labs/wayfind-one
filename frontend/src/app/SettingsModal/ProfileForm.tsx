import { useState } from 'react'
import { api } from '../../lib/api'
import { useAction } from '../../hooks/useAction'
import { inputCls, buttonCls } from '../forms'

export default function ProfileForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName)
  const { busy, busyLabel, error, run } = useAction()

  return (
    <div className="mt-4">
      <h3 className="font-brico text-base font-bold">Display name</h3>
      <input
        className={inputCls}
        placeholder="e.g. Ada"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
      />
      <button
        className={buttonCls}
        disabled={busy || !name.trim()}
        onClick={() => void run('Saving…', () => api('/api/profile', { name: name.trim() }))}
      >
        {busy ? busyLabel : 'Save name'}
      </button>
      {error && <p className="mt-4 text-sm text-bcoral">{error}</p>}
    </div>
  )
}
