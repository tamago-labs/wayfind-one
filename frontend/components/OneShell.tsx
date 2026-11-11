'use client';

import { useCallback, useEffect, useState } from 'react';
import { signOut } from 'aws-amplify/auth';
import { MODELS } from './Catalog';
import {
  ConversationMeta,
  checkpointBlob,
  conversationKeys,
  createConversation,
  listConversations,
  pushWorkspace,
  relayMessage,
  terminateConversation,
} from '@/lib/wayfind';
import { checkReceipt } from '@/lib/receipt';
import VerificationWidget from '@/components/VerificationWidget';
import { TranscriptEntry, openEnvelope, verifyTranscript } from '@/lib/envelope';
import { BotRow, listBots } from '@/lib/data';

type Tab = 'bots' | 'conversations' | 'verify';

const LEVELS = [
  { id: 'standard', label: 'Standard — isolated execution' },
  { id: 'verified_inference', label: 'Verified inference — attested NEAR AI' },
];

function Err({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>;
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = id;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button onClick={copy} title="Copy full conversation id" className="rounded px-1 font-mono text-xs text-ink hover:bg-mist">
      {id.slice(0, 8)}… {copied ? 'copied' : 'copy'}
    </button>
  );
}

function BotsTab({ onCreated }: { onCreated: (id: string) => void }) {
  const [bots, setBots] = useState<BotRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  useEffect(() => {
    listBots().then(setBots).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function startWithBot(b: BotRow) {
    setStarting(b.id);
    setError(null);
    try {
      const created = await createConversation({ botId: b.id });
      const system = [b.name ? `You are "${b.name}".` : '', b.role ?? '', b.description ?? '']
        .filter(Boolean)
        .join(' ') || 'You are a helpful assistant. Answer concisely.';
      await relayMessage(created.conversationId, 'bot/init', { system, model: created.model });
      onCreated(created.conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(null);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Bots</h1>
      <p className="mt-1 text-sm text-ink">Authored in the Wayfind Cloud builder · one click starts a private execution session.</p>
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
              onClick={() => startWithBot(b)}
              disabled={starting !== null}
              className="mt-3 rounded-lg bg-cta px-3 py-1.5 text-sm text-white hover:bg-ctahover disabled:opacity-50"
            >
              {starting === b.id ? 'Provisioning…' : 'Start private conversation'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewConversationForm({
  bots,
  onCreated,
}: {
  bots: BotRow[];
  onCreated: (id: string) => void;
}) {
  const [botId, setBotId] = useState('');
  const [model, setModel] = useState(MODELS[0].id);
  const [level, setLevel] = useState('standard');
  const [system, setSystem] = useState('You are a helpful assistant. Answer concisely.');
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!first.trim()) {
      setError('Write the first message.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setStage('Provisioning disposable VM…');
      const created = await createConversation({
        ...(botId ? { botId } : {}),
        model,
        securityLevel: level,
      });
      setStage('Initializing bot + verifying attestation…');
      await relayMessage(created.conversationId, 'bot/init', { system, model });
      setStage('Running first inference…');
      await relayMessage(created.conversationId, 'bot/message', { content: first.trim() });
      setStage(null);
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
        {busy ? (stage ?? 'Working…') : 'Start private conversation'}
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
  const [attachInfo, setAttachInfo] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ preflight?: { nodes?: number; nvidia?: { gpus?: number } | null } | null; messages?: Array<{ kind?: string; signer?: string | null; valid?: boolean; checked?: boolean }> } | null>(null);

  const load = useCallback(async () => {
    try {
      const t = await relayMessage<{ entries: TranscriptEntry[]; verified: boolean }>(id, 'bot/transcript', {});
      setEntries(t.entries ?? []);
      setVerified(t.verified);
      try {
        const ev = await relayMessage<{ preflight?: { nodes?: number; nvidia?: { gpus?: number } | null } | null; messages?: Array<{ kind?: string; signer?: string | null; valid?: boolean; checked?: boolean }> }>(id, 'bot/evidence', {});
        setEvidence(ev);
      } catch {
        // Older images lack /bot/evidence — badges stay hidden.
      }
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
    setStage('Thinking — inference runs inside the disposable VM…');
    setError(null);
    try {
      await relayMessage(id, 'bot/message', { content: draft.trim() });
      setDraft('');
      setStage('Verifying response…');
      await load();
      setStage(null);
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

  async function attach(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setAttachInfo(null);
    try {
      const picked = [...files].slice(0, 200);
      const encoded = await Promise.all(
        picked.map(
          (f) =>
            new Promise<{ path: string; contentBase64: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = String(reader.result ?? '');
                const b64 = result.includes(',') ? result.split(',')[1] : result;
                resolve({ path: f.name, contentBase64: b64 });
              };
              reader.onerror = () => reject(new Error(`cannot read ${f.name}`));
              reader.readAsDataURL(f);
            }),
        ),
      );
      const out = await pushWorkspace(id, encoded);
      setAttachInfo(`Attached ${out.pushed} file(s) · workspace ${out.workspaceHash.slice(0, 12)}…`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-navy/10 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-ink">
          <CopyId id={id} />
          {verified === true && <span className="text-green-700">· chain verified</span>}{verified === false && <span className="text-red-700">· chain BROKEN</span>}
          {evidence?.preflight && <span className="text-green-700"> · attested ({evidence.preflight.nodes ?? 0} TEE node{(evidence.preflight.nodes ?? 0) === 1 ? '' : 's'})</span>}
        </p>
        <button onClick={terminate} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">
          Terminate + destroy VM
        </button>
      </div>
      <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">
        {(entries ?? []).map((e) => {
          const v = evidence?.messages?.find((m) => m && typeof m === 'object' && (m as { seq?: number }).seq === e.seq) as { kind?: string; signer?: string | null; valid?: boolean; checked?: boolean } | undefined;
          return (
            <div key={e.seq} className={`rounded-lg px-3 py-2 text-sm ${e.role === 'user' ? 'bg-mist text-navy' : 'bg-green-50 text-navy'}`}>
              <p className="text-xs font-semibold uppercase text-ink">
                {e.role}
                {e.role === 'assistant' && v?.checked && (
                  <span className={v.valid ? 'text-green-700 normal-case' : 'text-red-700 normal-case'}> · {v.valid ? `verified ${v.kind}` : 'UNVERIFIED'}</span>
                )}
              </p>
              <p className="whitespace-pre-wrap">{e.content}</p>
            </div>
          );
        })}
        {entries !== null && entries.length === 0 && <p className="text-sm text-ink">No messages yet.</p>}
      </div>
      {stage && <p className="mt-2 text-xs italic text-ink">{stage}</p>}
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
      <div className="mt-2 flex items-center gap-2">
        <label className={`cursor-pointer rounded-lg border border-navy/15 px-3 py-1.5 text-sm text-ink hover:bg-mist ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          Attach files
          <input type="file" multiple className="hidden" disabled={busy} onChange={(e) => { attach(e.target.files); e.target.value = ''; }} />
        </label>
        {attachInfo && <p className="text-xs text-ink">{attachInfo}</p>}
      </div>
      <Err message={error} />
    </div>
  );
}

function ClosedConversation({ conv }: { conv: ConversationMeta }) {
  const [entries, setEntries] = useState<TranscriptEntry[] | null>(null);
  const [chainOk, setChainOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      const { workspaceKey } = await conversationKeys(conv.conversationId);
      // Row manifest first, receipt copy as fallback (pre-persist-fix rows).
      const manifest = (conv.checkpointManifest?.length ? conv.checkpointManifest : conv.receipt?.checkpointManifest ?? []);
      if (manifest.length === 0) {
        setEntries([]);
        setChainOk(null);
        return;
      }
      // Latest checkpoint holds the full transcript. Relayed through the
      // API (no S3 CORS involved) and decrypted client-side.
      const last = manifest[manifest.length - 1];
      const seq = Number(last.split(':')[0]);
      const { envelope, sha256 } = await checkpointBlob(conv.conversationId, seq);
      const bytes = await openEnvelope(workspaceKey, 'transcript.jsonl', { ...envelope, sha256: envelope.sha256 ?? sha256 ?? undefined });
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as TranscriptEntry[];
      setEntries(parsed);
      setChainOk(await verifyTranscript(parsed));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 text-xs text-ink">
      <p>Closed · checkpoints {(conv.checkpointManifest?.length ? conv.checkpointManifest.length : conv.receipt?.checkpointManifest?.length) ?? 0} · {conv.receipt ? 'receipt present — see Verify tab' : 'no receipt'}</p>
      {conv.receipt?.inference && <VerificationWidget conversationId={conv.conversationId} />}
      {entries === null && (
        <button onClick={loadHistory} disabled={loading} className="mt-2 rounded-lg border border-navy/15 px-3 py-1 hover:bg-mist disabled:opacity-50">
          {loading ? 'Decrypting…' : 'Load history (decrypted client-side)'}
        </button>
      )}
      {entries !== null && entries.length === 0 && <p className="mt-2">No checkpoints recorded.</p>}
      {entries !== null && entries.length > 0 && (
        <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
          <p>Chain {chainOk === true ? <span className="text-green-700">verified</span> : chainOk === false ? <span className="text-red-700">BROKEN</span> : '…'}</p>
          {entries.map((e) => (
            <div key={e.seq} className={`rounded-lg px-3 py-2 text-sm ${e.role === 'user' ? 'bg-mist text-navy' : 'bg-green-50 text-navy'}`}>
              <p className="text-xs font-semibold uppercase">{e.role}</p>
              <p className="whitespace-pre-wrap">{e.content}</p>
            </div>
          ))}
        </div>
      )}
      <Err message={error} />
    </div>
  );
}

function ConversationsTab({ openRequest }: { openRequest: string | null }) {
  const [convs, setConvs] = useState<ConversationMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bots, setBots] = useState<BotRow[]>([]);
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

  useEffect(() => {
    if (openRequest) {
      setOpenId(openRequest);
      refresh();
    }
  }, [openRequest, refresh]);

  return (
    <div>
      <h1 className="text-2xl font-bold">Conversations</h1>
      <p className="mt-1 text-sm text-ink">One conversation = one disposable execution session.</p>
      <Err message={error} />
      <div className="mt-4">
        <NewConversationForm
          bots={bots}
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
              <span className="font-mono text-xs text-navy"><CopyId id={c.conversationId} /> · {c.model}</span>
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
              <ClosedConversation conv={c} />
            )}
          </div>
        ))}
        {convs !== null && convs.length === 0 && <p className="text-sm text-ink">No conversations yet.</p>}
      </div>
    </div>
  );
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
  const [openRequest, setOpenRequest] = useState<string | null>(null);
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
            onCreated={(id) => {
              setOpenRequest(id);
              setTab('conversations');
            }}
          />
        )}
        {tab === 'conversations' && <ConversationsTab openRequest={openRequest} />}
        {tab === 'verify' && <VerifyTab />}
      </main>
    </div>
  );
}
