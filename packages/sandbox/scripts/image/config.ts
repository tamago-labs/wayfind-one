// Shared config for scripts/image/*.ts — run from the package dir, e.g.
//   cd packages/sandbox
//   npx tsx scripts/image/01-package-upload.ts
// Golden-image pipeline for the minimal exec sandbox (not the agent computer).
// Same SDK pattern as packages/computer/scripts/image — separate image name,
// zip key, and state file so the two pipelines never clobber each other.
import { config } from 'dotenv';
// Root .env.local two levels up, then scripts/image/.env as an optional override.
config({ path: '../../.env.local' });
config({ path: 'scripts/image/.env', override: true });

import { LambdaMicrovmsClient } from '@aws-sdk/client-lambda-microvms';
import { S3Client } from '@aws-sdk/client-s3';
import { existsSync, readFileSync, writeFileSync } from 'fs';

export const DIR = 'scripts/image';
const STATE_PATH = `${DIR}/.exec-image-state.json`;

export function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} — copy ${DIR}/.env.example to ${DIR}/.env and fill it in (see ${DIR}/README.md).`);
    process.exit(1);
  }
  return v;
}

export const REGION = process.env.AWS_REGION ?? 'ap-southeast-1';
export const BUCKET = need('MICROVM_BUCKET');
export const IMAGE_NAME = process.env.SANDBOX_IMAGE_NAME ?? 'wayfind-sandbox';
export const ZIP_KEY = process.env.SANDBOX_ZIP_KEY ?? `microvm-artifacts/${IMAGE_NAME}.zip`;

export const mv = new LambdaMicrovmsClient({ region: REGION });
export const s3 = new S3Client({ region: REGION });

// Network connectors for manual runs. NOTE: production provisions are
// default-deny egress (P1 workstream 3) — INTERNET_EGRESS here is only
// for the manual smoke-run path until the allowlist lands.
export const INGRESS_ALL = `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:ALL_INGRESS`;
export const EGRESS_INTERNET = `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:INTERNET_EGRESS`;

export interface ExecImageState {
  imageArn?: string;
  imageVersion?: string;
  zipKey?: string;
  /** Manual smoke-run VM. */
  microvmId?: string;
  endpoint?: string;
}

export function loadState(): ExecImageState {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as ExecImageState;
}

export function saveState(patch: Partial<ExecImageState>): ExecImageState {
  const next = { ...loadState(), ...patch };
  writeFileSync(STATE_PATH, JSON.stringify(next, null, 2));
  return next;
}

export async function waitFor<T>(
  label: string,
  poll: () => Promise<T | null>,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 15_000;
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
  const start = Date.now();
  for (;;) {
    const done = await poll();
    if (done !== null) return done;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`${label}: timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
