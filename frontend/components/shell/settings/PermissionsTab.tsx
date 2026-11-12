'use client';

import { useEffect, useState } from 'react';
import { getPermissions, setPermissions, undoPermissions, type PermissionRule } from '@/lib/team';
import TabHeader from './TabHeader';

const ACTIONS = ['allow', 'ask', 'deny'] as const;

/** Permissions that break basic chat when denied — confirm first. */
const CORE_PERMISSIONS = new Set(['read', 'list', 'task']);

function actionStyle(active: boolean, action: string): string {
  if (!active) return 'text-navy/50 hover:text-navy';
  if (action === 'allow') return 'bg-emerald-100 text-emerald-800';
  if (action === 'deny') return 'bg-red-100 text-red-800';
  return 'bg-amber-100 text-amber-800';
}

export default function PermissionsTab() {
  const [rules, setRules] = useState<PermissionRule[] | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getPermissions()
      .then(({ rules: r, canUndo: u }) => {
        if (!alive) return;
        setRules(r);
        setCanUndo(u);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load permissions.');
      });
    return () => {
      alive = false;
    };
  }, []);

  // Non-optimistic: local state only changes after the PUT succeeds, so a
  // failed save can never masquerade as applied. Returns true on success.
  const persist = async (next: PermissionRule[]): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const saved = await setPermissions(next);
      setRules(saved);
      setCanUndo(true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const undo = () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    undoPermissions()
      .then((restored) => {
        if (restored) {
          setRules(restored.rules);
          setCanUndo(restored.canUndo);
        } else {
          setCanUndo(false);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Undo failed.'))
      .finally(() => setSaving(false));
  };

  const setRuleAction = (index: number, action: (typeof ACTIONS)[number]) => {
    if (!rules || saving) return;
    const target = rules[index];
    if (action === 'deny' && CORE_PERMISSIONS.has(target.permission)) {
      const ok = window.confirm(
        `Denying "${target.permission}" will break basic replies. Deny anyway?`,
      );
      if (!ok) return;
    }
    const next = rules.map((r, i) => (i === index ? { ...r, action } : r));
    void persist(next);
  };

  const deleteRule = (index: number) => {
    if (!rules || saving) return;
    const next = rules.filter((_, i) => i !== index);
    void persist(next);
  };

  const revokeAll = (permission: string) => {
    if (!rules || saving) return;
    // Same semantics as the per-row ✕: drop every rule for this permission
    // so its tools fall back to ask (reads stay free by default).
    const next = rules.filter((r) => r.permission !== permission);
    void persist(next);
  };

  if (error && !rules) {
    return <p className="p-5 text-sm font-medium text-red-600">{error}</p>;
  }
  if (!rules) {
    return <p className="p-5 text-sm text-navy/50">Loading permissions…</p>;
  }

  const groups: Array<{ permission: string; items: Array<{ rule: PermissionRule; index: number }> }> = [];
  rules.forEach((rule, index) => {
    const g = groups.find((x) => x.permission === rule.permission);
    if (g) g.items.push({ rule, index });
    else groups.push({ permission: rule.permission, items: [{ rule, index }] });
  });

  return (
    <div className="p-5">
      <TabHeader
        title="Permissions"
        sub="Control what bots can do without asking. Changes apply to new chats."
      />
      {groups.map(({ permission, items }) => (
        <div key={permission} className="mt-5">
          <div className="flex items-center justify-between">
            <h4 className="font-brico text-sm font-bold text-navy">{permission}</h4>
            <button
              onClick={() => revokeAll(permission)}
              disabled={saving}
              aria-label={`Delete all ${permission} rules`}
              title="Delete all rules for this permission"
              className="shrink-0 text-xs font-bold text-navy/50 hover:text-red-600 disabled:opacity-50"
            >
              ✕ all
            </button>
          </div>
          <div className="mt-2 space-y-1.5">
            {items.map(({ rule, index }) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-xl border border-navy/10 bg-ice px-3 py-2"
              >
                <code className="min-w-0 flex-1 truncate text-xs text-navy">{rule.pattern}</code>
                <div className="flex shrink-0 gap-1">
                  {ACTIONS.map((a) => (
                    <button
                      key={a}
                      onClick={() => setRuleAction(index, a)}
                      disabled={saving}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${actionStyle(rule.action === a, a)}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => deleteRule(index)}
                  disabled={saving}
                  aria-label={`Delete rule ${rule.pattern}`}
                  title="Delete rule"
                  className="shrink-0 text-xs font-bold text-navy/50 hover:text-red-600 disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <p className="mt-5 rounded-xl border border-dashed border-navy/20 p-4 text-center text-sm text-navy/50">
          No rules — reads are free, everything else falls back to ask.
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
      <div className="sticky bottom-0 -mx-5 -mb-5 mt-5 border-t border-navy/10 bg-white/95 px-5 py-3 backdrop-blur">
        <div className="flex justify-end">
          <button
            onClick={undo}
            disabled={saving || !canUndo}
            title={canUndo ? 'Restore before the last save' : 'No changes to undo'}
            className="rounded-full border border-navy/15 px-4 py-1.5 text-xs font-bold text-navy hover:border-cta disabled:cursor-not-allowed disabled:opacity-40"
          >
            Undo last change
          </button>
        </div>
      </div>
    </div>
  );
}
