// Permissions, opencode Ruleset-lite: allow|deny|ask with wildcard patterns,
// loaded from workspace/permissions.json (defaults below). Two ask modes:
// - CLI (interactive): prompt on stdin (allow once / always / deny).
// - Server (non-interactive): enforcing mode parks until POST
//   /approvals/:id decides (needs hang-proof resume); permissive mode
//   auto-allows and logs (opt-in via PERMISSION_MODE=permissive).
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { WORKSPACE_DIR } from './config.js';

export type Action = 'allow' | 'deny' | 'ask';
export interface Rule {
  permission: string;
  pattern: string;
  action: Action;
}

const DEFAULTS: Rule[] = [
  { permission: 'read', pattern: '*', action: 'allow' },
  { permission: 'list', pattern: '*', action: 'allow' },
  { permission: 'skill', pattern: '*', action: 'allow' },
  { permission: 'task', pattern: '*', action: 'allow' },
  { permission: 'shell', pattern: 'ls *', action: 'allow' },
  { permission: 'shell', pattern: 'cat *', action: 'allow' },
  { permission: 'shell', pattern: 'echo *', action: 'allow' },
  { permission: 'shell', pattern: '*', action: 'ask' },
  { permission: 'write', pattern: '*', action: 'ask' },
];

function wildcard(pattern: string, value: string): boolean {
  const rx = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return rx.test(value);
}

export function loadRules(): Rule[] {
  const path = join(WORKSPACE_DIR, 'permissions.json');
  if (!existsSync(path)) return DEFAULTS;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { rules?: Rule[] };
    // An explicitly saved empty list stays empty — it means "no rules".
    // (Unknown permissions still fall back to 'ask' via check().)
    return parsed.rules ?? DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function check(rules: Rule[], permission: string, target: string): Action {
  for (const r of rules) {
    if (r.permission === permission && wildcard(r.pattern, target)) return r.action;
  }
  return 'ask';
}

/** Persist rules with a timestamped backup. Throws on invalid shape. */
export function saveRules(rules: Rule[]): void {
  if (!Array.isArray(rules)) throw new Error('rules must be an array');
  for (const r of rules) {
    if (!r || typeof r.permission !== 'string' || typeof r.pattern !== 'string') {
      throw new Error('each rule must be { permission, pattern, action }');
    }
    if (r.action !== 'allow' && r.action !== 'deny' && r.action !== 'ask') {
      throw new Error(`invalid action "${(r as { action: unknown }).action}"`);
    }
  }
  const path = join(WORKSPACE_DIR, 'permissions.json');
  // Single rolling backup — overwritten on every save, restored via undo.
  if (existsSync(path)) {
    copyFileSync(path, `${path}.bak`);
  }
  writeFileSync(path, JSON.stringify({ rules }, null, 2) + '\n', 'utf8');
}

/** Restore the last saved rules. Returns null when there is no backup. */
export function undoRules(): Rule[] | null {
  const path = join(WORKSPACE_DIR, 'permissions.json');
  const bak = `${path}.bak`;
  if (!existsSync(bak)) return null;
  copyFileSync(bak, path);
  return loadRules();
}

/** True when an undo backup exists. */
export function canUndoRules(): boolean {
  return existsSync(join(WORKSPACE_DIR, 'permissions.json.bak'));
}

export async function askCli(permission: string, target: string): Promise<'allow' | 'deny' | 'always'> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`Allow ${permission} "${target}"? [y]es / [a]lways / [n]o: `, resolve);
  });
  rl.close();
  const a = answer.trim().toLowerCase();
  if (a === 'a' || a === 'always') return 'always';
  if (a === 'y' || a === 'yes' || a === '') return 'allow';
  return 'deny';
}
