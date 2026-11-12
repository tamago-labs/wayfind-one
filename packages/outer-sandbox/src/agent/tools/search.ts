// `glob` + `grep` tools (opencode-style fast search, zero-dep): find files
// by pattern and search contents with regex. Prefer over shell ls/cat/grep
// — capped output, line numbers, ignored dirs, works where sh is absent.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { approvalPolicy, guarded, type GuardOpts } from '../../core/guard.js';
import { inside } from './paths.js';

const IGNORED = new Set(['node_modules', '.git', '.wayfind', 'dist', 'build', '.next', 'coverage']);
const MAX_FILES = 100;
const MAX_OUTPUT = 20_000;

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…(truncated, ${s.length} chars total)` : s;
}

/** Minimal glob→RegExp: `*` (no slash), `**` (any), `?` (one char). */
function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/');
  let rx = '';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '*') {
      if (normalized[i + 1] === '*') {
        rx += '.*';
        i++;
        if (normalized[i + 1] === '/') i++;
      } else {
        rx += '[^/]*';
      }
    } else if (c === '?') {
      rx += '[^/]';
    } else {
      rx += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${rx}$`, 'i');
}

function walk(dir: string, out: string[], rel: string): void {
  if (out.length >= MAX_FILES * 4) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (IGNORED.has(e)) continue;
    const full = join(dir, e);
    const relPath = rel ? `${rel}/${e}` : e;
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walk(full, out, relPath);
    else {
      out.push(relPath);
      if (out.length >= MAX_FILES * 4) return;
    }
  }
}

export function createSearchTools(opts: GuardOpts): Array<ReturnType<typeof tool>> {
  const glob = tool({
    name: 'glob',
    description:
      'Find files by glob pattern (`*.ts`, `**/*.json`). Fast workspace search — prefer over shell ls/find. ' +
      'Omit path to search the whole workspace.',
    parameters: z.object({
      pattern: z.string().describe('Glob pattern to match, e.g. **/*.ts'),
      path: z.string().optional().describe('Subdirectory to search (default workspace root)'),
    }),
    execute: guarded('glob', (a: { pattern: string; path?: string }) => `${a.path ?? '.'}:${a.pattern}`, async (a: { pattern: string; path?: string }) => {
      const root = inside(a.path ?? '.');
      const files: string[] = [];
      walk(root, files, '');
      const rx = globToRegExp(a.pattern);
      const hits = files.filter((f) => rx.test(f)).slice(0, MAX_FILES);
      return truncate(hits.join('\n') || '(no matches)');
    }, opts),
    needsApproval: approvalPolicy('glob', (a: { pattern: string; path?: string }) => `${a.path ?? '.'}:${a.pattern}`),
  });

  const grep = tool({
    name: 'grep',
    description:
      'Search file contents with a regex. Returns file:line matches. Prefer over shell grep — capped, skips ignored dirs. ' +
      'Use glob first when you need files by name.',
    parameters: z.object({
      pattern: z.string().describe('Regex to search for'),
      include: z.string().optional().describe('Glob filter for files, e.g. *.{ts,tsx}'),
      path: z.string().optional().describe('Subdirectory to search (default workspace root)'),
    }),
    execute: guarded('grep', (a: { pattern: string }) => a.pattern, async (a: { pattern: string; include?: string; path?: string }) => {
      let rx: RegExp;
      try {
        rx = new RegExp(a.pattern, 'im');
      } catch {
        throw new Error(`Invalid regex: ${a.pattern}`);
      }
      const root = inside(a.path ?? '.');
      const files: string[] = [];
      walk(root, files, '');
      const inc = a.include ? globToRegExp(a.include) : null;
      const out: string[] = [];
      for (const f of files) {
        if (inc && !inc.test(f)) continue;
        let content: string;
        try {
          content = readFileSync(join(root, f), 'utf8');
        } catch {
          continue;
        }
        if (content.length > 500_000) continue; // skip huge files
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (rx.test(lines[i])) {
            out.push(`${f}:${i + 1}:${lines[i].trim().slice(0, 200)}`);
            if (out.join('\n').length > MAX_OUTPUT) return truncate(out.join('\n'));
          }
        }
        if (out.length > 500) break;
      }
      return truncate(out.join('\n') || '(no matches)');
    }, opts),
    needsApproval: approvalPolicy('grep', (a: { pattern: string }) => a.pattern),
  });

  return [glob, grep];
}
