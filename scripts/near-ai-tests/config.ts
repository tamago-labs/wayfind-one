// Shared config for scripts/near-ai-tests/*.ts — run from the repo root, e.g.
//   npx tsx scripts/near-ai-tests/01-gateway-attestation.ts
// This mirrors what `wayfind ai --provider near-ai` + `wayfind verify` will do,
// so working calls here transfer directly into product code (Phase 1 step 8/9,
// Phase 2 verifier). API key: scripts/near-ai-tests/.env (gitignored).
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: 'scripts/near-ai-tests/.env', override: true });

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { decodeJwt } from 'jose';

export const DIR = 'scripts/near-ai-tests';
const STATE_PATH = `${DIR}/.near-proof-state.json`;

export const NEARAI_BASE_URL = process.env.NEARAI_CLOUD_BASE_URL || 'https://cloud-api.near.ai';
export const NVIDIA_NRAS_URL = 'https://nras.attestation.nvidia.com/v3/attest/gpu';
// Default test model: full chain verifies (attestation + NVIDIA + provider_tee
// chat signature). The embedding model (Qwen/Qwen3-Embedding-0.6B) is
// TEE-hosted and NVIDIA-verifiable but NOT chat-capable (upstream 404 on
// /v1/chat/completions) — override per-run with MODEL_NAME= for chat steps.
export const MODEL_NAME = process.env.MODEL_NAME || 'Qwen/Qwen3.8-27B';

export function apiKey(): string {
  return need('NEARAI_CLOUD_API_KEY');
}

export function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} — copy ${DIR}/.env.example to ${DIR}/.env and fill it in (see ${DIR}/README.md).`);
    process.exit(1);
  }
  return v;
}

export function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

export function sha256hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

export async function httpError(res: Response, context: string): Promise<Error> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch { /* ignore */ }
  return new Error(`${context}: ${res.status} ${res.statusText}${detail ? ` - ${detail}` : ''}`);
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${apiKey()}` };
}

/** Attestation report. With a model → model_attestations + gateway_attestation; without → gateway only. */
export async function getAttestation(model: string | null, nonce?: string): Promise<any> {
  const params = new URLSearchParams({ signing_algo: 'ecdsa' });
  if (model) params.set('model', model);
  if (nonce) params.set('nonce', nonce);
  const res = await fetch(`${NEARAI_BASE_URL}/v1/attestation/report?${params.toString()}`, {
    headers: { accept: 'application/json', ...authHeaders() },
  });
  if (!res.ok) throw await httpError(res, 'Attestation request failed');
  return res.json();
}

/** Verify a model's nvidia_payload with NVIDIA NRAS. Returns the raw NRAS array. */
export async function getGpuAttestation(nvidiaPayload: string | object): Promise<any> {
  const body = typeof nvidiaPayload === 'string' ? nvidiaPayload : JSON.stringify(nvidiaPayload);
  const res = await fetch(NVIDIA_NRAS_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body,
  });
  if (!res.ok) throw await httpError(res, 'GPU attestation verification failed');
  return res.json();
}

/** Decode NRAS array ([["JWT", token], {"GPU-0": token, ...]]) into claims. */
export function decodeNvidiaAttestation(nvidiaResponse: any): Record<string, any> {
  const result: Record<string, any> = {};
  if (!Array.isArray(nvidiaResponse)) throw new Error('Expected array response from NVIDIA');
  const decodeToken = (key: string, token: unknown) => {
    if (typeof token === 'string' && token.includes('.')) {
      try {
        result[key] = decodeJwt(token);
      } catch (err) {
        result[key] = { error: (err as Error).message };
      }
    }
  };
  for (const item of nvidiaResponse) {
    if (Array.isArray(item) && item.length === 2) decodeToken(item[0], item[1]);
    else if (item && typeof item === 'object') {
      for (const [k, v] of Object.entries(item)) decodeToken(k, v);
    }
  }
  return result;
}

export interface GpuSummary {
  overallResult: boolean;
  eatNonce: string | null;
  nonceMatch: boolean | null;
  gpus: Array<Record<string, unknown>>;
}

export function summarizeGpuAttestation(decoded: Record<string, any>, expectedNonce?: string): GpuSummary {
  const overall = decoded.JWT || {};
  const eatNonce: string | null = overall.eat_nonce ?? null;
  const nonceMatch =
    expectedNonce && eatNonce ? eatNonce.toLowerCase() === expectedNonce.toLowerCase() : null;
  const gpus = Object.entries(decoded)
    .filter(([k]) => k.startsWith('GPU-'))
    .map(([key, claims]: [string, any]) => ({
      key,
      hwmodel: claims.hwmodel ?? null,
      driverVersion: claims['x-nvidia-gpu-driver-version'] ?? null,
      secureBoot: claims.secboot ?? null,
      measres: claims.measres ?? null,
    }));
  return { overallResult: overall['x-nvidia-overall-att-result'] === true, eatNonce, nonceMatch, gpus };
}

export function extractSigningAddresses(report: any): { modelTee: string[]; gateway: string[] } {
  const modelTee: string[] = [];
  for (const a of report.model_attestations ?? []) {
    if (a.signing_address && !modelTee.includes(a.signing_address)) modelTee.push(a.signing_address);
  }
  const gateway: string[] = [];
  const gw = report.gateway_attestation?.signing_address;
  if (gw) gateway.push(gw);
  return { modelTee, gateway };
}

/** Recover an EIP-191 signer and compare against expected TEE addresses. */
export function verifySignature(
  message: string,
  signature: string,
  expectedAddresses: string | string[],
): { valid: boolean; recoveredAddress: string | null; error?: string } {
  const addrs = Array.isArray(expectedAddresses) ? expectedAddresses : [expectedAddresses];
  try {
    const recovered = ethers.verifyMessage(message, signature);
    return {
      valid: addrs.some((a) => recovered.toLowerCase() === String(a).toLowerCase()),
      recoveredAddress: recovered,
    };
  } catch (err) {
    return { valid: false, recoveredAddress: null, error: (err as Error).message };
  }
}

export interface ProofState {
  nonce?: string;
  model?: string;
  modelTee?: string[];
  gateway?: string[];
  reportPath?: string;
}

export function loadState(): ProofState {
  if (!existsSync(STATE_PATH)) return {};
  return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as ProofState;
}

export function saveState(patch: Partial<ProofState>): ProofState {
  const next = { ...loadState(), ...patch };
  writeFileSync(STATE_PATH, JSON.stringify(next, null, 2));
  return next;
}

/** Check collector: prints ✅/❌ summary, exits 1 on any failure. */
export function report(checks: Array<{ name: string; pass: boolean }>): void {
  console.log('\n📋 Summary');
  console.log('--------------------------------');
  for (const c of checks) console.log(`   ${c.pass ? '✅' : '❌'} ${c.name}`);
  const failed = checks.filter((c) => !c.pass);
  if (failed.length > 0) {
    console.error(`\n❌ ${failed.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\n✅ all checks passed');
}
