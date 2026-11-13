// `spawn_inner_sandbox` + `close_inner_sandbox` — escalation to disposable
// attested inner sandboxes (PLAN-P2, outer-blind).
//
// Orchestration: agents-as-tools, never a handoff — the outer agent stays
// responsible for the final answer. The outer NEVER handles sensitive bytes:
// the browser stages files control-plane-side and the tool passes opaque
// staged ids; sealing happens server-side with the inner session key.
//
// Sessions: one open sandbox per thread. First escalation spawns; follow-up
// calls reuse the live sandbox (transcript + files persist there). Idle
// 30 min, explicit close, or computer terminate ends the session with one
// signed receipt. Miss = fresh spawn, never auto-attach to another thread.
import { tool } from '@openai/agents';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guarded, type GuardOpts } from '../../core/guard.js';
import { WORKSPACE_DIR } from '../../core/config.js';
import { getTeamBot, getTeamConfig } from '../../team/store.js';

/** The only model an inner sandbox boots (control plane pins it too). */
const INNER_MODEL = 'Qwen/Qwen3.8-27B';

/** Idle sessions die lazily on next use (plus computer-terminate hook). */
const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Turn cap per session — bounds prompt/cost growth without compaction. */
const SESSION_MAX_TURNS = 10;

interface Session {
  sandboxId: string;
  lastUsedAt: number;
  turns: number;
}

const sessions = new Map<string, Session>();

function sessionKey(opts: GuardOpts): string {
  return `${opts.ownerId ?? 'cli'}/${opts.conversationId ?? 'direct'}`;
}

interface ApiCtx {
  base: string;
  headers: Record<string, string>;
  computerId?: string;
}

function apiCtx(opts: GuardOpts): ApiCtx | { missing: string } {
  const base = (opts.apiUrl ?? process.env.WAYFIND_API_URL ?? '').replace(/\/+$/, '');
  const usageToken = process.env.USAGE_TOKEN ?? '';
  const userToken = opts.userToken ?? '';
  const computerId = process.env.COMPUTER_ID ?? '';
  const missing: string[] = [];
  if (!base) missing.push('API base (WAYFIND_API_URL)');
  if (!usageToken && !userToken) missing.push('a credential (usage token on cloud, sign-in on local dev)');
  if (missing.length > 0) return { missing: missing.join(', ') };
  return {
    base,
    headers: usageToken ? { 'X-computer-usage-token': usageToken } : { Authorization: `Bearer ${userToken}` },
    ...(computerId ? { computerId } : {}),
  };
}

async function postJson(api: ApiCtx, path: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${api.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...api.headers },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: 0, data: { error: `request failed: ${err instanceof Error ? err.message : err}` } };
  }
  const data = (await res.json().catch(() => ({}))) as unknown;
  return { ok: res.ok, status: res.status, data };
}

/** Bot brief + role for the inner system prompt — training transfer. The
 * inner starts with what this bot knows; the binding is the brief hash. */
function botBriefBlock(opts: GuardOpts): { system: string; briefHash: string | null } {
  try {
    const conv = opts.conversationId ?? '';
    const botId = conv.startsWith('team/') ? conv.slice('team/'.length) : '';
    const bot = botId ? getTeamBot(botId) : null;
    const briefPath = botId ? join(WORKSPACE_DIR, 'team', 'briefs', `${botId}.md`) : '';
    const brief = briefPath && existsSync(briefPath) ? readFileSync(briefPath, 'utf8').slice(0, 8000) : '';
    const role = bot ? `You are ${bot.name}${bot.role ? ` — ${bot.role}` : ''}.${bot.description ? ` ${bot.description}` : ''}` : '';
    const text = [role, brief ? `Team brief:\n${brief}` : ''].filter(Boolean).join('\n');
    return {
      system: text,
      briefHash: brief ? createHash('sha256').update(brief, 'utf8').digest('hex').slice(0, 16) : null,
    };
  } catch {
    return { system: '', briefHash: null };
  }
}

async function terminateSession(api: ApiCtx, sid: string, goalHash: string): Promise<{ verified: boolean; receiptClass: string }> {
  try {
    const t = await postJson(api, `/sandboxes/${sid}/terminate`, {
      ...(api.computerId ? { computerId: api.computerId } : {}),
      goalHash,
    });
    const d = t.data as { verified?: boolean; receipt?: { class?: string } };
    return { verified: t.ok && d.verified === true, receiptClass: d.receipt?.class ?? 'unknown' };
  } catch {
    return { verified: false, receiptClass: 'unknown' };
  }
}

