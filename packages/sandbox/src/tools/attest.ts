// In-VM attestation verification (ports scripts/near-ai-tests 00–06).
// Preflight once per bot session (attestation + NVIDIA, ~2s), then cheap
// per-message signature checks against the retained candidates.
// Honest scope: NVIDIA verdict + signer recovery + hash binding. Full TDX
// quote verification (dcap-qvl) is upstream scope, not here.
import { randomBytes } from 'node:crypto';
import { ethers } from 'ethers';
import { NEARAI_BASE_URL } from '../config.js';
import { HttpError } from '../http.js';

const NVIDIA_NRAS_URL = 'https://nras.attestation.nvidia.com/v3/attest/gpu';

export interface Preflight {
  at: string;
  nonce: string;
  model: string;
  modelTee: string[];
  gateway: string[];
  nodes: number;
  nonceEchoed: boolean;
  nvidia: { overall: boolean; nonceMatch: boolean | null; gpus: number } | null;
}

export interface MessageVerification {
  seq: number;
  chatId: string | null;
  /** false when no preflight ran (standard-tier provider) — nothing checked. */
  checked: boolean;
  kind: string;
  kindMatch: boolean;
  requestHashMatch: boolean;
  responseHashMatch: boolean;
  modelMatch: boolean | null;
  signer: string | null;
  valid: boolean;
  error?: string;
}

async function httpJson(url: string, init: RequestInit, what: string): Promise<any> {
  const res = await fetch(url, init);
  if (!res.ok) throw new HttpError(502, `${what} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  try {
    return await res.json();
  } catch {
    throw new HttpError(502, `${what} returned non-JSON`);
  }
}

function decodeNvidia(decoded: unknown): { overall: boolean; eatNonce: string | null; gpuCount: number } {
  // NRAS returns [["JWT", token], {"GPU-0": token, ...}]; decode without
  // verifying (NRAS is the verifier here) and read the verdict claims.
  const claims: Record<string, any> = {};
  if (Array.isArray(decoded)) {
    for (const item of decoded) {
      if (Array.isArray(item) && item.length === 2 && typeof item[1] === 'string') {
        const parts = item[1].split('.');
        if (parts.length >= 2) {
          try {
            claims[item[0]] = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          } catch { /* ignore undecodable */ }
        }
      } else if (item && typeof item === 'object') {
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          if (typeof v === 'string') {
            const parts = v.split('.');
            if (parts.length >= 2) {
              try {
                claims[k] = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
              } catch { /* ignore */ }
            }
          }
        }
      }
    }
  }
  const overall = claims.JWT ?? {};
  return {
    overall: overall['x-nvidia-overall-att-result'] === true,
    eatNonce: overall.eat_nonce ?? null,
    gpuCount: Object.keys(claims).filter((k) => k.startsWith('GPU-')).length,
  };
}

/** Preflight: fresh-nonce attestation + NVIDIA verdict, candidates retained. */
export async function preflightAttestation(apiKey: string, model: string): Promise<Preflight> {
  const nonce = randomBytes(32).toString('hex');
  const params = new URLSearchParams({ model, signing_algo: 'ecdsa', nonce });
  const att = await httpJson(
    `${NEARAI_BASE_URL}/v1/attestation/report?${params.toString()}`,
    { headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` } },
    'attestation report',
  );
  const modelTee: string[] = [];
  for (const a of att.model_attestations ?? []) {
    if (a.signing_address && !modelTee.includes(a.signing_address)) modelTee.push(a.signing_address);
  }
  const gateway: string[] = [];
  if (att.gateway_attestation?.signing_address) gateway.push(att.gateway_attestation.signing_address);
  const nodes = (att.model_attestations ?? []).length;
  const nonceEchoed =
    nodes > 0 &&
    (att.model_attestations ?? []).every((a: any) => a.request_nonce === nonce) &&
    (!att.gateway_attestation || att.gateway_attestation.request_nonce === nonce);
  // NVIDIA verdict on the first payload (full per-node proof is step 03's job).
  let nvidia: Preflight['nvidia'] = null;
  const first = (att.model_attestations ?? []).find((a: any) => a.nvidia_payload);
  if (first) {
    const raw = await httpJson(
      NVIDIA_NRAS_URL,
      {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: typeof first.nvidia_payload === 'string' ? first.nvidia_payload : JSON.stringify(first.nvidia_payload),
      },
      'NVIDIA attestation',
    );
    const summary = decodeNvidia(raw);
    nvidia = {
      overall: summary.overall,
      nonceMatch: summary.eatNonce ? summary.eatNonce.toLowerCase() === nonce : null,
      gpus: summary.gpuCount,
    };
  }
  return { at: new Date().toISOString(), nonce, model, modelTee, gateway, nodes, nonceEchoed, nvidia };
}

async function getSignature(apiKey: string, chatId: string, model: string): Promise<any> {
  const url =
    `${NEARAI_BASE_URL}/v1/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`;
  let last: unknown = null;
  // Multi-node serving: the signature is cached on the serving node,
  // lookups can transiently 404 elsewhere. Bounded retry, fail closed.
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, { headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` } });
    if (res.ok) return res.json();
    last = `${res.status}: ${(await res.text()).slice(0, 200)}`;
    if (res.status !== 404) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new HttpError(502, `signature lookup failed: ${String(last)}`);
}

function resolveKind(sig: { signature_kind?: string; text: string }): string {
  if (sig.signature_kind === 'provider_tee' || sig.signature_kind === 'gateway') return sig.signature_kind;
  return sig.text.split(':').length === 3 ? 'provider_tee' : 'gateway';
}

/** Per-message 06-checks against retained preflight candidates. */
export async function verifyMessage(
  apiKey: string,
  seq: number,
  chatId: string | null,
  model: string,
  requestHash: string,
  responseHash: string,
  preflight: Preflight,
): Promise<MessageVerification> {
  const fail = (error: string): MessageVerification => ({
    seq, chatId, checked: true, kind: 'unknown', kindMatch: false, requestHashMatch: false,
    responseHashMatch: false, modelMatch: null, signer: null, valid: false, error,
  });
  if (!chatId) return fail('no chat id — response is unverified');
  let sig: { text: string; signature: string; signature_kind?: string };
  try {
    sig = await getSignature(apiKey, chatId, model);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  const parts = (sig.text ?? '').split(':');
  const kind = resolveKind(sig as { signature_kind?: string; text: string });
  const kindMatch = parts.length === (kind === 'provider_tee' ? 3 : 2);
  const requestHashMatch = parts[parts.length - 2] === requestHash;
  const responseHashMatch = parts[parts.length - 1] === responseHash;
  const modelMatch = kind !== 'provider_tee' ? null : parts[0] === model;
  const candidates = kind === 'gateway' ? preflight.gateway : preflight.modelTee;
  let signer: string | null = null;
  let addrOk = false;
  try {
    signer = ethers.verifyMessage(sig.text, sig.signature);
    addrOk = candidates.some((a) => signer!.toLowerCase() === String(a).toLowerCase());
  } catch {
    addrOk = false;
  }
  // A model TEE signature must commit to the requested model id.
  const modelOk = kind !== 'provider_tee' || modelMatch === true;
  const valid = kindMatch && requestHashMatch && responseHashMatch && modelOk && addrOk;
  return {
    seq, chatId, checked: true, kind, kindMatch, requestHashMatch, responseHashMatch,
    modelMatch, signer, valid,
    ...(valid ? {} : { error: 'response verification failed' }),
  };
}
