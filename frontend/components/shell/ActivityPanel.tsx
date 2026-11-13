'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { History, X } from 'lucide-react';
import ActivitySection from './tabs/ActivityTab';

/**
 * Activity slide-in panel (same drawer chrome as SandboxesPanel).
 * Append-only audit trail, opened from the profile menu.
 */
export default function ActivityPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-navy/40"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Activity"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-navy/10 bg-mist shadow-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-navy/10 bg-white px-6 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-white">
                <History className="h-5 w-5" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-brico text-lg font-bold text-navy">Activity</span>
                <span className="block text-xs text-ink">Append-only audit trail.</span>
              </span>
              <button
                onClick={onClose}
                aria-label="Close Activity"
                className="grid h-9 w-9 place-items-center rounded-full text-ink hover:bg-mist hover:text-navy"
              >
                <X className="h-5 w-5" strokeWidth={2.2} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <ActivitySection />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
