import { Send } from 'lucide-react'

/** Composer shell. Disabled until local inference is wired —
 *  layout mirrors wayfind-cloud so the swap-in is a prop flip. */
export default function Composer({ botName }: { botName: string }) {
  return (
    <div className="px-4 pb-5 pt-1">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-full bg-bamber/25 px-4 py-1.5 text-center text-xs font-bold text-navy">
          Chat is UI-only for now — agent replies arrive with local inference.
        </div>
        <div className="mt-2 flex items-center gap-2 rounded-full bg-white py-2 pl-5 pr-2 shadow-md shadow-navy/5">
          <input
            disabled
            value=""
            placeholder={`Message ${botName}…`}
            className="min-w-0 flex-1 bg-transparent text-sm text-navy outline-none placeholder:text-slate-400 disabled:opacity-60"
          />
          <button
            disabled
            aria-label="Send"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cta text-white disabled:opacity-40"
          >
            <Send className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  )
}
