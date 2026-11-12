'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, PanelRight, Send } from 'lucide-react';
import Mascot from '@/components/Mascot';
import { HistoryEntry, TeamBot, answerBotRequest, answerQuestion, decideApproval, saveTeamBot, summarizeRole, teamChat, teamHistory, waitForRun } from '@/lib/team';
import Markdown from './Markdown';
import VoiceModal from './VoiceModal';
import { Err } from './shared';

interface TeamChatProps {
  bot: TeamBot | null;
  bots: TeamBot[];
  disabled?: boolean;
  disabledHint?: string | null;
  mentionNames: string[];
  onBusy: (botId: string | null) => void;
  onNeedBots: () => void;
  onOpenSettings: () => void;
  onTeamChanged: () => void;
}

/** Hello prompts (bot-initiated intros). Never rendered as chat — the
 * display filter below drops them from already-polluted threads so only
 * the greeting reply shows. Exactly-once per bot per session. */
const HELLO_PREFIX = 'Introduce yourself briefly';
const greetedBots = new Set<string>();

function visibleEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.filter((e) => !(e.role === 'user' && e.content.startsWith(HELLO_PREFIX)));
}

interface BotReq {
  bid: string;
  name: string;
  role?: string;
  description?: string;
  done?: 'created' | 'cancelled';
}

interface ParkedQuestion {
  qid: string;
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
  }>;
  done?: boolean;
}

interface ParkedApproval {
  approvalId: string;
  permission?: string;
  target?: string;
  done?: 'approve' | 'reject' | 'approve-all';
}

/** Trailing @mention being typed, e.g. "@Re" in "ask @Re". Null when none. */
function mentionQuery(draft: string): string | null {
  const m = draft.match(/(?:^|\s)@([A-Za-z0-9_-]{0,24})$/);
  return m ? m[1] : null;
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

/** One parked clarifying question: option buttons + free-text + skip. */
function QuestionCard({ q, onAnswer }: { q: ParkedQuestion; onAnswer: (answers: string[][]) => void }) {
  const [custom, setCustom] = useState('');
  const answered = q.done === true;
  return (
    <div className="msg-in rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {q.questions.map((item, qi) => (
        <div key={qi} className={qi > 0 ? 'mt-3 border-t border-slate-100 pt-3' : ''}>
          {item.header && <p className="text-xs font-bold uppercase tracking-wide text-cta">{item.header}</p>}
          <p className="mt-0.5 font-bold text-navy">{item.question}</p>
          {!answered && (
            <div className="mt-2 flex flex-col gap-1.5">
              {item.options.map((o) => (
                <button
                  key={o.label}
                  onClick={() => onAnswer(q.questions.map((_, j) => (j === qi ? [o.label] : [])))}
                  className="rounded-xl border border-navy/20 px-3.5 py-2 text-left hover:border-cta hover:bg-cta/5"
                >
                  <span className="block text-sm font-bold text-navy">{o.label}</span>
                  {o.description && <span className="mt-0.5 block text-xs text-navy/50">{o.description}</span>}
                </button>
              ))}
              <div className="flex gap-1.5">
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && custom.trim()) onAnswer(q.questions.map((_, j) => (j === qi ? [custom.trim()] : [])));
                  }}
                  placeholder="Or type your own answer…"
                  className="min-w-0 flex-1 rounded-xl border border-navy/20 px-3.5 py-2 text-sm text-navy outline-none placeholder:text-slate-400 focus:border-cta"
                />
                <button
                  onClick={() => custom.trim() && onAnswer(q.questions.map((_, j) => (j === qi ? [custom.trim()] : [])))}
                  disabled={!custom.trim()}
                  className="shrink-0 rounded-xl bg-navy px-3.5 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-40"
                >
                  Send
                </button>
              </div>
              <button
                onClick={() => onAnswer(q.questions.map(() => []))}
                className="rounded-xl px-3.5 py-1.5 text-left text-sm font-semibold text-navy/50 hover:bg-slate-50"
              >
                Skip
              </button>
            </div>
          )}
        </div>
      ))}
      {answered && <p className="mt-2 text-sm font-bold text-blagoon">✓ Answered</p>}
    </div>
  );
}

