import { useCallback, useEffect, useState } from 'react'

interface Task {
  id: string
  text: string
  done: boolean
  createdBy: string
  createdAt: number
}

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [text, setText] = useState('')
  const [online, setOnline] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTasks(data.tasks ?? [])
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [refresh])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setText('')
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: t })
    })
    await refresh()
  }

  async function toggle(id: string) {
    await fetch(`/api/tasks/${id}/toggle`, { method: 'POST' })
    await refresh()
  }

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-wider text-cta">Team workspace</p>
      <h1 className="mt-2 font-brico text-4xl font-extrabold tracking-tight">Tasks</h1>

      {online === false && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm">
          Daemon offline — run <code className="font-mono">wayfind-one up</code> to sync.
        </p>
      )}

      <form onSubmit={(e) => void add(e)} className="mt-6 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="New task…"
          className="min-w-0 flex-1 rounded-lg border border-navy/15 bg-white px-3 py-2.5 text-[15px]"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="rounded-full bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          Add
        </button>
      </form>

      <ul className="mt-6 space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-xl border border-navy/10 bg-white px-4 py-3">
            <button
              onClick={() => void toggle(t.id)}
              aria-label={t.done ? 'Reopen' : 'Complete'}
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${t.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-navy/30'}`}
            >
              {t.done && <span className="text-xs leading-none">✓</span>}
            </button>
            <span className={`flex-1 ${t.done ? 'text-navy/40 line-through' : ''}`}>{t.text}</span>
            <span className="font-mono text-xs text-heroslate">{t.createdBy.slice(0, 8)}…</span>
          </li>
        ))}
      </ul>
      {online && tasks.length === 0 && (
        <p className="mt-6 text-heroslate">No tasks yet — add one above, watch it appear on the other node.</p>
      )}
    </div>
  )
}
