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

export interface TeamBot {
  id: string;
  name: string;
  role?: string | null;
  description?: string | null;
  color?: string | null;
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
}): Promise<TeamBot> {
  const out = await teamFetch<{ bot: TeamBot }>('/team/bots', { method: 'POST', body: input });
  return out.bot;
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
  output?: string;
  error?: string;
}

export async function runEvents(runId: string, cursor = 0): Promise<{ events: RunEvent[]; nextCursor: number; done: boolean }> {
  return teamFetch(`/runs/${runId}/events?cursor=${cursor}`);
}

/** Poll a run to completion (proxy buffers SSE — events polling is the path). */
export async function waitForRun(runId: string, onTick?: (events: RunEvent[]) => void): Promise<string> {
  let cursor = 0;
  for (;;) {
    const { events, nextCursor, done } = await runEvents(runId, cursor);
    cursor = nextCursor;
    if (onTick && events.length > 0) onTick(events);
    const hit = events.find((e) => e.type === 'done');
    if (hit) return hit.output ?? '';
    if (done) throw new Error('run finished with no done event');
    await new Promise((r) => setTimeout(r, 1000));
  }
}
