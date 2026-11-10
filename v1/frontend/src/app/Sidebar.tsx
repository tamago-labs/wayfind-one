import { Search, Plus, Star } from 'lucide-react'
import Mascot, { type MascotColor, type MascotShape } from './Mascot'
import type { Bot, Status } from '../lib/api'

interface Props {
  status: Status | null
  selfName: string
  dimmed: boolean
  onProfile: () => void
  bots: Bot[]
  cur: number
  onSelect: (index: number) => void
  query: string
  onQuery: (q: string) => void
  showSearch: boolean
  onToggleSearch: () => void
  onNew: () => void
}

export default function Sidebar({
  status, selfName, dimmed, onProfile,
  bots, cur, onSelect, query, onQuery, showSearch, onToggleSearch, onNew,
}: Props) {
  const q = query.toLowerCase()
  const items = bots
    .map((bot, index) => ({ bot, index }))
    .filter(({ bot }) => !q || `${bot.name}${bot.role}`.toLowerCase().includes(q))

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-navy/10 bg-ice">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <span className="flex shrink-0 items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy">
            <Mascot color="white" size="xs" motion="none" label="Wayfind mascot" />
          </span>
          <span className="font-brico text-lg font-bold text-navy">Wayfind ONE</span>
        </span>
        <div className="flex gap-2">
          <button
            onClick={onToggleSearch}
            aria-label="Search bots"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
          >
            <Search className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            onClick={onNew}
            aria-label="New bot"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {showSearch && (
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search bots"
          className="mx-4 mb-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-navy outline-none placeholder:text-slate-400"
        />
      )}

      <div className={`flex-1 overflow-y-auto px-3 ${dimmed ? 'pointer-events-none opacity-40' : ''}`}>
        <nav className="space-y-1" aria-label="Your bots">
          {items.map(({ bot, index }) => (
            <button
              key={bot.id}
              onClick={() => onSelect(index)}
              className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${
                index === cur ? 'bg-white shadow-sm' : 'hover:bg-white/60'
              }`}
            >
              <Mascot
                color={bot.color as MascotColor}
                shape={bot.shape as MascotShape}
                size="md"
                motion="none"
                className="shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-bold text-navy">
                  <span className="truncate">{bot.name}</span>
                  {bot.isChiefOfStaff && (
                    <span title="Chief of staff" className="grid shrink-0 place-items-center">
                      <Star className="h-4 w-4 fill-bamber text-bamber" strokeWidth={2} />
                    </span>
                  )}
                </span>
                <span className="block truncate text-sm text-heroslate">
                  {bot.role || 'No role yet'}
                </span>
              </span>
            </button>
          ))}
          {items.length === 0 && (
            <p className="px-2 py-4 text-sm text-heroslate">
              {status
                ? q
                  ? `No bots match “${query}”.`
                  : 'No bots yet — press + to create one.'
                : 'Daemon offline.'}
            </p>
          )}
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
