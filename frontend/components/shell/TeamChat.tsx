'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PanelRight, Send } from 'lucide-react';
import Mascot from '@/components/Mascot';
import { HistoryEntry, TeamBot, teamChat, teamHistory, waitForRun } from '@/lib/team';
import Markdown from './Markdown';
import { Err } from './shared';

interface TeamChatProps {
  bot: TeamBot | null;
  disabled?: boolean;
  disabledHint?: string | null;
  onBusy: (botId: string | null) => void;
  onNeedBots: () => void;
  onOpenSettings: () => void;
}

const MEMBER_SUGGESTIONS = [
  { label: 'What can you do?', desc: 'Learn what this bot helps with', prompt: 'What can you help me with?' },
  { label: 'Write a poem', desc: 'A short river poem', prompt: 'Write a short 8-line poem about a river.' },
  { label: 'Explain simply', desc: 'A complex topic in plain words', prompt: 'Explain how neural networks learn, simply.' },
];

const CHIEF_SUGGESTIONS = [
  { label: 'Coordinate my team', desc: 'How the chief helps', prompt: 'How do you coordinate my other bots?' },
  ...MEMBER_SUGGESTIONS.slice(1),
];

/** Thread view for the selected team bot (roster lives in the sidebar). */
export default function TeamChat({ bot, disabled, disabledHint, onBusy, onNeedBots, onOpenSettings }: TeamChatProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [verified, setVerified] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outerMissing, setOuterMissing] = useState(false);
  // Live reply text, accumulated from chunk deltas (cloud parity: the reply
  // renders token-by-token while polling, not all-at-once at done).
  const [liveText, setLiveText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async (botId: string) => {
    try {
      const h = await teamHistory(botId);
      setEntries(h.entries);
      setVerified(h.verified);
      setOuterMissing(false);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[team] history load failed:', msg);
      if (/404|no provisioned|not found/i.test(msg)) setOuterMissing(true);
      else setError('Could not load this thread — try again.');
    }
  }, []);

  useEffect(() => {
    if (bot) {
      setEntries([]);
      setDraft('');
      setError(null);
      loadHistory(bot.id);
    }
  }, [bot, loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, busy, liveText]);

  async function sendText(text: string) {
    if (!bot || !text.trim() || busy || disabled) return;
    setBusy(true);
    setLiveText('');
    onBusy(bot.id);
    setError(null);
    try {
      const { runId } = await teamChat(bot.id, text.trim());
      setDraft('');
      await waitForRun(runId, {
        onChunk: (delta) => setLiveText((prev) => prev + delta),
      });
      setLiveText('');
      await loadHistory(bot.id);
    } catch (e) {
      setLiveText('');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onBusy(null);
    }
  }

  function send() {
    sendText(draft);
  }

  const suggestions = bot?.isChiefOfStaff ? CHIEF_SUGGESTIONS : MEMBER_SUGGESTIONS;
  const showSuggestions = entries.length === 0 && !busy;

  if (outerMissing) {
    return (
      <div className="grid flex-1 place-items-center p-10 text-center">
        <div>
          <p className="font-brico text-lg font-bold text-navy">Team chat isn&apos;t available on this computer yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-navy/50">It may still be starting — wait a moment and try again.</p>
          <button onClick={() => bot && loadHistory(bot.id)} className="mt-4 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="grid flex-1 place-items-center p-10 text-center">
        {disabled ? (
          <p className="text-sm text-navy/50">Setting up your team…</p>
        ) : (
          <div>
            <p className="font-brico text-lg font-bold text-navy">No bots yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-navy/50">Create your first bot to start chatting.</p>
            <button onClick={onNeedBots} className="mt-4 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90">
              Create bot
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center px-4 pb-2 pt-4">
        <span className="hidden w-40 md:block" />
        <button
          onClick={onOpenSettings}
          aria-label="Bot settings"
          className="mx-auto flex items-center gap-2.5 rounded-full bg-white py-2 pl-3 pr-5 font-bold text-navy shadow-md shadow-navy/5 hover:bg-slate-50"
        >
          <Mascot color={bot.color ?? 'amber'} shape={bot.shape ?? 'blob'} size="xs" motion="none" />
          <span>{bot.name}</span>
          <span className="hidden text-sm font-medium text-navy/50 sm:inline">· {bot.role || 'No role yet'}</span>
        </button>
        <button
          onClick={onOpenSettings}
          aria-label="Bot settings"
          className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
        >
          <PanelRight className="h-4 w-4" strokeWidth={2.2} />
        </button>
        {!verified && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">history unverified</span>}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 text-[15px]">
          {entries.map((m) =>
            m.role === 'user' ? (
              <div key={m.seq} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-cta px-4 py-2.5 text-white">
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ) : (
              <div key={m.seq} className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-navy shadow-sm">
                <Markdown text={m.content} />
              </div>
            ),
          )}
          {busy && liveText && (
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-navy shadow-sm">
              <Markdown text={liveText} />
            </div>
          )}
          {busy && !liveText && (
            <div className="w-fit rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm">
              <span className="flex gap-1">
                <i className="h-2 w-2 rounded-full bg-slate-400" />
                <i className="h-2 w-2 rounded-full bg-slate-400" />
                <i className="h-2 w-2 rounded-full bg-slate-400" />
              </span>
            </div>
          )}
          {showSuggestions && (
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {suggestions.map((s) => (
                <button
                  key={s.label}
                  onClick={() => sendText(s.prompt)}
                  className="rounded-2xl border border-navy/15 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-cta hover:bg-cta/5"
                >
                  <span className="block text-sm font-bold text-navy">{s.label}</span>
                  <span className="mt-0.5 block text-xs text-navy/50">{s.desc}</span>
                </button>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="relative mx-auto max-w-2xl">
          {disabled && disabledHint && (
            <span className="absolute -top-9 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-navy px-4 py-1.5 text-xs font-bold text-white shadow-lg" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {disabledHint}
            </span>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!disabled) send();
            }}
            aria-disabled={disabled}
            className={`relative mx-auto flex max-w-2xl items-center gap-2 rounded-full border border-slate-200 bg-white p-1.5 shadow-sm focus-within:border-cta ${disabled ? 'opacity-60' : ''}`}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={disabled}
              autoComplete="off"
              placeholder={disabled ? disabledHint ?? 'Setting up your computer…' : `Message ${bot.name}`}
              className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-navy outline-none placeholder:text-slate-400"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={disabled || busy || !draft.trim()}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cta text-white hover:bg-ctahover disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2.4} /> : <Send className="h-[18px] w-[18px]" strokeWidth={2.4} />}
            </button>
          </form>
        </div>
        <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-slate-400">
          Chats run on your computer · Meta open-weight · observed, never verified here
        </p>
      </div>
      {error && (
        <div className="px-4 pb-3">
          <Err message={error} />
        </div>
      )}
    </div>
  );
}
