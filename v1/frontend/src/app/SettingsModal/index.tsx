import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { Status } from '../../lib/api'
import { displayNameOf } from '../../hooks/useStatus'
import ProfileForm from './ProfileForm'
import TeamPanel from './TeamPanel'
import ProvidersPanel from './ProvidersPanel'
import AboutPanel from './AboutPanel'
import AdvancedPanel from './AdvancedPanel'

interface Props {
  open: boolean
  onClose: () => void
  status: Status | null
}

type Tab = 'profile' | 'team' | 'ai' | 'about' | 'advanced'

const tabs: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'team', label: 'Team' },
  { id: 'ai', label: 'AI' },
  { id: 'about', label: 'About' },
  { id: 'advanced', label: 'Advanced' },
]

// Connected-state modal only: settings with a side tab rail. No mascot,
// no welcome content — opened from the profile card once a team exists.
export default function SettingsModal({ open, onClose, status }: Props) {
  const [openCount, setOpenCount] = useState(0)
  const [wasOpen, setWasOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('profile')
  if (open && !wasOpen) {
    setWasOpen(true)
    setOpenCount((c) => c + 1)
    setTab('profile')
  }
  if (!open && wasOpen) setWasOpen(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="flex max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl"
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 4 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex w-36 shrink-0 flex-col gap-1 border-r border-navy/10 bg-ice p-3">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`rounded-lg px-3 py-2 text-left text-sm font-bold ${
                    tab === t.id ? 'bg-white text-navy shadow-sm' : 'text-heroslate hover:bg-white/60'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <h2 className="font-brico text-xl font-extrabold">
                {tabs.find((t) => t.id === tab)?.label}
              </h2>
              <div className="mt-3 border-t border-navy/10" />
              <div key={openCount}>
                {tab === 'profile' && (
                  <ProfileForm initialName={displayNameOf(status).replace(/^node-/, '')} />
                )}
                    {tab === 'team' && status && <TeamPanel status={status} />}
                    {tab === 'ai' && <ProvidersPanel />}
                    {tab === 'about' && status && <AboutPanel status={status} />}
                    {tab === 'advanced' && <AdvancedPanel onTeamGone={onClose} />}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
