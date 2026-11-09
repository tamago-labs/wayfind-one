import { useState } from 'react'
import Sidebar from './app/Sidebar'
import ChatMain from './app/ChatMain'
import ConnectModal from './app/ConnectModal'
import SettingsModal from './app/SettingsModal'
import { useStatus, displayNameOf } from './hooks/useStatus'

export default function App() {
  const status = useStatus()
  const [connectOpen, setConnectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const hasTeam = status !== null && status.team !== null

  // Auto-open the connect modal when there is no team yet (first run).
  if (hasTeam && dismissed) setDismissed(false)
  const autoConnect = status !== null && !hasTeam && !dismissed && !settingsOpen

  const onProfile = () => {
    if (hasTeam) setSettingsOpen(true)
    else setConnectOpen(true)
  }
  const closeConnect = () => {
    setConnectOpen(false)
    setDismissed(true)
  }

  return (
    <div className="flex h-screen bg-ice font-brico text-navy">
      <Sidebar
        status={status}
        selfName={displayNameOf(status)}
        dimmed={!hasTeam}
        onProfile={onProfile}
      />
      <ChatMain status={status} />
      <ConnectModal open={connectOpen || autoConnect} onClose={closeConnect} status={status} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} status={status} />
    </div>
  )
}
