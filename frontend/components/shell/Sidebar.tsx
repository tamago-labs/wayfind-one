'use client';

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import Mascot from '@/components/Mascot';
import type { TeamBot } from '@/lib/team';
import SidebarFooter from './SidebarFooter';
import TeamRoster from './TeamRoster';

interface SidebarProps {
  email?: string;
  open: boolean;
  onClose: () => void;
  onSettings: () => void;
  onTrustCenter: () => void;
  bots: TeamBot[];
  selectedId: string | null;
  busyId: string | null;
  rosterReady: boolean;
  onSelectBot: (id: string) => void;
  onNewBot: () => void;
}

/** App sidebar (mirrors wayfind-cloud Roster): overlay + panel + header + team roster + footer. */
export default function Sidebar({ email, open, onClose, onSettings, onTrustCenter, bots, selectedId, busyId, rosterReady, onSelectBot, onNewBot }: SidebarProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const visible = query.trim()
    ? bots.filter((b) => `${b.name} ${b.role ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    : bots;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-20 bg-navy/40 md:hidden ${open ? '' : 'hidden'}`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[19rem] flex-col border-r border-navy/10 bg-ice transition-transform md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <span className="flex shrink-0 items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy">
              <Mascot color="white" size="xs" motion="none" label="Wayfind mascot" />
            </span>
            <span className="font-brico text-lg font-bold text-navy">Wayfind</span>
          </span>
          <div className="flex gap-2">
            <button
              aria-label="Search bots"
              onClick={() => setShowSearch((s) => !s)}
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
            >
              <Search className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <button
              aria-label="New bot"
              onClick={onNewBot}
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        </div>
        {showSearch && (
          <div className="px-4 pb-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bots…"
              className="w-full rounded-xl border border-navy/10 bg-white px-3 py-2 text-sm text-navy outline-none placeholder:text-navy/40 focus:border-navy/30"
            />
          </div>
        )}
        {rosterReady ? (
          <TeamRoster bots={visible} selectedId={selectedId} busyId={busyId} onSelect={onSelectBot} />
        ) : (
          <div className="flex-1 px-4 py-2 text-sm text-navy/50">Loading team…</div>
        )}
        <SidebarFooter email={email} onSettings={onSettings} onTrustCenter={onTrustCenter} />
      </aside>
    </>
  );
}
