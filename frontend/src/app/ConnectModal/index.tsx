import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import type { Status } from '../../lib/api'
import Mascot from '../Mascot'
import TeamSetup from './TeamSetup'

interface Props {
  open: boolean
  onClose: () => void
  status: Status | null
}

// First-run modal only: welcome + create/join. Never shown once a team exists.
export default function ConnectModal({ open, onClose, status }: Props) {
  const [openCount, setOpenCount] = useState(0)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setOpenCount((c) => c + 1)
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

  const connected = status !== null

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
            className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:flex-row"
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 4 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-navy p-6 text-white sm:w-2/5">
              <Mascot color="white" size="sm" motion="none" label="Wayfind mascot" />
              <p className="mt-4 font-brico text-xl font-bold">Welcome</p>
              <p className="mt-1 text-sm text-white/70">
                One team. Your computers. One private AI workspace.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-white/70">
                <li>✓ Private by default</li>
                <li>✓ Encrypted P2P sync</li>
                <li>✓ No central server</li>
              </ul>
            </div>

            <div className="flex-1 p-6">
              {!connected && (
                <p className="text-sm text-heroslate">Daemon offline — start it, then refresh.</p>
              )}
              {connected && <TeamSetup key={openCount} status={status} />}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
