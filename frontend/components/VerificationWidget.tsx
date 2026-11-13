'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { verificationReports } from '@/lib/wayfind';

const VIEWER_ORIGIN = 'https://cloud.near.ai';
const VIEWER_URL = `${VIEWER_ORIGIN}/verify?canRequestReports=true&darkMode=true&showHeader=false`;

// Embedded NEAR Verification Center (iframe + postMessage).
// Two feed modes: conversationId (backend builds VerificationReport[] from
// retained evidence) or reports[] directly (evidence bundles already on the
// client — e.g. inner sandbox runs whose evidence never touches the DB).
// Either way the viewer renders structure only — it never independently
// verifies the evidence. Our own checks (Verify tab / CLI) remain the
// trust anchor.
export default function VerificationWidget({ conversationId, reports: directReports }: { conversationId?: string; reports?: unknown[] }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const requestIdRef = useRef('');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const getReports = useCallback(async () => {
    if (directReports) return directReports;
    if (!conversationId) return [];
    const out = await verificationReports(conversationId);
    return out.reports ?? [];
  }, [conversationId, directReports]);

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
    // The NEAR viewer lives on a third-party origin — if it never phones
    // home (blocked, offline), say so instead of spinning forever.
    const watchdog = setTimeout(() => {
      if (!requestIdRef.current) setTimedOut(true);
    }, 15000);
    return () => {
      requestIdRef.current = '';
      clearTimeout(watchdog);
      window.removeEventListener('message', receive);
      if (iframeRef.current) iframeRef.current.removeAttribute('src');
    };
  }, [getReports]);

  return (
    <div className="mt-2">
      {!ready && !error && !timedOut && <p className="text-xs italic text-ink">Loading NEAR Verification Center…</p>}
      {timedOut && !ready && !error && (
        <p className="text-xs text-ink">NEAR viewer didn&apos;t respond (cloud.near.ai unreachable?) — our own checks above remain the trust anchor.</p>
      )}
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
