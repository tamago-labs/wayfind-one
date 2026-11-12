'use client';

import { useState } from 'react';
import { exportEvidence } from '@/lib/wayfind';

export function Err({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>;
}

export function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = id;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button onClick={copy} title="Copy full conversation id" className="rounded px-1 font-mono text-xs text-ink hover:bg-mist">
      {id.slice(0, 8)}… {copied ? 'copied' : 'copy'}
    </button>
  );
}

export async function downloadEvidenceBundle(conversationId: string) {
  const bundle = await exportEvidence(conversationId);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wayfind-evidence-${conversationId.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
