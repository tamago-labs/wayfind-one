// Agent HTTP + SSE server. Serves the browser direct (SSE) and the
// MicroVM lifecycle hooks. P0 routes only; auth + approvals land in P1.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import OpenAI from 'openai';
import { PORT, PROVIDER_BASE_URL, PROVIDER_MODEL, WORKSPACE_DIR, keysReady } from './core/config.js';
import { permissionMode } from './core/guard.js';
import { hasSearchKey } from './agent/tools/web.js';
import { initProvider, reinitProvider } from './providers/provider.js';
import { loadCatalog, resolveApiKey, clearProviderCache } from './providers/providers.js';
import { writeKey } from './providers/keystore.js';
import { pullWorkspace, pushWorkspace, type SyncCtx } from './cloud/sync.js';
import { loadRules, saveRules, undoRules, canUndoRules } from './core/permissions.js';
import { getRun, getHistory, listPendingApprovals, listPendingBotRequests,
  listPendingQuestions, listRuns, resolveApproval, answerBotRequest, answerQuestion, startRun, onRunSettled } from './runs/runner.js';
import { reportUsage } from './runs/usage.js';
import { listInstalledSkills, removeSkill, resolveSkillSource, saveSkillPreview, scanLocalSkills, validateSkillPreview } from './agent/skills.js';
import { listMcpServers, patchMcpServer, removeMcpServer, restartMcpServer, saveMcpServer } from './agent/mcp.js';
import { transcribeWav, VoiceError } from './voice/transcribe.js';
import { ensureTeamSeed, getTeamBot, getTeamConfig, listTeamBots, readHistory, saveTeamBot, saveTeamConfig, toRosterEntry, verifyTeamManifest } from './team/store.js';

/** Browser origin for local dev (Amplify dev server). Loosen only for local. */
const CORS_ORIGIN = process.env.AGENT_CORS_ORIGIN ?? '*';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders() });
  res.end(JSON.stringify(body));
}

/** Per-VM cloud identity, injected by POST /hooks/run. Null locally. */
let cloudIdentity: { ownerId?: string; computerId?: string } | null = null;
/** S3 workspace sync target, injected by POST /hooks/run. Null locally. */
let workspaceSync: { bucket: string; prefix: string } | null = null;
/** Boot pull backfill runs once, on the first /task carrying an API base. */
let bootPulled = false;

/** Lambda runtime hook prefix (docs: /aws/lambda-microvms/runtime/v1/<hook>). */
const RT_PREFIX = '/aws/lambda-microvms/runtime/v1';

interface RunHookBody {
  ownerId?: string;
  computerId?: string;
  secrets?: Record<string, string>;
  apiUrl?: string;
  taskRunId?: string;
  /** Per-computer usage-report token (provision-minted, stored on the row).
   * The VM reports metered calls with it — it holds no Cognito identity. */
  usageToken?: string;
  workspace?: { bucket?: string; prefix?: string };
  /** Which product owns this computer. This image serves one_outer only —
   * a foreign kind fails closed (refuse to boot on the wrong computer). */
  kind?: string;
}

async function doRunHook(body: RunHookBody): Promise<{ ok: boolean; initialized: boolean; identity: typeof cloudIdentity }> {
  if (typeof body.kind === 'string' && body.kind && body.kind !== 'one_outer') {
    throw new Error(`refusing foreign kind '${body.kind}' — this image serves one_outer only`);
  }
  if (body.secrets && typeof body.secrets === 'object') {
    for (const [k, v] of Object.entries(body.secrets)) {
      if (typeof v === 'string' && v && /^[A-Za-z0-9_]+$/.test(k)) writeKey(k, v);
    }
  }
  if (typeof body.apiUrl === 'string' && body.apiUrl) process.env.WAYFIND_API_URL = body.apiUrl;
  if (typeof body.taskRunId === 'string' && body.taskRunId) process.env.TASK_RUN_ID = body.taskRunId;
  if (typeof body.usageToken === 'string' && body.usageToken) process.env.USAGE_TOKEN = body.usageToken;
  if (typeof body.ownerId === 'string' && body.ownerId) {
    cloudIdentity = { ...(cloudIdentity ?? {}), ownerId: body.ownerId.slice(0, 128) };
  }
  if (typeof body.computerId === 'string' && body.computerId) {
    cloudIdentity = { ...(cloudIdentity ?? {}), computerId: body.computerId.slice(0, 128) };
  }
  if (body.workspace?.bucket && body.workspace?.prefix) {
    workspaceSync = { bucket: body.workspace.bucket, prefix: body.workspace.prefix };
    // Restore this computer's files (missing-only — never clobbers).
    // Presigned pull needs the API base: provision sends it via /hooks/run,
    // otherwise the first /task (frontend always sends it) triggers the pull.
    const ctx = syncCtx();
    if (ctx) {
      try {
        await pullWorkspace(ctx);
      } catch (err) {
        console.error('[hooks/run] workspace pull failed:', err instanceof Error ? err.message : err);
      }
    }
  }
  // New keys → drop cached model clients so they take effect now.
  clearProviderCache();
  reinitProvider();
  // Team restore check: seed skeleton on first boot, verify the manifest
  // after a workspace pull. A corrupt config fails closed (empty team +
  // flagged); manifest gaps only log — the pull is missing-only.
  ensureTeamSeed(PROVIDER_MODEL);
  const manifest = verifyTeamManifest();
  if (!manifest.ok) {
    console.error('[hooks/run] team manifest mismatch:', JSON.stringify({ missing: manifest.missing, changed: manifest.changed }));
  }
  return { ok: true, initialized: keysReady(), identity: cloudIdentity };
}