/** Thread view for the selected team bot (roster lives in the sidebar). */
export default function TeamChat({ bot, bots, disabled, disabledHint, mentionNames, onBusy, onNeedBots, onOpenSettings, onTeamChanged }: TeamChatProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [verified, setVerified] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outerMissing, setOuterMissing] = useState(false);
  const [botReqs, setBotReqs] = useState<BotReq[]>([]);
  const [agentNotes, setAgentNotes] = useState<string[]>([]);
  const [questions, setQuestions] = useState<ParkedQuestion[]>([]);
  const [approvals, setApprovals] = useState<ParkedApproval[]>([]);
  const [voiceOpen, setVoiceOpen] = useState(false);
  // History for the selected bot has loaded at least once — the hello
  // effect must wait for this, otherwise it fires into the pre-load
  // empty thread on every reload and greets again.
  const [historyReady, setHistoryReady] = useState(false);
  // Live reply text, accumulated from chunk deltas (cloud parity: the reply
  // renders token-by-token while polling, not all-at-once at done).
  const [liveText, setLiveText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async (botId: string) => {
    try {
      const h = await teamHistory(botId);
      setEntries(visibleEntries(h.entries));
      setVerified(h.verified);
      setOuterMissing(false);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[team] history load failed:', msg);
      if (/404|no provisioned|not found/i.test(msg)) setOuterMissing(true);
      else setError('Could not load this thread — try again.');
    }
    setHistoryReady(true);
  }, []);

  useEffect(() => {
    if (bot) {
      setEntries([]);
      setDraft('');
      setError(null);
      setBotReqs([]);
      setAgentNotes([]);
      setQuestions([]);
      setApprovals([]);
      setVoiceOpen(false);
      setHistoryReady(false);
      loadHistory(bot.id);
    }
  }, [bot, loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, busy, liveText, botReqs, agentNotes, questions, approvals]);

  async function sendText(text: string, opts?: { hello?: boolean }) {
    if (!bot || !text.trim() || busy || disabled) return;
    const learnRole = !bot.role && !bot.isChiefOfStaff && !opts?.hello;
    setBusy(true);
    setLiveText('');
    onBusy(bot.id);
    setError(null);
    setAgentNotes([]);
    // Optimistic user bubble (cloud parity): the message shows instantly
    // with the typing indicator; history reload after done replaces it
    // with the server copy. Hellos skip this — the prompt must never render.
    if (!opts?.hello) {
      const optimistic = text.trim();
      setEntries((prev) => [...prev, { seq: -Date.now(), role: 'user' as const, content: optimistic }]);
    }
    try {
      const { runId } = await teamChat(bot.id, text.trim(), undefined, opts?.hello);
      if (!runId) {
        // Server says this bot was already greeted — just show its history.
        await loadHistory(bot.id);
        return;
      }
      setDraft('');
      await waitForRun(runId, {
        onChunk: (delta) => setLiveText((prev) => prev + delta),
        onAgent: (label) => setAgentNotes((prev) => (prev.includes(label) ? prev : [...prev, label])),
        onBotRequest: (r) =>
          setBotReqs((prev) =>
            prev.some((b) => b.bid === r.bid)
              ? prev
              : [...prev, { bid: r.bid, name: r.botName, ...(r.botRole ? { role: r.botRole } : {}), ...(r.botDescription ? { description: r.botDescription } : {}) }],
          ),
        // Parked states resume the same run once answered — the reply
        // streams on below without a second send.
        onQuestion: (q) =>
          setQuestions((prev) => (prev.some((x) => x.qid === q.qid) ? prev : [...prev, { qid: q.qid, questions: q.questions }])),
        onApproval: (a) =>
          setApprovals((prev) =>
            prev.some((x) => x.approvalId === a.approvalId)
              ? prev
              : [...prev, { approvalId: a.approvalId, ...(a.permission ? { permission: a.permission } : {}), ...(a.target ? { target: a.target } : {}) }],
          ),
      });
      setLiveText('');
      // First chat defines the role (never for chiefs, never from hellos):
      // compress the user's job description, manual edits win.
      if (learnRole) {
        try {
          const role = await summarizeRole(text.trim());
          if (role) {
            await saveTeamBot({ id: bot.id, name: bot.name, role });
            onTeamChanged();
          }
        } catch (err) {
          console.error('[team] role summarize failed:', err instanceof Error ? err.message : err);
        }
      }
      await loadHistory(bot.id);
    } catch (e) {
      setLiveText('');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onBusy(null);
    }
  }

  // Bot-initiated hello: one model run, fired when the thread is
  // known-empty. Module-level set survives StrictMode remounts, the
  // historyReady gate survives reloads (history arrives before any hello
  // is considered), and the server refuses second hellos regardless.
  useEffect(() => {
    if (!bot || disabled || busy || !historyReady || entries.length > 0 || greetedBots.has(bot.id)) return;
    greetedBots.add(bot.id);
    void sendText(
      bot.role
        ? 'Introduce yourself briefly in character and ask for the first task.'
        : 'Introduce yourself briefly and ask the user to define your role: what to do, what never to do, and what to remember.',
      { hello: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot, disabled, entries]);

  function send() {
    sendText(draft);
  }

  async function answerRequest(req: BotReq, ok: boolean) {
    const mark = (done: 'created' | 'cancelled') =>
      setBotReqs((prev) => prev.map((b) => (b.bid === req.bid ? { ...b, done } : b)));
    if (!ok) {
      mark('cancelled');
      try {
        await answerBotRequest(req.bid, 'cancel');
      } catch (e) {
        console.error('[team] bot request cancel failed:', e instanceof Error ? e.message : e);
      }
      return;
    }
    const taken = bots.some((b) => b.name.toLowerCase() === req.name.toLowerCase());
    if (taken) {
      // Name taken: cancel with an error so the model retries another name.
      mark('cancelled');
      try {
        await answerBotRequest(req.bid, 'cancel', `A bot named "${req.name}" already exists — pick another name.`);
      } catch (e) {
        console.error('[team] bot request resolve failed:', e instanceof Error ? e.message : e);
      }
      return;
    }
    try {
      await answerBotRequest(req.bid, 'confirm');
      mark('created');
      onTeamChanged();
    } catch (e) {
      console.error('[team] bot request confirm failed:', e instanceof Error ? e.message : e);
    }
  }

  async function answerQ(index: number, answers: string[][]) {
    const q = questions[index];
    if (!q || q.done) return;
    setQuestions((prev) => prev.map((x, i) => (i === index ? { ...x, done: true as const } : x)));
    try {
      await answerQuestion(q.qid, answers);
    } catch (e) {
      setQuestions((prev) => prev.map((x, i) => (i === index ? { ...x, done: undefined } : x)));
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function decideAppr(index: number, decision: 'approve' | 'reject' | 'approve-all') {
    const a = approvals[index];
    if (!a || a.done) return;
    setApprovals((prev) => prev.map((x, i) => (i === index ? { ...x, done: decision } : x)));
    try {
      await decideApproval(a.approvalId, decision);
    } catch (e) {
      setApprovals((prev) => prev.map((x, i) => (i === index ? { ...x, done: undefined } : x)));
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const mentions =
    mentionNames.length === 0
      ? []
      : (() => {
          const q = mentionQuery(draft);
          return q === null ? [] : mentionNames.filter((n) => n.toLowerCase().startsWith(q.toLowerCase())).slice(0, 5);
        })();

  const pickMention = (name: string) => {
    setDraft(draft.replace(/@([A-Za-z0-9_-]{0,24})$/, `@${name} `));
  };

  const suggestions = bot?.isChiefOfStaff ? CHIEF_SUGGESTIONS : MEMBER_SUGGESTIONS;
  // The bot always greets first, so "untouched" means no user message yet —
  // starters stay visible under the greeting until the user sends something.
  // Hidden while disabled: the hello can't fire before the computer is up,
  // and dead buttons are worse than none.
  const showSuggestions = !disabled && !busy && botReqs.length === 0 && entries.every((e) => e.role !== 'user');

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
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center px-4 pb-2 pt-4">
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

      <div className="thread-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 text-[15px]">
          {entries.map((m) =>
            m.role === 'user' ? (
              <div key={m.seq} className="msg-in ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-cta px-4 py-2.5 text-white">
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ) : (
              <div key={m.seq} className="msg-in max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-navy shadow-sm">
                <Markdown text={m.content} />
              </div>
            ),
          )}
          {busy && liveText && (
            <div className="msg-in max-w-[85%] rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-navy shadow-sm">
              <Markdown text={liveText} />
            </div>
          )}
          {busy && !liveText && (
            <div className="w-fit rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm">
              <span className="typing-dots flex gap-1">
                <i className="h-2 w-2 rounded-full bg-slate-400" />
                <i className="h-2 w-2 rounded-full bg-slate-400" />
                <i className="h-2 w-2 rounded-full bg-slate-400" />
              </span>
            </div>
          )}
          {botReqs.map((r) => (
            <div key={r.bid} className="max-w-[85%] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-cta">New Bot</p>
              <p className="mt-0.5 font-bold text-navy">
                {r.name}
                {r.role && <span className="font-medium text-navy/50"> · {r.role}</span>}
              </p>
              {r.description && <p className="mt-1 text-sm text-navy/60">{r.description}</p>}
              {r.done === undefined ? (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => answerRequest(r, true)}
                    className="rounded-full bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-navy/90"
                  >
                    Create Bot
                  </button>
                  <button
                    onClick={() => answerRequest(r, false)}
                    className="rounded-full border border-slate-300 px-4 py-1.5 text-sm font-semibold text-navy hover:bg-slate-50"
                  >
                    Not now
                  </button>
                </div>
              ) : (
                <p className={`mt-2 text-sm font-bold ${r.done === 'created' ? 'text-blagoon' : 'text-slate-400'}`}>
                  {r.done === 'created' ? '✓ Created' : 'Declined'}
                </p>
              )}
            </div>
          ))}
          {agentNotes.map((label) => (
            <div key={label} className="msg-in flex items-center gap-2 px-1 text-xs font-semibold text-navy/50">
              <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-bamber" />
              <span>{label}</span>
            </div>
          ))}
          {questions.map((q, i) => (
            <QuestionCard key={q.qid} q={q} onAnswer={(answers) => void answerQ(i, answers)} />
          ))}
          {approvals.map((a, i) => (
            <div key={a.approvalId} className="msg-in rounded-2xl border border-bamber/50 bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-cta">Approval needed</p>
              <p className="mt-0.5 font-bold text-navy">{a.permission ?? 'Permission'}</p>
              {a.target && <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm text-navy/60">{a.target}</p>}
              {a.done === undefined ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void decideAppr(i, 'approve')}
                    className="rounded-full bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-navy/90"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => void decideAppr(i, 'reject')}
                    className="rounded-full border border-slate-300 px-4 py-1.5 text-sm font-semibold text-navy hover:bg-slate-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => void decideAppr(i, 'approve-all')}
                    className="rounded-full px-4 py-1.5 text-sm font-semibold text-navy/50 hover:bg-slate-50"
                  >
                    Approve all
                  </button>
                </div>
              ) : (
                <p className={`mt-2 text-sm font-bold ${a.done === 'reject' ? 'text-slate-400' : 'text-blagoon'}`}>
                  {a.done === 'reject' ? 'Rejected' : a.done === 'approve-all' ? '✓ Approved (all)' : '✓ Approved'}
                </p>
              )}
            </div>
          ))}
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

      <div className="shrink-0 px-4 pb-4">
        <div className="relative mx-auto max-w-2xl">
          {mentions.length > 0 && (
            <div className="absolute bottom-full left-4 right-4 z-10 mb-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {mentions.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => pickMention(n)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold text-navy hover:bg-cta/5"
                >
                  <span className="text-cta">@</span>
                  {n}
                </button>
              ))}
            </div>
          )}
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
              onKeyDown={(e) => {
                if (e.key === 'Tab' && mentions.length > 0) {
                  e.preventDefault();
                  pickMention(mentions[0]);
                }
              }}
              placeholder={disabled ? disabledHint ?? 'Setting up your computer…' : `Message ${bot.name}`}
              className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-navy outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              aria-label="Voice message"
              disabled={disabled || busy}
              onClick={() => setVoiceOpen(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-navy/50 hover:bg-slate-100 hover:text-navy disabled:opacity-40"
            >
              <Mic className="h-[18px] w-[18px]" strokeWidth={2.4} />
            </button>
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
        {voiceOpen && !disabled && !busy && (
          <VoiceModal onVoiceSend={(text) => void sendText(text)} onClose={() => setVoiceOpen(false)} />
        )}
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
