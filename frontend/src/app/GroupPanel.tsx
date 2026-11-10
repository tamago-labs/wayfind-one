import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Lock, Users, X } from 'lucide-react'
import Composer from './Composer'
import Mascot, { type MascotColor, type MascotShape } from './Mascot'
import type { ChatFrom, GroupMsg, SharedBotAd, Status } from '../lib/api'
import type { TeamChat } from '../hooks/useTeamChat'

interface Props {
  open: boolean
  onClose: () => void
  status: Status | null
  selfName: string
  chat: TeamChat
}

function timeOf(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function senderLabel(from: ChatFrom, status: Status | null): string {
  if (from.kind === 'human') {
    if (from.id === status?.nodeId) return `${from.name} (you)`
    return from.name
  }
  const ad = status?.sharedBots?.find((a) => a.botId === from.id)
  if (ad && ad.ownerNodeId !== status?.nodeId) {
    const owner = status?.members.find((m) => m.nodeId === ad.ownerNodeId)
    return `${from.name} · via ${owner?.displayName ?? 'teammate'}`;
  }
  return from.name
}

function GroupBubbles({ msgs, status, bottomRef }: { msgs: GroupMsg[]; status: Status | null; bottomRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {msgs.length === 0 && (
        <p className="mt-8 text-center text-sm text-heroslate">
          No messages yet — say hello to the team.
        </p>
      )}
      {msgs.map((m) => {
        const mine = m.from.kind === 'human' && m.from.id === status?.nodeId
        return (
          <div key={m.id} className={`max-w-[85%] ${mine ? 'ml-auto' : ''}`}>
            <p className={`mb-1 text-xs font-semibold text-heroslate ${mine ? 'text-right' : ''}`}>
              {senderLabel(m.from, status)} <span className="font-normal opacity-70">{timeOf(m.ts)}</span>
            </p>
            <div
              className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                mine
                  ? 'rounded-br-md bg-navy text-white'
                  : 'rounded-bl-md bg-white text-navy'
              }`}
            >
              <span className="whitespace-pre-wrap">{m.text}</span>
            </div>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}

export default function GroupPanel({ open, onClose, status, chat }: Props) {
  const [tab, setTab] = useState<'team' | 'dms'>('team')
  const [draft, setDraft] = useState('')
  const [dmPeer, setDmPeer] = useState<ChatFrom | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const members = useMemo(() => status?.members ?? [], [status?.members])
  const ads = useMemo(() => status?.sharedBots ?? [], [status?.sharedBots])
  const online = useMemo(() => new Set(status?.online ?? []), [status?.online])

  // Keep the thread pinned to the bottom on new messages / tab switches.
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [open, chat.group.length, tab, dmPeer, chat.threads])

  // Reading the team tab marks it seen; opening a DM marks that thread read.
  useEffect(() => {
    if (open && tab === 'team') chat.markGroupSeen()
  }, [open, tab, chat.group.length, chat])

  const dmKey = dmPeer ? `${dmPeer.kind}:${dmPeer.id}` : null

  useEffect(() => {
    if (open && dmKey) void chat.markRead(dmKey)
  }, [open, dmKey, chat])

  const ownerName = (ad: SharedBotAd): string => {
    if (ad.ownerNodeId === status?.nodeId) return 'yours'
    return members.find((m) => m.nodeId === ad.ownerNodeId)?.displayName ?? 'teammate'
  }

  const sendTeam = async () => {
    const text = draft.trim()
    if (!text || chat.busy) return
    setSendError(null)
    const err = await chat.sendGroup(text)
    if (err) setSendError(err)
    else setDraft('')
  }

  const activeThread = dmKey ? chat.threads[dmKey] : undefined
  const activeMsgs = activeThread?.msgs ?? []

  const sendActiveDm = async () => {
    const text = draft.trim()
    if (!text || chat.busy || !dmPeer) return
    setSendError(null)
    const err = await chat.sendDm({ kind: dmPeer.kind, id: dmPeer.id }, text)
    if (err) setSendError(err)
    else setDraft('')
  }

  return (
    <div
      className={`shrink-0 overflow-hidden border-navy/10 bg-ice transition-all duration-200 ${
        open ? 'fixed inset-y-0 right-0 z-30 w-96 border-l md:static' : 'w-0'
      }`}
      aria-hidden={!open}
    >
      <div className="flex h-full w-96 max-w-[100vw] flex-col">
        <div className="flex items-center justify-between px-4 pt-4">
          <div className="flex items-center gap-2 text-navy">
            <Users className="h-4 w-4" strokeWidth={2.2} />
            <h2 className="font-brico text-base font-bold">Team chat</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close team chat"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        <div className="mx-4 mt-3 grid grid-cols-2 gap-1 rounded-full bg-white p-1 text-sm font-semibold shadow-sm">
          {(['team', 'dms'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t)
                setDraft('')
                setSendError(null)
                if (t === 'team') setDmPeer(null)
              }}
              className={`rounded-full py-1.5 ${tab === t ? 'bg-navy text-white' : 'text-heroslate hover:bg-ice'}`}
            >
              {t === 'team' ? 'Team' : `DMs${chat.dmUnread > 0 ? ` (${chat.dmUnread})` : ''}`}
            </button>
          ))}
        </div>

        {tab === 'team' ? (
          <>
            <div className="mx-4 mt-3 flex flex-wrap gap-1.5">
              {members.map((m) => (
                <span
                  key={m.nodeId}
                  title={m.nodeId === status?.nodeId ? 'you' : online.has(m.nodeId) ? 'online' : 'offline'}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-navy shadow-sm"
                >
                  <i className={`h-1.5 w-1.5 rounded-full ${online.has(m.nodeId) ? 'bg-[#1c9e6c]' : 'bg-navy/20'}`} />
                  {m.displayName}
                </span>
              ))}
              {ads.map((a) => (
                <span
                  key={a.botId}
                  title={`Shared bot · owner: ${ownerName(a)}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-navy shadow-sm ring-1 ring-cta/30"
                >
                  <Mascot color={a.color as MascotColor} shape={(a.shape as MascotShape) ?? 'blob'} size="xs" motion="none" />
                  {a.name}
                </span>
              ))}
              {members.length === 0 && ads.length === 0 && (
                <span className="text-xs text-heroslate">Nobody here yet.</span>
              )}
            </div>
            <GroupBubbles msgs={chat.group} status={status} bottomRef={bottomRef} />
            {chat.queued > 0 && (
              <p className="px-4 pb-1 text-xs text-bamber">
                {chat.queued} message{chat.queued === 1 ? '' : 's'} queued — will send when a teammate connects.
              </p>
            )}
            {sendError && (
              <p className="px-4 pb-1 text-xs font-medium text-bcoral" role="alert">
                {sendError}
              </p>
            )}
            <Composer botName="the team" draft={draft} onDraft={setDraft} onSend={() => void sendTeam()} busy={chat.busy} />
          </>
        ) : dmPeer ? (
          <>
            <button
              onClick={() => {
                setDmPeer(null)
                setDraft('')
                setSendError(null)
              }}
              className="mx-4 mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-navy shadow-sm hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} /> All DMs
            </button>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {activeMsgs.length === 0 && (
                <p className="mt-8 text-center text-sm text-heroslate">
                  No messages yet with {dmPeer.name}.
                </p>
              )}
              {activeMsgs.map((m) => (
                <div key={m.id} className={`max-w-[85%] ${m.out ? 'ml-auto' : ''}`}>
                  <p className={`mb-1 flex items-center gap-1 text-xs font-semibold text-heroslate ${m.out ? 'justify-end' : ''}`}>
                    {m.out ? 'you' : m.from.name}
                    {m.sealed && <Lock className="h-3 w-3" strokeWidth={2.2} aria-label="Sealed" />}
                    <span className="font-normal opacity-70">{timeOf(m.ts)}</span>
                  </p>
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
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
              <p className="px-4 pb-1 text-xs font-medium text-bcoral" role="alert">
                {sendError}
              </p>
            )}
            <Composer botName={dmPeer.name} draft={draft} onDraft={setDraft} onSend={() => void sendActiveDm()} busy={chat.busy} />
          </>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-heroslate">Teammates</p>
            <div className="space-y-1.5">
              {members
                .filter((m) => m.nodeId !== status?.nodeId)
                .map((m) => {
                  const key = `human:${m.nodeId}`
                  const t = chat.threads[key]
                  return (
                    <DmRow
                      key={key}
                      name={m.displayName}
                      sub={online.has(m.nodeId) ? 'online' : 'offline'}
                      preview={t?.msgs[t.msgs.length - 1]?.text}
                      unread={t?.unread ?? 0}
                      onOpen={() => {
                        setDmPeer({ kind: 'human', id: m.nodeId, name: m.displayName })
                        setDraft('')
                        setSendError(null)
                      }}
                    />
                  )
                })}
            </div>
            <p className="mb-2 mt-4 text-xs font-bold uppercase tracking-wider text-heroslate">Shared bots</p>
            <div className="space-y-1.5">
              {ads.map((a) => {
                const key = `bot:${a.botId}`
                const t = chat.threads[key]
                return (
                  <DmRow
                    key={key}
                    name={`${a.name} · ${ownerName(a)}`}
                    sub={online.has(a.ownerNodeId) ? 'online' : 'owner offline'}
                    preview={t?.msgs[t.msgs.length - 1]?.text}
                    unread={t?.unread ?? 0}
                    onOpen={() => {
                      setDmPeer({ kind: 'bot', id: a.botId, name: a.name })
                      setDraft('')
                      setSendError(null)
                    }}
                  />
                )
              })}
              {ads.length === 0 && <p className="text-xs text-heroslate">No shared bots yet — flip “Share to team” on a bot.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DmRow({ name, sub, preview, unread, onOpen }: { name: string; sub: string; preview?: string; unread: number; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl bg-white px-3.5 py-2.5 text-left shadow-sm hover:bg-slate-50"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-bold text-navy">
          <span className="truncate">{name}</span>
          {unread > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-cta px-1.5 text-[11px] font-bold text-white">
              {unread}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-heroslate">
          {preview ?? sub}
        </span>
      </span>
    </button>
  )
}
