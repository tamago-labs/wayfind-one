import { apiFetch, apiFetchRaw } from './wayfind';

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

/** Answer a chief-proposed bot request (parks the run until answered).
 * Confirm creates the file server-side; cancel (optionally with error
 * so the model retries, e.g. name taken) resumes without creating. */
export async function answerBotRequest(bid: string, decision: 'confirm' | 'cancel', error?: string): Promise<void> {
  await teamFetch(`/bot-requests/${bid}`, {
    method: 'POST',
    body: { decision, ...(error ? { error } : {}) },
  });
}

/** Answer a parked clarifying question. The run continues with your answers. */
export async function answerQuestion(qid: string, answers: string[][]): Promise<void> {
  await teamFetch(`/questions/${qid}`, { method: 'POST', body: { answers } });
}

/** Resolve a parked approval. The run resumes and streams on. */
export async function decideApproval(approvalId: string, decision: 'approve' | 'reject' | 'approve-all'): Promise<void> {
  await teamFetch(`/approvals/${approvalId}`, { method: 'POST', body: { decision } });
}

/** Voice: post a WAV blob, get the transcript back (Meta STT server-side). */
export async function transcribeVoice(wav: Blob): Promise<{ transcript: string; audioDurationMs: number }> {
  if (DIRECT) {
    const res = await fetch(`${DIRECT}/voice/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: wav,
    });
    const data = (await res.json().catch(() => ({}))) as { transcript?: string; audioDurationMs?: number; error?: string };
    if (!res.ok) throw new Error(data.error ?? `Voice transcribe failed (${res.status})`);
    return { transcript: data.transcript ?? '', audioDurationMs: data.audioDurationMs ?? 0 };
  }
  return apiFetchRaw('/computer/proxy/voice/transcribe?kind=one_outer', {
    method: 'POST',
    contentType: 'audio/wav',
    body: wav,
  });
}
/** Compress a user's first message into a short role label (no tools). */
export async function summarizeRole(text: string): Promise<string | null> {
  try {
    const out = await teamFetch<{ role?: string }>('/summarize-role', { method: 'POST', body: { text } });
    return out.role ?? null;
  } catch {
    return null;
  }
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

export async function teamChat(botId: string, text: string, ownerId?: string, hello?: boolean): Promise<{ runId: string }> {
  return teamFetch('/team/chat', {
    method: 'POST',
    body: { botId, text, ...(ownerId ? { ownerId } : {}), ...(hello ? { hello: true } : {}) },
  });
}

export interface RunEvent {
  type?: string;
  chunk?: string;
  agent?: string;
  bid?: string;
  botName?: string;
  botRole?: string;
  botDescription?: string;
  qid?: string;
  questions?: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
  }>;
  approvalId?: string;
  permission?: string;
  target?: string;
  output?: string;
  error?: string;
}

export async function runEvents(runId: string, cursor = 0): Promise<{ events: RunEvent[]; nextCursor: number; done: boolean }> {
  return teamFetch(`/runs/${runId}/events?cursor=${cursor}`);
}

export interface RunHandlers {
  onChunk?: (delta: string) => void;
  onAgent?: (label: string) => void;
  onBotRequest?: (r: { bid: string; botName: string; botRole?: string; botDescription?: string }) => void;
  onQuestion?: (q: { qid: string; questions: NonNullable<RunEvent['questions']> }) => void;
  onApproval?: (a: { approvalId: string; permission?: string; target?: string }) => void;
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
      } else if (e.type === 'bot_request' && typeof e.bid === 'string' && typeof e.botName === 'string') {
        handlers.onBotRequest?.({
          bid: e.bid,
          botName: e.botName,
          ...(typeof e.botRole === 'string' ? { botRole: e.botRole } : {}),
          ...(typeof e.botDescription === 'string' ? { botDescription: e.botDescription } : {}),
        });
      } else if (e.type === 'question' && typeof e.qid === 'string' && Array.isArray(e.questions)) {
        handlers.onQuestion?.({ qid: e.qid, questions: e.questions });
      } else if (e.type === 'approval' && typeof e.approvalId === 'string') {
        handlers.onApproval?.({
          approvalId: e.approvalId,
          ...(typeof e.permission === 'string' ? { permission: e.permission } : {}),
          ...(typeof e.target === 'string' ? { target: e.target } : {}),
        });
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
