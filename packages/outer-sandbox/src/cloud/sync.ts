// Workspace sync for cloud suspend/resume/terminate hooks.
//
// The VM holds no AWS credentials, so all bytes move over HTTPS with
// short-lived presigned URLs minted by the backend (server-to-server auth
// via the per-computer usage token). Push uploads new/changed files on
// suspend/terminate; pull restores missing files on run/resume. Secrets
// NEVER sync: .wayfind/ (keystore) stays on the VM — identity is
// re-injected at every /run. Per-file cap 25MB (buffered PUTs).
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { WORKSPACE_DIR } from '../core/config.js';

const ROOT = resolve(WORKSPACE_DIR);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 2000;
const PUT_CONCURRENCY = 8;
// Manifest of the last successful push, kept inside .wayfind/ so it never
// leaves the VM. Suspend-hook flushes then upload only what changed since
// the last push instead of the whole workspace — a full sequential re-push
// is what blew the platform's suspend-hook timeout and got VMs terminated.
const MANIFEST_PATH = join(ROOT, '.wayfind', 'sync-manifest.json');

type Manifest = Record<string, { size: number; mtimeMs: number }>;

function loadManifest(): Manifest {
  try {
    if (!existsSync(MANIFEST_PATH)) return {};
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch {
    return {};
  }
}

function saveManifest(m: Manifest): void {
  try {
    mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
    writeFileSync(MANIFEST_PATH, JSON.stringify(m));
  } catch {
    // Manifest is an optimization; a failed save just means a fuller push.
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full);
    // Secrets + state that must never leave the VM.
    if (rel === '.wayfind' || rel.startsWith(`.wayfind${sep}`)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}

function relOf(full: string): string {
  return relative(ROOT, full).split(sep).join('/');
}

export interface SyncCtx {
  apiBase: string;
  token: string;
  computerId: string;
}

async function syncFetch(ctx: SyncCtx, route: string, body: unknown): Promise<Response> {
  const res = await fetch(`${ctx.apiBase}/computer/sync/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-computer-usage-token': ctx.token },
    body: JSON.stringify({ computerId: ctx.computerId, ...(body as Record<string, unknown>) }),
  });
  if (!res.ok) {
    throw new Error(`sync/${route} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}

export async function pushWorkspace(ctx: SyncCtx): Promise<{ pushed: number; bytes: number; skippedLarge: number; unchanged: number }> {
  const files = existsSync(ROOT) ? walk(ROOT) : [];
  const manifest = loadManifest();
  const dirty: Array<{ path: string; size: number; full: string }> = [];
  let skippedLarge = 0;
  let unchanged = 0;
  for (const full of files.slice(0, MAX_FILES)) {
    const st = statSync(full);
    if (st.size > MAX_FILE_BYTES) {
      skippedLarge += 1;
      continue;
    }
    const path = relOf(full);
    const prev = manifest[path];
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) {
      unchanged += 1;
      continue;
    }
    dirty.push({ path, size: st.size, full });
  }
  if (dirty.length === 0) return { pushed: 0, bytes: 0, skippedLarge, unchanged };
  const byPath = new Map(dirty.map((e) => [e.path, e]));
  const urlRes = await syncFetch(ctx, 'upload-urls', {
    files: dirty.map(({ path, size }) => ({ path, size })),
  });
  const { urls } = (await urlRes.json()) as { urls?: Record<string, string> };
  const jobs = Object.entries(urls ?? {}).filter(([, url]) => typeof url === 'string');
  let pushed = 0;
  let bytes = 0;
  let idx = 0;
  const errors: string[] = [];
  // Parallel PUTs: a full first push over presigned HTTPS must not crawl.
  const worker = async (): Promise<void> => {
    while (idx < jobs.length) {
      const [path, url] = jobs[idx++];
      const entry = byPath.get(path);
      if (!entry) continue;
      try {
        const st = statSync(entry.full);
        // Re-check size at upload time (file may have changed since listing).
        if (st.size > MAX_FILE_BYTES) {
          skippedLarge += 1;
          continue;
        }
        const put = await fetch(url, { method: 'PUT', body: readFileSync(entry.full) });
        if (!put.ok) throw new Error(`PUT ${path} → ${put.status}: ${(await put.text()).slice(0, 120)}`);
        manifest[path] = { size: st.size, mtimeMs: st.mtimeMs };
        pushed += 1;
        bytes += st.size;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUT_CONCURRENCY, jobs.length) }, () => worker()));
  if (pushed > 0) saveManifest(manifest);
  if (errors.length > 0 && pushed === 0) throw new Error(`push failed (${errors.length}): ${errors[0]}`);
  if (errors.length > 0) console.error(`[sync] ${errors.length} file(s) failed to push, first: ${errors[0]}`);
  return { pushed, bytes, skippedLarge, unchanged };
}

export async function pullWorkspace(ctx: SyncCtx): Promise<{ pulled: number; skipped: number }> {
  const listRes = await syncFetch(ctx, 'download-urls', {});
  const { files } = (await listRes.json()) as { files?: Array<{ path: string; size: number; url: string }> };
  const manifest = loadManifest();
  let manifestDirty = false;
  let pulled = 0;
  let skipped = 0;
  for (const f of (files ?? []).slice(0, MAX_FILES)) {
    const parts = f.path.split('/').filter((s) => s !== '' && s !== '.');
    if (parts.length === 0 || parts.some((s) => s === '..') || parts[0] === '.wayfind') continue;
    const full = resolve(ROOT, ...parts);
    if (full !== ROOT && !full.startsWith(ROOT + sep)) continue;
    if (existsSync(full)) {
      skipped += 1; // never overwrite running state
      continue;
    }
    if (typeof f.size === 'number' && f.size > MAX_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    const got = await fetch(f.url);
    if (!got.ok) throw new Error(`GET ${f.path} → ${got.status}`);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, Buffer.from(await got.arrayBuffer()));
    // Record the restore so the next push doesn't re-upload it.
    const st = statSync(full);
    manifest[f.path] = { size: st.size, mtimeMs: st.mtimeMs };
    manifestDirty = true;
    pulled += 1;
  }
  if (manifestDirty) saveManifest(manifest);
  return { pulled, skipped };
}
