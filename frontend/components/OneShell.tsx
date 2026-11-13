'use client';

import { useCallback, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './shell/Sidebar';
import TeamChat from './shell/TeamChat';
import BotPanel from './shell/BotPanel';
import NewBotModal from './shell/NewBotModal';
import SettingsModal from './shell/settings/SettingsModal';
import SandboxesPanel, { type SandboxSection } from './shell/SandboxesPanel';
import ActivityPanel from './shell/ActivityPanel';
import { BootPhase, ComputerRow, ensureComputer } from '@/lib/computer';
import { BotEdits, TeamBot, deleteTeamBot, listTeamBots, saveTeamBot } from '@/lib/team';

/** App shell — ensure one outer computer, then team chat. */
export default function OneShell({ email }: { email?: string }) {
  const [openRequest, setOpenRequest] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [sandboxesOpen, setSandboxesOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [sandboxSection, setSandboxSection] = useState<SandboxSection>('verify');
  const [phase, setPhase] = useState<BootPhase>('checking');
  const [, setComputer] = useState<ComputerRow | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const [bots, setBots] = useState<TeamBot[] | null>(null);
  const [botsError, setBotsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Example first-message from bot creation — auto-sent once, then cleared. */
  const [pendingPrompt, setPendingPrompt] = useState<{ botId: string; text: string } | null>(null);

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

  const ready = phase === 'running' || phase === 'suspended';

  const loadBots = useCallback(async (select?: string) => {
    try {
      const list = await listTeamBots();
      setBots(list);
      setBotsError(null);
      const active = list.filter((b) => b.status !== 'paused');
      const pick = (select && list.find((b) => b.id === select)) ?? active[0] ?? null;
      setSelectedId((cur) => (cur && list.some((b) => b.id === cur) ? cur : (pick ? pick.id : null)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[team] roster load failed:', msg);
      if (/404|no provisioned|not found/i.test(msg)) {
        setBots([]);
      } else {
        setBotsError('Could not load your team — try again.');
      }
    }
  }, []);

  // Roster loads once the computer is running; retry net covers a missed update.
  useEffect(() => {
    if (!ready || bots !== null || botsError) return;
    let cancelled = false;
    void loadBots();
    const timer = setInterval(() => {
      if (!cancelled) void loadBots();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ready, bots, botsError, loadBots]);

  const createBot = useCallback(
    async (name: string, isChief: boolean, opts?: { role?: string; firstPrompt?: string }): Promise<string | null> => {
      try {
        const bot = await saveTeamBot({
          name,
          ...(opts?.role || isChief ? { role: opts?.role ?? 'Chief of staff' } : {}),
          ...(isChief ? { isChiefOfStaff: true } : {}),
        });
        await loadBots(bot.id);
        setSelectedId(bot.id);
        setModalOpen(false);
        if (opts?.firstPrompt) setPendingPrompt({ botId: bot.id, text: opts.firstPrompt });
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [loadBots],
  );

  const openSandboxes = (s: SandboxSection) => {
    setSandboxSection(s);
    setNavOpen(false);
    setSandboxesOpen(true);
  };

  const handleOpenVerify = (sandboxId: string) => {
    setOpenRequest(sandboxId);
    openSandboxes('verify');
  };

  const saveBotEdits = useCallback(
    async (id: string, edits: BotEdits): Promise<string | null> => {
      try {
        await saveTeamBot({ id, ...edits });
        await loadBots(id);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [loadBots],
  );

  const deleteBot = useCallback(
    async (id: string): Promise<string | null> => {
      try {
        await deleteTeamBot(id);
        setSelectedId((cur) => (cur === id ? null : cur));
        setPanelOpen(false);
        await loadBots();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [loadBots],
  );

  const handleOpenActivity = () => {
    setNavOpen(false);
    setActivityOpen(true);
  };

  const selected = bots?.find((b) => b.id === selectedId) ?? null;
  const chiefTakenBy = bots?.find((b) => b.isChiefOfStaff)?.name ?? null;

  const bootHint = bootError
    ? `Couldn't start your computer — ${bootError}`
    : phase === 'provisioning'
      ? 'Booting your computer…'
      : 'Setting up your computer…';

  return (
    <div className="flex h-screen overflow-hidden bg-mist font-brico text-navy">
      <Sidebar
        email={email}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onSettings={() => {
          setNavOpen(false);
          setSettingsOpen(true);
        }}
        onSandboxes={() => openSandboxes('verify')}
        onActivity={handleOpenActivity}
        bots={bots ?? []}
        selectedId={selectedId}
        busyId={busyId}
        rosterReady={ready && bots !== null}
        onSelectBot={setSelectedId}
        onNewBot={() => setModalOpen(true)}
      />
      <main className="flex min-w-0 flex-1 flex-col bg-thread">
        <div className="px-4 pt-4 md:hidden">
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
              bootHint
            )}
          </div>
        )}

        {botsError ? (
          <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-navy/15 bg-white/60 p-10 text-center">
            <div>
              <p className="font-brico text-lg font-bold text-navy">{botsError}</p>
              <button
                onClick={() => {
                  setBots(null);
                  setBotsError(null);
                }}
                className="mt-4 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <TeamChat
            bot={selected}
            bots={bots ?? []}
            disabled={!ready}
            disabledHint={bootHint}
            mentionNames={(() => {
              const list = (bots ?? []).filter((b) => b.status !== 'paused');
              if (selected?.isChiefOfStaff) return list.filter((b) => b.id !== selected.id).map((b) => b.name);
              const chief = list.find((b) => b.isChiefOfStaff);
              return chief ? [chief.name] : [];
            })()}
            onBusy={setBusyId}
            onNeedBots={() => setModalOpen(true)}
            onOpenSettings={() => setPanelOpen(true)}
            onOpenVerify={handleOpenVerify}
            onTeamChanged={() => loadBots()}
            initialPrompt={pendingPrompt}
            onPromptConsumed={() => setPendingPrompt(null)}
          />
        )}
      </main>
      <NewBotModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={createBot}
        taken={(bots ?? []).map((b) => b.name)}
        chiefTakenBy={chiefTakenBy}
      />
      <BotPanel open={panelOpen} onClose={() => setPanelOpen(false)} bot={selected} onSave={saveBotEdits} onDelete={deleteBot} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SandboxesPanel open={sandboxesOpen} onClose={() => { setSandboxesOpen(false); setOpenRequest(null); }} initialSection={sandboxSection} openRequest={openRequest} verifyRequest={sandboxSection === 'verify' ? openRequest : null} />
      <ActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} />
    </div>
  );
}
