'use client';

import { useEffect, useState } from 'react';
import { getSkills, removeSkill, type InstalledSkill } from '@/lib/team';
import TabHeader from './TabHeader';

export default function SkillsTab() {
  const [skills, setSkills] = useState<InstalledSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSkills()
      .then((s) => {
        if (alive) setSkills(s);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load skills.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const onRemove = async (name: string) => {
    // Two-click confirm: first click arms, second click removes.
    if (confirming !== name) {
      setConfirming(name);
      return;
    }
    if (busy) return;
    setConfirming(null);
    setBusy(true);
    setError(null);
    try {
      await removeSkill(name);
      setSkills(await getSkills());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !skills) {
    return <p className="p-5 text-sm font-medium text-red-600">{error}</p>;
  }
  if (!skills) {
    return <p className="p-5 text-sm text-navy/50">Loading skills…</p>;
  }

  return (
    <div className="space-y-4 p-5">
      <TabHeader
        title="Skills"
        sub="Give bots new know-how. Add a skill from chat with a repo or GitHub link."
      />
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {skills.length === 0 ? (
        <p className="text-sm text-navy/50">No skills installed yet.</p>
      ) : (
        <ul className="space-y-2">
          {skills.map((s) => (
            <li key={s.name} className="rounded-xl border border-navy/10 bg-ice p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-brico text-sm font-bold text-navy" title={s.source}>{s.name}</h4>
                  <p className="mt-0.5 line-clamp-2 text-sm text-navy/50" title={s.description}>
                    {s.description}
                  </p>
                </div>
                <button
                  onClick={() => void onRemove(s.name)}
                  onBlur={() => setConfirming((c) => (c === s.name ? null : c))}
                  disabled={busy}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold disabled:opacity-50 ${
                    confirming === s.name
                      ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
                      : 'border-red-200 text-red-600 hover:bg-red-50'
                  }`}
                >
                  {confirming === s.name ? 'Confirm?' : 'Remove'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
