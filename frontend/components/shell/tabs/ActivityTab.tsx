'use client';

import { useCallback, useEffect, useState } from 'react';
import { listAudit, type AuditEvent } from '@/lib/wayfind';
import { CopyId, Err, downloadEvidenceBundle } from '../shared';

export default function ActivitySection() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await listAudit({ conversationId: filter.trim() || undefined, limit: 100 });
      setEvents(out.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [filter]);

  useEffect(() => {
    refresh();
  }, []);

  async function download(convId: string) {
    setExporting(convId);
    setError(null);
    try {
      await downloadEvidenceBundle(convId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <p className="text-sm text-ink">Append-only audit trail. Evidence bundles download as JSON (sealed blobs decrypt with <span className="font-mono">wayfind evidence --decrypt</span> or the history view).</p>
      <div className="mt-4 flex gap-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by sandbox id…" className="w-80 rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy" />
        <button onClick={refresh} disabled={busy} className="rounded-lg bg-cta px-4 py-2 text-sm text-white hover:bg-ctahover disabled:opacity-50">Refresh</button>
      </div>
      <Err message={error} />
      <div className="mt-4 space-y-1">
        {(events ?? []).map((e, i) => (
          <div key={`${e.at}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-navy/10 bg-white px-3 py-2 text-xs">
            <span className="font-mono text-ink">{e.at ? new Date(e.at).toLocaleString() : '?'}</span>
            <span className="rounded-full bg-mist px-2 py-0.5 text-navy">{e.action}</span>
            {e.conversationId && (
              <>
                <CopyId id={e.conversationId} />
                <button
                  onClick={() => download(e.conversationId as string)}
                  disabled={exporting !== null}
                  className="rounded border border-navy/15 px-2 py-0.5 text-ink hover:bg-mist disabled:opacity-50"
                >
                  {exporting === e.conversationId ? 'Exporting…' : 'Evidence'}
                </button>
              </>
            )}
            {e.detail != null && <span className="truncate text-ink">{JSON.stringify(e.detail).slice(0, 140)}</span>}
          </div>
        ))}
        {events !== null && events.length === 0 && <p className="text-sm text-ink">No audit events yet.</p>}
      </div>
    </div>
  );
}
