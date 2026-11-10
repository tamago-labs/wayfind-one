// Snapshot sync, Option A: push local dir up, pull diffs back, sha256-compared.
// Default excludes keep build junk and VCS metadata out of the snapshot.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { relay } from './api.js';

const DEFAULT_EXCLUDES = new Set(['node_modules', '.git', 'dist', '.wayfind', '.DS_Store']);

export async function walkLocal(root, out = [], base = root) {
  const entries = await fs.readdir(base, { withFileTypes: true });
  for (const e of entries) {
    if (DEFAULT_EXCLUDES.has(e.name)) continue;
    const abs = path.join(base, e.name);
    if (e.isDirectory()) {
      await walkLocal(root, out, abs);
    } else if (e.isFile()) {
      const buf = await fs.readFile(abs);
      out.push({
        rel: path.relative(root, abs).split(path.sep).join('/'),
        abs,
        sha256: createHash('sha256').update(buf).digest('hex'),
      });
    }
  }
  return out;
}

export async function push(token, session, dir) {
  const manifest = await relay(token, session, 'sync/out', {});
  const remote = new Map((manifest.files ?? []).map((f) => [f.path, f.sha256]));
  const local = await walkLocal(dir);
  const changed = local.filter((f) => remote.get(f.rel) !== f.sha256);
  const BATCH = 50;
  for (let i = 0; i < changed.length; i += BATCH) {
    const files = await Promise.all(
      changed.slice(i, i + BATCH).map(async (f) => ({
        path: f.rel,
        contentBase64: (await fs.readFile(f.abs)).toString('base64'),
      })),
    );
    await relay(token, session, 'sync/in', { files });
  }
  return { pushed: changed.length, skipped: local.length - changed.length, total: local.length };
}

export async function pull(token, session, dir) {
  const manifest = await relay(token, session, 'sync/out', {});
  const remote = manifest.files ?? [];
  const local = new Map((await walkLocal(dir)).map((f) => [f.rel, f.sha256]));
  let pulled = 0;
  for (const f of remote) {
    if (local.get(f.path) === f.sha256) continue;
    const cur = await relay(token, session, 'read', { path: f.path });
    const abs = path.join(dir, f.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, cur.content, 'utf8');
    pulled++;
  }
  return { pulled, skipped: remote.length - pulled, total: remote.length };
}
