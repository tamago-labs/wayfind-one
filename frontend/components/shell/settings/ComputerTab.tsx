'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cloud, RotateCcw } from 'lucide-react';
import { requestComputer, restartOuterComputer, computerAction, type ComputerRow } from '@/lib/computer';
import { listTeamBots, outerReady } from '@/lib/team';
import TabHeader from './TabHeader';

function short(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 13 ? `${id.slice(0, 8)}…` : id;
}

function hostOf(endpoint: string | null | undefined): string {
  if (!endpoint) return '—';
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint.length > 40 ? `${endpoint.slice(0, 40)}…` : endpoint;
  }
}

const STATUS_DOT: Record<string, string> = {
  running: 'bg-emerald-500',
  suspended: 'bg-bamber',
  provisioning: 'bg-cta animate-pulse',
  terminated: 'bg-slate-400',
  not_provisioned: 'bg-slate-400',
};

/** Outer computer overview: live status, identity, team summary, safe reboot. */
export default function ComputerTab() {
  const [row, setRow] = useState<ComputerRow | null>(null);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [team, setTeam] = useState<{ count: number; chief: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [{ data }, ready, bots] = await Promise.all([
        requestComputer('one_outer'),
        outerReady().catch(() => null),
        listTeamBots().catch(() => [] as Awaited<ReturnType<typeof listTeamBots>>),
      ]);
      setRow(data);
      setInitialized(ready ? ready.initialized : null);
      const active = bots.filter((b) => b.status !== 'paused');
      setTeam({ count: active.length, chief: active.find((b) => b.isChiefOfStaff)?.name ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRestart = async () => {
    if (
      !window.confirm(
        'Restart your computer? Your team is saved first, then it reboots fresh from the latest image (about a minute).',
      )
    )
      return;
    setRestarting(true);
    try {
      try {
        await restartOuterComputer();
      } catch (e) {
        if (
          !window.confirm(
            `Could not save the workspace first (${e instanceof Error ? e.message : String(e)}). Terminate anyway? Unsaved changes may be lost.`,
          )
        ) {
          setRestarting(false);
          return;
        }
        await computerAction('terminate', 'one_outer');
      }
      window.location.reload();
    } catch (e) {
      window.alert(`Restart failed: ${e instanceof Error ? e.message : String(e)}`);
      setRestarting(false);
    }
  };

  if (error && !row) {
    return <p className="p-5 text-sm font-medium text-red-600">{error}</p>;
  }
  if (!row) {
    return <p className="p-5 text-sm text-navy/50">Loading computer…</p>;
  }

  const status = row.provisionStatus;

  return (
    <div className="space-y-4 p-5">
      <TabHeader
        title="Computer"
        sub="Your persistent cloud computer. Suspend keeps it ready; restart boots it fresh from the latest image."
        action={
          <button
            onClick={() => void load()}
            disabled={busy}
            className="rounded-full border border-navy/15 px-3 py-1 text-xs font-bold text-navy hover:bg-ice disabled:opacity-50"
          >
            Refresh
          </button>
        }
      />
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <div className="rounded-xl border border-navy/10 bg-ice p-3">
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-navy" strokeWidth={2.2} />
          <h4 className="font-brico text-sm font-bold text-navy">Outer computer</h4>
          <span className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold text-navy">
            <i className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] ?? 'bg-slate-400'}`} />
            {status.replace(/_/g, ' ')}
          </span>
        </div>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-navy/50">Computer</dt>
            <dd className="truncate font-mono text-xs text-navy" title={row.id}>{short(row.id)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-navy/50">MicroVM</dt>
            <dd className="truncate font-mono text-xs text-navy" title={row.microvmId ?? ''}>{short(row.microvmId)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-navy/50">Endpoint</dt>
            <dd className="truncate font-mono text-xs text-navy" title={row.endpoint ?? ''}>{hostOf(row.endpoint)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-navy/50">Server ready</dt>
            <dd className="font-semibold text-navy">{initialized === null ? 'unknown' : initialized ? 'yes' : 'starting…'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-navy/50">Team</dt>
            <dd className="font-semibold text-navy">
              {team === null ? '…' : `${team.count} bot${team.count === 1 ? '' : 's'}${team.chief ? ` · chief ${team.chief}` : ''}`}
            </dd>
          </div>
        </dl>
      </div>
      <button
        onClick={onRestart}
        disabled={restarting || busy}
        className="flex items-center gap-2 rounded-full border-2 border-navy px-4 py-1.5 text-xs font-bold text-navy hover:bg-navy hover:text-white disabled:opacity-50"
      >
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.4} />
        {restarting ? 'Restarting…' : 'Restart computer'}
      </button>
      <p className="text-xs text-navy/50">
        Restart saves your team first, then boots fresh — use it after an image update or when the computer misbehaves.
      </p>
    </div>
  );
}
