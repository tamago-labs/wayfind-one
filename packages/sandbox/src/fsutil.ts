// Workspace jail + file discovery primitives shared by all tools.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DIR, MAX_LIST_ENTRIES } from './config.js';
import { HttpError } from './http.js';

// Join a client path to the workspace; throw on escape attempts.
export function jail(p: unknown): { abs: string; rel: string } {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw new HttpError(400, 'bad path');
  const rel = p.replace(/^\/+/, '');
  const abs = path.resolve(WORKSPACE_DIR, rel);
  if (abs !== WORKSPACE_DIR && !abs.startsWith(WORKSPACE_DIR + path.sep)) {
    throw new HttpError(400, 'path escapes workspace');
  }
  return { abs, rel: path.relative(WORKSPACE_DIR, abs) || '.' };
}

export function walk(absRoot: string, out: string[], base = absRoot): void {
  let entries;
  try {
    entries = readdirSync(absRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_LIST_ENTRIES) return;
    const abs = path.join(absRoot, e.name);
    if (e.isDirectory()) {
      walk(abs, out, base);
    } else if (e.isFile()) {
      out.push(path.relative(base, abs));
    }
  }
}

export function globToRegExp(pattern: string): RegExp {
  // Minimal glob: ** (any depth), * (within segment), ? (one char).
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function sha256File(abs: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex');
  } catch {
    return null;
  }
}
