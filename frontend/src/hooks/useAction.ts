import { useState } from 'react'

export function useAction() {
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('Working…')
  const [error, setError] = useState<string | null>(null)

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    setBusyLabel(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setBusy(false)
    setError(null)
  }

  return { busy, busyLabel, error, run, reset, setError }
}
