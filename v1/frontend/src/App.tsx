import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import Sidebar from './app/Sidebar'
import ChatMain from './app/ChatMain'
import ConnectModal from './app/ConnectModal'
import SettingsModal from './app/SettingsModal'
import NewBotModal from './app/NewBotModal'
import BotPanel, { type BotEdits } from './app/BotPanel'
import DmPanel from './app/DmPanel'
import { useStatus, displayNameOf } from './hooks/useStatus'
import { useDMs } from './hooks/useDMs'
import { api, type Bot } from './lib/api'

export default function App() {
  const status = useStatus()
  const [connectOpen, setConnectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const [bots, setBots] = useState<Bot[]>([])
  const [cur, setCur] = useState(0)
  const [query, setQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [botModalOpen, setBotModalOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [dmOpen, setDmOpen] = useState(false)

  const hasTeam = status !== null && status.team !== null
  const dms = useDMs(hasTeam)
  const unread = dms.dmUnread

  // Auto-open the connect modal when there is no team yet (first run).
  if (hasTeam && dismissed) setDismissed(false)
  const autoConnect = status !== null && !hasTeam && !dismissed && !settingsOpen

  const refreshBots = useCallback(async () => {
    try {
      const data = await api<{ bots: Bot[] }>('/api/bots')
      setBots(data.bots)
    } catch {
      setBots([])
    }
  }, [])

  useEffect(() => {
    if (status?.team) void refreshBots()
    else setBots([])
  }, [status?.team?.id, status?.joined, refreshBots])

  useEffect(() => {
    setCur((c) => Math.min(c, Math.max(0, bots.length - 1)))
  }, [bots.length])

  const onProfile = () => {
    if (hasTeam) setSettingsOpen(true)
    else setConnectOpen(true)
  }
  const closeConnect = () => {
    setConnectOpen(false)
    setDismissed(true)
  }

  const sendChat = async (text: string): Promise<boolean> => {
    const bot = bots[cur]
    if (!bot) return false
    try {
      const data = await api<{ bot: Bot }>(`/api/bots/${bot.id}/chat`, { text })
      setBots((prev) => prev.map((b, i) => (i === cur ? data.bot : b)))
      return true
    } catch {
      return false
    }
  }

  const createBot = async (name: string, isChief: boolean): Promise<string | null> => {
    try {
      const data = await api<{ bot: Bot }>('/api/bots', { name, isChiefOfStaff: isChief })
      setBots((prev) => [data.bot, ...prev])
      setCur(0)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Create failed.'
    }
  }

  // Stable identity across the 3s status polls — a fresh array each render
  // would make memo'd/closed-over consumers think the roster changed.
  const taken = useMemo(() => bots.map((b) => b.name), [bots])

  const saveBot = async (edits: BotEdits): Promise<string | null> => {
    const bot = bots[cur]
    if (!bot) return 'No bot selected.'
    try {
      const data = await api<{ bot: Bot }>(`/api/bots/${bot.id}`, edits, 'PATCH')
      setBots((prev) => prev.map((b, i) => (i === cur ? data.bot : b)))
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Save failed.'
    }
  }

  const deleteBot = async (): Promise<string | null> => {
    const bot = bots[cur]
    if (!bot) return 'No bot selected.'
    try {
      await api(`/api/bots/${bot.id}`, undefined, 'DELETE')
      setBots((prev) => prev.filter((_, i) => i !== cur))
      setCur((c) => Math.max(0, c - 1))
      setPanelOpen(false)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Delete failed.'
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-ice font-brico text-navy">
      <Sidebar
        status={status}
        selfName={displayNameOf(status)}
        dimmed={!hasTeam}
        onProfile={onProfile}
        bots={bots}
        cur={cur}
        onSelect={(i) => {
          setCur(i)
          setPanelOpen(false)
        }}
        query={query}
        onQuery={setQuery}
        showSearch={showSearch}
        onToggleSearch={() => setShowSearch((s) => !s)}
        onNew={() => setBotModalOpen(true)}
      />
      <ChatMain status={status} bot={bots[cur] ?? null} panelOpen={panelOpen} onOpenPanel={() => setPanelOpen((o) => !o)} onOpenSettings={() => setSettingsOpen(true)} onSend={sendChat} />
      {bots[cur] && (
        <BotPanel
          bot={bots[cur]}
          computer={status?.computer ?? null}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          onSave={saveBot}
          onDelete={deleteBot}
        />
      )}
      {hasTeam && (
        <DmPanel
          open={dmOpen}
          onClose={() => setDmOpen(false)}
          status={status}
          dms={dms}
        />
      )}
      {hasTeam && !dmOpen && (
        <button
          onClick={() => setDmOpen(true)}
          aria-label="Open messages"
          title="Messages"
          className="fixed bottom-6 right-6 z-40 grid h-14 w-14 place-items-center rounded-full bg-cta text-white shadow-lg hover:bg-ctahover"
        >
          <MessagesSquare className="h-6 w-6" strokeWidth={2} />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-bcoral px-1.5 text-xs font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}
      <NewBotModal
        open={botModalOpen}
        onClose={() => setBotModalOpen(false)}
        taken={taken}
        onCreate={createBot}
      />
      <ConnectModal open={connectOpen || autoConnect} onClose={closeConnect} status={status} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} status={status} />
    </div>
  )
}
