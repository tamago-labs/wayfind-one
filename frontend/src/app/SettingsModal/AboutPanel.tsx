import type { Status } from '../../lib/api'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-navy/10 py-2 text-sm">
      <span className="text-heroslate">{label}</span>
      <code className="font-mono text-xs">{value}</code>
    </div>
  )
}

export default function AboutPanel({ status }: { status: Status }) {
  return (
    <div className="mt-4">
      <h3 className="font-brico text-base font-bold">This node</h3>
      <Row label="Node" value={`${status.nodeId?.slice(0, 16)}…`} />
      <Row label="Team" value={status.team?.name ?? '—'} />
      <Row label="Peers" value={String(status.peers.length)} />
      <Row label="Store" value={status.store?.writable ? 'writer' : 'read-only'} />
    </div>
  )
}