/** Close every session this process holds (computer terminate hook). */
export async function terminateAllSandboxSessions(): Promise<void> {
  const api = apiCtx({} as GuardOpts);
  if ('missing' in api) return;
  for (const [key, s] of sessions) {
    try {
      await terminateSession(api, s.sandboxId, `close-all:${key}`);
    } catch {
      // Best-effort — the VM idle TTL is the backstop.
    }
    sessions.delete(key);
  }
}

/** Escalation runner: reuse the thread's session or spawn fresh. */
async function runEscalation(
  api: ApiCtx,
  key: string,
  opts: GuardOpts,
  args: { goal: string; fileRefs?: string[]; profile?: 'review' | 'analysis' },
): Promise<string> {
  const stagedIds = Array.isArray(args.fileRefs) ? args.fileRefs.filter((r): r is string => typeof r === 'string') : [];
  const goalHash = createHash('sha256').update(args.goal, 'utf8').digest('hex');
  const brief = botBriefBlock(opts);

  // Reuse: live session for this thread, within idle + turn bounds.
  const cached = sessions.get(key);
  if (cached) {
    if (Date.now() - cached.lastUsedAt > SESSION_IDLE_MS || cached.turns >= SESSION_MAX_TURNS) {
      await terminateSession(api, cached.sandboxId, goalHash);
      sessions.delete(key);
    } else {
      const msg = await postJson(api, `/sandboxes/${cached.sandboxId}/message`, {
        ...(api.computerId ? { computerId: api.computerId } : {}),
        sub: 'bot/message',
        body: { content: args.goal },
        ...(stagedIds.length > 0 ? { stagedIds } : {}),
      });
      if (msg.ok) {
        const res = (msg.data as { result?: { text?: unknown; error?: string; verification?: { kind?: string; valid?: boolean } } }).result ?? {};
        if (!res.error) {
          cached.lastUsedAt = Date.now();
          cached.turns += 1;
          const verification = res.verification
            ? `${res.verification.kind ?? 'unknown'}, signature ${res.verification.valid === true ? 'valid' : 'NOT valid'}`
            : 'none reported';
          return (
            `<inner_result sandbox="${cached.sandboxId}" turn="${cached.turns}" session="open" policy="verified_inference (enforced inside)">\n` +
            `${typeof res.text === 'string' && res.text ? res.text : '(empty result)'}\n` +
            `${verification}\n` +
            `</inner_result>`
          );
        }
        // Model-level error: keep the session, surface the failure.
        return `Inner sandbox run failed in the open session: \`${JSON.stringify(res.error).slice(0, 300)}\`. The session stays open — retry or close it.`;
      }
      // Transport-level failure (410 gone, unreachable): drop and respawn.
      sessions.delete(key);
    }
  }

  // Fresh spawn: init (with brief) + first turn, session stays OPEN.
  const spawn = await postJson(api, '/sandboxes', {
    ...(api.computerId ? { computerId: api.computerId } : {}),
    goal: args.goal,
    goalHash,
    ...(stagedIds.length > 0 ? { stagedIds } : {}),
    model: INNER_MODEL,
    ...(args.profile === 'review' || args.profile === 'analysis' ? { profile: args.profile } : {}),
  });
  const spawned = spawn.data as { sandboxId?: string; error?: string; policy?: { securityLevel?: string } };
  if (!spawn.ok || !spawned.sandboxId) {
    return `Inner sandbox spawn failed: \`spawn → ${spawn.status}: ${spawned.error ?? 'no error detail'}\`. No sandbox was started.`;
  }
  const sid = spawned.sandboxId;
  const fail = async (why: string): Promise<string> => {
    await terminateSession(api, sid, goalHash);
    return why;
  };
  const system = [
    brief.system,
    `Inner escalation run. Goal sha256: ${goalHash}${brief.briefHash ? `, brief sha256: ${brief.briefHash}` : ''}.`,
  ]
    .filter(Boolean)
    .join('\n');
  const init = await postJson(api, `/sandboxes/${sid}/message`, {
    ...(api.computerId ? { computerId: api.computerId } : {}),
    sub: 'bot/init',
    body: { system, model: INNER_MODEL },
  });
  if (!init.ok) {
    const d = init.data as { error?: string };
    return fail(`Inner sandbox init failed: \`init → ${init.status}: ${d.error ?? 'no error detail'}\`. No session opened.`);
  }
  const run = await postJson(api, `/sandboxes/${sid}/message`, {
    ...(api.computerId ? { computerId: api.computerId } : {}),
    sub: 'bot/message',
    body: { content: args.goal },
  });
  if (!run.ok) {
    const d = run.data as { error?: string; result?: { error?: string } };
    return fail(`Inner sandbox run failed: \`message → ${run.status}: ${d.result?.error ?? d.error ?? 'no error detail'}\`. No session opened.`);
  }
  const runData = (run.data as { result?: { text?: unknown; error?: string; verification?: { kind?: string; valid?: boolean } } }).result;
  if (!runData || runData.error) {
    return fail(`Inner sandbox returned an error, session closed: \`${JSON.stringify(runData?.error ?? 'empty result').slice(0, 300)}\`.`);
  }
  sessions.set(key, { sandboxId: sid, lastUsedAt: Date.now(), turns: 1 });
  const verification = runData.verification
    ? `${runData.verification.kind ?? 'unknown'}, signature ${runData.verification.valid === true ? 'valid' : 'NOT valid'}`
    : 'none reported';
  return (
    `<inner_result sandbox="${sid}" turn="1" session="open" policy="${spawned.policy?.securityLevel ?? 'verified_inference'} (enforced inside)">\n` +
    `${typeof runData.text === 'string' && runData.text ? runData.text : '(empty result)'}\n` +
    `${verification}\n` +
    `</inner_result>`
  );
}