/** Sync context for presigned transfers: API base + usage token from env,
 * computer id from the injected cloud identity. Null when sync is
 * unavailable (local dev, or provision predating COMPUTER_API_URL). */
function syncCtx(): SyncCtx | null {
  const apiBase = (process.env.WAYFIND_API_URL ?? '').replace(/\/+$/, '');
  const token = process.env.USAGE_TOKEN ?? '';
  const computerId = cloudIdentity?.computerId;
  if (!workspaceSync || !apiBase || !token || !computerId) return null;
  return { apiBase, token, computerId };
}

async function doSuspend(): Promise<{ ok: boolean; pushed?: number; bytes?: number; skipped?: string; error?: string }> {
  const ctx = syncCtx();
  if (!ctx) return { ok: true, skipped: 'no workspace sync configured' };
  try {
    const { pushed, bytes } = await pushWorkspace(ctx);
    return { ok: true, pushed, bytes };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[hooks/suspend] workspace push failed:', msg);
    return { ok: false, error: `push failed: ${msg}` };
  }
}

async function doResume(): Promise<{ ok: boolean; pulled?: number; skipped?: number | string; error?: string }> {
  const ctx = syncCtx();
  if (!ctx) return { ok: true, skipped: 'no workspace sync configured' };
  try {
    const { pulled, skipped } = await pullWorkspace(ctx);
    return { ok: true, pulled, skipped };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `pull failed: ${msg}` };
  }
}

async function doTerminate(): Promise<{ ok: boolean }> {
  const ctx = syncCtx();
  if (ctx) {
    try {
      await pushWorkspace(ctx);
    } catch (err) {
      console.error('[hooks/terminate] final push failed:', err instanceof Error ? err.message : err);
    }
  }
  return { ok: true };
}

/** Boot never crashes on missing keys: cloud VMs start keyless and wait
 * for /hooks/run; local dev gets the loud warning instead of a boot. */
