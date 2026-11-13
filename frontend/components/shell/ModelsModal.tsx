'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Cpu, X } from 'lucide-react';
import { INNER_MODELS, DEFAULT_INNER_MODEL, getInnerModel, setInnerModel } from '@/lib/models';

/** Inner-sandbox model picker. Selection persists in localStorage only —
 * it rides each chat call, so no database change is involved. */
export default function ModelsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [active, setActive] = useState<string>(DEFAULT_INNER_MODEL);

  useEffect(() => {
    if (open) setActive(getInnerModel());
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pick = (id: string) => {
    setInnerModel(id);
    setActive(id);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Sandbox model"
          >
            <div className="flex items-center justify-between border-b border-navy/10 px-5 py-4">
              <h3 className="flex items-center gap-2 font-brico text-lg font-bold text-navy">
                <Cpu className="h-5 w-5" strokeWidth={2.2} />
                Sandbox model
              </h3>
              <button
                onClick={onClose}
                aria-label="Close model picker"
                className="grid h-8 w-8 place-items-center rounded-full text-heroslate hover:bg-ice hover:text-navy"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 p-5">
              <p className="text-sm text-ink">
                Which model runs inside your next sandbox. Attestation is checked live at run time either way.
              </p>
              {INNER_MODELS.map((m) => {
                const selected = m.id === active;
                return (
                  <button
                    key={m.id}
                    onClick={() => pick(m.id)}
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                      selected ? 'border-cta bg-cta/5' : 'border-navy/15 hover:border-navy/30'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-navy">{m.label}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            m.badge === 'verified' ? 'bg-blagoon/15 text-[#12706f]' : 'bg-bamber/25 text-navy'
                          }`}
                        >
                          {m.badge === 'verified' ? 'Verified' : 'Pilot'}
                        </span>
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-navy/50">{m.id}</span>
                      <span className="mt-0.5 block text-xs text-ink">{m.desc}</span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-cta" strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
