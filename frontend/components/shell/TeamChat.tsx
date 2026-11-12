'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Plus, Send } from 'lucide-react';
import { HistoryEntry, TeamBot, listTeamBots, saveTeamBot, teamChat, teamHistory, waitForRun } from '@/lib/team';
import { Err } from './shared';

/** Team chat: bot roster (files on the outer computer) + per-bot thread. */
export default function TeamChat({ disabled, disabledHint }: { disabled?: boolean; disabledHint?: string | null }) {
  const [bots, setBots] = useState<TeamBot[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [verified, setVerified] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outerMissing, setOuterMissing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadBots = useCallback(async (select?: string) => {
    try {
      const list = await listTeamBots();
      setBots(list);
      setOuterMissing(false);
      const active = list.filter((b) => b.status !== 'paused');
      const pick = (select && list.find((b) => b.id === select)) ?? active[0] ?? null;
      setSelectedId(pick ? pick.id : null);
      if (!pick) setEntries([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Classic image (pre-deploy): /team/* doesn't exist there.
      if (/404|no provisioned|not found/i.test(msg)) setOuterMissing(true);
      else setError(msg);
    }
  }, []);

  useEffect(() => {
    loadBots();
  }, [loadBots]);

  const loadHistory = useCallback(async (botId: string) => {
    try {
      const h = await teamHistory(botId);
      setEntries(h.entries);
      setVerified(h.verified);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadHistory(selectedId);
  }, [selectedId, loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, stage]);

  async function send() {
    if (!selectedId || !draft.trim() || busy || disabled) return;
    setBusy(true);
    setError(null);
    setStage('Thinking — Meta open-weight via Modal…');
    try {
      const { runId } = await teamChat(selectedId, draft.trim());
      setDraft('');
      await waitForRun(runId);
      setStage(null);
      await loadHistory(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage(null);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const bot = await saveTeamBot({ name: newName.trim(), ...(newRole.trim() ? { role: newRole.trim() } : {}) });
      setNewName('');
      setNewRole('');
      setShowNew(false);
      await loadBots(bot.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const selected = bots?.find((b) => b.id === selectedId) ?? null;

  if (outerMissing) {
    return (
      <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-navy/15 bg-white/60 p-10 text-center">
        <div>
          <p className="font-brico text-lg font-bold text-navy">Outer computer required</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-navy/70">
            This computer doesn&apos;t serve the team endpoints — it&apos;s the classic image. Deploy the backend with{' '}
            <span className="font-mono">ONE_OUTER_IMAGE_ARN</span> set, then provision with kind{' '}
            <span className="font-mono">one_outer</span>.
          </p>
          <button onClick={() => loadBots()} className="mt-4 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-1 gap-4">
      {/* Roster */}
      <div className="w-56 shrink-0 rounded-2xl border border-navy/10 bg-white/70 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-bold uppercase tracking-wider text-navy/50">Team</span>
          <button onClick={() => setShowNew((s) => !s)} aria-label="New bot" className="grid h-7 w-7 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50">
            <Plus className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        {showNew && (
          <div className="mb-2 rounded-xl bg-ice p-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Bot name" className="mb-1.5 w-full rounded-lg border border-navy/10 px-2 py-1.5 text-sm outline-none focus:border-navy/30" />
            <input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="Role (optional)" className="mb-1.5 w-full rounded-lg border border-navy/10 px-2 py-1.5 text-sm outline-none focus:border-navy/30" />
            <button onClick={create} disabled={busy || !newName.trim()} className="w-full rounded-lg bg-navy px-2 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
              Create bot
            </button>
          </div>
        )}
        {bots === null ? (
          <p className="px-1 text-sm text-navy/50">Loading team…</p>
        ) : bots.length === 0 ? (
          <p className="px-1 text-sm text-navy/50">No bots yet — create your first above.</p>
        ) : (
          bots.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelectedId(b.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm font-semibold ${b.id === selectedId ? 'bg-navy text-white' : 'text-navy hover:bg-ice'}`}
            >
              <Bot className="h-4 w-4 shrink-0" strokeWidth={2.2} />
              <span className="truncate">{b.name}</span>
            </button>
          ))
        )}
      </div>

      {/* Thread */}
      <div className="flex flex-1 flex-col rounded-2xl border border-navy/10 bg-white/70">
        {!selected ? (
          <div className="grid flex-1 place-items-center p-10 text-center text-sm text-navy/50">
            {bots !== null && bots.length > 0 ? 'Select a bot to start chatting.' : 'Create a bot to start chatting.'}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-navy/10 px-4 py-3">
              <span className="font-brico text-base font-bold text-navy">{selected.name}</span>
              {selected.role && <span className="truncate text-sm text-navy/50">{selected.role}</span>}
              <span className="ml-auto rounded-full bg-ice px-2 py-0.5 text-[11px] font-semibold text-navy/70">observed</span>
              {!verified && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">history unverified</span>}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: '50vh' }}>
              {entries.map((m) => (
                <div key={m.seq} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'ml-auto bg-navy text-white' : 'bg-ice text-navy'}`}>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
              {stage && <p className="text-sm italic text-navy/50">{stage}</p>}
              <div ref={bottomRef} />
            </div>
            <div className="flex gap-2 border-t border-navy/10 p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={disabled ? (disabledHint ?? 'Setting up your computer…') : `Message ${selected.name}…`}
                disabled={disabled}
                className="flex-1 rounded-full border border-navy/10 px-4 py-2 text-sm outline-none focus:border-navy/30 disabled:opacity-50"
              />
              <button onClick={send} disabled={busy || !draft.trim() || disabled} aria-label="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-navy text-white disabled:opacity-40">
                <Send className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>
          </>
        )}
        {error && (
          <div className="px-4 pb-3">
            <Err message={error} />
          </div>
        )}
      </div>
    </div>
  );
}
