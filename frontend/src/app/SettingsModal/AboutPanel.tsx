import type { Status } from '../../lib/api'

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-navy/10 py-2 text-sm">
      <span className="shrink-0 text-heroslate">{label}</span>
      {mono ? (
        <code className="truncate font-mono text-xs" title={value}>{value}</code>
      ) : (
        <span className="truncate text-sm font-semibold" title={value}>{value}</span>
      )}
    </div>
  )
}

function statusColor(state?: string): string {
  if (state === 'running') return 'text-[#12706f]'
  if (state === 'starting') return 'text-bamber'
  if (state === 'unavailable') return 'text-bcoral'
  return 'text-heroslate'
}

export default function AboutPanel({ status }: { status: Status }) {
  const c = status.computer
  return (
    <div className="mt-4">
      <h3 className="font-brico text-base font-bold">This team</h3>
      <Row label="Team" value={status.team?.name ?? '—'} mono={false} />
      <Row label="Peers" value={String(status.peers.length)} mono={false} />

      <h3 className="mt-5 font-brico text-base font-bold">Computer</h3>
      <div className="flex items-center justify-between gap-3 border-b border-navy/10 py-2 text-sm">
        <span className="shrink-0 text-heroslate">Status</span>
        <span className={`text-sm font-bold ${statusColor(c?.state)}`} title={c?.error ?? ''}>
          {c?.state ?? 'off'}
        </span>
      </div>
      <Row label="Container" value={c?.container ? `${c.container.slice(0, 18)}…` : '—'} />
      <Row label="Image" value={c?.image ?? '—'} />
      <Row label="Workspace" value={c?.workspace ?? '—'} />
    </div>
  )
}
