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
