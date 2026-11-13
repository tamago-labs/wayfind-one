'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BadgeCheck, X } from 'lucide-react';
import VerificationWidget from '@/components/VerificationWidget';
import type { WidgetReport } from '@/lib/verifyReports';

/**
 * Full-size NEAR Verification Center drawer. The chat card and session
 * rows are too narrow for the viewer iframe — this gives it room.
 */
export default function VerificationDrawer({
  open,
  onClose,
  reports,
}: {
  open: boolean;
  onClose: () => void;
  reports: WidgetReport[] | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Portaled to document.body: rendered deep inside the chat bubble,
  // an inline drawer would be capped by ancestor transforms/overflow.
  // (Same pattern as NewBotModal / ConnectorsModal.)
  return createPortal(
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
            className="fixed inset-0 z-50 bg-navy/40"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="NEAR Verification Center"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l border-navy/10 bg-mist shadow-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-navy/10 bg-white px-6 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-white">
                <BadgeCheck className="h-5 w-5" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-brico text-lg font-bold text-navy">NEAR Verification Center</span>
                <span className="block text-xs text-ink">NEAR&apos;s view of our retained evidence — our own checks are the trust anchor.</span>
              </span>
              <button
                onClick={onClose}
                aria-label="Close verification center"
                className="grid h-9 w-9 place-items-center rounded-full text-ink hover:bg-mist hover:text-navy"
              >
                <X className="h-5 w-5" strokeWidth={2.2} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {reports ? (
                <div className="rounded-xl border border-navy/10 bg-white p-4">
                  <VerificationWidget reports={reports} />
                </div>
              ) : (
                <p className="text-sm text-ink">No verification reports for this run yet.</p>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
