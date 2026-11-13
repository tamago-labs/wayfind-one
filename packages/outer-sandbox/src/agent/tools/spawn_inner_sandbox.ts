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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { guarded, type GuardOpts } from '../../core/guard.js';
import { WORKSPACE_DIR } from '../../core/config.js';
import { getTeamBot, getTeamConfig, saveEvidence } from '../../team/store.js';

/** The only model an inner sandbox boots by default (control plane pins it too). */
const INNER_MODEL = 'Qwen/Qwen3.8-27B';

/** Selectable inner models (frontend Models picker, localStorage). Must
 * stay in sync with control-plane CURATED_MODELS — anything else fails
 * closed there, and the inner allowlist rejects it here. */
const INNER_MODEL_ALLOWLIST = new Set([
  INNER_MODEL,
  'z-ai/glm-5.3-flash',
  'deepseek-ai/DeepSeek-V4.1-Flash-1017',
]);

/** Per-thread model override, set from /team/chat's innerModel (which the
 * frontend sends from localStorage — no database involved). Fresh per chat
 * call, so a changed picker applies to the next escalation immediately. */
const threadModels = new Map<string, string>();

export function setThreadInnerModel(ownerId: string | undefined, conversationId: string | undefined, model: string): void {
  if (!INNER_MODEL_ALLOWLIST.has(model)) return;
  threadModels.set(`${ownerId ?? 'cli'}/${conversationId ?? 'direct'}`, model);
}

function innerModelFor(opts: GuardOpts): string {
  return threadModels.get(sessionKey(opts)) ?? INNER_MODEL;
}

/** Idle sessions die lazily on next use (plus computer-terminate hook). */
const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Turn cap per session — bounds prompt/cost growth without compaction. */
const SESSION_MAX_TURNS = 10;

interface Session {
  sandboxId: string;
  lastUsedAt: number;
  turns: number;
  goals: string[];
}

const sessions = new Map<string, Session>();

/** In-memory sessions die with the process (outer restarts between turns),
 * so the map persists to the team workspace and reloads lazily. Without
 * this, follow-ups miss the cache and spawn duplicates of a live session. */
const SESSIONS_PATH = join(WORKSPACE_DIR, 'team', 'sandbox-sessions.json');
let sessionsLoaded = false;

function ensureSessionsLoaded(): void {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  try {
    if (!existsSync(SESSIONS_PATH)) return;
    const raw = JSON.parse(readFileSync(SESSIONS_PATH, 'utf8')) as Record<string, unknown>;
    for (const [key, v] of Object.entries(raw)) {
      const s = v as Partial<Session>;
      if (typeof s.sandboxId === 'string' && s.sandboxId) {
        sessions.set(key, {
          sandboxId: s.sandboxId,
          lastUsedAt: typeof s.lastUsedAt === 'number' ? s.lastUsedAt : Date.now(),
          turns: typeof s.turns === 'number' ? s.turns : 1,
          goals: Array.isArray(s.goals) ? s.goals.filter((g): g is string => typeof g === 'string') : [],
        });
      }
    }
  } catch {
    // Corrupt cache — start empty, live sessions re-resolve on next call.
  }
}

function persistSessions(): void {
  try {
    mkdirSync(join(WORKSPACE_DIR, 'team'), { recursive: true });
    writeFileSync(SESSIONS_PATH, JSON.stringify(Object.fromEntries(sessions), null, 2));
  } catch {
    // Cache write failure must never break the run.
  }
}

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

