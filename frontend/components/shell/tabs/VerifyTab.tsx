'use client';

import { useState } from 'react';
import { checkReceipt } from '@/lib/receipt';
import { listConversations, verifyReceiptServer } from '@/lib/wayfind';
import { Err } from '../shared';

export default function VerifySection() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<ReturnType<typeof checkReceipt> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [serverCheck, setServerCheck] = useState<{ valid?: boolean; kid?: string; signerMatch?: boolean; checks?: Array<{ name: string; pass: boolean; detail?: string }>; reason?: string } | null>(null);
  const [checking, setChecking] = useState(false);

  async function run() {
    setError(null);
    setResult(null);
    setServerCheck(null);
    const trimmed = input.trim();
    if (!trimmed) {
      setError('Paste a receipt JSON or a conversation id.');
      return;
    }
    try {
      let receipt: unknown = null;
      if (trimmed.startsWith('{')) {
        receipt = JSON.parse(trimmed);
      } else {
        const convs = await listConversations();
        const conv = convs.find((c) => c.conversationId === trimmed);
        if (!conv?.receipt) {
          setError('No receipt on that conversation (only closed ones carry one).');
          return;
        }
        receipt = conv.receipt;
      }
      setResult(checkReceipt(receipt as never));
      if ((receipt as { class?: string; signature?: { sig?: string } })?.class === 'signed') {
        setChecking(true);
        try {
          setServerCheck(await verifyReceiptServer(receipt));
        } finally {
          setChecking(false);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <p className="text-sm text-ink">Same checks as <span className="font-mono">wayfind verify</span> — v0 receipts are integrity-checked, not yet signed (Phase 2).</p>
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
      {checking && <p className="mt-2 text-xs italic text-ink">Checking control-plane signature…</p>}
      {serverCheck && (
        <div className="mt-4 rounded-xl border border-navy/10 bg-white p-4">
          <p className="text-sm font-semibold text-navy">Control-plane signature (server-checked — true offline check is the CLI)</p>
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
    </div>
  );
}
