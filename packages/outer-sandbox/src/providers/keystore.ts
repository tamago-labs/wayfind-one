// VM keystore: model keys live here, never in chat/transcripts.
// File is chmod 0600. Writes come from `wayfind keys set` (operator CLI) or
// the deployment itself (embedded in the MicroVM, .env locally) — end users
// never provide keys.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WORKSPACE_DIR } from '../core/config.js';

export const KEYSTORE_PATH = join(WORKSPACE_DIR, '.wayfind', 'keys.json');

export function readKeys(): Record<string, string | string[]> {
  if (!existsSync(KEYSTORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(KEYSTORE_PATH, 'utf8')) as Record<string, string | string[]>;
  } catch {
    return {};
  }
}

export function writeKey(name: string, value: string): void {
  mkdirSync(dirname(KEYSTORE_PATH), { recursive: true });
  const keys = { ...readKeys(), [name]: value };
  writeFileSync(KEYSTORE_PATH, JSON.stringify(keys, null, 2));
  chmodSync(KEYSTORE_PATH, 0o600);
}

const rotationCounters = new Map<string, number>();

/** Draw a key value, round-robining when the entry is an array (rotation). */
export function drawKey(name: string): string | null {
  const v = readKeys()[name];
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v.length === 0) return null;
  const n = rotationCounters.get(name) ?? 0;
  rotationCounters.set(name, n + 1);
  return v[n % v.length];
}

export function maskedKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(readKeys())) {
    const first = Array.isArray(v) ? v[0] : v;
    const extra = Array.isArray(v) ? ` (+${v.length - 1} rotated)` : '';
    out[k] = (first.length <= 8 ? '****' : `${first.slice(0, 4)}…${first.slice(-4)}`) + extra;
  }
  return out;
}