function requireApiKeyOptIn(): void {
  if (!keysReady()) {
    console.error(
      'No API keys (.env or workspace keystore) — booting uninitialized. ' +
        'POST /hooks/run to inject (cloud) or add packages/computer/.env (local).',
    );
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function readBytes(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sse(res: ServerResponse, runId: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    ...corsHeaders(),
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let cursor = 0;
  let ticks = 0;
  const timer = setInterval(() => {
    const r = getRun(runId);
    if (!r) {
      res.write(`data: ${JSON.stringify({ error: 'unknown run' })}\n\n`);
      clearInterval(timer);
      res.end();
      return;
    }
    let wrote = false;
    while (cursor < r.events.length) {
      res.write(`data: ${JSON.stringify(r.events[cursor])}\n\n`);
      cursor += 1;
      wrote = true;
    }
    // Heartbeat comment every ~15s of silence: keeps long runs (parallel
    // subagents, parked approvals) alive through idle-killing proxies, and
    // is ignored by SSE clients (not a `data:` line).
    ticks += 1;
    if (!wrote && ticks % 60 === 0) res.write(': ping\n\n');
    if (r.done) {
      clearInterval(timer);
      res.end();
    }
  }, 250);
  timer.unref?.();
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const method = req.method ?? 'GET';

  // CORS preflight for browser clients (local dev).
  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return void res.end();
  }

  // Lifecycle hooks. Two path sets, one implementation:
  // - Lambda runtime paths (/aws/lambda-microvms/runtime/v1/*): Lambda
  //   itself calls these. /run MUST return 200 or the endpoint never
  //   forwards traffic (callers see 502). /ready is POST during builds.
  // - Our /hooks/* + GET /ready: same handlers for scripts/manager calls.
  // Cloud identity: one golden image, many VMs — /run injects per-VM
  // identity + secrets (passed by the caller, never baked).
  // .wayfind/ (keystore) never leaves the VM: suspend/terminate sync the
  // workspace to S3, /run re-injects identity on every boot.
  if (
    (pathname === '/ready' || pathname === `${RT_PREFIX}/ready`) &&
    (method === 'GET' || method === 'POST')
  ) {
    try {
      mkdirSync(join(WORKSPACE_DIR, '.wayfind'), { recursive: true });
    } catch {
      return void json(res, 500, { ok: false, error: 'workspace not writable' });
    }
    return void json(res, 200, { ok: true, initialized: keysReady(), identity: cloudIdentity });
  }
  if ((pathname === '/validate' || pathname === `${RT_PREFIX}/validate`) && method === 'POST') {
    return void json(res, 200, { ok: true, initialized: keysReady() });
  }
  if (
    (pathname === '/hooks/run' || pathname === `${RT_PREFIX}/run`) &&
    method === 'POST'
  ) {
    try {
      const raw = JSON.parse(await readBody(req)) as {
        ownerId?: string;
        computerId?: string;
        secrets?: Record<string, string>;
        apiUrl?: string;
        taskRunId?: string;
        workspace?: { bucket?: string; prefix?: string };
        microvmId?: string;
        runHookPayload?: string;
      };
      // Lambda's own /run call carries {microvmId, runHookPayload} — accept
      // IDs from either shape so traffic starts even before our secrets POST.
      let body = raw;
      if (!raw.ownerId && !raw.computerId && typeof raw.runHookPayload === 'string' && raw.runHookPayload) {
        try {
          const ids = JSON.parse(raw.runHookPayload) as { ownerId?: string; computerId?: string };
          body = { ...raw, ...(typeof ids.ownerId === 'string' ? { ownerId: ids.ownerId } : {}), ...(typeof ids.computerId === 'string' ? { computerId: ids.computerId } : {}) };
        } catch {
          // Non-JSON payload — still acknowledge so traffic starts.
        }
      }
      if (typeof raw.microvmId === 'string' && raw.microvmId && !body.computerId) {
        body = { ...body, computerId: raw.microvmId };
      }
      const out = await doRunHook(body);
      return void json(res, 200, out);
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }
  // Service-initiated suspend (idle hook): MUST NOT 500 — a failed push
  // must never cost the whole computer (observed: 500 → terminate). The
  // push result is logged; the VM suspends regardless.
  if (pathname === `${RT_PREFIX}/suspend` && method === 'POST') {
    const out = await doSuspend().catch((err) => ({
      ok: false as const,
      error: `suspend failed: ${err instanceof Error ? err.message : String(err)}`,
    }));
    if (!out.ok) console.error('[runtime/suspend] proceeding despite:', out.error);
    return void json(res, 200, out);
  }
  if (pathname === '/hooks/suspend' && method === 'POST') {
    const out = await doSuspend();
    return void json(res, out.ok ? 200 : 500, out);
  }
  if (
    (pathname === '/hooks/resume' || pathname === `${RT_PREFIX}/resume`) &&
    method === 'POST'
  ) {
    const out = await doResume();
    return void json(res, out.ok ? 200 : 500, out);
  }
  if (
    (pathname === '/hooks/terminate' || pathname === `${RT_PREFIX}/terminate`) &&
    method === 'POST'
  ) {
    const out = await doTerminate();
    return void json(res, 200, out);
  }
  if (pathname === '/status' && method === 'GET') {
    return void json(res, 200, {
      ok: true,
      workspace: WORKSPACE_DIR,
      permissionMode: permissionMode(),
      search: hasSearchKey(),
      provider: { baseURL: PROVIDER_BASE_URL, model: PROVIDER_MODEL },
      runs: listRuns().map((r) => ({ id: r.id, done: r.done, startedAt: r.startedAt })),
    });
  }

  if (pathname === '/task' && method === 'POST') {
    // Cloud VMs boot keyless — /hooks/run injects identity + secrets.
    if (!keysReady()) {
      return void json(res, 503, { error: 'computer not initialized — POST /hooks/run first' });
    }
    try {
      const { text, conversationId, system, provider, model, allowedSkills, allowedMcp, canManageBots, roster, botName, attachments, ownerId, apiUrl, idToken } = JSON.parse(await readBody(req)) as {
        text?: string;
        conversationId?: string;
        system?: string;
        provider?: string;
        model?: string;
        allowedSkills?: string[];
        allowedMcp?: string[];
        canManageBots?: boolean;
        roster?: Array<{ id?: string; name?: string; role?: string; skills?: string[] | null; mcp?: string[] | null }>;
        botName?: string;
        attachments?: string[];
        ownerId?: string;
        // Frontend-known API base (amplify_outputs): lets usage events
        // reach the backend without backend self-knowledge of its URL.
        apiUrl?: string;
        // User JWT (local dev): forwarded by agent tools that need backend
        // auth when the computer holds no usage token. Never logged.
        idToken?: string;
      };
      // Usage reporting needs the API base — refresh from every task (the
      // frontend always knows it; provision-time injection can't).
      if (typeof apiUrl === 'string' && apiUrl) process.env.WAYFIND_API_URL = apiUrl;
      // Boot pull may have been skipped for lack of an API base (provision
      // predates COMPUTER_API_URL). First task with a base backfills it —
      // missing-only, so concurrent first tasks are harmless.
      const bootCtx = syncCtx();
      if (workspaceSync && bootCtx && !bootPulled) {
        bootPulled = true;
        try {
          await pullWorkspace(bootCtx);
        } catch (err) {
          console.error('[task] boot pull failed:', err instanceof Error ? err.message : err);
        }
      }
      if (!text || typeof text !== 'string') return void json(res, 400, { error: 'Body must be { text, provider?, model? }' });
      if (conversationId !== undefined && typeof conversationId !== 'string') {
        return void json(res, 400, { error: 'conversationId must be a string' });
      }
      if (allowedSkills !== undefined && (!Array.isArray(allowedSkills) || allowedSkills.some((s) => typeof s !== 'string'))) {
        return void json(res, 400, { error: 'allowedSkills must be string[]' });
      }
      if (allowedMcp !== undefined && (!Array.isArray(allowedMcp) || allowedMcp.some((s) => typeof s !== 'string'))) {
        return void json(res, 400, { error: 'allowedMcp must be string[]' });
      }
      if (attachments !== undefined && (!Array.isArray(attachments) || attachments.some((a) => typeof a !== 'string'))) {
        return void json(res, 400, { error: 'attachments must be string[]' });
      }
      const cleanRoster = Array.isArray(roster)
        ? roster
            .filter((b) => b && typeof b.id === 'string' && typeof b.name === 'string')
            .slice(0, 50)
            .map((b) => ({
              id: b.id as string,
              name: (b.name as string).slice(0, 40),
              ...(typeof b.role === 'string' ? { role: b.role.slice(0, 80) } : {}),
              ...(Array.isArray(b.skills) ? { skills: (b.skills as string[]).filter((s) => typeof s === 'string') } : {}),
              ...(Array.isArray(b.mcp) ? { mcp: (b.mcp as string[]).filter((s) => typeof s === 'string') } : {}),
            }))
        : undefined;
      // No caller roster → the on-disk team is the roster. The VM trusts
      // caller rosters like any other /task field, but ONE callers omit it.
      const diskRoster = cleanRoster ?? listTeamBots().slice(0, 50).map(toRosterEntry);
      const r = startRun(text, {
        provider,
        model,
        conversationId,
        system,
        allowedSkills,
        allowedMcp,
        canManageBots: canManageBots === true,
        roster: diskRoster,
        ...(typeof botName === 'string' ? { botName: botName.slice(0, 40) } : {}),
        ...(attachments ? { attachments: attachments.slice(0, 5) } : {}),
        ...(typeof ownerId === 'string' && ownerId ? { ownerId: ownerId.slice(0, 128) } : {}),
        ...(typeof apiUrl === 'string' && apiUrl ? { apiUrl } : {}),
        ...(typeof idToken === 'string' && idToken ? { idToken } : {}),
      });
      return void json(res, 202, { runId: r.id });
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  const historyMatch = pathname.match(/^\/history\/([A-Za-z0-9-]+)$/);
  if (historyMatch && method === 'GET') {
    return void json(res, 200, { messages: getHistory(historyMatch[1]) });
  }

  // Team: bots as files (ONE outer path — no Amplify Data in this image).
  if (pathname === '/team/bots' && method === 'GET') {
    try {
      return void json(res, 200, { bots: listTeamBots() });
    } catch (err) {
      return void json(res, 500, { error: `team list failed: ${err instanceof Error ? err.message : err}` });
    }
  }

  if (pathname === '/team/bots' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as { id?: string; name?: string; role?: string; description?: string; color?: string; status?: 'active' | 'paused'; model?: string };
      if (!body || typeof body.name !== 'string' || !body.name.trim()) {
        return void json(res, 400, { error: 'Body must be { name, role?, description?, color?, status?, model? }' });
      }
      const bot = saveTeamBot({
        ...(typeof body.id === 'string' ? { id: body.id } : {}),
        name: body.name.trim(),
        ...(typeof body.role === 'string' ? { role: body.role } : {}),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
        ...(typeof body.color === 'string' ? { color: body.color } : {}),
        ...(body.status === 'active' || body.status === 'paused' ? { status: body.status } : {}),
        ...(typeof body.model === 'string' ? { model: body.model } : {}),
      });
      return void json(res, 200, { bot });
    } catch (err) {
      return void json(res, 400, { error: `team save failed: ${err instanceof Error ? err.message : err}` });
    }
  }

  const teamHistoryMatch = pathname.match(/^\/team\/history\/([A-Za-z0-9-]+)$/);
  if (teamHistoryMatch && method === 'GET') {
    try {
      const { entries, verified } = readHistory(teamHistoryMatch[1]);
      return void json(res, 200, { entries, verified, class: 'observed' });
    } catch (err) {
      return void json(res, 400, { error: `team history failed: ${err instanceof Error ? err.message : err}` });
    }
  }

  if (pathname === '/team/config' && method === 'GET') {
    return void json(res, 200, { config: getTeamConfig() });
  }

  if (pathname === '/team/config' && method === 'PUT') {
    try {
      const body = JSON.parse(await readBody(req)) as { defaultModel?: string; escalation?: 'manual' | 'auto-logged' };
      const config = saveTeamConfig({
        ...(typeof body?.defaultModel === 'string' ? { defaultModel: body.defaultModel } : {}),
        ...(body?.escalation === 'manual' || body?.escalation === 'auto-logged' ? { escalation: body.escalation } : {}),
      });
      return void json(res, 200, { config });
    } catch {
      return void json(res, 400, { error: 'Invalid config body' });
    }
  }

  // Team chat: one user turn as a bot. System brief defaults to the bot's
  // file; conversationId defaults to team/<botId> so the SDK session is
  // per-bot. Chat-only in Phase 1: empty skill/MCP allowlists.
  if (pathname === '/team/chat' && method === 'POST') {
    if (!keysReady()) {
      return void json(res, 503, { error: 'computer not initialized — POST /hooks/run first' });
    }
    try {
      const body = JSON.parse(await readBody(req)) as { botId?: string; text?: string; model?: string; apiUrl?: string; ownerId?: string };
      if (!body || typeof body.botId !== 'string' || typeof body.text !== 'string' || !body.text.trim()) {
        return void json(res, 400, { error: 'Body must be { botId, text, model?, apiUrl?, ownerId? }' });
      }
      const bot = getTeamBot(body.botId);
      if (!bot || bot.status !== 'active') {
        return void json(res, 404, { error: 'unknown or paused bot' });
      }
      if (typeof body.apiUrl === 'string' && body.apiUrl) process.env.WAYFIND_API_URL = body.apiUrl;
      const system = `You are ${bot.name}${bot.role ? ` — ${bot.role}` : ''}.${bot.description ? ` ${bot.description}` : ''}`;
      const r = startRun(body.text.trim(), {
        ...(typeof body.model === 'string' ? { model: body.model } : bot.model ? { model: bot.model } : {}),
        conversationId: `team/${bot.id}`,
        teamBotId: bot.id,
        system,
        allowedSkills: [],
        allowedMcp: [],
        roster: listTeamBots().slice(0, 50).map(toRosterEntry),
        ...(typeof body.ownerId === 'string' && body.ownerId ? { ownerId: body.ownerId.slice(0, 128) } : {}),
        ...(typeof body.apiUrl === 'string' && body.apiUrl ? { apiUrl: body.apiUrl } : {}),
      });
      return void json(res, 202, { runId: r.id, conversationId: `team/${bot.id}` });
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  // Voice: browser posts raw WAV bytes (audio/wav), we proxy Meta ASR.
  // User-initiated input like typing — no approval card. Metered (observe-only).
  if (pathname === '/voice/transcribe' && method === 'POST') {
    try {
      const ct = req.headers['content-type'] ?? '';
      if (!ct.startsWith('audio/')) return void json(res, 400, { error: 'Content-Type must be audio/wav' });
      const wav = await readBytes(req, 7 * 1024 * 1024);
      const out = await transcribeWav(wav);
      const ownerId = url.searchParams.get('ownerId') ?? undefined;
      await reportUsage({
        runId: 'voice',
        model: 'muse-voice-transcribe-1.0',
        kind: 'voice',
        unit: 'seconds',
        quantity: Math.round((out.audioDurationMs / 1000) * 10) / 10,
        durationMs: 0,
        outputChars: out.transcript.length,
        toolCalls: 0,
        ...(ownerId ? { userId: ownerId } : {}),
        at: new Date().toISOString(),
      });
      return void json(res, 200, out);
    } catch (err) {
      if (err instanceof VoiceError) return void json(res, err.status, { error: err.message });
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[voice] transcribe failed:', msg);
      return void json(res, 500, { error: `transcribe failed: ${msg}` });
    }
  }

  // Workspace files: Library tab listing, composer uploads, downloads.
  // User-initiated input like typing — no approval card. All paths are
  // jailed inside WORKSPACE_DIR; dotfiles (keys, state) stay hidden.
  function jailPath(rel: string): string | null {
    const root = resolve(WORKSPACE_DIR);
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) return null;
    return abs;
  }

  if (pathname === '/files' && method === 'GET') {
    const rel = url.searchParams.get('path') ?? '';
    const abs = jailPath(rel);
    if (abs === null) return void json(res, 400, { error: 'Path escapes workspace' });
    try {
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        return void json(res, 404, { error: 'Not a directory' });
      }
      const entries = readdirSync(abs)
        .filter((n) => !n.startsWith('.'))
        .map((n) => {
          const st = statSync(resolve(abs, n));
          return {
            name: n,
            dir: st.isDirectory(),
            size: st.isDirectory() ? 0 : st.size,
            mtime: st.mtimeMs,
          };
        })
        .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      return void json(res, 200, { path: rel, entries });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return void json(res, 500, { error: `list failed: ${msg}` });
    }
  }

  if (pathname === '/files/upload' && method === 'POST') {
    try {
      const { path: rel, contentBase64 } = JSON.parse(await readBody(req)) as {
        path?: string;
        contentBase64?: string;
      };
      if (!rel || typeof rel !== 'string' || typeof contentBase64 !== 'string') {
        return void json(res, 400, { error: 'Body must be { path, contentBase64 }' });
      }
      const abs = jailPath(rel);
      if (abs === null) return void json(res, 400, { error: 'Path escapes workspace' });
      if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
        return void json(res, 400, { error: 'Path is a directory' });
      }
      const buf = Buffer.from(contentBase64, 'base64');
      if (buf.length > 10 * 1024 * 1024) return void json(res, 413, { error: 'File too large (10MB max)' });
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, buf);
      return void json(res, 200, { ok: true, path: rel, size: buf.length });
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  const downloadMatch = pathname === '/files/download' && method === 'GET';
  if (downloadMatch) {
    const rel = url.searchParams.get('path') ?? '';
    const abs = jailPath(rel);
    if (abs === null) return void json(res, 400, { error: 'Path escapes workspace' });
    try {
      if (!existsSync(abs) || statSync(abs).isDirectory()) {
        return void json(res, 404, { error: 'Not a file' });
      }
      const name = rel.split('/').pop() ?? 'download';
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
        ...corsHeaders(),
      });
      return void createReadStream(abs).pipe(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return void json(res, 500, { error: `download failed: ${msg}` });
    }
  }

  // Inline view for images (chat rendering, Markdown img). Unlike
  // /files/download (attachment + octet-stream, forces save-as), this
  // serves real image Content-Types so browsers render it in place.
  // Images only — everything else still goes through /files/download.
  const IMAGE_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };
  if (pathname === '/files/view' && method === 'GET') {
    const rel = url.searchParams.get('path') ?? '';
    const abs = jailPath(rel);
    if (abs === null) return void json(res, 400, { error: 'Path escapes workspace' });
    try {
      if (!existsSync(abs) || statSync(abs).isDirectory()) {
        return void json(res, 404, { error: 'Not a file' });
      }
      const ext = extname(abs).toLowerCase();
      const contentType = IMAGE_TYPES[ext];
      if (!contentType) return void json(res, 415, { error: 'Not a viewable image' });
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=3600',
        ...corsHeaders(),
      });
      return void createReadStream(abs).pipe(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return void json(res, 500, { error: `view failed: ${msg}` });
    }
  }

  if (pathname === '/approvals' && method === 'GET') {
    return void json(res, 200, { approvals: listPendingApprovals() });
  }

  if (pathname === '/questions' && method === 'GET') {
    return void json(res, 200, { questions: listPendingQuestions() });
  }

  // Chief-of-staff bot creation: the frontend owns Bot records, so the
  // model's create_bot call parks here until the user confirms/cancels.
  if (pathname === '/bot-requests' && method === 'GET') {
    return void json(res, 200, { requests: listPendingBotRequests() });
  }

  const botRequestMatch = pathname.match(/^\/bot-requests\/([A-Za-z0-9-]+)$/);
  if (botRequestMatch && method === 'POST') {
    try {
      const { decision, botId, error } = JSON.parse(await readBody(req)) as {
        decision?: string;
        botId?: string;
        error?: string;
      };
      if (decision !== 'confirm' && decision !== 'cancel') {
        return void json(res, 400, { error: 'Body must be { decision: "confirm" | "cancel", botId?, error? }' });
      }
      const ok = answerBotRequest(botRequestMatch[1], {
        decision,
        ...(typeof botId === 'string' ? { botId } : {}),
        ...(typeof error === 'string' ? { error } : {}),
      });
      return void json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'unknown bot request' });
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  const questionMatch = pathname.match(/^\/questions\/([A-Za-z0-9-]+)$/);
  if (questionMatch && method === 'POST') {
    try {
      const { answers } = JSON.parse(await readBody(req)) as { answers?: string[][] };
      if (!Array.isArray(answers)) {
        return void json(res, 400, { error: 'Body must be { answers: string[][] }' });
      }
      const ok = answerQuestion(questionMatch[1], answers);
      return void json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'unknown question' });
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  const approvalMatch = pathname.match(/^\/approvals\/([A-Za-z0-9_-]+)$/);
  if (approvalMatch && method === 'POST') {
    try {
      const { decision } = JSON.parse(await readBody(req)) as { decision?: string };
      if (decision !== 'approve' && decision !== 'reject' && decision !== 'approve-all') {
        return void json(res, 400, { error: 'Body must be { decision: "approve" | "reject" | "approve-all" }' });
      }
      // SDK-native resume: the parked RunState continues from the interruption.
      try {
        const ok = await resolveApproval(approvalMatch[1], decision);
        return void json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'unknown approval' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[approvals] resume failed:', msg);
        return void json(res, 500, { error: `resume failed: ${msg}` });
      }
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  // Skills: installed catalog (Settings list), chat-importer endpoints,
  // and workspace discovery. Reloaded on every run — no restart needed.
  if (pathname === '/skills' && method === 'GET') {
    return void json(res, 200, { skills: listInstalledSkills() });
  }

  if (pathname === '/skills/resolve' && method === 'POST') {
    try {
      const { source } = JSON.parse(await readBody(req)) as { source?: string };
      if (!source || typeof source !== 'string') {
        return void json(res, 400, { error: 'Body must be { source }' });
      }
      const result = await resolveSkillSource(source);
      if (!result.ok) return void json(res, 422, { error: result.error });
      if ('choices' in result) return void json(res, 200, { choices: result.choices, hint: result.hint });
      return void json(res, 200, {
        preview: {
          name: result.preview.name,
          description: result.preview.description,
          source: result.preview.source,
          files: result.preview.files.map((f) => f.path),
        },
      });
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  if (pathname === '/skills/install' && method === 'POST') {
    try {
      const { source, overwrite } = JSON.parse(await readBody(req)) as { source?: string; overwrite?: boolean };
      if (!source || typeof source !== 'string') {
        return void json(res, 400, { error: 'Body must be { source, overwrite? }' });
      }
      const result = await resolveSkillSource(source);
      if (!result.ok) return void json(res, 422, { error: result.error });
      if ('choices' in result) return void json(res, 200, { choices: result.choices, hint: result.hint });
      const errors = validateSkillPreview(result.preview, { allowOverwrite: overwrite === true });
      if (errors.length > 0) return void json(res, 409, { error: errors.join(' ') });
      saveSkillPreview(result.preview);
      return void json(res, 200, { ok: true, skills: listInstalledSkills() });
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  const skillMatch = pathname.match(/^\/skills\/([A-Za-z0-9-]+)$/);
  if (skillMatch && method === 'DELETE') {
    const ok = removeSkill(skillMatch[1]);
    if (!ok) return void json(res, 404, { error: 'unknown skill' });
    return void json(res, 200, { ok: true, skills: listInstalledSkills() });
  }

  if (pathname === '/skills/scan' && method === 'GET') {
    return void json(res, 200, { found: scanLocalSkills() });
  }

  // MCP servers: global registry in workspace/mcp.json (synced like skills).
  // Per-bot scoping lives on the team file (roster entry); the agent enforces it at build.
  // Reloaded on every run — no restart needed.
  if (pathname === '/mcp' && method === 'GET') {
    return void json(res, 200, { servers: listMcpServers() });
  }

  if (pathname === '/mcp' && method === 'POST') {
    try {
      const { name, ...cfg } = JSON.parse(await readBody(req)) as { name?: string } & Record<string, unknown>;
      if (!name || typeof name !== 'string') {
        return void json(res, 400, { error: 'Body must be { name, command?|url?, ... }' });
      }
      const result = saveMcpServer(name, cfg);
      if (!result.ok) return void json(res, result.error === 'exists' ? 409 : 400, { error: result.error });
      return void json(res, 200, { ok: true, servers: listMcpServers() });
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  const mcpMatch = pathname.match(/^\/mcp\/([A-Za-z0-9_-]+)$/);
  if (mcpMatch && (method === 'PATCH' || method === 'PUT')) {
    try {
      const cfg = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const result = patchMcpServer(mcpMatch[1], cfg);
      if (!result.ok) return void json(res, result.error === 'unknown server' ? 404 : 400, { error: result.error });
      return void json(res, 200, { ok: true, servers: listMcpServers() });
    } catch {
      return void json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  if (mcpMatch && method === 'DELETE') {
    const ok = removeMcpServer(mcpMatch[1]);
    if (!ok) return void json(res, 404, { error: 'unknown server' });
    return void json(res, 200, { ok: true, servers: listMcpServers() });
  }

  // Force-reconnect: evicts the pooled client and connects fresh. The
  // recovery path for "Connection closed" / 0-tools without re-registering.
  const mcpRestartMatch = pathname.match(/^\/mcp\/([A-Za-z0-9_-]+)\/restart$/);
  if (mcpRestartMatch && method === 'POST') {
    const result = await restartMcpServer(mcpRestartMatch[1]);
    if (!result.ok) {
      const code = result.error === 'unknown server' ? 404 : result.error === 'server is off — turn it on first' ? 409 : 502;
      return void json(res, code, { error: result.error, servers: listMcpServers() });
    }
    return void json(res, 200, { ok: true, status: result.status, tools: result.tools, servers: listMcpServers() });
  }

  // Settings: permissions rule list (the rules ARE the grants — flipping a
  // rule to deny is the revoke path). Reloaded on every run, no restart.
  if (pathname === '/permissions' && method === 'GET') {
    return void json(res, 200, { rules: loadRules(), canUndo: canUndoRules() });
  }

  if (pathname === '/permissions/undo' && method === 'POST') {
    const rules = undoRules();
    if (!rules) return void json(res, 404, { error: 'nothing to undo' });
    return void json(res, 200, { ok: true, rules, canUndo: canUndoRules() });
  }

  if (pathname === '/permissions' && method === 'PUT') {
    try {
      const { rules } = JSON.parse(await readBody(req)) as { rules?: unknown };
      saveRules(rules as never);
      return void json(res, 200, { ok: true, rules: loadRules() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return void json(res, 400, { error: msg });
    }
  }

  // Settings: provider catalog minus secrets. Read-only in v1 — the model is
  // fixed per deployment and keys are provisioned by us (embedded in the
  // MicroVM, .env locally). Key values are never returned (only
  // keyConfigured flags).
  if (pathname === '/providers' && method === 'GET') {
    const catalog = loadCatalog();    const providers: Record<string, { baseURL: string; keyConfigured: boolean; keystore: string; models: string[] }> = {};
    for (const [pid, p] of Object.entries(catalog.providers ?? {})) {
      const key = resolveApiKey(p);
      providers[pid] = {
        baseURL: p.baseURL,
        keyConfigured: key !== '' && key !== 'missing-key',
        keystore: p.key?.keystore ?? 'MODAL_API_KEY',
        models: Object.keys(p.models ?? {}),
      };
    }
    return void json(res, 200, { defaults: catalog.defaults ?? null, providers });
  }

  const streamMatch = pathname.match(/^\/stream\/([A-Za-z0-9-]+)$/);
  if (streamMatch && method === 'GET') return void sse(res, streamMatch[1]);

  // Pollable twin of /stream for buffered transports (cloud API relay):
  // GET /runs/:id/events?cursor=n -> { events, nextCursor, done }. The
  // frontend long-polls this ~1/s and renders progressively. Same shapes
  // as the SSE data lines, so one parser serves both.
  const eventsMatch = pathname.match(/^\/runs\/([A-Za-z0-9-]+)\/events$/);
  if (eventsMatch && method === 'GET') {
    const r = getRun(eventsMatch[1]);
    if (!r) return void json(res, 404, { error: 'unknown run' });
    const cursor = Math.max(0, Number(url.searchParams.get('cursor') ?? 0) || 0);
    return void json(res, 200, { events: r.events.slice(cursor), nextCursor: r.events.length, done: r.done });
  }

  // One cheap model call: compress a user's first message (their bot's job
  // description) into a short role label. No tools, no session.
  if (pathname === '/summarize-role' && method === 'POST') {
    try {
      const { text, ownerId } = JSON.parse(await readBody(req)) as { text?: string; ownerId?: string };
      if (!text || typeof text !== 'string') return void json(res, 400, { error: 'Body must be { text }' });
      if (!keysReady()) {
        return void json(res, 503, { error: 'computer not initialized — POST /hooks/run first' });
      }
      // Live key (never the import-time snapshot — /run may inject later).
      const { drawKey } = await import('./providers/keystore.js');
      const client = new OpenAI({ apiKey: process.env.MODAL_API_KEY ?? drawKey('MODAL_API_KEY') ?? '', baseURL: PROVIDER_BASE_URL });
      // NOTE: muse-spark spends part of the token budget on hidden reasoning
      // (usage.reasoning_tokens) — a small max_tokens starves the visible
      // reply and yields null content. Keep the budget generous; the answer
      // itself is still one short line.
      const out = await client.chat.completions.create({
        model: PROVIDER_MODEL,
        max_tokens: 1000,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You name AI assistant roles. Compress the user\'s job description into a short role label: 2-6 words, no quotes, no period, no preamble. Examples: "inbox triage", "expense manager", "talent scout". If the text is vague or not a job description, reply exactly: general assistant.',
          },
          { role: 'user', content: text.slice(0, 2000) },
        ],
      });
      const role = (out.choices[0]?.message?.content ?? '')
        .split('\n')[0]
        .replace(/^["'“”]+|["'“”.]+$/g, '')
        .trim()
        .slice(0, 80);
      await reportUsage({
        runId: 'summarize-role',
        model: PROVIDER_MODEL,
        kind: 'summarize',
        unit: 'calls',
        quantity: 1,
        durationMs: 0,
        outputChars: role.length,
        toolCalls: 0,
        ...(typeof ownerId === 'string' && ownerId ? { userId: ownerId } : {}),
        at: new Date().toISOString(),
      });
      return void json(res, 200, { role: role || 'general assistant' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[summarize-role] failed:', msg);
      return void json(res, 500, { error: 'summarize failed' });
    }
  }

  return void json(res, 404, { error: 'not found' });
}

requireApiKeyOptIn();
initProvider();
const server = createServer((req, res) => {
  void handle(req, res).catch((err: unknown) => {
    console.error('request failed:', err);
    if (!res.headersSent) json(res, 500, { error: 'internal error' });
  });
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is already in use — an old server is still running. Kill it first (it keeps serving STALE code).`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, () => {
  console.log(`wayfind agent listening on :${PORT} (workspace ${WORKSPACE_DIR})`);
});

// Periodic safety-net push: a platform hard-kill (8h lifetime expiry) runs
// no hook, so without this anything changed since the last run-push or
// suspend would die with the VM. Manifest-diff keeps idle ticks to a
// no-op; an in-flight guard skips overlaps with run/suspend pushes.
let periodicPushInFlight = false;
const periodicPushTimer = setInterval(() => {
  if (periodicPushInFlight) return;
  const ctx = syncCtx();
  if (!ctx) return;
  periodicPushInFlight = true;
  void pushWorkspace(ctx)
    .then(({ pushed }) => {
      if (pushed > 0) console.log(`[sync] periodic push: ${pushed} file(s)`);
    })
    .catch((err) => console.error('[sync] periodic push failed:', err instanceof Error ? err.message : err))
    .finally(() => {
      periodicPushInFlight = false;
    });
}, 5 * 60_000);
periodicPushTimer.unref?.();

// Post-run workspace push (trailing debounce): a platform kill loses at
// most one run instead of everything since the last suspend, and it keeps
// the suspend-hook flush tiny so the hook beats its timeout.
let postRunPushTimer: NodeJS.Timeout | null = null;
onRunSettled(() => {
  if (postRunPushTimer) clearTimeout(postRunPushTimer);
  postRunPushTimer = setTimeout(() => {
    postRunPushTimer = null;
    const ctx = syncCtx();
    if (!ctx) return;
    void pushWorkspace(ctx)
      .then(({ pushed, unchanged }) => {
        if (pushed > 0) console.log(`[sync] post-run push: ${pushed} file(s), ${unchanged} unchanged`);
      })
      .catch((err) => console.error('[sync] post-run push failed:', err instanceof Error ? err.message : err));
  }, 30_000);
  postRunPushTimer.unref?.();
});
