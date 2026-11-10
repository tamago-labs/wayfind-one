import { Send } from 'lucide-react'

interface Props {
  botName: string
  draft: string
  onDraft: (v: string) => void
  onSend: () => void
  busy: boolean
}

export default function Composer({ botName, draft, onDraft, onSend, busy }: Props) {
  return (
    <div className="px-4 pb-5 pt-1">
      <div className="mx-auto max-w-2xl">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSend()
          }}
          className="flex items-center gap-2 rounded-full bg-white py-2 pl-5 pr-2 shadow-md shadow-navy/5"
        >
          <input
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            disabled={busy}
            autoComplete="off"
            placeholder={busy ? 'Working…' : `Message ${botName}…`}
            className="min-w-0 flex-1 bg-transparent text-sm text-navy outline-none placeholder:text-slate-400 disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy || !draft.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cta text-white hover:bg-ctahover disabled:opacity-40"
          >
            <Send className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </form>
      </div>
    </div>
  )
}
