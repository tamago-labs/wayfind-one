'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Menu } from 'lucide-react';
import Sidebar from './shell/Sidebar';
import TeamChat from './shell/TeamChat';
import TrustCenterPanel, { type TrustSection } from './shell/TrustCenterPanel';
import { BootPhase, ComputerRow, ensureComputer } from '@/lib/computer';

/** App shell — readiness gate + floating boot banner (cloud pattern). */
export default function OneShell({ email }: { email?: string }) {
  const [openRequest, setOpenRequest] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [trustSection, setTrustSection] = useState<TrustSection>('verify');
  const [phase, setPhase] = useState<BootPhase>('checking');
  const [, setComputer] = useState<ComputerRow | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const boot = useCallback(async () => {
    setBootError(null);
    try {
      await ensureComputer('one_outer', (p, row) => {
        // Breadcrumb for stuck-boot reports: phase trail in the console.
        console.info('[computer]', p);
        setPhase(p);
        if (row) setComputer(row);
      });
    } catch (e) {
      setBootError(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  const openTrust = (s: TrustSection) => {
    setTrustSection(s);
    setNavOpen(false);
    setTrustOpen(true);
  };

  const handleCreated = (id: string) => {
    setOpenRequest(id);
    openTrust('conversations');
  };

  // Suspended counts as ready — the VM wakes on first traffic, so gating
  // it would brick the wake (same rule as cloud's AppShell gate).
  const ready = phase === 'running' || phase === 'suspended';
  const bootHint = bootError
    ? `Couldn't start your computer — ${bootError}`
    : phase === 'provisioning'
      ? 'Booting your computer…'
      : 'Setting up your computer…';

  return (
    <div className="flex min-h-screen bg-mist font-brico text-navy">
      <Sidebar
        email={email}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onSettings={() => openTrust('settings')}
        onTrustCenter={() => openTrust('verify')}
      />
      <main className="flex flex-1 flex-col p-8">
        <div className="mb-4 md:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="grid h-10 w-10 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
          >
            <Menu className="h-5 w-5" strokeWidth={2.2} />
          </button>
        </div>

        {!ready && (
          <div className="mx-4 mb-1 flex items-center justify-center gap-2 rounded-full bg-bamber/25 px-4 py-1.5 text-center text-xs font-bold text-navy">
            {phase === 'failed' ? (
              <>
                <span className="truncate">{bootHint}</span>
                <button onClick={boot} className="shrink-0 underline hover:no-underline">
                  Retry
                </button>
              </>
            ) : (
              <>
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                {bootHint}
              </>
            )}
          </div>
        )}

        <TeamChat disabled={!ready} disabledHint={bootHint} ready={ready} />
      </main>
      <TrustCenterPanel open={trustOpen} onClose={() => setTrustOpen(false)} onCreated={handleCreated} initialSection={trustSection} openRequest={openRequest} />
    </div>
  );
}
