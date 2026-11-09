import { useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import Mascot, { type MascotColor, type MascotShape } from '../Mascot'
import BotEditModal from './BotEditModal'
import DeleteBotModal from './DeleteBotModal'
import type { Bot } from '../../lib/api'

export interface BotEdits {
  name: string
  role: string
  isChiefOfStaff: boolean
  color: MascotColor
  shape: MascotShape
}

export interface ComputerInfo {
  state: string
  container?: string
  image?: string
  workspace?: string
  error?: string
}

interface Props {
  bot: Bot
  computer?: ComputerInfo | null
  open: boolean
  onClose: () => void
  onSave: (edits: BotEdits) => Promise<string | null>
  onDelete: () => Promise<string | null>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-white px-4 py-2.5 shadow-sm">
      <span className="shrink-0 text-sm font-semibold text-heroslate">{label}</span>
      {children}
    </div>
  )
}

function statusColor(state?: string): string {
  if (state === 'running') return 'text-[#12706f]'
  if (state === 'starting') return 'text-bamber'
  if (state === 'unavailable') return 'text-bcoral'
  return 'text-heroslate'
}

function short(v?: string | null): string {
  return v ? `${v.slice(0, 8)}…` : '—'
}

export default function BotPanel({ bot, computer, open, onClose, onSave, onDelete }: Props) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const v: BotEdits = {
    name: bot.name,
    role: bot.role,
    isChiefOfStaff: bot.isChiefOfStaff ?? false,
    color: bot.color as MascotColor,
    shape: bot.shape as MascotShape,
  }

  return (
    <div
      className={`shrink-0 overflow-hidden border-navy/10 bg-ice transition-all duration-200 ${
        open ? 'fixed inset-y-0 right-0 z-30 w-80 border-l md:static' : 'w-0'
      }`}
      aria-hidden={!open}
    >
      <div className="flex h-full w-80 flex-col p-5">
        <div className="flex items-center justify-between">
          <button
            onClick={onClose}
            aria-label="Close bot panel"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete bot"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-bcoral shadow-sm hover:bg-slate-50"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        <button
          onClick={() => setEditOpen(true)}
          aria-label="Edit bot"
          title="Edit name, role, color and shape"
          className="mx-auto mt-5 rounded-full transition hover:opacity-80"
        >
          <Mascot color={v.color} shape={v.shape} size="lg" motion="none" />
        </button>

        <p className="mt-5 truncate text-center text-lg font-bold text-navy">
          {v.name} <span className="text-sm font-medium text-heroslate">· {v.role || 'No role yet'}</span>
        </p>

        <div className="mt-5 space-y-2 text-sm">
          <Row label="Bot ID">
            <span className="max-w-[10rem] truncate font-mono text-xs text-navy" title={bot.id}>
              {bot.id.slice(0, 8)}…
            </span>
          </Row>
          <Row label="Messages">
            <span className="font-bold text-navy">{bot.msgs.length}</span>
          </Row>
          <Row label="Stored">
            <span className="font-bold text-navy">This machine only</span>
          </Row>
        </div>

        <p className="mt-5 px-1 text-xs font-bold uppercase tracking-wider text-heroslate">Computer</p>
        <div className="mt-2 space-y-2 text-sm" title={computer?.error ?? ''}>
          <Row label="Status">
            <span className={`font-bold ${statusColor(computer?.state)}`}>
              {computer?.state ?? 'off'}
            </span>
          </Row>
          <Row label="Container">
            <span className="max-w-[10rem] truncate font-mono text-xs text-navy" title={computer?.container ?? ''}>
              {short(computer?.container)}
            </span>
          </Row>
          <Row label="Image">
            <span className="max-w-[10rem] truncate font-mono text-xs text-navy" title={computer?.image ?? ''}>
              {computer?.image ?? '—'}
            </span>
          </Row>
        </div>

        <button
          onClick={() => setEditOpen(true)}
          className="mt-4 rounded-full bg-navy px-5 py-2 text-sm font-bold text-white hover:bg-[#1c3350]"
        >
          Edit bot
        </button>
      </div>

      <DeleteBotModal
        open={deleteOpen}
        botName={bot.name}
        onClose={() => setDeleteOpen(false)}
        onDelete={async () => {
          const err = await onDelete()
          if (!err) {
            setDeleteOpen(false)
            onClose()
          }
          return err
        }}
      />
      <BotEditModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={v}
        onSave={async (edits) => {
          const err = await onSave(edits)
          if (!err) setEditOpen(false)
          return err
        }}
      />
    </div>
  )
}
