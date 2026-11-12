'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import Mascot from '@/components/Mascot';
import type { BotEdits, TeamBot } from '@/lib/team';
import BotEditModal from './BotEditModal';
import DeleteBotModal from './DeleteBotModal';

interface BotPanelProps {
  open: boolean;
  onClose: () => void;
  bot: TeamBot | null;
  onSave: (id: string, edits: BotEdits) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
}

/** Right slide-in bot settings (mirrors wayfind-cloud BotPanel, minus tabs):
 * mascot, name + role, edit modal, delete modal. */
export default function BotPanel({ open, onClose, bot, onSave, onDelete }: BotPanelProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div
      className={`shrink-0 overflow-hidden border-navy/10 bg-ice transition-all duration-200 ${
        open ? 'fixed inset-y-0 right-0 z-30 w-80 border-l md:static' : 'w-0'
      }`}
      aria-hidden={!open}
    >
      <div className="flex h-full w-80 flex-col p-5">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete Bot"
            title="Delete Bot"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-red-600 shadow-sm hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            onClick={onClose}
            aria-label="Close Bot settings"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        {bot && (
          <>
            <button
              onClick={() => setEditOpen(true)}
              aria-label="Edit Bot appearance"
              title="Edit name, role, color and shape"
              className="mx-auto mt-5 rounded-full transition hover:opacity-80"
            >
              <Mascot color={bot.color ?? 'amber'} shape={bot.shape ?? 'blob'} size="lg" motion="none" />
            </button>
            <p className="mt-5 truncate text-center text-lg font-bold text-navy">
              {bot.name} <span className="text-sm font-medium text-navy/50">· {bot.role || 'No role yet'}</span>
            </p>
            <DeleteBotModal
              open={deleteOpen}
              botName={bot.name}
              onClose={() => setDeleteOpen(false)}
              onDelete={async () => {
                const err = await onDelete(bot.id);
                if (!err) {
                  setDeleteOpen(false);
                  onClose();
                }
                return err;
              }}
            />
            <BotEditModal
              open={editOpen}
              onClose={() => setEditOpen(false)}
              initial={{
                name: bot.name,
                role: bot.role ?? '',
                isChiefOfStaff: bot.isChiefOfStaff ?? false,
                color: bot.color ?? 'amber',
                shape: bot.shape ?? 'blob',
              }}
              onSave={async (edits) => {
                const err = await onSave(bot.id, edits);
                if (!err) {
                  setEditOpen(false);
                  onClose();
                }
                return err;
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
