'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './shell/Sidebar';
import TrustCenterPanel, { type TrustSection } from './shell/TrustCenterPanel';
import WorkspaceEmpty from './shell/WorkspaceEmpty';

/** App shell — sidebar + workspace stage. Everything else lives in the Trust center panel. */
export default function OneShell({ email }: { email?: string }) {
  const [openRequest, setOpenRequest] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [trustSection, setTrustSection] = useState<TrustSection>('verify');

  const openTrust = (s: TrustSection) => {
    setTrustSection(s);
    setNavOpen(false);
    setTrustOpen(true);
  };

  const handleCreated = (id: string) => {
    setOpenRequest(id);
    openTrust('conversations');
  };

  return (
    <div className="flex min-h-screen bg-mist font-brico text-navy">
      <Sidebar
        email={email}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onSettings={() => openTrust('settings')}
        onTrustCenter={() => openTrust('verify')}
      />
      <main className="flex-1 p-8">
        <div className="mb-4 md:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="grid h-10 w-10 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
          >
            <Menu className="h-5 w-5" strokeWidth={2.2} />
          </button>
        </div>
        <WorkspaceEmpty />
      </main>
      <TrustCenterPanel open={trustOpen} onClose={() => setTrustOpen(false)} onCreated={handleCreated} initialSection={trustSection} openRequest={openRequest} />
    </div>
  );
}
