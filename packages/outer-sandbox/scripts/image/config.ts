// Shared config for packages/computer/scripts/image/*.ts — run from the repo root, e.g.
//   npx tsx packages/computer/scripts/image/01-package-upload.ts
// Golden-image pipeline for the real agent computer (not the hello-app toy).
// Same SDK pattern as scripts/microvm-tests — working calls transfer to the
// future `computer-manager` Lambda. Nothing here touches the app.
import { config } from 'dotenv';
// Root .env.local first (already holds AWS_REGION + MICROVM_BUCKET),
// then packages/computer/scripts/image/.env as an optional override.
config({ path: '.env.local' });
config({ path: 'packages/computer/scripts/image/.env', override: true });

import { LambdaMicrovmsClient } from '@aws-sdk/client-lambda-microvms';
import { S3Client } from '@aws-sdk/client-s3';
import { existsSync, readFileSync, writeFileSync } from 'fs';

export const DIR = 'packages/computer/scripts/image';
const STATE_PATH = `${DIR}/.computer-image-state.json`;

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
export const IMAGE_NAME = process.env.COMPUTER_IMAGE_NAME ?? 'wayfind-computer';
export const ZIP_KEY = process.env.COMPUTER_ZIP_KEY ?? `microvm-artifacts/${IMAGE_NAME}.zip`;

export const mv = new LambdaMicrovmsClient({ region: REGION });
export const s3 = new S3Client({ region: REGION });

// Network connectors for 03-run (same account/region as the spike).
export const INGRESS_ALL = `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:ALL_INGRESS`;
export const EGRESS_INTERNET = `arn:aws:lambda:${REGION}:aws:network-connector:aws-network-connector:INTERNET_EGRESS`;

export interface ComputerImageState {
  imageArn?: string;
  imageVersion?: string;
  zipKey?: string;
  /** Manual 03-run VM (single dev VM until the manager exists). */
  microvmId?: string;
  endpoint?: string;
}

export function loadState(): ComputerImageState {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as ComputerImageState;
}

export function saveState(patch: Partial<ComputerImageState>): ComputerImageState {
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
