'use client';

import { useState } from 'react';
import { signOut } from 'aws-amplify/auth';
import { MODELS } from './Catalog';

type Tab = 'bots' | 'conversations' | 'verify';

/** App shell placeholder — real data wiring lands with step 2/3 backend. */
export default function OneShell({ email }: { email?: string }) {
  const [tab, setTab] = useState<Tab>('bots');
  return (
    <div className="flex min-h-screen bg-mist">
      <aside className="flex w-64 flex-col border-r border-navy/10 bg-white">
        <div className="border-b border-navy/10 px-5 py-4">
          <p className="font-bold text-navy">Wayfind ONE</p>
          <p className="truncate text-xs text-ink">{email}</p>
        </div>
        <nav className="flex flex-col gap-1 p-3 text-sm">
          {(['bots', 'conversations', 'verify'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-2 text-left capitalize ${tab === t ? 'bg-navy text-white' : 'text-ink hover:bg-mist'}`}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="mt-auto p-3">
          <button onClick={() => signOut()} className="w-full rounded-lg border border-navy/15 px-3 py-2 text-sm text-ink hover:bg-mist">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8">
        {tab === 'bots' && (
          <div>
            <h1 className="text-2xl font-bold">Bots</h1>
            <p className="mt-1 text-sm text-ink">Authored in the Wayfind Cloud builder · deployed here for private execution.</p>
            <div className="mt-6 rounded-xl border border-dashed border-navy/20 bg-white p-10 text-center text-sm text-ink">
              Bot library wires up with step 3 (conversation sessions). New-conversation flow lands next.
            </div>
          </div>
        )}
        {tab === 'conversations' && (
          <div>
            <h1 className="text-2xl font-bold">Conversations</h1>
            <p className="mt-1 text-sm text-ink">One conversation = one disposable execution session.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {MODELS.map((m) => (
                <span key={m.id} className="rounded-full bg-white px-3 py-1 text-xs text-ink ring-1 ring-navy/10">
                  {m.id} · {m.label}
                </span>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-dashed border-navy/20 bg-white p-10 text-center text-sm text-ink">
              Live view + history render from checkpoints (step 3 backend).
            </div>
          </div>
        )}
        {tab === 'verify' && (
          <div>
            <h1 className="text-2xl font-bold">Verify</h1>
            <p className="mt-1 text-sm text-ink">Paste a receipt to check it — same checks as the CLI verifier.</p>
            <div className="mt-6 rounded-xl border border-dashed border-navy/20 bg-white p-10 text-center text-sm text-ink">
              Receipt verification panel lands with step 7 (receipts).
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