/** Manual mode asks (approval card is the confirm); auto-logged runs free. */
async function escalationAsks(): Promise<boolean> {
  if (process.env.PERMISSION_MODE === 'permissive') return false;
  try {
    return getTeamConfig().escalation !== 'auto-logged';
  } catch {
    return true;
  }
}

export function createSpawnInnerSandboxTool(opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'spawn_inner_sandbox',
    description:
      'Run sensitive work in a disposable attested inner sandbox (near-ai only, killed after the task). ' +
      'Policy is enforced inside the sandbox itself: verified_inference is mandatory, attestation ' +
      'preflight must pass, and only the run allowlist models can infer — the sandbox refuses otherwise. ' +
      'One open session per thread: the first call spawns, follow-ups reuse the live sandbox (transcript + files persist). ' +
      'File references are opaque staged ids from the user message — you never see file bytes. ' +
      'Use for sensitive files or data that must never land on this computer. ' +
      'This is a bounded blocking call — you stay responsible for the final answer; relay the result in your own words. ' +
      'Only name staged files listed in your context, never invent ids.',
    parameters: z.object({
      goal: z.string().describe('What the inner sandbox should do, as a self-contained task'),
      fileRefs: z.array(z.string()).describe('Staged file ids from the user message (opaque — pass through untouched)').optional(),
      profile: z.enum(['review', 'analysis']).describe('Sandbox profile: review is read-only and cheapest, analysis allows local exec').optional(),
    }),
    execute: guarded(
      'spawn_inner_sandbox',
      (a: { goal: string }) => a.goal.slice(0, 80),
      async (a: { goal: string; fileRefs?: string[]; profile?: 'review' | 'analysis' }) => {
        if (!a.goal.trim()) return 'spawn_inner_sandbox needs a goal.';
        const api = apiCtx(opts);
        if ('missing' in api) {
          return (
            `Inner sandboxes aren't available from this computer (missing: ${api.missing}). ` +
            `On local dev, make sure you're signed in; on a cloud computer this is configured automatically.`
          );
        }
        return runEscalation(api, sessionKey(opts), opts, a);
      },
      opts,
    ),
    needsApproval: async () => escalationAsks(),
  });
}

export function createCloseInnerSandboxTool(opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'close_inner_sandbox',
    description:
      'Close this thread\'s open inner sandbox session now: final checkpoint, signed receipt, verified VM kill. ' +
      'Call when the sensitive work is fully done. Closing is safe — the receipt preserves the evidence.',
    parameters: z.object({}),
    execute: guarded(
      'close_inner_sandbox',
      () => 'close',
      async () => {
        const key = sessionKey(opts);
        const s = sessions.get(key);
        if (!s) return 'No open inner sandbox for this thread — nothing to close.';
        const api = apiCtx(opts);
        if ('missing' in api) return `Cannot close: inner sandboxes aren't available (${api.missing}).`;
        sessions.delete(key);
        const out = await terminateSession(api, s.sandboxId, `close:${key}`);
        return `Inner sandbox ${s.sandboxId} closed after ${s.turns} turn(s): kill ${out.verified ? 'verified' : 'UNVERIFIED'}, receipt ${out.receiptClass}.`;
      },
      opts,
    ),
    needsApproval: async () => false,
  });
}
