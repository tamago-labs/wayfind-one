'use client';

import { useEffect, useState } from 'react';
import { BotRow, listBots } from '@/lib/data';
import { createConversation, relayMessage } from '@/lib/wayfind';
import { Err } from '../shared';

export default function BotsSection({ onCreated }: { onCreated: (id: string) => void }) {
  const [bots, setBots] = useState<BotRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  useEffect(() => {
    listBots().then(setBots).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function startWithBot(b: BotRow) {
    setStarting(b.id);
    setError(null);
    try {
      const created = await createConversation({ botId: b.id });
      const system = [b.name ? `You are "${b.name}".` : '', b.role ?? '', b.description ?? '']
        .filter(Boolean)
        .join(' ') || 'You are a helpful assistant. Answer concisely.';
      await relayMessage(created.conversationId, 'bot/init', { system, model: created.model });
      onCreated(created.conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(null);
    }
  }

  return (
    <div>
      <p className="text-sm text-ink">Authored in the Wayfind Cloud builder · one click starts a private execution session.</p>
      <Err message={error} />
      {bots === null && !error && <p className="mt-6 text-sm text-ink">Loading…</p>}
      {bots !== null && bots.length === 0 && (
        <p className="mt-6 text-sm text-ink">No bots yet — create one in Wayfind Cloud first.</p>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {(bots ?? []).map((b) => (
          <div key={b.id} className="rounded-xl border border-navy/10 bg-white p-4">
            <p className="font-semibold text-navy">{b.name ?? 'Untitled bot'}</p>
            {b.role && <p className="mt-1 text-sm text-ink">{b.role}</p>}
            {b.description && <p className="mt-1 text-xs text-ink">{b.description}</p>}
            <button
              onClick={() => startWithBot(b)}
              disabled={starting !== null}
              className="mt-3 rounded-lg bg-cta px-3 py-1.5 text-sm text-white hover:bg-ctahover disabled:opacity-50"
            >
              {starting === b.id ? 'Provisioning…' : 'Start private sandbox'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
