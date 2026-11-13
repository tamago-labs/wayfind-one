'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck, X } from 'lucide-react';
import ActivitySection from './tabs/ActivityTab';
import BotsSection from './tabs/BotsTab';
import ConversationsSection from './tabs/ConversationsTab';
import NewSection from './tabs/NewTab';
import SettingsSection from './tabs/SettingsTab';
import VerifySection from './tabs/VerifyTab';

type Section = 'new' | 'bots' | 'sandboxes' | 'verify' | 'activity' | 'settings';

export type SandboxSection = Section;

const SECTIONS: Section[] = ['new', 'bots', 'sandboxes', 'verify', 'activity', 'settings'];

/**
 * Sandboxes slide-in panel (GA-style right drawer).
 * Hosts every former sidebar tab as a section.
 */
export default function SandboxesPanel({
  open,
  onClose,
  onCreated,
  initialSection,
  openRequest,
  verifyRequest,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  initialSection: Section;
  openRequest: string | null;
  verifyRequest?: string | null;
}) {
  const [section, setSection] = useState<Section>(initialSection);

  useEffect(() => {
    if (open) setSection(initialSection);
  }, [open, initialSection]);

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
            aria-label="Sandboxes"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-navy/10 bg-mist shadow-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-navy/10 bg-white px-6 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-white">
                <ShieldCheck className="h-5 w-5" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-brico text-lg font-bold text-navy">Sandboxes</span>
                <span className="block text-xs text-ink">Sandboxes, receipts, attestations, and the audit trail.</span>
              </span>
              <button
                onClick={onClose}
                aria-label="Close Sandboxes"
                className="grid h-9 w-9 place-items-center rounded-full text-ink hover:bg-mist hover:text-navy"
              >
                <X className="h-5 w-5" strokeWidth={2.2} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1 border-b border-navy/10 bg-white px-6 py-2">
              {SECTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSection(s)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold capitalize ${
                    section === s ? 'bg-navy text-white' : 'text-ink hover:bg-mist'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {section === 'new' && <NewSection onCreated={onCreated} />}
              {section === 'bots' && <BotsSection onCreated={onCreated} />}
              {section === 'sandboxes' && <ConversationsSection openRequest={openRequest} />}
              {section === 'verify' && <VerifySection initialId={verifyRequest ?? undefined} />}
              {section === 'activity' && <ActivitySection />}
              {section === 'settings' && <SettingsSection />}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
