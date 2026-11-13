'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { dataClient } from '@/lib/data';

type RangeKey = 'day' | 'week' | 'month';

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

interface UsageModalProps {
  open: boolean;
  onClose: () => void;
  ownerId: string | null;
}

function fmtMoney(v: number): string {
  const a = Math.abs(v);
  return `$${a.toFixed(a < 1 ? 3 : 2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(d);
}

function shortModel(m?: string): string {
  if (!m) return 'Unknown model';
  const base = m.split('/').pop() ?? m;
  return base.length > 28 ? `${base.slice(0, 27)}…` : base;
}

interface ParsedUsage {
  model?: string;
  kind?: string;
  inTokens?: number;
  outTokens?: number;
  tools?: number;
}

/** Reason lines look like: model usage run=<id> provider=… model=… kind=chat
 * 320 chars tokens=144261in/1055out tools=7 durationMs=1696 — parse them into
 * stats; anything else only counts toward billing. */
function parseReason(reason?: string | null): ParsedUsage | null {
  if (!reason || !reason.startsWith('model usage ')) return null;
  const str = (re: RegExp): string | undefined => {
    const m = reason.match(re);
    return m ? m[1] : undefined;
  };
  const num = (re: RegExp): number | undefined => {
    const m = reason.match(re);
    return m ? Number(m[1]) : undefined;
  };
  const tokens = reason.match(/tokens=(\d+)in\/(\d+)out/);
  return {
    model: str(/model=(\S+)/),
    kind: str(/kind=(\S+)/),
    inTokens: tokens ? Number(tokens[1]) : undefined,
    outTokens: tokens ? Number(tokens[2]) : undefined,
    tools: num(/tools=(\d+)/),
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0">
      <span className="block truncate text-base font-bold text-navy">{value}</span>
      <span className="block text-[11px] text-heroslate">{label}</span>
    </span>
  );
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Usage modal (wayfind-cloud Roster UsageModal parity, recharts replaced
 * with CSS bars): billed-this-month header, day/week/month ranges, token
 * stats, per-bucket bars, top-models breakdown. Reads the shared
 * CreditLedger via the cross-repo data client — usage events from this
 * computer already land there through the usage-token reporter. */
export default function UsageModal({ open, onClose, ownerId }: UsageModalProps) {
  const [rows, setRows] = useState<Array<{
    id: string; delta?: number | null; reason?: string | null; createdAt?: string | null;
  }> | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [range, setRange] = useState<RangeKey>('week');

  useEffect(() => {
    if (!open || !ownerId) return;
    let alive = true;
    setRows(null);
    setError('');
    void (async () => {
      try {
        const { data, errors } = await dataClient().models.CreditLedger.ledgerByOwnerId({ ownerId }, { limit: 200 });
        if (!alive) return;
        if (errors) throw new Error('Could not load usage');
        const list = [...(data ?? [])].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        setRows(list);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Could not load usage');
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, ownerId, attempt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const inWindow = (iso?: string | null): boolean => {
    const t = new Date(iso ?? 0).getTime();
    if (Number.isNaN(t)) return false;
    if (range === 'day') return t >= todayStart;
    const days = range === 'week' ? 7 : 30;
    return t >= todayStart - (days - 1) * 86400_000;
  };

  const allParsed = (rows ?? []).map((r) => ({ row: r, p: parseReason(r.reason) }));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthRows = allParsed.filter((x) => {
    const t = new Date(x.row.createdAt ?? 0).getTime();
    return !Number.isNaN(t) && t >= monthStart;
  });
  const monthBilled = Math.abs(monthRows.reduce((sum, x) => sum + (x.row.delta ?? 0), 0));
  const monthTokens = monthRows.reduce((s, x) => s + (x.p?.inTokens ?? 0) + (x.p?.outTokens ?? 0), 0);
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(now);
  const scoped = allParsed.filter((x) => inWindow(x.row.createdAt));
  const modelRows = scoped.filter((x) => x.p);
  const inT = modelRows.reduce((s, x) => s + (x.p?.inTokens ?? 0), 0);
  const outT = modelRows.reduce((s, x) => s + (x.p?.outTokens ?? 0), 0);
  const toolCalls = modelRows.reduce((s, x) => s + (x.p?.tools ?? 0), 0);

  // Tokens-per-bucket bar data (zero-filled so the chart reads professionally).
  interface Bucket {
    label: string;
    tokens: number;
  }
  let buckets: Bucket[] = [];
  if (range === 'day') {
    for (let h = 0; h < 24; h++) {
      buckets.push({ label: `${h}:00`, tokens: 0 });
    }
    for (const { row: r, p } of modelRows) {
      const t = new Date(r.createdAt ?? 0).getTime();
      if (Number.isNaN(t) || t < todayStart) continue;
      const h = Math.min(23, Math.floor((t - todayStart) / 3600_000));
      buckets[h].tokens += (p?.inTokens ?? 0) + (p?.outTokens ?? 0);
    }
  } else {
    const days = range === 'week' ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      buckets.push({ label: fmtDay(new Date(todayStart - i * 86400_000)), tokens: 0 });
    }
    for (const { row: r, p } of modelRows) {
      const t = new Date(r.createdAt ?? 0).getTime();
      if (Number.isNaN(t)) continue;
      const idx = Math.round((startOfDay(new Date(t)).getTime() - (todayStart - (days - 1) * 86400_000)) / 86400_000);
      if (idx < 0 || idx >= days) continue;
      buckets[idx].tokens += (p?.inTokens ?? 0) + (p?.outTokens ?? 0);
    }
  }
  const bucketMax = Math.max(1, ...buckets.map((b) => b.tokens));

  const modelMap = new Map<string, { tokens: number; runs: number }>();
  for (const { p } of modelRows) {
    const m = p?.model ?? 'unknown';
    const cur = modelMap.get(m) ?? { tokens: 0, runs: 0 };
    cur.tokens += (p?.inTokens ?? 0) + (p?.outTokens ?? 0);
    cur.runs += 1;
    modelMap.set(m, cur);
  }
  const modelSorted = Array.from(modelMap.entries()).sort((a, b) => b[1].tokens - a[1].tokens);
  const modelTop = modelSorted.slice(0, 4);
  const modelMax = Math.max(1, ...modelTop.map(([, v]) => v.tokens));

  const rangeNoun = range === 'day' ? 'today' : range === 'week' ? 'this week' : 'this month';

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Usage"
          >
            <div className="flex items-center justify-between p-5 pb-3">
              <h3 className="font-brico text-lg font-bold text-navy">Usage</h3>
              <button
                onClick={onClose}
                aria-label="Close usage"
                className="grid h-8 w-8 place-items-center rounded-full text-heroslate hover:bg-ice hover:text-navy"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 pb-3">
              {rows === null && !error ? (
                <p className="mt-1 text-3xl font-bold text-navy">…</p>
              ) : (
                <>
                  <p className="mt-1 text-3xl font-bold text-navy">{fmtMoney(monthBilled)}</p>
                  <p className="mt-0.5 text-xs font-semibold text-heroslate">
                    Billed in {monthName} · {monthRows.length} runs · {fmtTokens(monthTokens)} tokens
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-1 rounded-full bg-ice p-1" role="tablist" aria-label="Usage range">
                    {RANGES.map((r) => (
                      <button
                        key={r.key}
                        role="tab"
                        aria-selected={range === r.key}
                        onClick={() => setRange(r.key)}
                        className={`rounded-full py-1.5 text-xs font-bold transition ${
                          range === r.key ? 'bg-navy text-white' : 'text-heroslate hover:text-navy'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-4">
                    <Stat label="Tokens in" value={fmtTokens(inT)} />
                    <Stat label="Tokens out" value={fmtTokens(outT)} />
                    <Stat label="Tool calls" value={`${toolCalls}`} />
                  </div>
                </>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
              {rows === null && !error && <p className="py-4 text-center text-xs text-heroslate">Loading usage…</p>}
              {error && (
                <div className="py-4 text-center">
                  <p className="text-xs font-semibold text-red-600">{error}</p>
                  <button
                    onClick={() => setAttempt((a) => a + 1)}
                    className="mt-2 rounded-full bg-ice px-4 py-1.5 text-xs font-bold text-navy"
                  >
                    Retry
                  </button>
                </div>
              )}
              {rows !== null && scoped.length === 0 && !error && (
                <p className="py-4 text-center text-xs text-heroslate">No usage {rangeNoun}.</p>
              )}
              {rows !== null && scoped.length > 0 && (
                <>
                  <p className="mt-1 text-[11px] font-semibold text-heroslate">
                    Tokens per {range === 'day' ? 'hour' : 'day'} · {rangeNoun}
                  </p>
                  <div className="mt-2 flex h-28 items-end gap-1" role="img" aria-label={`Tokens per ${range === 'day' ? 'hour' : 'day'}`}>
                    {buckets.map((b, i) => (
                      <div
                        key={i}
                        title={`${b.label}: ${fmtTokens(b.tokens)} tokens`}
                        className="min-w-0 flex-1 rounded-t bg-cta/80 hover:bg-cta"
                        style={{ height: `${Math.max(4, (b.tokens / bucketMax) * 100)}%` }}
                      />
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-heroslate">
                    <span>{buckets[0]?.label}</span>
                    <span>{buckets[buckets.length - 1]?.label}</span>
                  </div>
                  {modelTop.length > 0 && (
                    <>
                      <p className="mt-3 text-[11px] font-semibold text-heroslate">Top models · {rangeNoun}</p>
                      <div className="mt-1 space-y-1.5">
                        {modelTop.map(([m, v]) => (
                          <div key={m} title={`${fmtTokens(v.tokens)} tokens · ${v.runs} runs`}>
                            <div className="flex justify-between text-xs">
                              <span className="truncate font-bold text-navy">{shortModel(m)}</span>
                              <span className="ml-2 shrink-0 text-heroslate">{fmtTokens(v.tokens)}</span>
                            </div>
                            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-ice">
                              <div className="h-full rounded-full bg-cta/80" style={{ width: `${Math.max(3, (v.tokens / modelMax) * 100)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end p-4 pt-2">
              <button
                onClick={onClose}
                className="rounded-full bg-navy px-5 py-2 text-sm font-bold text-white hover:bg-navy/90"
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
