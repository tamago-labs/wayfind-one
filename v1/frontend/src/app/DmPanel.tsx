import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Lock, MessageSquare, Search, X } from 'lucide-react'
import Composer from './Composer'
import Mascot, { type MascotColor, type MascotShape } from './Mascot'
import type { ChatFrom, SharedBotAd, Status } from '../lib/api'
import type { DMs } from '../hooks/useDMs'

interface Props {
  open: boolean
  onClose: () => void
  status: Status | null
  dms: DMs
}

function timeOf(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function ownerName(ad: SharedBotAd, status: Status | null): string {
  if (ad.ownerNodeId === status?.nodeId) return 'yours'
  return status?.members.find((m) => m.nodeId === ad.ownerNodeId)?.displayName ?? 'teammate'
}

export default function DmPanel({ open, onClose, status, dms }: Props) {
  const [query, setQuery] = useState('')
  const [dmPeer, setDmPeer] = useState<ChatFrom | null>(null)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const members = useMemo(() => status?.members ?? [], [status?.members])
  const ads = useMemo(() => status?.sharedBots ?? [], [status?.sharedBots])
  const online = useMemo(() => new Set(status?.online ?? []), [status?.online])
  const dmKey = dmPeer ? `${dmPeer.kind}:${dmPeer.id}` : null

  const activeThread = dmKey ? dms.threads[dmKey] : undefined
  const activeMsgs = activeThread?.msgs ?? []
  const activeCount = activeMsgs.length

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [open, dmPeer, activeCount])

  useEffect(() => {
    if (open && dmKey) void dms.markRead(dmKey)
  }, [open, dmKey, dms.markRead])

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const q = query.trim().toLowerCase()
  const shownMembers = members.filter(
    (m) => m.nodeId !== status?.nodeId && (q === '' || m.displayName.toLowerCase().includes(q)),
  )
  const shownAds = ads.filter(
    (a) => q === '' || a.name.toLowerCase().includes(q) || ownerName(a, status).toLowerCase().includes(q),
  )

  const sendActive = async () => {
    const text = draft.trim()
    if (!text || dms.busy || !dmPeer) return
    setSendError(null)
    const err = await dms.sendDm({ kind: dmPeer.kind, id: dmPeer.id }, text)
    if (err) setSendError(err)
    else setDraft('')
  }

  const pick = (peer: ChatFrom) => {
    setDmPeer(peer)
    setDraft('')
    setSendError(null)
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.16 }}
          role="dialog"
          aria-label="Direct messages"
          className="fixed bottom-24 right-6 z-40 flex h-[560px] max-h-[calc(100vh-9rem)] w-[420px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl bg-ice shadow-2xl ring-1 ring-navy/10"
          style={{ transformOrigin: 'bottom right' }}
        >
          {/* Left sidebar: who to chat with */}
          <div className="flex w-40 shrink-0 flex-col border-r border-navy/10 bg-white/60">
            <div className="p-2.5 pb-1.5">
              <div className="flex items-center gap-1.5 rounded-full bg-ice px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-heroslate" strokeWidth={2.2} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent text-xs text-navy outline-none placeholder:text-heroslate/60"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              <p className="px-1.5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-heroslate">
                Teammates
              </p>
              {shownMembers.map((m) => {
                const key = `human:${m.nodeId}`
                const t = dms.threads[key]
                const selected = dmKey === key
                return (
                  <button
                    key={key}
                    onClick={() => pick({ kind: 'human', id: m.nodeId, name: m.displayName })}
                    className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition ${
                      selected ? 'bg-navy text-white' : 'hover:bg-ice'
                    }`}
                  >
                    <i
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        online.has(m.nodeId) ? 'bg-[#1c9e6c]' : 'bg-navy/20'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs font-bold ${selected ? 'text-white' : 'text-navy'}`}>
                        {m.displayName}
                      </span>
                      <span className={`block truncate text-[11px] ${selected ? 'text-white/70' : 'text-heroslate'}`}>
                        {t?.msgs[t.msgs.length - 1]?.text ?? (online.has(m.nodeId) ? 'online' : 'offline')}
                      </span>
                    </span>
                    {(t?.unread ?? 0) > 0 && (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-cta px-1.5 text-[11px] font-bold text-white">
                        {t!.unread}
                      </span>
                    )}
                  </button>
                )
              })}
              <p className="px-1.5 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-heroslate">
                Shared bots
              </p>
              {shownAds.map((a) => {
                const key = `bot:${a.botId}`
                const t = dms.threads[key]
                const selected = dmKey === key
                return (
                  <button
                    key={key}
                    onClick={() => pick({ kind: 'bot', id: a.botId, name: a.name })}
                    className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition ${
                      selected ? 'bg-navy text-white' : 'hover:bg-ice'
                    }`}
                  >
                    <Mascot color={a.color as MascotColor} shape={(a.shape as MascotShape) ?? 'blob'} size="xs" motion="none" />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs font-bold ${selected ? 'text-white' : 'text-navy'}`}>
                        {a.name}
                      </span>
                      <span className={`block truncate text-[11px] ${selected ? 'text-white/70' : 'text-heroslate'}`}>
                        {t?.msgs[t.msgs.length - 1]?.text ?? ownerName(a, status)}
                      </span>
                    </span>
                    {(t?.unread ?? 0) > 0 && (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-cta px-1.5 text-[11px] font-bold text-white">
                        {t!.unread}
                      </span>
                    )}
                  </button>
                )
              })}
              {shownMembers.length === 0 && shownAds.length === 0 && (
                <p className="px-1.5 py-2 text-[11px] text-heroslate">
                  {q === '' ? 'Nobody here yet.' : 'No matches.'}
                </p>
              )}
            </div>
          </div>

          {/* Right: conversation */}
          <div className="flex min-w-0 flex-1 flex-col">
            {dmPeer ? (
              <>
                <div className="flex items-center gap-2 border-b border-navy/10 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-navy">
                    {dmPeer.name}
                    {dmPeer.kind === 'bot' && (
                      <span className="ml-1.5 text-[11px] font-medium text-heroslate">bot</span>
                    )}
                  </span>
                  <button
                    onClick={onClose}
                    aria-label="Close messages"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
                  >
                    <X className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
                  {activeMsgs.length === 0 && (
                    <p className="mt-8 text-center text-xs text-heroslate">
                      No messages yet with {dmPeer.name}.
                    </p>
                  )}
                  {activeMsgs.map((m) => (
                    <div key={m.id} className={`max-w-[90%] ${m.out ? 'ml-auto' : ''}`}>
                      <p className={`mb-1 flex items-center gap-1 text-[11px] font-semibold text-heroslate ${m.out ? 'justify-end' : ''}`}>
                        {m.out ? 'you' : m.from.name}
                        {m.sealed && <Lock className="h-3 w-3" strokeWidth={2.2} aria-label="Sealed" />}
                        <span className="font-normal opacity-70">{timeOf(m.ts)}</span>
                      </p>
                      <div
                        className={`rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                          m.out ? 'rounded-br-md bg-navy text-white' : 'rounded-bl-md bg-white text-navy'
                        }`}
                      >
                        <span className="whitespace-pre-wrap">{m.text}</span>
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
                {sendError && (
                  <p className="px-3 pb-1 text-xs font-medium text-bcoral" role="alert">
                    {sendError}
                  </p>
                )}
                <Composer botName={dmPeer.name} draft={draft} onDraft={setDraft} onSend={() => void sendActive()} busy={dms.busy} />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <MessageSquare className="h-8 w-8 text-heroslate/50" strokeWidth={1.8} />
                <p className="text-sm font-bold text-navy">Pick someone to message</p>
                <p className="text-xs text-heroslate">Teammates and shared bots are on the left.</p>
                <button
                  onClick={onClose}
                  aria-label="Close messages"
                  className="mt-2 grid h-8 w-8 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
                >
                  <X className="h-4 w-4" strokeWidth={2.2} />
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
