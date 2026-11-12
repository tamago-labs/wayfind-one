// `edit` tool (opencode-style surgical replacement): exact oldString →
// newString, single or all occurrences. Cheaper and safer than `write`
// (which rewrites whole files) for small changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { approvalPolicy, guarded, type GuardOpts } from '../../core/guard.js';
import { inside } from './paths.js';

export function createEditTool(opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'edit',
    description:
      'Replace text in a file. oldString must match exactly (derive it from a fresh read). ' +
      'Fails when not found or ambiguous — widen context or set replaceAll. ' +
      'Prefer over write for small changes.',
    parameters: z.object({
      path: z.string().describe('Workspace-relative file path'),
      oldString: z.string().describe('Exact text to replace'),
      newString: z.string().describe('Replacement text'),
      replaceAll: z.boolean().optional().describe('Replace every occurrence (default false)'),
    }),
    execute: guarded('edit', (a: { path: string }) => a.path, async (a: { path: string; oldString: string; newString: string; replaceAll?: boolean }) => {
      if (a.oldString === a.newString) throw new Error('oldString and newString are identical — nothing to do');
      const full = inside(a.path);
      const content = readFileSync(full, 'utf8');
      const count = content.split(a.oldString).length - 1;
      if (count === 0) throw new Error(`oldString not found in ${a.path}`);
      if (count > 1 && !a.replaceAll) {
        throw new Error(`Found ${count} matches in ${a.path} — widen oldString context or set replaceAll`);
      }
      const next = a.replaceAll ? content.split(a.oldString).join(a.newString) : content.replace(a.oldString, a.newString);
      writeFileSync(full, next);
      return `Edited ${a.path}: replaced ${a.replaceAll ? count : 1} occurrence(s)`;
    }, opts),
    needsApproval: approvalPolicy('edit', (a: { path: string }) => a.path),
  });
}
