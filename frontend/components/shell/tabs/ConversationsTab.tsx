'use client';

import { useCallback, useEffect, useState } from 'react';
import VerificationDrawer from '../VerificationDrawer';
import EvidenceDrawer from '../EvidenceDrawer';
import { toVerificationReports, type WidgetReport } from '@/lib/verifyReports';
import {
  listSandboxes,
  terminateSandbox,
  verifyReceiptServer,
  type SandboxLive,
} from '@/lib/wayfind';
import { teamEvidence, teamEvidenceList, type ClosedSandboxRun } from '@/lib/team';
import { CopyId, Err } from '../shared';

function relTime(iso: string | null): string {
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

function fmtDuration(ms: number | null): string | null {
  if (typeof ms !== 'number' || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function shortModel(m: string | null): string | null {
  if (!m) return null;
  const parts = m.split('/');
  return parts[parts.length - 1] || m;
}export default function ConversationsSection() {
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<SandboxLive[] | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [closed, setClosed] = useState<ClosedSandboxRun[] | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [evId, setEvId] = useState<string | null>(null);
  const [evBundle, setEvBundle] = useState<Record<string, unknown> | null>(null);
  const [evLoading, setEvLoading] = useState<string | null>(null);
  const [widgetData, setWidgetData] = useState<Record<string, { reports: WidgetReport[] } | { error: string }>>({});
  const [widgetLoading, setWidgetLoading] = useState<string | null>(null);

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

  async function openEvidence(sandboxId: string) {
    setEvLoading(sandboxId);
    try {
      const out = await teamEvidence(sandboxId);
      const ev = (out.evidence ?? null) as Record<string, unknown> | null;
      if (ev) {
        setEvBundle(ev);
        setEvId(sandboxId);
      } else {
        setError('No stored evidence for that sandbox yet — close the session first (Sessions → Close).');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEvLoading(null);
    }
  }

  async function openDrawer(sandboxId: string) {
    if (!widgetData[sandboxId]) {
      setWidgetLoading(sandboxId);
      try {
        const out = await teamEvidence(sandboxId);
        // Stored bundle nests the inner attestations two levels down:
        // { receipt, evidence: { checkpoint, botEvidence: { preflight, … } } }.
        const stored = (out.evidence ?? {}) as {
          receipt?: { model?: string };
          evidence?: { botEvidence?: Parameters<typeof toVerificationReports>[1] };
        };
        const model = typeof stored.receipt?.model === 'string' && stored.receipt.model ? stored.receipt.model : 'Qwen/Qwen3.8-27B';
        setWidgetData((p) => ({ ...p, [sandboxId]: { reports: toVerificationReports(model, stored.evidence?.botEvidence ?? null) } }));
      } catch (e) {
        setWidgetData((p) => ({ ...p, [sandboxId]: { error: e instanceof Error ? e.message : String(e) } }));
        return;
      } finally {
        setWidgetLoading(null);
      }
    } else if ('error' in widgetData[sandboxId]) {
      return;
    }
    setDrawerId(sandboxId);
  }

  useEffect(() => {
    refreshLive();
    const timer = setInterval(() => void refreshLive(), 15000);
    return () => clearInterval(timer);
  }, [refreshLive]);

  return (
    <div>
      <p className="text-sm font-semibold text-navy">Live inner sandboxes</p>
      <p className="text-xs text-ink">Open sessions from team escalations — they stay here until closed.</p>
      <Err message={error} />
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
          <p className="text-xs text-ink">No open sessions — ask your team to run something and it appears here.</p>
        )}
      </div>
      <p className="mt-4 text-sm font-semibold text-navy">Recent closed sandboxes</p>
      <p className="text-xs text-ink">Every closed run leaves a signed receipt — verified below, viewable in full anytime.</p>
      <div className="mt-2 space-y-2">
        {(closed ?? []).map((c) => {
          const dur = fmtDuration(c.durationMs);
          const sub = [
            c.closedAt ? `Closed ${relTime(c.closedAt)}` : null,
            dur,
            c.stepsTotal > 0 ? `${c.stepsVerified} of ${c.stepsTotal} steps verified` : c.turns != null ? `${c.turns} turn(s)` : null,
            shortModel(c.model),
          ].filter(Boolean).join(' · ');
          return (
            <div key={c.sandboxId} className="rounded-xl border border-navy/10 bg-white px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-navy" title={c.task ?? undefined}>
                    {c.task ?? 'Sandbox run'}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink">
                    <span>{sub}</span>
                    {c.receiptClass && (
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${c.receiptClass === 'signed' ? 'bg-green-100 text-green-800' : 'bg-bamber/30 text-navy'}`}>
                        Receipt {c.receiptClass}
                      </span>
                    )}
                    <CopyId id={c.sandboxId} />
                  </span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={evLoading === c.sandboxId}
                    onClick={() => void openEvidence(c.sandboxId)}
                    className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy shadow-sm ring-1 ring-navy/15 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {evLoading === c.sandboxId ? 'Loading…' : 'Evidence'}
                  </button>
                  <button
                    type="button"
                    disabled={verifying === c.sandboxId}
                    onClick={() => void verifyClosed(c.sandboxId)}
                    className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy shadow-sm ring-1 ring-navy/15 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {verifying === c.sandboxId ? 'Checking…' : 'Verify'}
                  </button>
                  <button
                    type="button"
                    disabled={widgetLoading === c.sandboxId}
                    onClick={() => void openDrawer(c.sandboxId)}
                    className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-cta shadow-sm ring-1 ring-navy/15 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {widgetLoading === c.sandboxId ? 'Loading…' : 'NEAR widget'}
                  </button>
                </span>
              </div>
              {verified[c.sandboxId] && (
                <p className={`mt-1 text-xs font-semibold ${verified[c.sandboxId].ok ? 'text-green-700' : 'text-red-700'}`}>
                  {verified[c.sandboxId].ok ? 'Signature verified · signed by Wayfind' : `NOT VERIFIED · ${verified[c.sandboxId].detail}`}
                </p>
              )}
              {widgetData[c.sandboxId] && 'error' in widgetData[c.sandboxId] && (
                <p className="mt-1 text-xs text-red-700">{(widgetData[c.sandboxId] as { error: string }).error}</p>
              )}
            </div>
          );
        })}
        {closed !== null && closed.length === 0 && (
          <p className="text-xs text-ink">No closed runs yet — close a session and its signed receipt lands here.</p>
        )}
      </div>
      <VerificationDrawer
        open={drawerId !== null}
        onClose={() => setDrawerId(null)}
        reports={drawerId !== null && widgetData[drawerId] && !('error' in widgetData[drawerId]) ? (widgetData[drawerId] as { reports: WidgetReport[] }).reports : null}
      />
      <EvidenceDrawer open={evId !== null} onClose={() => { setEvId(null); setEvBundle(null); }} bundle={evBundle} sandboxId={evId ?? undefined} />
    </div>
  );
}
