'use client';

import { useCallback, useEffect, useState } from 'react';
import VerificationWidget from '@/components/VerificationWidget';
import { toVerificationReports, type WidgetReport } from '@/lib/verifyReports';
import {
  listSandboxes,
  terminateSandbox,
  verifyReceiptServer,
  type SandboxLive,
} from '@/lib/wayfind';
import { teamEvidence, teamEvidenceList, type ClosedSandboxRun } from '@/lib/team';
import { CopyId, Err } from '../shared';

export default function ConversationsSection() {
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<SandboxLive[] | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [closed, setClosed] = useState<ClosedSandboxRun[] | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [widgetOpen, setWidgetOpen] = useState<Record<string, boolean>>({});
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

  async function toggleWidget(sandboxId: string) {
    const next = !widgetOpen[sandboxId];
    setWidgetOpen((p) => ({ ...p, [sandboxId]: next }));
    if (!next || widgetData[sandboxId]) return;
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
    } finally {
      setWidgetLoading(null);
    }
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
      <p className="text-xs text-ink">Every closed run leaves a signed receipt — same id as in chat.</p>
      <div className="mt-2 space-y-2">
        {(closed ?? []).map((c) => (
          <div key={c.sandboxId} className="rounded-xl border border-navy/10 bg-white px-4 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-navy">
                <CopyId id={c.sandboxId} /> · {c.turns ?? '?'} turn(s){c.receiptClass ? ` · receipt: ${c.receiptClass}` : ''}
              </span>
              <span className="flex shrink-0 gap-1.5">
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
                  onClick={() => void toggleWidget(c.sandboxId)}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-cta shadow-sm ring-1 ring-navy/15 hover:bg-slate-50 disabled:opacity-50"
                >
                  {widgetLoading === c.sandboxId ? 'Loading…' : widgetOpen[c.sandboxId] ? 'Hide NEAR widget' : 'NEAR widget'}
                </button>
              </span>
            </div>
            {verified[c.sandboxId] && (
              <p className={`mt-1 text-xs font-semibold ${verified[c.sandboxId].ok ? 'text-green-700' : 'text-red-700'}`}>
                {verified[c.sandboxId].ok ? 'Signature valid' : 'NOT VERIFIED'} <span className="font-normal text-ink">· {verified[c.sandboxId].detail}</span>
              </p>
            )}
            {widgetOpen[c.sandboxId] && widgetData[c.sandboxId] && (
              <div className="mt-2 rounded-lg bg-mist p-2">
                {'error' in widgetData[c.sandboxId] ? (
                  <p className="text-xs text-red-700">{(widgetData[c.sandboxId] as { error: string }).error}</p>
                ) : (
                  <VerificationWidget reports={(widgetData[c.sandboxId] as { reports: WidgetReport[] }).reports} />
                )}
              </div>
            )}
          </div>
        ))}
        {closed !== null && closed.length === 0 && (
          <p className="text-xs text-ink">No closed runs yet — close a session and its signed receipt lands here.</p>
        )}
      </div>
    </div>
  );
}
