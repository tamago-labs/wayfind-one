'use client';

import { useEffect, useRef, useState } from 'react';
import VerificationDrawer from '../VerificationDrawer';
import { checkReceipt } from '@/lib/receipt';
import { toVerificationReports, type WidgetReport } from '@/lib/verifyReports';
import { listConversations, verifyReceiptServer } from '@/lib/wayfind';
import { teamEvidence } from '@/lib/team';
import { Err } from '../shared';

type BundleEvidence = {
  receipt?: { model?: string };
  evidence?: { botEvidence?: Parameters<typeof toVerificationReports>[1] };
};

export default function VerifySection({ initialId }: { initialId?: string | null }) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<ReturnType<typeof checkReceipt> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [serverCheck, setServerCheck] = useState<{ valid?: boolean; kid?: string; signerMatch?: boolean; checks?: Array<{ name: string; pass: boolean; detail?: string }>; reason?: string } | null>(null);
  const [widgetReports, setWidgetReports] = useState<WidgetReport[] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function runWith(raw: string) {
    setError(null);
    setResult(null);
    setServerCheck(null);
    setWidgetReports(null);
    setDrawerOpen(false);
    const trimmed = raw.trim();
    if (!trimmed) {
      setError('Paste a receipt JSON or a sandbox id.');
      return;
    }
    try {
      let receipt: unknown = null;
      let bundle: BundleEvidence | null = null;
      if (trimmed.startsWith('{')) {
        receipt = JSON.parse(trimmed);
      } else if (/^microvm-[A-Za-z0-9-]+$/.test(trimmed)) {
        // Inner sandbox run: receipt lives in the outer's stored evidence
        // bundle (same id you see in chat and the Sessions tab).
        try {
          const out = await teamEvidence(trimmed);
          bundle = (out.evidence as unknown as BundleEvidence | null) ?? null;
          receipt = (out.evidence as { receipt?: unknown })?.receipt ?? null;
        } catch {
          receipt = null;
        }
        if (!receipt) {
          setError('No stored evidence for that sandbox yet — close the session first (Sessions → Close), then verify.');
          return;
        }
      } else {
        const convs = await listConversations();
        const conv = convs.find((c) => c.conversationId === trimmed);
        if (!conv?.receipt) {
          setError('No receipt on that sandbox (only closed ones carry one).');
          return;
        }
        receipt = conv.receipt;
      }
      setResult(checkReceipt(receipt as never));
      if ((receipt as { class?: string; signature?: { sig?: string } })?.class === 'signed') {
        setChecking(true);
        try {
          const check = await verifyReceiptServer(receipt);
          setServerCheck(check);
          if (bundle && check.valid === true) {
            const r = receipt as { model?: string };
            const model = typeof r.model === 'string' && r.model ? r.model : 'Qwen/Qwen3.8-27B';
            setWidgetReports(toVerificationReports(model, bundle.evidence?.botEvidence ?? null));
          }
        } finally {
          setChecking(false);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function run() {
    await runWith(input);
  }

  // Deep link from an evidence card: prefill + auto-run once per id.
  const autoRan = useRef<string | null>(null);
  useEffect(() => {
    if (initialId && autoRan.current !== initialId) {
      autoRan.current = initialId;
      setInput(initialId);
      void runWith(initialId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  return (
    <div>
      <p className="text-sm text-ink">Paste a receipt, or a sandbox id (microvm-…), and we&apos;ll check its signature. Signed receipts also open in the NEAR Verification Center below.</p>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        placeholder='Paste receipt JSON or a sandbox id (microvm-…)'
        className="mt-4 w-full rounded-xl border border-navy/15 bg-white px-3 py-2 font-mono text-xs text-navy"
      />
      <button onClick={run} className="mt-2 rounded-lg bg-cta px-4 py-2 text-sm text-white hover:bg-ctahover">
        Verify
      </button>
      <Err message={error} />
      {checking && <p className="mt-2 text-xs italic text-ink">Checking signature…</p>}
      {serverCheck && (
        <div className="mt-4 rounded-xl border border-navy/10 bg-white p-4">
          <p className="text-sm font-semibold text-navy">Wayfind signature check</p>
          {(serverCheck.checks ?? []).map((c) => (
            <p key={c.name} className="text-sm">
              <span className={c.pass ? 'text-green-700' : 'text-red-700'}>{c.pass ? 'PASS' : 'FAIL'}</span>
              <span className="text-navy"> {c.name}</span>
              {c.detail && <span className="text-ink"> — {c.detail}</span>}
            </p>
          ))}
          {serverCheck.reason && <p className="text-sm text-ink">{serverCheck.reason}</p>}
          <p className={`mt-1 text-sm font-semibold ${serverCheck.valid ? 'text-green-700' : 'text-red-700'}`}>
            {serverCheck.valid ? 'SIGNATURE VALID' : 'SIGNATURE NOT VERIFIED'}
          </p>
          {serverCheck.valid && widgetReports && (
            <button onClick={() => setDrawerOpen(true)} className="mt-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-cta shadow-sm ring-1 ring-navy/15 hover:bg-slate-50">
              Open in NEAR Verification Center
            </button>
          )}
        </div>
      )}
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
      <VerificationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} reports={widgetReports} />
    </div>
  );
}
