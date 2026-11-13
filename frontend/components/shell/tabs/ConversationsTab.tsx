'use client';

import { useCallback, useEffect, useState } from 'react';
import VerificationWidget from '@/components/VerificationWidget';
import { TranscriptEntry, openEnvelope, verifyTranscript } from '@/lib/envelope';
import {
  ConversationMeta,
  checkpointBlob,
  conversationKeys,
  listConversations,
  listSandboxes,
  pushWorkspace,
  relayMessage,
  terminateConversation,
  terminateSandbox,
  verifyReceiptServer,
  type SandboxLive,
} from '@/lib/wayfind';
import { teamEvidence, teamEvidenceList, type ClosedSandboxRun } from '@/lib/team';
import { CopyId, Err, downloadEvidenceBundle } from '../shared';

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
  const [exporting, setExporting] = useState(false);

  async function download() {
    setExporting(true);
    setError(null);
    try {
      await downloadEvidenceBundle(conv.conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

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
        <div className="mt-2 flex gap-2">
          <button onClick={loadHistory} disabled={loading} className="rounded-lg border border-navy/15 px-3 py-1 hover:bg-mist disabled:opacity-50">
            {loading ? 'Decrypting…' : 'Load history (decrypted client-side)'}
          </button>
          <button onClick={download} disabled={exporting} className="rounded-lg border border-navy/15 px-3 py-1 hover:bg-mist disabled:opacity-50">
            {exporting ? 'Exporting…' : 'Download evidence bundle'}
          </button>
        </div>
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

export default function ConversationsSection({ openRequest }: { openRequest: string | null }) {
  const [convs, setConvs] = useState<ConversationMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [live, setLive] = useState<SandboxLive[] | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [closed, setClosed] = useState<ClosedSandboxRun[] | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, { ok: boolean; detail: string }>>({});

  const refresh = useCallback(async () => {
    try {
      setConvs(await listConversations());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshLive = useCallback(async () => {
    try {
      const out = await listSandboxes();
      setLive(out.sandboxes ?? []);
    } catch {
      setLive([]);
    }
    try {
      const out = await teamEvidenceList();
      setClosed(out.evidence ?? []);
    } catch {
      setClosed([]);
    }
  }, []);

  async function verifyClosed(sandboxId: string) {
    setVerifying(sandboxId);
    try {
      const out = await teamEvidence(sandboxId);
      const receipt = (out.evidence as { receipt?: unknown })?.receipt;
      if (!receipt) {
        setVerified((p) => ({ ...p, [sandboxId]: { ok: false, detail: 'no receipt stored' } }));
        return;
      }
      const res = (await verifyReceiptServer(receipt)) as { valid?: boolean; kid?: string; signerMatch?: boolean };
      setVerified((p) => ({
        ...p,
        [sandboxId]: {
          ok: res.valid === true,
          detail: res.valid === true ? `signature valid · kid ${res.kid ?? '?'}${res.signerMatch === false ? ' · key rotated?' : ''}` : 'signature did NOT verify',
        },
      }));
    } catch (e) {
      setVerified((p) => ({ ...p, [sandboxId]: { ok: false, detail: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setVerifying(null);
    }
  }

  useEffect(() => {
    refresh();
    refreshLive();
    const timer = setInterval(() => void refreshLive(), 15000);
    return () => clearInterval(timer);
  }, [refresh, refreshLive]);

  useEffect(() => {
    if (openRequest) {
      setOpenId(openRequest);
      refresh();
    }
  }, [openRequest, refresh]);

  return (
    <div>
      <p className="text-sm font-semibold text-navy">Live inner sandboxes</p>
      <p className="text-xs text-ink">Open sessions from escalations — transcript and files persist here until closed.</p>
      <div className="mt-2 space-y-2">
        {(live ?? []).map((s) => (
          <div key={s.sandboxId} className="flex items-center justify-between gap-2 rounded-xl border border-navy/10 bg-white px-4 py-2.5">
            <span className="font-mono text-xs text-navy">
              <CopyId id={s.sandboxId} /> · {s.profile} · {s.policy}
            </span>
            <button
              type="button"
              disabled={closing === s.sandboxId}
              onClick={async () => {
                setClosing(s.sandboxId);
                try {
                  await terminateSandbox(s.sandboxId);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setClosing(null);
                  void refreshLive();
                }
              }}
              className="shrink-0 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90 disabled:opacity-50"
            >
              {closing === s.sandboxId ? 'Closing…' : 'Close'}
            </button>
          </div>
        ))}
        {live !== null && live.length === 0 && (
          <p className="text-xs text-ink">None open — escalate from a team chat and the session appears here.</p>
        )}
      </div>
      <p className="mt-4 text-sm font-semibold text-navy">Recent closed sandboxes</p>
      <p className="text-xs text-ink">Signed receipts live here — same microvm-… ids as chat and evidence cards.</p>
      <div className="mt-2 space-y-2">
        {(closed ?? []).map((c) => (
          <div key={c.sandboxId} className="rounded-xl border border-navy/10 bg-white px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-navy">
                <CopyId id={c.sandboxId} /> · {c.turns ?? '?'} turn(s){c.receiptClass ? ` · receipt: ${c.receiptClass}` : ''}
              </span>
              <button
                type="button"
                disabled={verifying === c.sandboxId}
                onClick={() => void verifyClosed(c.sandboxId)}
                className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy shadow-sm ring-1 ring-navy/15 hover:bg-slate-50 disabled:opacity-50"
              >
                {verifying === c.sandboxId ? 'Checking…' : 'Verify'}
              </button>
            </div>
            {verified[c.sandboxId] && (
              <p className={`mt-1 text-xs font-semibold ${verified[c.sandboxId].ok ? 'text-green-700' : 'text-red-700'}`}>
                {verified[c.sandboxId].ok ? 'SIGNATURE VALID' : 'NOT VERIFIED'} <span className="font-normal text-ink">· {verified[c.sandboxId].detail}</span>
              </p>
            )}
          </div>
        ))}
        {closed !== null && closed.length === 0 && (
          <p className="text-xs text-ink">No closed runs yet — close a session (chat or above) and its signed receipt lands here.</p>
        )}
      </div>
      <p className="mt-4 text-sm font-semibold text-navy">Conversations</p>
      <p className="text-sm text-ink">One sandbox = one disposable execution session.</p>
      <Err message={error} />
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
        {convs !== null && convs.length === 0 && <p className="text-sm text-ink">No sandboxes yet.</p>}
      </div>
    </div>
  );
}
