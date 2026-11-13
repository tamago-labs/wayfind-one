'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cpu, Boxes, Trash2, X } from 'lucide-react';
import Mascot from '@/components/Mascot';
import type { BotEdits, TeamBot } from '@/lib/team';
import { listSandboxes, terminateSandbox, type SandboxLive } from '@/lib/wayfind';
import BotEditModal from './BotEditModal';
import DeleteBotModal from './DeleteBotModal';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-white px-4 py-2.5 shadow-sm">
      <span className="shrink-0 text-sm font-semibold text-navy/50">{label}</span>
      {children}
    </div>
  );
}

function ComputerTab({ bot }: { bot: TeamBot }) {
  return (
    <div className="space-y-2 text-sm">
      <Row label="Bot ID">
        <span className="max-w-[10rem] truncate font-mono text-xs text-navy" title={bot.id}>{bot.id}</span>
      </Row>
      <Row label="Model">
        <span className="text-sm font-bold text-navy">{bot.model || 'Meta open-weight'}</span>
      </Row>
      <Row label="Status">
        <span className={`text-sm font-bold ${bot.status === 'paused' ? 'text-bamber' : 'text-green-700'}`}>
          {bot.status || 'active'}
        </span>
      </Row>
      <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-cta">NEAR AI · private inference</p>
        <dl className="mt-2 space-y-1.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-navy/50">Provider</dt>
            <dd className="font-semibold text-navy">NEAR AI Cloud</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-navy/50">Sandbox model</dt>
            <dd className="font-mono text-xs text-navy">Qwen/Qwen3.8-27B</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-navy/50">Checks</dt>
            <dd className="text-right font-semibold text-navy">TEE attestation + NVIDIA GPUs, every response signed</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function SandboxTab() {
  const [live, setLive] = useState<SandboxLive[] | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const out = await listSandboxes();
      setLive(out.sandboxes ?? []);
    } catch {
      setLive([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between px-1">
        <h4 className="text-xs font-bold uppercase tracking-wide text-navy/50">Open sessions</h4>
        <button onClick={() => void refresh()} className="text-xs font-bold text-cta hover:text-ctahover">
          Refresh
        </button>
      </div>
      {error && <p className="px-1 text-xs font-medium text-red-600">{error}</p>}
      {(live ?? []).map((s) => (
        <div key={s.sandboxId} className="flex items-center justify-between gap-2 rounded-xl bg-white px-4 py-2.5 shadow-sm">
          <span className="min-w-0">
            <span className="block truncate font-mono text-xs text-navy" title={s.sandboxId}>{s.sandboxId}</span>
            <span className="block text-[11px] text-navy/50">{s.profile} · {s.policy}</span>
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
                void refresh();
              }
            }}
            className="shrink-0 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90 disabled:opacity-50"
          >
            {closing === s.sandboxId ? 'Closing…' : 'Close'}
          </button>
        </div>
      ))}
      {live !== null && live.length === 0 && (
        <p className="rounded-xl bg-white px-4 py-3 text-xs text-navy/50 shadow-sm">
          No open sessions — ask this bot to run something sensitive and it appears here.
        </p>
      )}
    </div>
  );
}

type Tab = 'computer' | 'sandbox';

interface BotPanelProps {
  open: boolean;
  onClose: () => void;
  bot: TeamBot | null;
  onSave: (id: string, edits: BotEdits) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
}

const TABS: Array<{ id: Tab; label: string; icon: typeof Cpu }> = [
  { id: 'computer', label: 'Computer', icon: Cpu },
  { id: 'sandbox', label: 'Sandbox', icon: Boxes },
];

export default function BotPanel({ open, onClose, bot, onSave, onDelete }: BotPanelProps) {
  const [tab, setTab] = useState<Tab>('computer');
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div
      className={`shrink-0 overflow-hidden border-navy/10 bg-ice transition-all duration-200 ${
        open ? 'fixed inset-y-0 right-0 z-30 w-80 border-l md:static' : 'w-0'
      }`}
      aria-hidden={!open}
    >
      <div className="flex h-full w-80 flex-col p-5">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete Bot"
            title="Delete Bot"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-red-600 shadow-sm hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2.2} />
          </button>
          <button
            onClick={onClose}
            aria-label="Close Bot settings"
            className="grid h-9 w-9 place-items-center rounded-full bg-white text-navy shadow-sm hover:bg-slate-50"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
        {bot && (
          <>
            <button
              onClick={() => setEditOpen(true)}
              aria-label="Edit Bot appearance"
              title="Edit name, role, color and shape"
              className="mx-auto mt-5 rounded-full transition hover:opacity-80"
            >
              <Mascot color={bot.color ?? 'amber'} shape={bot.shape ?? 'blob'} size="lg" motion="none" />
            </button>
            <p className="mt-5 truncate text-center text-lg font-bold text-navy">
              {bot.name} <span className="text-sm font-medium text-navy/50">· {bot.role || 'No role yet'}</span>
            </p>
            <div className="mt-4 flex gap-1 rounded-xl bg-white p-1 shadow-sm">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${
                    tab === id ? 'bg-navy text-white' : 'text-navy/50 hover:text-navy'
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2.2} />
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {tab === 'computer' ? <ComputerTab bot={bot} /> : <SandboxTab />}
            </div>
            <DeleteBotModal
              open={deleteOpen}
              botName={bot.name}
              onClose={() => setDeleteOpen(false)}
              onDelete={async () => {
                const err = await onDelete(bot.id);
                if (!err) {
                  setDeleteOpen(false);
                  onClose();
                }
                return err;
              }}
            />
            <BotEditModal
              open={editOpen}
              onClose={() => setEditOpen(false)}
              initial={{
                name: bot.name,
                role: bot.role ?? '',
                isChiefOfStaff: bot.isChiefOfStaff ?? false,
                color: bot.color ?? 'amber',
                shape: bot.shape ?? 'blob',
              }}
              onSave={async (edits) => {
                const err = await onSave(bot.id, edits);
                if (!err) {
                  setEditOpen(false);
                  onClose();
                }
                return err;
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
