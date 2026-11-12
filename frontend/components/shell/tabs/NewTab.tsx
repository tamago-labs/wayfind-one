'use client';

import { useEffect, useState } from 'react';
import { MODELS } from '@/components/Catalog';
import { BotRow, listBots } from '@/lib/data';
import { createConversation, relayMessage } from '@/lib/wayfind';
import { Err } from '../shared';

const LEVELS = [
  { id: 'standard', label: 'Standard — isolated execution' },
  { id: 'verified_inference', label: 'Verified inference — attested NEAR AI' },
];

function NewConversationForm({
  bots,
  onCreated,
}: {
  bots: BotRow[];
  onCreated: (id: string) => void;
}) {
  const [botId, setBotId] = useState('');
  const [model, setModel] = useState(MODELS[0].id);
  const [level, setLevel] = useState('standard');
  const [system, setSystem] = useState('You are a helpful assistant. Answer concisely.');
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!first.trim()) {
      setError('Write the first message.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setStage('Provisioning disposable VM…');
      const created = await createConversation({
        ...(botId ? { botId } : {}),
        model,
        securityLevel: level,
      });
      setStage('Initializing bot + verifying attestation…');
      await relayMessage(created.conversationId, 'bot/init', { system, model });
      setStage('Running first inference…');
      await relayMessage(created.conversationId, 'bot/message', { content: first.trim() });
      setStage(null);
      onCreated(created.conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-navy/10 bg-white p-4">
      <p className="font-semibold text-navy">New sandbox</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-sm text-ink">
          Bot
          <select value={botId} onChange={(e) => setBotId(e.target.value)} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy">
            <option value="">No bot (ad-hoc)</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>{b.name ?? b.id}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink">
          Model
          <select value={model} onChange={(e) => setModel(e.target.value)} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy">
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.id} · {m.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink">
          Security level
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy">
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink">
          System prompt
          <input value={system} onChange={(e) => setSystem(e.target.value)} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy" />
        </label>
      </div>
      <label className="mt-3 block text-sm text-ink">
        First message
        <textarea value={first} onChange={(e) => setFirst(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy" />
      </label>
      <button
        onClick={submit}
        disabled={busy}
        className="mt-3 rounded-lg bg-cta px-4 py-2 text-sm text-white hover:bg-ctahover disabled:opacity-50"
      >
        {busy ? (stage ?? 'Working…') : 'Start private sandbox'}
      </button>
      <Err message={error} />
    </div>
  );
}

export default function NewSection({ onCreated }: { onCreated: (id: string) => void }) {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    listBots().then(setBots).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  });
  return (
    <div>
      <p className="text-sm text-ink">Pick a bot, model, and security level — a disposable VM boots for this session only.</p>
      <Err message={error} />
      <div className="mt-4">
        <NewConversationForm bots={bots} onCreated={onCreated} />
      </div>
    </div>
  );
}
