'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { dataClient } from '@/lib/data';

interface ProfileModalProps {
  open: boolean;
  onClose: () => void;
  profileId: string | null;
  initialName: string;
  onSaved: (name: string) => void;
}

export default function ProfileModal({ open, onClose, profileId, initialName, onSaved }: ProfileModalProps) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const save = async () => {
    const v = name.trim();
    if (!v || !profileId || saving) return;
    setSaving(true);
    try {
      const { errors } = await dataClient().models.UserProfile.update({ id: profileId, displayName: v });
      if (errors?.length) return;
      onSaved(v);
      onClose();
    } catch {
      // keep modal open on failure
    } finally {
      setSaving(false);
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
            aria-label="Set profile name"
          >
            <div className="p-5">
              <h3 className="font-brico text-lg font-bold text-navy">Your profile name</h3>
              <p className="mt-1 text-sm text-heroslate">Your bots will address you by this name.</p>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                }}
                placeholder="e.g. Alex"
                maxLength={40}
                className="mt-4 w-full rounded-xl border border-navy/15 bg-ice px-4 py-2.5 text-sm text-navy outline-none placeholder:text-heroslate/60 focus:border-cta"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="rounded-full px-5 py-2 text-sm font-semibold text-heroslate hover:bg-ice"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void save()}
                  disabled={!name.trim() || saving}
                  className="rounded-full bg-cta px-5 py-2 text-sm font-bold text-white hover:bg-ctahover disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
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
