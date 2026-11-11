'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { verificationReports } from '@/lib/wayfind';

const VIEWER_ORIGIN = 'https://cloud.near.ai';
const VIEWER_URL = `${VIEWER_ORIGIN}/verify?canRequestReports=true&darkMode=true&showHeader=false`;

// Embedded NEAR Verification Center (iframe + postMessage). Our backend
// supplies VerificationReport[] built from retained evidence; the viewer
// renders structure only — it never independently verifies the evidence.
// Our own checks (Verify tab / CLI) remain the trust anchor.
export default function VerificationWidget({ conversationId }: { conversationId: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const requestIdRef = useRef('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const getReports = useCallback(async () => {
    const out = await verificationReports(conversationId);
    return out.reports ?? [];
  }, [conversationId]);

  useEffect(() => {
    async function receive(event: MessageEvent) {
      if (event.origin !== VIEWER_ORIGIN || event.source !== iframeRef.current?.contentWindow) return;
      const { type, version, requestId } = (event.data ?? {}) as { type?: string; version?: number; requestId?: string };
      if (version !== 1 || !requestId) return;
      if (type !== 'NEAR_AI_VERIFICATION_CENTER_READY' && type !== 'NEAR_AI_REQUEST_VERIFICATION_REPORT') return;
      requestIdRef.current = requestId;
      setReady(true);
      try {
        const reports = await getReports();
        if (requestIdRef.current !== requestId) return;
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'NEAR_AI_VERIFICATION_REPORT', version: 1, requestId, reports },
          VIEWER_ORIGIN,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    window.addEventListener('message', receive);
    if (iframeRef.current) iframeRef.current.src = VIEWER_URL;
    return () => {
      requestIdRef.current = '';
      window.removeEventListener('message', receive);
      if (iframeRef.current) iframeRef.current.removeAttribute('src');
    };
  }, [getReports]);

  return (
    <div className="mt-2">
      {!ready && !error && <p className="text-xs italic text-ink">Loading NEAR Verification Center…</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
      <iframe
        ref={iframeRef}
        title="NEAR AI Verification Center"
        allow="clipboard-write"
        referrerPolicy="no-referrer"
        style={{ width: '100%', maxWidth: 720, height: '60vh', border: 0 }}
      />
      <p className="mt-1 text-xs text-ink">Third-party view of our retained evidence. Structure display only — trust our own checks.</p>
    </div>
  );
}