async function getJson(api: ApiCtx, path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${api.base}${path}`, { headers: api.headers });
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

interface Closeout {
  verified: boolean;
  receiptClass: string;
  receipt?: unknown;
  evidence?: unknown;
}

async function terminateSession(api: ApiCtx, sid: string, goalHash: string): Promise<Closeout> {
  try {
    const t = await postJson(api, `/sandboxes/${sid}/terminate`, {
      ...(api.computerId ? { computerId: api.computerId } : {}),
      goalHash,
    });
    const d = t.data as { verified?: boolean; receipt?: { class?: string } & Record<string, unknown>; evidence?: unknown };
    return {
      verified: t.ok && d.verified === true,
      receiptClass: d.receipt?.class ?? 'unknown',
      receipt: d.receipt,
      evidence: d.evidence,
    };
  } catch {
    return { verified: false, receiptClass: 'unknown' };
  }
}

/** Close + persist evidence + drop from the registry. Every close path
 * (explicit, idle, computer terminate) funnels through here so no session
 * ends without a stored bundle — unless it never ran (0 turns, no
 * transcript, e.g. an uncached close of an unreachable VM), in which case
 * saving an empty bundle would only pollute the closed-runs list. */
async function closeSessionWithEvidence(
  api: ApiCtx,
  key: string,
  s: Session,
  goalHash: string,
  reason: string,
): Promise<Closeout & { saved: boolean }> {
  // Grab the transcript BEFORE terminate (the VM dies after this). Best
  // effort: a missing transcript must never block closeout + receipt.
  let transcript: unknown = null;
  try {
    const t = await postJson(api, `/sandboxes/${s.sandboxId}/message`, {
      ...(api.computerId ? { computerId: api.computerId } : {}),
      sub: 'bot/transcript',
      body: {},
    });
    const d = t.data as { result?: { entries?: unknown } };
    if (t.ok && Array.isArray(d.result?.entries)) transcript = d.result.entries;
  } catch {
    // Fall through — evidence without transcript still verifies.
  }
  const out = await terminateSession(api, s.sandboxId, goalHash);
  sessions.delete(key);
  persistSessions();
  // Uncached closes (computer restarted after spawning) arrive with
  // turns: -1 — the run count is unknown, not zero. Never persist an
  // empty bundle: no turns, no transcript, nothing to verify.
  if (s.turns <= 0 && !transcript) {
    return { ...out, saved: false };
  }
  try {
    saveEvidence(s.sandboxId, {
      sandboxId: s.sandboxId,
      thread: key,
      turns: s.turns < 0 ? null : s.turns,
      goalHashes: s.goals,
      closedAt: new Date().toISOString(),
      closeReason: reason,
      transcript,
      receipt: out.receipt ?? null,
      evidence: out.evidence ?? null,
    });
  } catch (err) {
    console.error('[spawn_inner_sandbox] evidence save failed:', err instanceof Error ? err.message : String(err));
    return { ...out, saved: false };
  }
  return { ...out, saved: true };
}

/** Close every session this process holds (computer terminate hook). */
export async function terminateAllSandboxSessions(): Promise<void> {
  const api = apiCtx({} as GuardOpts);
  if ('missing' in api) return;
  ensureSessionsLoaded();
  for (const [key, s] of [...sessions]) {
    try {
      await closeSessionWithEvidence(api, key, s, `close-all:${key}`, 'computer-terminate');
    } catch {
      // Best-effort — the VM idle TTL is the backstop.
    }
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
  ensureSessionsLoaded();

  // Reuse: live session for this thread, within idle + turn bounds.
  const cached = sessions.get(key);
  if (cached) {
    if (Date.now() - cached.lastUsedAt > SESSION_IDLE_MS || cached.turns >= SESSION_MAX_TURNS) {
      await closeSessionWithEvidence(api, key, cached, goalHash, 'idle-or-budget');
    } else {
      const postGoal = (withFiles: boolean) =>
        postJson(api, `/sandboxes/${cached.sandboxId}/message`, {
          ...(api.computerId ? { computerId: api.computerId } : {}),
          sub: 'bot/message',
          body: { content: args.goal },
          ...(withFiles && stagedIds.length > 0 ? { stagedIds } : {}),
        });
      let msg = await postGoal(true);
      let reusedSealedFiles = false;
      // Staged ids are single-use: re-passing an already-consumed file fails
      // even though its bytes persist in the live session. Retry bare before
      // giving up — the session already holds the files.
      if (!msg.ok && stagedIds.length > 0 && /stag|expir|consum|already used|seal/i.test(JSON.stringify(msg.data))) {
        msg = await postGoal(false);
        reusedSealedFiles = msg.ok;
      }
      if (msg.ok) {
        const res = (msg.data as { result?: { text?: unknown; error?: string; verification?: { kind?: string; valid?: boolean } } }).result ?? {};
        if (!res.error) {
          cached.lastUsedAt = Date.now();
          cached.turns += 1;
          cached.goals.push(goalHash);
          persistSessions();
          const verification = res.verification
            ? `${res.verification.kind ?? 'unknown'}, signature ${res.verification.valid === true ? 'valid' : 'NOT valid'}`
            : 'none reported';
          return (
            `<inner_result sandbox="${cached.sandboxId}" turn="${cached.turns}" session="open" policy="verified_inference (enforced inside)" verification="${verification}">\n` +
            `${typeof res.text === 'string' && res.text ? res.text : '(empty result)'}\n` +
            (reusedSealedFiles ? `\n(files were already sealed in this session from the first run — reused without re-upload)\n` : '') +
            `</inner_result>`
          );
        }
        // Model-level error: keep the session, surface the failure.
        return `Inner sandbox run failed in the open session: \`${JSON.stringify(res.error).slice(0, 300)}\`. The session stays open — retry or close it.`;
      }
      // Transport-level failure (410 gone, unreachable): drop and respawn.
      sessions.delete(key);
      persistSessions();
    }
  }

  // Fresh spawn: init (with brief) + first turn, session stays OPEN.
  // Model comes from the thread's picker choice (localStorage → chat call),
  // defaulting to Qwen; the control-plane curated gate + inner allowlist
  // both enforce it downstream.
  const model = innerModelFor(opts);
  const spawn = await postJson(api, '/sandboxes', {
    ...(api.computerId ? { computerId: api.computerId } : {}),
    goal: args.goal,
    goalHash,
    ...(stagedIds.length > 0 ? { stagedIds } : {}),
    model,
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
    body: { system, model },
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
  sessions.set(key, { sandboxId: sid, lastUsedAt: Date.now(), turns: 1, goals: [goalHash] });
  persistSessions();
  const verification = runData.verification
    ? `${runData.verification.kind ?? 'unknown'}, signature ${runData.verification.valid === true ? 'valid' : 'NOT valid'}`
    : 'none reported';
  return (
    `<inner_result sandbox="${sid}" turn="1" session="open" policy="${spawned.policy?.securityLevel ?? 'verified_inference'} (enforced inside)" verification="${verification}">\n` +
    `${typeof runData.text === 'string' && runData.text ? runData.text : '(empty result)'}\n` +
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
      'The session registry survives restarts, so an open session stays reachable. ' +
      'File references are opaque staged ids from the user message — you never see file bytes. ' +
      'Never re-pass fileRefs already attached earlier in this thread: staged ids are single-use and ' +
      'already-consumed ids fail, while the live session already holds the files. ' +
      'This is a bounded blocking call — you stay responsible for the final answer. ' +
      'Relay the result in your own words, then quote the <inner_result> block VERBATIM at the very end (it carries the verifiable receipt for the UI). ' +
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
        ensureSessionsLoaded();
        const key = sessionKey(opts);
        const s = sessions.get(key);
        if (s) {
          const api = apiCtx(opts);
          if ('missing' in api) return `Cannot close: inner sandboxes aren't available (${api.missing}).`;
          const out = await closeSessionWithEvidence(api, key, s, `close:${key}`, 'explicit');
          const closeoutBlock = `\n<closeout sandbox="${s.sandboxId}" turns="${s.turns}" verified="${out.verified}" receipt="${out.receiptClass}"></closeout>`;
          return (
            `Inner sandbox ${s.sandboxId} closed after ${s.turns} turn(s): kill ${out.verified ? 'verified' : 'UNVERIFIED'}, receipt ${out.receiptClass}. ` +
            (out.saved ? 'Evidence saved — open it from the evidence card below or Sessions → verify.' : 'Nothing preserved — the session never ran.') +
            (out.saved ? closeoutBlock : '')
          );
        }
        // No cached session (e.g. computer restarted after spawning): fall
        // back to the control-plane registry instead of claiming nothing.
        const api = apiCtx(opts);
        if ('missing' in api) return `Cannot close: inner sandboxes aren't available (${api.missing}).`;
        const list = await getJson(api, `/sandboxes${api.computerId ? `?computerId=${encodeURIComponent(api.computerId)}` : ''}`);
        const rows = ((list.data as { sandboxes?: Array<{ sandboxId?: string }> }).sandboxes ?? []).filter(
          (r): r is { sandboxId: string } => typeof r.sandboxId === 'string',
        );
        if (rows.length === 0) return 'No open inner sandbox found for this computer — nothing to close.';
        if (rows.length > 1) {
          return `Multiple open sessions (${rows.map((r) => r.sandboxId).join(', ')}). Tell me which sandbox id to close, or close extras from Sandboxes → Live.`;
        }
        const sid = rows[0].sandboxId;
        // Run count unknown after a restart — pass -1 so closeout records
        // turns: null instead of a misleading 0.
        const out = await closeSessionWithEvidence(api, key, { sandboxId: sid, lastUsedAt: Date.now(), turns: -1, goals: [] }, `close:${key}`, 'explicit-uncached');
        const closeoutBlock = `\n<closeout sandbox="${sid}" verified="${out.verified}" receipt="${out.receiptClass}"></closeout>`;
        return (
          `Inner sandbox ${sid} closed (verified=${out.verified}, receipt ${out.receiptClass}). ` +
          (out.saved ? 'Evidence saved — open it from the evidence card below or Sessions → verify.' : 'Nothing preserved — the session never ran.') +
          (out.saved ? closeoutBlock : '')
        );
      },
      opts,
    ),
    needsApproval: async () => false,
  });
}
