'use client';

import { Plus, Search } from 'lucide-react';
import Mascot from '@/components/Mascot';
import SidebarFooter from './SidebarFooter';

interface SidebarProps {
  email?: string;
  open: boolean;
  onClose: () => void;
  onSettings: () => void;
  onTrustCenter: () => void;
}

/** App sidebar (mirrors wayfind-cloud Roster): overlay + panel + header + bot-list slot + footer. */
export default function Sidebar({ email, open, onClose, onSettings, onTrustCenter }: SidebarProps) {
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
              title="Coming soon"
              onClick={() => {}}
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
            >
              <Search className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <button
              aria-label="New bot"
              title="Coming soon"
              onClick={() => {}}
              className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        </div>
        {/* Bot group interface lands here (separate work). */}
        <div className="flex-1" />
        <SidebarFooter email={email} onSettings={onSettings} onTrustCenter={onTrustCenter} />
      </aside>
    </>
  );
}
