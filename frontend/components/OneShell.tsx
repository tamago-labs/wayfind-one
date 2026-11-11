'use client';

import { useCallback, useEffect, useState } from 'react';
import { signOut } from 'aws-amplify/auth';
import { MODELS } from './Catalog';
import {
  ConversationMeta,
  createConversation,
  listConversations,
  relayMessage,
  terminateConversation,
} from '@/lib/wayfind';
import { checkReceipt } from '@/lib/receipt';
import { BotRow, listBots } from '@/lib/data';

type Tab = 'bots' | 'conversations' | 'verify';

interface TranscriptEntry {
  seq: number;
  role: string;
  content: string;
  hash: string;
}

const LEVELS = [
  { id: 'standard', label: 'Standard — isolated execution' },
  { id: 'verified_inference', label: 'Verified inference — attested NEAR AI' },
];

function Err({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>;
}

function BotsTab({ onDeploy }: { onDeploy: (bot: BotRow) => void }) {
  const [bots, setBots] = useState<BotRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listBots().then(setBots).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  return (
    <div>
      <h1 className="text-2xl font-bold">Bots</h1>
      <p className="mt-1 text-sm text-ink">Authored in the Wayfind Cloud builder · deployed here for private execution.</p>
      <Err message={error} />
      {bots === null && !error && <p className="mt-6 text-sm text-ink">Loading…</p>}
      {bots !== null && bots.length === 0 && (
        <p className="mt-6 text-sm text-ink">No bots yet — create one in Wayfind Cloud first.</p>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {(bots ?? []).map((b) => (
          <div key={b.id} className="rounded-xl border border-navy/10 bg-white p-4">
            <p className="font-semibold text-navy">{b.name ?? 'Untitled bot'}</p>
            {b.role && <p className="mt-1 text-sm text-ink">{b.role}</p>}
            {b.description && <p className="mt-1 text-xs text-ink">{b.description}</p>}
            <button
              onClick={() => onDeploy(b)}
              className="mt-3 rounded-lg bg-cta px-3 py-1.5 text-sm text-white hover:bg-ctahover"
            >
              Deploy to private execution
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewConversationForm({
  bots,
  presetBotId,
  onCreated,
}: {
  bots: BotRow[];
  presetBotId: string;
  onCreated: (id: string) => void;
}) {
  const [botId, setBotId] = useState(presetBotId);
  const [model, setModel] = useState(MODELS[0].id);
  const [level, setLevel] = useState('standard');
  const [system, setSystem] = useState('You are a helpful assistant. Answer concisely.');
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setBotId(presetBotId), [presetBotId]);

  async function submit() {
    if (!first.trim()) {
      setError('Write the first message.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createConversation({
        ...(botId ? { botId } : {}),
        model,
        securityLevel: level,
      });
      await relayMessage(created.conversationId, 'bot/init', { system, model });
      await relayMessage(created.conversationId, 'bot/message', { content: first.trim() });
      onCreated(created.conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-navy/10 bg-white p-4">
      <p className="font-semibold text-navy">New conversation</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-sm text-ink">
          Bot
          <select value={botId} onChange={(e) => setBotId(e.target.value)} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy">
            <option value="">No bot (ad-hoc)</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>{b.name ?? b.id}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink">
          Model
          <select value={model} onChange={(e) => setModel(e.target.value)} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy">
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.id} · {m.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink">
          Security level
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy">
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink">
          System prompt
          <input value={system} onChange={(e) => setSystem(e.target.value)} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy" />
        </label>
      </div>
      <label className="mt-3 block text-sm text-ink">
        First message
        <textarea value={first} onChange={(e) => setFirst(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy" />
      </label>
      <button
        onClick={submit}
        disabled={busy}
        className="mt-3 rounded-lg bg-cta px-4 py-2 text-sm text-white hover:bg-ctahover disabled:opacity-50"
      >
        {busy ? 'Provisioning disposable VM…' : 'Start private conversation'}
      </button>
      <Err message={error} />
    </div>
  );
}

function LiveConversation({ id, onClosed }: { id: string; onClosed: () => void }) {
  const [entries, setEntries] = useState<TranscriptEntry[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await relayMessage<{ entries: TranscriptEntry[]; verified: boolean }>(id, 'bot/transcript', {});
      setEntries(t.entries ?? []);
      setVerified(t.verified);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function send() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await relayMessage(id, 'bot/message', { content: draft.trim() });
      setDraft('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function terminate() {
    setBusy(true);
    try {
      await terminateConversation(id);
      onClosed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-navy/10 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-ink">{id.slice(0, 8)}… {verified === true && <span className="text-green-700">· chain verified</span>}{verified === false && <span className="text-red-700">· chain BROKEN</span>}</p>
        <button onClick={terminate} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">
          Terminate + destroy VM
        </button>
      </div>
      <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
        {(entries ?? []).map((e) => (
          <div key={e.seq} className={`rounded-lg px-3 py-2 text-sm ${e.role === 'user' ? 'bg-mist text-navy' : 'bg-green-50 text-navy'}`}>
            <p className="text-xs font-semibold uppercase text-ink">{e.role}</p>
            <p className="whitespace-pre-wrap">{e.content}</p>
          </div>
        ))}
        {entries !== null && entries.length === 0 && <p className="text-sm text-ink">No messages yet.</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) send(); }}
          placeholder="Ask about your workspace…"
          className="flex-1 rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy"
        />
        <button onClick={send} disabled={busy} className="rounded-lg bg-cta px-4 py-2 text-sm text-white hover:bg-ctahover disabled:opacity-50">
          Send
        </button>
      </div>
      <Err message={error} />
    </div>
  );
}

function ConversationsTab() {
  const [convs, setConvs] = useState<ConversationMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bots, setBots] = useState<BotRow[]>([]);
  const [presetBotId, setPresetBotId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConvs(await listConversations());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    listBots().then(setBots).catch(() => {});
  }, [refresh]);

  return (
    <div>
      <h1 className="text-2xl font-bold">Conversations</h1>
      <p className="mt-1 text-sm text-ink">One conversation = one disposable execution session.</p>
      <Err message={error} />
      <div className="mt-4">
        <NewConversationForm
          bots={bots}
          presetBotId={presetBotId}
          onCreated={(id) => {
            setOpenId(id);
            refresh();
          }}
        />
      </div>
      <div className="mt-4 space-y-2">
        {(convs ?? []).map((c) => (
          <div key={c.conversationId} className="rounded-xl border border-navy/10 bg-white px-4 py-3">
            <button onClick={() => setOpenId(openId === c.conversationId ? null : c.conversationId)} className="flex w-full items-center justify-between text-left">
              <span className="font-mono text-xs text-navy">{c.conversationId.slice(0, 8)}… · {c.model}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === 'live' ? 'bg-green-100 text-green-800' : 'bg-mist text-ink'}`}>{c.status}</span>
            </button>
            {openId === c.conversationId && c.status === 'live' && (
              <LiveConversation
                id={c.conversationId}
                onClosed={() => {
                  setOpenId(null);
                  refresh();
                }}
              />
            )}
            {openId === c.conversationId && c.status !== 'live' && (
              <p className="mt-2 text-xs text-ink">
                Closed · checkpoints {c.checkpointManifest.length} · {c.receipt ? 'receipt present — see Verify tab' : 'no receipt'}
              </p>
            )}
          </div>
        ))}
        {convs !== null && convs.length === 0 && <p className="text-sm text-ink">No conversations yet.</p>}
      </div>
      <BotDeployBridge onPick={(id) => setPresetBotId(id)} botId={presetBotId} />
    </div>
  );
}

// Hidden bridge: the Bots tab sets the deployed bot here via a custom event.
function BotDeployBridge({ onPick, botId }: { onPick: (id: string) => void; botId: string }) {
  useEffect(() => {
    const handler = (e: Event) => onPick((e as CustomEvent<string>).detail);
    window.addEventListener('wayfind:deploy-bot', handler);
    return () => window.removeEventListener('wayfind:deploy-bot', handler);
  }, [onPick]);
  void botId;
  return null;
}

function VerifyTab() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<ReturnType<typeof checkReceipt> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    const trimmed = input.trim();
    if (!trimmed) {
      setError('Paste a receipt JSON or a conversation id.');
      return;
    }
    try {
      if (trimmed.startsWith('{')) {
        setResult(checkReceipt(JSON.parse(trimmed)));
        return;
      }
      const convs = await listConversations();
      const conv = convs.find((c) => c.conversationId === trimmed);
      if (!conv?.receipt) {
        setError('No receipt on that conversation (only closed ones carry one).');
        return;
      }
      setResult(checkReceipt(conv.receipt));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Verify</h1>
      <p className="mt-1 text-sm text-ink">Same checks as <span className="font-mono">wayfind verify</span> — v0 receipts are integrity-checked, not yet signed (Phase 2).</p>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        placeholder='Paste receipt JSON, or a conversation id'
        className="mt-4 w-full rounded-xl border border-navy/15 bg-white px-3 py-2 font-mono text-xs text-navy"
      />
      <button onClick={run} className="mt-2 rounded-lg bg-cta px-4 py-2 text-sm text-white hover:bg-ctahover">
        Check receipt
      </button>
      <Err message={error} />
      {result && (
        <div className="mt-4 rounded-xl border border-navy/10 bg-white p-4">
          {result.checks.map((c) => (
            <p key={c.name} className="text-sm">
              <span className={c.pass ? 'text-green-700' : 'text-red-700'}>{c.pass ? 'PASS' : 'FAIL'}</span>
              <span className="text-navy"> {c.name}</span>
              {c.detail && <span className="text-ink"> — {c.detail}</span>}
            </p>
          ))}
          <p className={`mt-2 text-sm font-semibold ${result.ok ? 'text-green-700' : 'text-red-700'}`}>
            {result.ok ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function OneShell({ email }: { email?: string }) {
  const [tab, setTab] = useState<Tab>('bots');
  return (
    <div className="flex min-h-screen bg-mist">
      <aside className="flex w-64 flex-col border-r border-navy/10 bg-white">
        <div className="border-b border-navy/10 px-5 py-4">
          <p className="font-bold text-navy">Wayfind ONE</p>
          <p className="truncate text-xs text-ink">{email}</p>
        </div>
        <nav className="flex flex-col gap-1 p-3 text-sm">
          {(['bots', 'conversations', 'verify'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-2 text-left capitalize ${tab === t ? 'bg-navy text-white' : 'text-ink hover:bg-mist'}`}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="mt-auto p-3">
          <button onClick={() => signOut()} className="w-full rounded-lg border border-navy/15 px-3 py-2 text-sm text-ink hover:bg-mist">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8">
        {tab === 'bots' && (
          <BotsTab
            onDeploy={(b) => {
              setTab('conversations');
              window.dispatchEvent(new CustomEvent('wayfind:deploy-bot', { detail: b.id }));
            }}
          />
        )}
        {tab === 'conversations' && <ConversationsTab />}
        {tab === 'verify' && <VerifyTab />}
      </main>
    </div>
  );
}
