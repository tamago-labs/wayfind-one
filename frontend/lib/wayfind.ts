import { fetchAuthSession } from 'aws-amplify/auth';
import outputs from '@/amplify_outputs.json';

const custom = (outputs as unknown as { custom?: { wayfindApi?: { functionUrl?: string } } }).custom;
const API_BASE = (custom?.wayfindApi?.functionUrl ?? '').replace(/\/$/, '');
if (!API_BASE) console.warn('[wayfind] functionUrl missing from amplify_outputs.json — re-copy it from wayfind-cloud');

async function idToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error('Not signed in');
  return token;
}

export async function apiFetch<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${await idToken()}`,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `request failed (${res.status})`);
  return data as T;
}

/** Raw-body sibling of apiFetch (voice blobs etc.): forwards bytes + content-type untouched. */
export async function apiFetchRaw<T = unknown>(path: string, opts: { method?: string; contentType?: string; body?: BodyInit } = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${await idToken()}`,
      ...(opts.contentType ? { 'Content-Type': opts.contentType } : {}),
    },
    body: opts.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `request failed (${res.status})`);
  return data as T;
}

export interface ConversationMeta {
  conversationId: string;
  botId: string | null;
  model: string;
  provider: string;
  securityLevel: string;
  status: string;
  checkpointManifest: string[];
  receipt: ReceiptV0 | null;
  provisionedAt: string | null;
  lastUsedAt: string | null;
  terminatedAt: string | null;
}

export interface ReceiptV0 {
  version: string;
  class: string;
  conversationId: string;
  botId: string | null;
  botBundleHash: string | null;
  workspaceHash: string | null;
  model: string | null;
  provider: string | null;
  securityLevel: string | null;
  checkpointManifest: string[];
  provisionedAt: string | null;
  terminatedAt: string | null;
  cleanup?: { vmTerminated?: boolean };
  signature?: { kid?: string; algo?: string; sig?: string };
  inference?: {
    preflight?: {
      at?: string; nonce?: string; model?: string; nodes?: number;
      nonceEchoed?: boolean; modelTee?: string[]; gateway?: string[];
      nvidia?: { overall?: boolean; nonceMatch?: boolean | null; gpus?: number } | null;
    } | null;
    messages?: Array<{
      seq?: number; chatId?: string | null; checked?: boolean; kind?: string;
      kindMatch?: boolean; requestHashMatch?: boolean; responseHashMatch?: boolean;
      modelMatch?: boolean | null; signer?: string | null; valid?: boolean; error?: string;
    }>;
    verified?: boolean;
  } | null;
}

export async function listConversations(): Promise<ConversationMeta[]> {
  const out = await apiFetch<{ conversations: ConversationMeta[] }>('/conversations');
  return out.conversations ?? [];
}

export async function createConversation(input: {
  botId?: string;
  model?: string;
  securityLevel?: string;
}): Promise<{ conversationId: string; model: string; provider: string; securityLevel: string }> {
  return apiFetch('/conversations', { method: 'POST', body: input });
}

export async function relayMessage<T = unknown>(id: string, sub: string, body: unknown): Promise<T> {
  const out = await apiFetch<{ result: T }>(`/conversations/${id}/message`, {
    method: 'POST',
    body: { sub, body },
  });
  return out.result;
}

export async function terminateConversation(id: string): Promise<{ ok: boolean; verified: boolean; receipt: ReceiptV0 }> {
  return apiFetch(`/conversations/${id}/terminate`, { method: 'POST', body: {} });
}

export async function pushWorkspace(id: string, files: Array<{ path: string; contentBase64: string }>): Promise<{ ok: boolean; pushed: number; workspaceHash: string }> {
  return apiFetch(`/conversations/${id}/workspace`, { method: 'POST', body: { files } });
}

export async function conversationKeys(id: string): Promise<{ key: string; workspaceKey: string }> {
  return apiFetch(`/conversations/${id}/key`);
}

export async function checkpointUrl(id: string, seq: number): Promise<{ blobKey: string; url: string; sha256: string | null }> {
  return apiFetch(`/conversations/${id}/checkpoint-url?seq=${seq}`);
}

export async function checkpointBlob(id: string, seq: number): Promise<{ blobKey: string; sha256: string | null; envelope: { sha256?: string; nonce?: string; data?: string } }> {
  return apiFetch(`/conversations/${id}/checkpoint-blob?seq=${seq}`);
}

export async function verifyReceiptServer(receipt: unknown): Promise<{ ok: boolean; valid: boolean; kid?: string; signerMatch?: boolean; checks?: Array<{ name: string; pass: boolean; detail?: string }>; reason?: string }> {
  return apiFetch(`/verify-receipt`, { method: 'POST', body: { receipt } });
}

export async function verificationReports(id: string, chatId?: string): Promise<{ reports: unknown[] }> {
  return apiFetch(`/conversations/${id}/verification-reports${chatId ? `?chatId=${encodeURIComponent(chatId)}` : ''}`);
}

export interface Policy {
  mandatoryLevel: 'none' | 'standard' | 'verified_inference';
  allowedModels: string[];
  maxIdleTtlSeconds: number;
}

export async function getPolicy(): Promise<{ policy: Policy }> {
  return apiFetch('/policy');
}

export async function putPolicy(body: Partial<Policy>): Promise<{ ok: boolean; policy: Policy }> {
  return apiFetch('/policy', { method: 'PUT', body });
}

export interface AuditEvent {
  at: string | null;
  actor: string | null;
  action: string | null;
  conversationId: string | null;
  detail: unknown;
}

export async function listAudit(opts: { conversationId?: string; limit?: number } = {}): Promise<{ events: AuditEvent[] }> {
  const qs = new URLSearchParams({ limit: String(opts.limit ?? 50), ...(opts.conversationId ? { conversationId: opts.conversationId } : {}) });
  return apiFetch(`/audit?${qs.toString()}`);
}

export async function exportEvidence(id: string): Promise<unknown> {
  return apiFetch(`/conversations/${id}/export-evidence`, { method: 'POST', body: {} });
}

export async function imageTrust(): Promise<{ imageTrust: { imageArn: string | null; imageVersion: string | null; zipSha256: string | null; sbomSha256: string | null; builtAt: string | null; publishedAt: string | null; signature: { kid?: string; algo?: string; sig?: string } | null } }> {
  return apiFetch('/image-trust');
}

// ---- Inner sandboxes (outer-blind escalation) ----

// Browser → control plane staged uploads. Bytes never touch the outer VM:
// the browser stages here, the outer passes opaque ids, the inner receives
// sealed envelopes.

export interface SandboxFileInput {
  name: string;
  contentBase64: string;
}

export type SandboxProfile = 'review' | 'analysis';

export interface StagedFile {
  fileId: string;
  name: string;
  sha256: string;
  size: number;
}

export async function stageFiles(files: SandboxFileInput[]): Promise<{ staged: StagedFile[] }> {
  return apiFetch('/sandboxes/stage', { method: 'POST', body: { files } });
}

export interface SandboxLive {
  sandboxId: string;
  profile: SandboxProfile;
  policy: string;
  parentComputerId: string | null;
  provisionedAt: string | null;
  lastUsedAt: string | null;
}

export async function listSandboxes(): Promise<{ sandboxes: SandboxLive[] }> {
  return apiFetch('/sandboxes');
}

export async function terminateSandbox(id: string): Promise<{ ok?: boolean; verified?: boolean; receipt?: unknown; error?: string }> {
  return apiFetch(`/sandboxes/${encodeURIComponent(id)}/terminate`, { method: 'POST', body: {} });
}
