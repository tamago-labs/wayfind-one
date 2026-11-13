// `spawn_inner_sandbox` tool — escalation to a disposable attested inner
// sandbox (PLAN-P2 Phase 2, wired).
//
// Orchestration: agents-as-tools, never a handoff — the outer agent stays
// responsible for the final answer and this tool is a bounded blocking call:
// spawn → init → run goal → terminate, returning { result, evidence }.
// No sub-agents on the escalation path; no escalation tool inside inner
// sandboxes (nesting cap 2, enforced control-plane-side).
//
// Auth: the computer's usage token (X-computer-usage-token + COMPUTER_ID,
// both injected at provision); local dev falls back to the user's JWT.
// The inner session bearer never leaves the control plane — every inner
// call relays through /sandboxes/:id/*.
import { tool } from '@openai/agents';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { guarded, type GuardOpts } from '../../core/guard.js';
import { WORKSPACE_DIR } from '../../core/config.js';
import { getTeamConfig } from '../../team/store.js';

/** The only model an inner sandbox boots (control plane pins it too). */
const INNER_MODEL = 'Qwen/Qwen3.8-27B';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

/** Read workspace-relative refs into pushable inputs. Jailed, capped. */
function readInputs(refs: string[]): { inputs: Array<{ path: string; contentBase64: string }> } | { error: string } {
  const root = resolve(WORKSPACE_DIR);
  const inputs: Array<{ path: string; contentBase64: string }> = [];
  for (const ref of refs.slice(0, MAX_FILES)) {
    const parts = String(ref).replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
    if (parts.length === 0 || parts.some((s) => s === '..' || s === '.wayfind')) {
      return { error: `refusing file ref outside the workspace: ${ref}` };
    }
    const rel = parts.join('/');
    let buf: Buffer;
    try {
      const abs = resolve(join(root, ...parts));
      if (abs !== root && !abs.startsWith(root + sep)) return { error: `refusing file ref outside the workspace: ${ref}` };
      const st = statSync(abs);
      if (!st.isFile()) return { error: `not a file: ${ref}` };
      if (st.size > MAX_FILE_BYTES) return { error: `${ref} exceeds 10MB` };
      buf = readFileSync(abs);
    } catch {
      return { error: `cannot read workspace file: ${ref}` };
    }
    inputs.push({ path: rel, contentBase64: buf.toString('base64') });
  }
  return { inputs };
}

/** Escalation runner: spawn → init → run → terminate. Returns text. */
async function runEscalation(
  api: ApiCtx,
  args: { goal: string; fileRefs?: string[]; profile?: 'review' | 'analysis' },
): Promise<string> {
  const refs = Array.isArray(args.fileRefs) ? args.fileRefs.filter((r): r is string => typeof r === 'string') : [];
  const read = readInputs(refs);
  if ('error' in read) return `Inner sandbox rejected the file refs: ${read.error}. Fix the paths and try again.`;
  const goalHash = createHash('sha256').update(args.goal, 'utf8').digest('hex');

  const spawn = await postJson(api, '/sandboxes', {
    ...(api.computerId ? { computerId: api.computerId } : {}),
    goal: args.goal,
    goalHash,
    fileInputs: read.inputs,
    model: INNER_MODEL,
    ...(args.profile === 'review' || args.profile === 'analysis' ? { profile: args.profile } : {}),
  });
  const spawned = spawn.data as { sandboxId?: string; error?: string; policy?: { securityLevel?: string } };
  if (!spawn.ok || !spawned.sandboxId) {
    // Quote the backend error verbatim so failures stay diagnosable
    // instead of being paraphrased away.
    return `Inner sandbox spawn failed: \`spawn → ${spawn.status}: ${spawned.error ?? 'no error detail'}\`. No sandbox was started.`;
  }
  const sid = spawned.sandboxId;
  const fail = async (why: string): Promise<string> => {
    await postJson(api, `/sandboxes/${sid}/terminate`, {
      ...(api.computerId ? { computerId: api.computerId } : {}),
      goalHash,
    }).catch(() => null);
    return why;
  };

  const init = await postJson(api, `/sandboxes/${sid}/message`, {
    ...(api.computerId ? { computerId: api.computerId } : {}),
    sub: 'bot/init',
    body: { system: `Inner escalation run. Goal sha256: ${goalHash}.`, model: INNER_MODEL },
  });
  if (!init.ok) {
    const d = init.data as { error?: string };
    return fail(`Inner sandbox init failed: ${d.error ?? `backend → ${init.status}`}. The sandbox was terminated.`);
  }
  const run = await postJson(api, `/sandboxes/${sid}/message`, {
    ...(api.computerId ? { computerId: api.computerId } : {}),
    sub: 'bot/message',
    body: { content: args.goal },
  });
  if (!run.ok) {
    const d = run.data as { error?: string; result?: { error?: string } };
    return fail(`Inner sandbox run failed: \`message → ${run.status}: ${d.result?.error ?? d.error ?? 'no error detail'}\`. The sandbox was terminated.`);
  }
  const runData = (run.data as { result?: { text?: unknown; verification?: { kind?: string; valid?: boolean } } }).result;
  const verification = runData?.verification;
  const term = await postJson(api, `/sandboxes/${sid}/terminate`, {
    ...(api.computerId ? { computerId: api.computerId } : {}),
    goalHash,
  });
  const t = term.data as {
    ok?: boolean;
    verified?: boolean;
    receipt?: { class?: string; signature?: unknown };
    result?: unknown;
    evidence?: unknown;
    error?: string;
  };
  if (!term.ok) {
    return fail(`Inner sandbox finished but terminate failed: \`terminate → ${term.status}: ${t.error ?? 'no error detail'}\`. Treat the result as unverified.`);
  }
  const text = (runData?.text ?? '') as string;
  const receiptClass = t.receipt?.class ?? 'unknown';
  const enforcedPolicy = spawned.policy?.securityLevel ?? 'verified_inference';
  const verifiedLine = verification
    ? `response verification: ${verification.kind ?? 'unknown'}, signature ${verification.valid === true ? 'valid' : 'NOT valid'}`
    : 'response verification: none reported';
  return (
    `<inner_result sandbox="${sid}" goal-sha256="${goalHash}" policy="${enforcedPolicy} (enforced inside the sandbox)" closeout="${t.verified === true ? 'verified kill' : 'kill UNVERIFIED'}, receipt ${receiptClass}">\n` +
    `${typeof text === 'string' && text ? text : '(inner run returned no text — see evidence)'}\n` +
    `${verifiedLine}\n` +
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
        'Use when the task involves sensitive files or data that must never land on this computer: ' +
        'files go sealed direct-to-inner, and { result, evidence } comes back. ' +
        'This is a bounded blocking call — you stay responsible for the final answer; relay the result in your own words. ' +
        'Only name workspace files you have actually listed or read.',
    parameters: z.object({
      goal: z.string().describe('What the inner sandbox should do, as a self-contained task'),
      fileRefs: z.array(z.string()).describe('Workspace-relative file paths to push sealed direct-to-inner').optional(),
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
        return runEscalation(api, a);
      },
      opts,
    ),
    needsApproval: async () => escalationAsks(),
  });
}
