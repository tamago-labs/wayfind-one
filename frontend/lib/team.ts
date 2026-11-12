import { apiFetch } from './wayfind';

/**
 * Team client. Production path: control-plane proxy
 * (/computer/proxy/* → the outer VM). Pre-deploy escape hatch: set
 * NEXT_PUBLIC_OUTER_DIRECT=http://localhost:8080 to talk to a local
 * outer-sandbox server straight from the browser (its CORS default is *).
 */
const DIRECT = (process.env.NEXT_PUBLIC_OUTER_DIRECT ?? '').replace(/\/+$/, '');

async function teamFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (DIRECT) {
    const res = await fetch(`${DIRECT}${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `request failed (${res.status})`);
    return data as T;
  }
  // kind rides the query string so the proxy relays to the outer VM even
  // when the user also holds a classic computer (one per kind).
  const sep = path.includes('?') ? '&' : '?';
  return apiFetch<T>(`/computer/proxy${path}${sep}kind=one_outer`, {
    ...(init?.method ? { method: init.method } : {}),
    ...(init?.body !== undefined ? { body: init.body } : {}),
  });
}

export type BotColor = 'amber' | 'moss' | 'lagoon' | 'ash' | 'blue' | 'coral' | 'grape';
export type BotShape = 'blob' | 'circle' | 'squircle' | 'pebble';

export interface TeamBot {
  id: string;
  name: string;
  role?: string | null;
  description?: string | null;
  color?: BotColor | null;
  shape?: BotShape | null;
  isChiefOfStaff?: boolean | null;
  status?: string | null;
  model?: string | null;
}

export interface HistoryEntry {
  seq: number;
  role: 'user' | 'assistant';
  content: string;
}

export async function listTeamBots(): Promise<TeamBot[]> {
  const out = await teamFetch<{ bots: TeamBot[] }>('/team/bots');
  return out.bots ?? [];
}

export async function saveTeamBot(input: {
  id?: string;
  name: string;
  role?: string;
  description?: string;
  color?: BotColor;
  shape?: BotShape;
  isChiefOfStaff?: boolean;
}): Promise<TeamBot> {
  const out = await teamFetch<{ bot: TeamBot }>('/team/bots', { method: 'POST', body: input });
  return out.bot;
}

export async function deleteTeamBot(id: string): Promise<void> {
  await teamFetch<{ ok: boolean }>(`/team/bots/${id}`, { method: 'DELETE' });
}

export interface BotEdits {
  name: string;
  role: string;
  isChiefOfStaff: boolean;
  color: BotColor;
  shape: BotShape;
}

export async function teamHistory(botId: string): Promise<{ entries: HistoryEntry[]; verified: boolean }> {
  return teamFetch(`/team/history/${botId}`);
}

export async function teamChat(botId: string, text: string, ownerId?: string): Promise<{ runId: string }> {
  return teamFetch('/team/chat', {
    method: 'POST',
    body: { botId, text, ...(ownerId ? { ownerId } : {}) },
  });
}

export interface RunEvent {
  type?: string;
  chunk?: string;
  agent?: string;
  output?: string;
  error?: string;
}

export async function runEvents(runId: string, cursor = 0): Promise<{ events: RunEvent[]; nextCursor: number; done: boolean }> {
  return teamFetch(`/runs/${runId}/events?cursor=${cursor}`);
}

export interface RunHandlers {
  onChunk?: (delta: string) => void;
  onAgent?: (label: string) => void;
}

/**
 * Progressive run follower (mirrors wayfind-cloud streamRunProgressive):
 * polls the events endpoint ~1/s and dispatches chunk deltas as they land,
 * so the reply renders token-by-token instead of popping in at done.
 * The cloud relay buffers SSE, so polling IS the streaming path.
 */
export async function waitForRun(runId: string, handlers: RunHandlers = {}, timeoutMs = 600_000): Promise<string> {
  let cursor = 0;
  let output = '';
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error('agent run timed out');
    const { events, nextCursor, done } = await runEvents(runId, cursor);
    cursor = nextCursor;
    for (const e of events ?? []) {
      if (e.type === 'chunk' && typeof e.chunk === 'string') {
        output += e.chunk;
        handlers.onChunk?.(e.chunk);
      } else if (e.type === 'agent' && typeof e.agent === 'string') {
        handlers.onAgent?.(e.agent);
      } else if (e.type === 'done') {
        if (typeof e.output === 'string') output = e.output;
        return output;
      } else if (e.type === 'error') {
        throw new Error(typeof e.error === 'string' ? e.error : 'agent run failed');
      }
    }
    if (done) return output;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
