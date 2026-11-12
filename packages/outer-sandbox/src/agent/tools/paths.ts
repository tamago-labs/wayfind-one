// Workspace path jail (shared by file tools). All model-supplied paths are
// workspace-relative; absolute, leading-slash, and `workspace/`-prefixed
// forms are normalized rather than rejected (models emit all three).
// Separator-aware: works on Windows backslashes and POSIX slashes.
import { isAbsolute, relative, resolve } from 'node:path';
import { WORKSPACE_DIR } from '../../core/config.js';

const ROOT = resolve(WORKSPACE_DIR);

export function inside(p: string): string {
  const cleaned = p.replace(/^[/\\]+/, '').replace(/^workspace[/\\]/, '');
  const full = resolve(ROOT, cleaned || '.');
  const rel = relative(ROOT, full);
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return full;
}
