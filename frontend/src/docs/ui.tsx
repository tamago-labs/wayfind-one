import { useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Copy, Info, Lightbulb } from 'lucide-react'

/* Shared docs primitives — hand-written content, marketing-free tone. */

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="group mt-10 scroll-mt-24 font-brico text-2xl font-extrabold tracking-tight text-navy">
      <a href={`#${id}`} className="inline-flex items-baseline gap-2">
        {children}
        <span aria-hidden="true" className="text-base text-cta opacity-0 transition-opacity group-hover:opacity-100">
          #
        </span>
      </a>
    </h2>
  )
}

export function H3({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="group mt-8 scroll-mt-24 font-brico text-lg font-extrabold text-navy">
      <a href={`#${id}`} className="inline-flex items-baseline gap-2">
        {children}
        <span aria-hidden="true" className="text-sm text-cta opacity-0 transition-opacity group-hover:opacity-100">
          #
        </span>
      </a>
    </h3>
  )
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 leading-relaxed text-navy/80">{children}</p>
}

type CalloutKind = 'info' | 'tip' | 'warning'

const CALLOUT_STYLE: Record<CalloutKind, { icon: typeof Info; box: string; iconColor: string }> = {
  info: { icon: Info, box: 'border-cta/25 bg-cta/5', iconColor: 'text-cta' },
  tip: { icon: Lightbulb, box: 'border-blagoon/25 bg-blagoon/5', iconColor: 'text-blagoon' },
  warning: { icon: AlertTriangle, box: 'border-red-200 bg-red-50', iconColor: 'text-red-600' },
}

export function Callout({ kind = 'info', children }: { kind?: CalloutKind; children: ReactNode }) {
  const s = CALLOUT_STYLE[kind]
  const Icon = s.icon
  return (
    <div className={`mt-5 flex gap-3 rounded-2xl border px-4 py-3.5 ${s.box}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${s.iconColor}`} />
      <div className="text-[15px] leading-relaxed text-navy/85">{children}</div>
    </div>
  )
}

export function Code({ title, children }: { title?: string; children: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(children)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — select manually */
    }
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-navy/10">
      <div className="flex items-center justify-between bg-ice px-3 py-1.5">
        <span className="font-mono text-xs font-bold text-heroslate">{title ?? 'Terminal'}</span>
        <button
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold text-cta hover:bg-white"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-navy p-4 font-mono text-[13px] leading-relaxed text-white/90">
        {children}
      </pre>
    </div>
  )
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="mt-4 space-y-4">{children}</ol>
}

export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy text-sm font-extrabold text-white">
        {title}
      </span>
      <div className="min-w-0 pt-0.5 text-[15px] leading-relaxed text-navy/80">{children}</div>
    </li>
  )
}

export function DocTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-navy/10" role="region" tabIndex={0}>
      <table className="w-full min-w-[480px] border-collapse text-left text-sm">
        <thead>
          <tr className="bg-ice">
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-brico font-extrabold text-navy">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-navy/5 bg-white">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={`px-4 py-2.5 ${j === 0 ? 'font-bold text-navy' : 'text-navy/75'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
