'use client';

import { Star } from 'lucide-react';
import Mascot, { type MascotColor, type MascotShape } from '@/components/Mascot';
import type { TeamBot } from '@/lib/team';

interface TeamRosterProps {
  bots: TeamBot[];
  selectedId: string | null;
  busyId: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
}

const FALLBACK_COLOR: MascotColor = 'amber';

/** Sidebar roster row: mascot + name + chief star + role subtitle + busy dot. */
export default function TeamRoster({ bots, selectedId, busyId, disabled, onSelect }: TeamRosterProps) {
  if (bots.length === 0) {
    return <p className="px-4 py-2 text-sm text-navy/50">No bots yet — create your first above.</p>;
  }
  return (
    <div className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
      {bots.map((b, i) => {
        const active = b.id === selectedId;
        return (
          <button
            key={b.id}
            onClick={() => onSelect(b.id)}
            disabled={disabled}
            className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${
              active ? 'bg-white shadow-sm' : 'hover:bg-white/60'
            } ${disabled ? 'opacity-50' : ''}`}
          >
            <Mascot
              color={(b.color as MascotColor | null) ?? FALLBACK_COLOR}
              shape={(b.shape as MascotShape | null) ?? 'blob'}
              size="md"
              motion="none"
              blinkDelay={`-${i * 1.4}s`}
              className="shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-bold text-navy">
                <span className="truncate">{b.name}</span>
                {b.isChiefOfStaff && (
                  <span title="Chief of staff" className="grid shrink-0 place-items-center">
                    <Star className="h-4 w-4 fill-bamber text-bamber" strokeWidth={2} />
                  </span>
                )}
              </span>
              <span className="block truncate text-sm text-navy/50">{b.role || 'No role yet'}</span>
            </span>
            {b.id === busyId && (
              <i title="Working" className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-blagoon" />
            )}
          </button>
        );
      })}
    </div>
  );
}
