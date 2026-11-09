import { useState } from 'react'
import { PanelRight } from 'lucide-react'
import Mascot, { type MascotColor, type MascotShape } from './Mascot'
import Thread from './Thread'
import Composer from './Composer'
import type { Bot, Status } from '../lib/api'

interface Props {
  status: Status | null
  bot: Bot | null
  panelOpen: boolean
  onOpenPanel: () => void
  onOpenSettings: () => void
  onSend: (text: string) => Promise<boolean>
}

export default function ChatMain({ status, bot, panelOpen, onOpenPanel, onOpenSettings, onSend }: Props) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  // New bot selected: fresh composer.
  const [draftFor, setDraftFor] = useState(bot?.id)
  if (bot?.id !== draftFor) {
    setDraftFor(bot?.id)
    setDraft('')
    setPendingText(null)
    setSendError(null)
  }

  const send = async () => {
    const v = draft.trim()
    if (!v || pending || !bot) return
    setPending(true)
    setPendingText(v)
    setSendError(null)
    setDraft('')
    const ok = await onSend(v)
    setPending(false)
    setPendingText(null)
    if (!ok) setSendError('That run failed — try again.')
  }
  if (!status) {
    return (
      <main className="grid min-w-0 flex-1 place-items-center bg-thread p-6">
        <div className="max-w-md rounded-2xl border border-navy/10 bg-white p-8 text-center shadow-sm">
          <h1 className="font-brico text-2xl font-extrabold">Daemon offline</h1>
          <p className="mt-2 text-sm text-heroslate">
            Start the daemon, then refresh. Click your profile card for connection options.
          </p>
          <code className="mt-4 block rounded-lg bg-ice px-3 py-2 font-mono text-xs">node bin/wayfind-one.js</code>
        </div>
      </main>
    )
  }

  if (!status.team) {
    return (
      <main className="grid min-w-0 flex-1 place-items-center bg-thread p-6">
        <div className="max-w-md rounded-2xl border border-navy/10 bg-white p-8 text-center shadow-sm">
          <h1 className="font-brico text-2xl font-extrabold">Welcome to Wayfind ONE</h1>
          <p className="mt-2 text-sm text-heroslate">
            Create or join a team to get started — the setup opens automatically.
          </p>
        </div>
      </main>
    )
  }

  if (!bot) {
    return (
      <main className="grid min-w-0 flex-1 place-items-center bg-thread p-6">
        <div className="text-center">
          <p className="text-xl font-bold">No bots yet</p>
          <p className="mt-1 text-sm text-heroslate">Name your first bot to get started.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-thread">
      <header className="relative flex items-center px-4 py-3.5">
        <span className="hidden w-40 md:block" />
        <button
          onClick={onOpenPanel}
          aria-label="Bot settings"
          className="mx-auto flex items-center gap-2.5 rounded-full bg-white py-2 pl-3 pr-5 font-bold text-navy shadow-md shadow-navy/5 hover:bg-slate-50"
        >
          <Mascot
            color={bot.color as MascotColor}
            shape={bot.shape as MascotShape}
            size="xs"
            motion="none"
          />
          <span>{bot.name}</span>
          <span className="hidden text-sm font-medium text-heroslate sm:inline">
            · {bot.role || 'No role yet'}
          </span>
        </button>
        <button
          onClick={onOpenPanel}
          aria-label="Bot settings"
          aria-expanded={panelOpen}
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
        >
          <PanelRight className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </header>

      <ComputerBanner state={status.computer?.state} error={status.computer?.error} />
      {status.provider && (!status.provider.model || !status.provider.hasKey) && (
        <div className="mx-4 mb-1 flex items-center justify-center">
          <button
            onClick={onOpenSettings}
            className="rounded-full bg-bamber/25 px-4 py-1.5 text-xs font-bold text-navy hover:bg-bamber/40"
          >
            No AI provider configured — open Settings → AI to set one up.
          </button>
        </div>
      )}
      <Thread bot={bot} typing={pending} pendingUser={pendingText} />
      <Composer botName={bot.name} draft={draft} onDraft={setDraft} onSend={() => void send()} busy={pending} />
      {sendError && (
        <p className="mx-auto w-full max-w-2xl px-6 pb-4 text-center text-sm font-medium text-bcoral">{sendError}</p>
      )}
    </main>
  )
}

function ComputerBanner({ state, error }: { state?: string; error?: string }) {
  // Healthy computer = clean thread (cloud parity). Banner only when
  // attention is needed: starting, or failed with the reason.
  if (!state || state === 'off' || state === 'running') return null
  const bad = state === 'unavailable'
  return (
    <div
      className={`mx-4 mb-1 flex items-center justify-center gap-2 rounded-full px-4 py-1.5 text-center text-xs font-bold text-navy ${
        bad ? 'bg-bcoral/25' : 'bg-bamber/25'
      }`}
      title={error ?? ''}
    >
      {state === 'starting'
        ? 'Starting local computer…'
        : `Local computer unavailable${error ? ` — ${error}` : ''}`}
    </div>
  )
}
