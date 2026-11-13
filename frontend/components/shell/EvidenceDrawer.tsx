'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, FileText, X } from 'lucide-react';

function short(s: string, n = 18): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return 'date unknown';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return 'just now';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtDur(ms: number | null): string | null {
  if (typeof ms !== 'number' || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-navy/10 bg-white p-4">
      <h4 className="font-brico text-sm font-bold text-navy">{title}</h4>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-[13px]">
      <dt className="shrink-0 text-navy/50">{k}</dt>
      <dd className={`text-right font-semibold text-navy ${mono ? 'break-all font-mono text-xs' : ''}`} title={v}>{v}</dd>
    </div>
  );
}

/**
 * Visual evidence bundle viewer. Reconstructs the downloaded JSON into
 * human sections — Summary, Receipt, Attestation, Transcript — with the raw
 * download one tap away in the header.
 */
export default function EvidenceDrawer({
  open,
  onClose,
  bundle,
  sandboxId,
}: {
  open: boolean;
  onClose: () => void;
  bundle: Record<string, unknown> | null;
  sandboxId?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const b = (bundle ?? {}) as {
    closedAt?: string;
    closeReason?: string;
    turns?: number;
    transcript?: Array<{ seq?: number; role?: string; content?: string }>;
    receipt?: {
      class?: string;
      kind?: string;
      model?: string;
      provider?: string;
      policy?: string;
      provisionedAt?: string;
      terminatedAt?: string;
      goalHash?: string;
      cleanup?: { vmTerminated?: boolean };
      finalSnapshot?: { recorded?: boolean; sha256?: string };
      inference?: { botEvidence?: EvidenceAttestation };
      signature?: { kid?: string; algo?: string; sig?: string };
    };
    evidence?: { botEvidence?: EvidenceAttestation };
  };

  interface EvidenceAttestation {
    profile?: string;
    policy?: { securityLevel?: string; allowedModels?: string[] };
    parsing?: Array<{ path?: string; kind?: string }>;
    preflight?: {
      model?: string;
      nodes?: number;
      nonceEchoed?: boolean;
      modelTee?: string[];
      gateway?: string[];
      nvidia?: { overall?: boolean; nonceMatch?: boolean | null; gpus?: number } | null;
    };
    messages?: Array<{ seq?: number; kind?: string; checked?: boolean; valid?: boolean; signer?: string }>;
    verified?: boolean;
  }

  const att = b.receipt?.inference?.botEvidence ?? b.evidence?.botEvidence ?? null;
  const transcript = Array.isArray(b.transcript) ? b.transcript : [];
  const firstUser = transcript.find((t) => t?.role === 'user' && typeof t.content === 'string' && t.content.trim());
  const t0 = b.receipt?.provisionedAt ? Date.parse(b.receipt.provisionedAt) : NaN;
  const t1 = b.receipt?.terminatedAt ? Date.parse(b.receipt.terminatedAt) : NaN;
  const dur = fmtDur(Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0 ? t1 - t0 : null);
  const msgs = att?.messages ?? [];
  const checked = msgs.filter((m) => m?.checked);
  const pre = att?.preflight ?? null;
  const nvidia = typeof pre?.nvidia === 'object' && pre?.nvidia !== null ? (pre.nvidia as { overall?: boolean; nonceMatch?: boolean | null; gpus?: number }) : null;

  function download() {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wayfind-evidence-${(sandboxId ?? 'sandbox').slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
            className="fixed inset-0 z-50 bg-navy/40"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Sandbox evidence"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l border-navy/10 bg-mist shadow-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-navy/10 bg-white px-6 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy text-white">
                <FileText className="h-5 w-5" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-brico text-lg font-bold text-navy">
                  {firstUser?.content?.trim().slice(0, 80) ?? 'Sandbox evidence'}
                </span>
                <span className="block text-xs text-ink">Signed receipt + attestation + decrypted transcript.</span>
              </span>
              <button
                onClick={download}
                disabled={!bundle}
                aria-label="Download evidence JSON"
                title="Download evidence JSON"
                className="grid h-9 w-9 place-items-center rounded-full text-navy hover:bg-mist disabled:opacity-40"
              >
                <Download className="h-5 w-5" strokeWidth={2.2} />
              </button>
              <button
                onClick={onClose}
                aria-label="Close evidence"
                className="grid h-9 w-9 place-items-center rounded-full text-ink hover:bg-mist hover:text-navy"
              >
                <X className="h-5 w-5" strokeWidth={2.2} />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              {!bundle ? (
                <p className="text-sm text-ink">No evidence loaded yet.</p>
              ) : (
                <>
                  <Section title="Summary">
                    <dl>
                      <KV k="Closed" v={b.closedAt ? `${relTime(b.closedAt)} · ${new Date(b.closedAt).toLocaleString()}` : 'date unknown'} />
                      {dur && <KV k="Run time" v={dur} />}
                      <KV k="Turns" v={String(b.turns ?? transcript.length)} />
                      {b.closeReason && <KV k="Close reason" v={b.closeReason} />}
                      <KV k="Sandbox" v={sandboxId ?? ''} mono />
                    </dl>
                  </Section>
                  <Section title="Receipt">
                    <dl>
                      <KV k="Class" v={b.receipt?.class ?? 'unknown'} />
                      {b.receipt?.model && <KV k="Model" v={b.receipt.model} mono />}
                      {b.receipt?.provider && <KV k="Provider" v={b.receipt.provider} />}
                      {b.receipt?.policy && <KV k="Policy" v={b.receipt.policy} />}
                      {b.receipt?.provisionedAt && <KV k="Started" v={new Date(b.receipt.provisionedAt).toLocaleString()} />}
                      {b.receipt?.terminatedAt && <KV k="Closed" v={new Date(b.receipt.terminatedAt).toLocaleString()} />}
                      <KV k="VM terminated" v={b.receipt?.cleanup?.vmTerminated ? 'verified' : 'NOT verified'} />
                      {b.receipt?.finalSnapshot?.sha256 && <KV k="Snapshot" v={short(b.receipt.finalSnapshot.sha256, 32)} mono />}
                      {b.receipt?.signature && (
                        <KV k="Signed by" v={`${b.receipt.signature.kid ?? '?'} · ${short(String(b.receipt.signature.sig ?? ''), 24)}`} mono />
                      )}
                    </dl>
                  </Section>
                  <Section title="Attestation">
                    {att ? (
                      <dl>
                        {att.profile && <KV k="Profile" v={att.profile} />}
                        {att.policy?.securityLevel && <KV k="Security level" v={att.policy.securityLevel} />}
                        {pre && (
                          <>
                            {typeof pre.nodes === 'number' && <KV k="TEE nodes" v={String(pre.nodes)} />}
                            <KV k="Nonce echoed" v={pre.nonceEchoed ? 'yes' : 'NOT confirmed'} />
                            {(pre.modelTee ?? []).map((a, i) => (
                              <KV key={`m-${i}`} k={i === 0 ? 'Model signer' : ' '} v={short(a, 26)} mono />
                            ))}
                            {(pre.gateway ?? []).map((a, i) => (
                              <KV key={`g-${i}`} k={i === 0 ? 'Gateway signer' : ' '} v={short(a, 26)} mono />
                            ))}
                            {nvidia && (
                              <KV k="NVIDIA GPUs" v={`${nvidia.overall ? 'verified' : 'NOT verified'}${typeof nvidia.gpus === 'number' ? ` · ${nvidia.gpus} GPU(s)` : ''}`} />
                            )}
                          </>
                        )}
                        {checked.length > 0 ? (
                          <KV k="Responses" v={`${checked.filter((m) => m.valid === true).length} of ${checked.length} signature(s) valid`} />
                        ) : (
                          <KV k="Responses" v="none checked" />
                        )}
                        {Array.isArray(att.parsing) && att.parsing.length > 0 ? (
                          <KV k="File reads" v={`${att.parsing.length} non-attested utilit${att.parsing.length === 1 ? 'y' : 'ies'}: ${att.parsing.map((p) => p.path ?? '?').join(', ')}`} />
                        ) : (
                          <KV k="File reads" v="none recorded" />
                        )}
                      </dl>
                    ) : (
                      <p className="text-[13px] text-ink">No attestation evidence retained for this run.</p>
                    )}
                  </Section>
                  <Section title={`Transcript · ${transcript.length} entr${transcript.length === 1 ? 'y' : 'ies'} (decrypted)`}>
                    {transcript.length === 0 ? (
                      <p className="text-[13px] text-ink">No transcript recorded.</p>
                    ) : (
                      <div className="max-h-96 space-y-1.5 overflow-y-auto">
                        {transcript.map((t, i) => (
                          <p key={t.seq ?? i} className="rounded-lg bg-mist px-3 py-2 text-[13px] text-navy">
                            <span className="font-semibold">{t.role === 'user' ? 'You' : 'Sandbox'}: </span>
                            <span className="whitespace-pre-wrap">{String(t.content ?? '').slice(0, 2000)}{String(t.content ?? '').length > 2000 ? '…' : ''}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </Section>
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
