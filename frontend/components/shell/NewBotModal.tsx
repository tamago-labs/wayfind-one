'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

interface NewBotModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, isChief: boolean) => Promise<string | null>;
  taken?: string[];
  chiefTakenBy?: string | null;
}

/** Theme-flavored name pool (nature + color tokens from the landing palette). */
const NAME_POOL = [
  'Amber',
  'Moss',
  'Lagoon',
  'Ash',
  'Reef',
  'Dune',
  'Bay',
  'Kelp',
  'Fern',
  'Tide',
  'Wren',
  'Nimbus',
];

function randomName(taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  const free = NAME_POOL.filter((n) => !lower.has(n.toLowerCase()));
  const pool = free.length > 0 ? free : NAME_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function NewBotModal({ open, onClose, onCreate, taken = [], chiefTakenBy = null }: NewBotModalProps) {
  const [name, setName] = useState('');
  const [isChief, setIsChief] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(randomName(taken));
      setIsChief(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const create = async () => {
    const v = name.trim();
    if (!v || saving) return;
    setSaving(true);
    setError(null);
    const err = await onCreate(v, isChief);
    setSaving(false);
    if (err) {
      setError(err);
    } else {
      onClose();
    }
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
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Name your Bot"
          >
            <div className="p-5">
              <h3 className="font-brico text-lg font-bold text-navy">Name your Bot</h3>
              <p className="mt-1 text-sm text-navy/60">{isChief ? 'It talks to your other bots and coordinates them.' : 'Give it a name — you\u2019ll define its role in your first message.'}</p>
              <div className="mt-4 flex gap-2">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void create();
                  }}
                  placeholder="e.g. Amber"
                  maxLength={40}
                  className="min-w-0 flex-1 rounded-xl border border-navy/15 bg-ice px-4 py-2.5 text-sm text-navy outline-none placeholder:text-navy/40 focus:border-navy/40"
                />
              </div>
              <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-navy">
                <input
                  type="checkbox"
                  checked={isChief}
                  onChange={(e) => setIsChief(e.target.checked)}
                  className="h-4 w-4 accent-[#2F7BFF]"
                />
                <span>
                  <span className="font-semibold">Chief of staff</span>
                  <span className="text-navy/60"> — coordinates your other bots</span>
                </span>
              </label>
              {isChief && chiefTakenBy && (
                <p className="mt-2 text-sm font-medium text-amber-600">This replaces {chiefTakenBy} as chief of staff.</p>
              )}
              {error && (
                <p className="mt-2 text-sm font-medium text-red-600" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="rounded-full px-5 py-2 text-sm font-semibold text-navy/60 hover:bg-ice"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void create()}
                  disabled={!name.trim() || saving}
                  className="rounded-full bg-navy px-5 py-2 text-sm font-bold text-white hover:bg-navy/90 disabled:opacity-50"
                >
                  {saving ? 'Creating…' : 'Create Bot'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
