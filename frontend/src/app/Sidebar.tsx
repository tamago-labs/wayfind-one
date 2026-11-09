import Mascot from './Mascot'
import type { Status } from '../lib/api'

interface Props {
  status: Status | null
  selfName: string
  dimmed: boolean
  onProfile: () => void
}

export default function Sidebar({ status, selfName, dimmed, onProfile }: Props) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-navy/10 bg-ice">
      <div className="flex items-center px-4 pb-3 pt-4">
        <span className="flex shrink-0 items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy">
            <Mascot color="white" size="xs" motion="none" label="Wayfind mascot" />
          </span>
          <span className="font-brico text-lg font-bold text-navy">Wayfind ONE</span>
        </span>
      </div>

      <div className={`flex-1 overflow-y-auto px-3 ${dimmed ? 'pointer-events-none opacity-40' : ''}`}>
        <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-heroslate">Bots</p>
        <nav className="space-y-1">
          <p className="px-2 py-4 text-sm text-heroslate">
            {status ? 'No bots yet — create one to start chatting.' : 'Daemon offline.'}
          </p>
        </nav>
      </div>

      <div className="border-t border-navy/10 p-3">
        <button
          onClick={onProfile}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cta font-brico text-sm font-bold text-white">
            {selfName.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{selfName}</span>
            <span className="block text-xs text-heroslate">
              {status ? (status.joined ? 'Online' : 'Starting…') : 'Offline — click to connect'}
            </span>
          </span>
        </button>
      </div>
    </aside>
  )
}
