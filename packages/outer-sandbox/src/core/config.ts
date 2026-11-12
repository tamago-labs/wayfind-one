// Runtime config. Two keys, strictly separated:
// - PROVIDER_API_KEY (Meta): grounded search + voice transcription via api.meta.ai.
// - MODAL_API_KEY: the main chat model endpoint (open-weights server).
// Locally both come from .env; on the MicroVM both are embedded privately.
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

config({ path: '.env' });

export const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? './workspace';

function keystore(): Record<string, string> {
  const p = join(WORKSPACE_DIR, '.wayfind', 'keys.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

const keys = keystore();

export const PROVIDER_BASE_URL = process.env.PROVIDER_BASE_URL ?? 'https://api.meta.ai/v1';
export const PROVIDER_MODEL = process.env.PROVIDER_MODEL ?? 'meta-models/Muse-Spark-Open-816B-A42B';
export const PROVIDER_API_KEY = process.env.PROVIDER_API_KEY ?? keys.PROVIDER_API_KEY ?? '';
export const MODAL_API_KEY = process.env.MODAL_API_KEY ?? keys.MODAL_API_KEY ?? '';

export const PORT = Number(process.env.PORT ?? 8080);

/** Live check (env or keystore written later by /run) — never the import snapshot. */
export function keysReady(): boolean {
  return Boolean(process.env.PROVIDER_API_KEY ?? drawKeyLive('PROVIDER_API_KEY')) &&
    Boolean(process.env.MODAL_API_KEY ?? drawKeyLive('MODAL_API_KEY'));
}

function drawKeyLive(name: string): string | null {
  try {
    const p = join(WORKSPACE_DIR, '.wayfind', 'keys.json');
    if (!existsSync(p)) return null;
    const v = (JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>)[name];
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/** Local-dev gate: cloud boot skips this (keys arrive via /run). */
export function requireApiKey(): string {
  if (!keysReady()) {
    console.error('Missing API keys (.env or workspace keystore). In cloud, POST /hooks/run first.');
    process.exit(1);
  }
  return PROVIDER_API_KEY;
}
