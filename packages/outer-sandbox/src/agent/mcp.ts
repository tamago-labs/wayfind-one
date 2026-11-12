// MCP client (stdio only, P1): reads workspace/mcp.json, spawns each
// configured server, converts its tools to agent tools. Remote/streamable
// transports land in P2.
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { WORKSPACE_DIR } from '../core/config.js';

import { approvalPolicy, guarded, isMcpReadTool, type GuardOpts } from '../core/guard.js';
export interface McpServerConfig {
  command?: string[];
  environment?: Record<string, string>;
  /** Input alias for environment (Claude-format configs use "env"). */
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Absent = active. Mirrors the skills allowlist semantics: unconfigured = on. */
  isActive?: boolean;
  disabledTools?: string[];
}

/** Stored form always uses `environment`; accept Claude-format `env`. */
function serverEnv(cfg: McpServerConfig): Record<string, string> | undefined {
  return cfg.environment ?? cfg.env;
}

interface McpJson {
  mcpServers?: Record<string, McpServerConfig>;
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, '_');
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
};

/** Top-level shape: object schemas map flat, others use one `input` field.
 * Only the top level is converted precisely — nested objects/arrays stay
 * z.unknown(). The SDK's zod→JSON-Schema converter rejects nested
 * `.optional()` (Zoho-style deep schemas), and servers validate their own
 * input anyway. */
function shapeOf(schema: JsonSchema | undefined): z.ZodObject<Record<string, z.ZodTypeAny>> {
  if (schema?.type === 'object' || (!schema?.type && schema?.properties)) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
      const field = toZod(v);
      shape[k] = schema.required?.includes(k) ? field : field.optional();
    }
    return z.object(shape);
  }
  return z.object({ input: z.unknown().optional() });
}
/** Shallow scalar conversion — objects/arrays collapse to unknown (see above). */
function toZod(schema: JsonSchema | undefined): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.unknown();
  if (schema.enum) {
    try {
      return z.enum(schema.enum as [string, ...string[]]).describe(schema.description ?? '');
    } catch {
      return z.unknown().describe(schema.description ?? '');
    }
  }
  switch (schema.type) {
    case 'string':
      return z.string().describe(schema.description ?? '');
    case 'number':
      return z.number().describe(schema.description ?? '');
    case 'integer':
      return z.number().int().describe(schema.description ?? '');
    case 'boolean':
      return z.boolean().describe(schema.description ?? '');
    default:
      return z.unknown().describe(schema.description ?? '');
  }
}

export interface McpServerInfo {
  name: string;
  type: 'stdio' | 'remote';
  isActive: boolean;
  /** Env/header key names only — values never leave the computer. */
  configKeys: string[];
  disabledTools: string[];
  /** Live connection state: unknown = never connected since boot. */
  status: 'connected' | 'error' | 'unknown';
  tools: number;
  lastError?: string;
}

const MCP_NAME_RE = /^[A-Za-z0-9_-]+$/;

/* Read cache (P1): idempotent MCP reads repeat constantly across turns
 * ("what's the balance?" → same list/get trio every message). Cache per
 * server+tool+args for 10 min; a write on a server invalidates its reads
 * (a posted transaction may change the next balance/list). Module-level so
 * it spans runs/turns — one computer, one account. */
interface CachedRead {
  at: number;
  args: string;
  text: string;
}
const READ_CACHE = new Map<string, CachedRead>();
const READ_CACHE_TTL_MS = 10 * 60_000;
const READ_CACHE_MAX = 200;
const READ_CACHE_TEXT_MAX = 8000;

function readCacheKey(server: string, tool: string, args: unknown): string {
  let a = '';
  try {
    a = JSON.stringify(args ?? {});
  } catch {
    a = '';
  }
  return `${server}::${tool}::${a}`;
}

function shortArgs(args: unknown): string {
  let a = '';
  try {
    a = JSON.stringify(args ?? {});
  } catch {
    a = '';
  }
  return a.length > 160 ? `${a.slice(0, 160)}…` : a;
}

function readCacheGet(key: string): string | undefined {
  const e = READ_CACHE.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > READ_CACHE_TTL_MS) {
    READ_CACHE.delete(key);
    return undefined;
  }
  return e.text;
}

function readCacheSet(key: string, args: string, text: string): void {
  if (READ_CACHE.size >= READ_CACHE_MAX) {
    const oldest = READ_CACHE.keys().next();
    if (!oldest.done) READ_CACHE.delete(oldest.value);
  }
  READ_CACHE.set(key, { at: Date.now(), args, text: text.slice(0, READ_CACHE_TEXT_MAX) });
}

function readCacheInvalidateServer(server: string): void {
  for (const k of [...READ_CACHE.keys()]) {
    if (k.startsWith(`${server}::`)) READ_CACHE.delete(k);
  }
}

/** Recently observed reads, newest first — rendered into the catalog
 * prompt so the model trusts them instead of re-fetching. */
export function recentMcpReads(
  limit = 6,
): Array<{ server: string; tool: string; args: string; text: string; ageSec: number }> {
  const now = Date.now();
  return [...READ_CACHE.entries()]
    .filter(([, e]) => now - e.at <= READ_CACHE_TTL_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, limit)
    .map(([k, e]) => {
      const [server, tool] = k.split('::');
      return { server, tool, args: e.args, text: e.text, ageSec: Math.round((now - e.at) / 1000) };
    });
}

/** Read the raw server map. Missing file = no servers; corrupt file = no servers (logged). */
export function readMcpConfig(): Record<string, McpServerConfig> {
  const path = join(WORKSPACE_DIR, 'mcp.json');
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as McpJson;
    return parsed.mcpServers ?? {};
  } catch {
    console.error('mcp.json is not valid JSON — skipping MCP servers');
    return {};
  }
}

function writeMcpConfig(servers: Record<string, McpServerConfig>): void {
  writeFileSync(join(WORKSPACE_DIR, 'mcp.json'), JSON.stringify({ mcpServers: servers }, null, 2));
}

/** Settings-list view: no secrets, command[0] + url only as type hints. */
export function listMcpServers(): McpServerInfo[] {
  return Object.entries(readMcpConfig()).map(([name, cfg]) => {
    const entry = pool.get(name);
    return {
      name,
      type: cfg?.url ? 'remote' : 'stdio',
      isActive: cfg?.isActive !== false,
      configKeys: Object.keys(cfg?.url ? (cfg.headers ?? {}) : (serverEnv(cfg) ?? {})),
      disabledTools: cfg?.disabledTools ?? [],
      status: !entry ? 'unknown' : entry.client ? 'connected' : 'error',
      tools: entry?.tools ?? 0,
      ...(entry?.lastError ? { lastError: entry.lastError } : {}),
    };
  });
}

function checkServerInput(name: string, cfg: Partial<McpServerConfig>): string | null {
  if (!MCP_NAME_RE.test(name)) return 'name must match [A-Za-z0-9_-]+';
  const hasCommand = Array.isArray(cfg.command) && cfg.command.length > 0 && cfg.command.every((s) => typeof s === 'string' && s);
  const hasUrl = typeof cfg.url === 'string' && cfg.url.length > 0;
  if (hasCommand && hasUrl) return 'set command[] or url, not both';
  if (!hasCommand && !hasUrl) return 'server needs command[] or url';
  return null;
}

/** Claude-format ({command: "npx", args: [...]}) normalizes to command[]. */
function normalizeCommand(cmd: unknown, args: unknown): string[] | undefined {
  const extra = Array.isArray(args) ? args.filter((s): s is string => typeof s === 'string' && !!s) : [];
  if (Array.isArray(cmd) && cmd.length > 0 && cmd.every((s) => typeof s === 'string' && s)) {
    return [...cmd, ...extra];
  }
  if (typeof cmd === 'string' && cmd) return [cmd, ...extra];
  return undefined;
}

function cleanConfig(cfg: Partial<McpServerConfig> & { args?: unknown }): McpServerConfig {
  const out: McpServerConfig = {};
  const command = normalizeCommand(cfg.command, (cfg as { args?: unknown }).args);
  if (command) out.command = command;
  const environment = cfg.environment ?? cfg.env;
  if (environment && typeof environment === 'object') out.environment = environment;
  if (typeof cfg.url === 'string') out.url = cfg.url;
  if (cfg.headers && typeof cfg.headers === 'object') out.headers = cfg.headers;
  if (cfg.isActive === false) out.isActive = false;
  if (Array.isArray(cfg.disabledTools)) out.disabledTools = cfg.disabledTools.filter((t) => typeof t === 'string');
  return out;
}

/** Create. Returns 'exists' when the name is taken, or an error message. */
export function saveMcpServer(name: string, cfg: Partial<McpServerConfig> & { args?: unknown }): { ok: true } | { ok: false; error: string } {
  const servers = readMcpConfig();
  if (servers[name]) return { ok: false, error: 'exists' };
  const norm = cleanConfig(cfg);
  const err = checkServerInput(name, norm);
  if (err) return { ok: false, error: err };
  servers[name] = norm;
  writeMcpConfig(servers);
  return { ok: true };
}

/** Partial update (toggle active, edit env/headers, disable tools). */
export function patchMcpServer(name: string, cfg: Partial<McpServerConfig> & { args?: unknown }): { ok: true } | { ok: false; error: string } {
  const servers = readMcpConfig();
  const prev = servers[name];
  if (!prev) return { ok: false, error: 'unknown server' };
  const merged = { ...prev, ...cleanConfig(cfg) };
  // Switching transport drops the other side's fields.
  if (cfg.url !== undefined) { delete merged.command; delete merged.environment; }
  if (cfg.command !== undefined) { delete merged.url; delete merged.headers; }
  // Explicit true clears a stored false (absent = active).
  if (cfg.isActive === true) delete merged.isActive;
  const err = checkServerInput(name, merged);
  if (err) return { ok: false, error: err };
  servers[name] = merged;
  writeMcpConfig(servers);
  // Disabling parks the connection; a config change reconnects next run
  // via the hash check in getOrConnect.
  if (cfg.isActive === false) evictMcpClient(name);
  return { ok: true };
}

export function removeMcpServer(name: string): boolean {
  const servers = readMcpConfig();
  if (!servers[name]) return false;
  delete servers[name];
  writeMcpConfig(servers);
  // Close first — never orphan a spawned process (cf. Cherry's
  // remove-before-delete rule).
  evictMcpClient(name);
  return true;
}

// Connection pool: one live client per server, reused across runs.
// Keyed by server name + config hash — a config edit reconnects, a
// toggle or tool-disable does not. Previously every run spawned every
// server and leaked the clients.
interface PooledEntry {
  client?: Client;
  hash: string;
  tools: number;
  lastError?: string;
}

const pool = new Map<string, PooledEntry>();

/** Slow-but-stable: stdio servers (npx downloads) may take a while. */
const MCP_CONNECT_TIMEOUT_MS = 120_000;
/** A stalled server must fail the call, never hang the run. */
const MCP_CALL_TIMEOUT_MS = 120_000;

function configHash(cfg: McpServerConfig): string {
  return createHash('sha256')
    .update(JSON.stringify({ command: cfg.command, environment: cfg.environment, url: cfg.url, headers: cfg.headers }))
    .digest('hex');
}

/** Drop a pooled client (delete/disable path). Best-effort close. */
export function evictMcpClient(name: string): void {
  const entry = pool.get(name);
  if (!entry) return;
  pool.delete(name);
  if (entry.client) void entry.client.close().catch(() => {});
}

function buildTransport(serverName: string, cfg: McpServerConfig) {
  if (cfg?.url) {
    return new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: { headers: cfg.headers ?? {} },
    });
  }
  if (cfg?.command?.length) {
    return new StdioClientTransport({
      command: cfg.command[0],
      args: cfg.command.slice(1),
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]), ...(serverEnv(cfg) ?? {}) },
    });
  }
  throw new Error(`MCP server "${serverName}" needs command[] or url`);
}

async function getOrConnect(serverName: string, cfg: McpServerConfig, hash: string): Promise<PooledEntry> {
  const existing = pool.get(serverName);
  if (existing?.client && existing.hash === hash) return existing;
  if (existing) evictMcpClient(serverName);
  const entry: PooledEntry = { hash, tools: 0 };
  pool.set(serverName, entry);
  const client = new Client({ name: 'wayfind-computer', version: '0.1.0' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(buildTransport(serverName, cfg)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`connect timed out after ${MCP_CONNECT_TIMEOUT_MS / 1000}s`)), MCP_CONNECT_TIMEOUT_MS);
      }),
    ]);
    entry.client = client;
    entry.lastError = undefined;
    return entry;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    entry.lastError = msg;
    console.error(`MCP server "${serverName}" failed:`, msg);
    await client.close().catch(() => {});
    return entry;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadMcpTools(opts: GuardOpts): Promise<Array<ReturnType<typeof tool>>> {
  const servers = readMcpConfig();
  const tools: Array<ReturnType<typeof tool>> = [];
  for (const [serverName, cfg] of Object.entries(servers)) {
    if (cfg.isActive === false) continue;
    // Per-bot allowlist first (team roster entry): undefined = all, [] = none.
    if (opts.allowedMcp !== undefined && !opts.allowedMcp.includes(serverName)) continue;
    const disabled = new Set(cfg.disabledTools ?? []);
    const hash = configHash(cfg);
    let entry: PooledEntry;
    try {
      entry = await getOrConnect(serverName, cfg, hash);
    } catch (err) {
      console.error(`MCP server "${serverName}" failed:`, err instanceof Error ? err.message : err);
      continue;
    }
    if (!entry.client) continue; // error already recorded + logged
    // Fresh tool list each run (cheap); a dead pooled connection
    // reconnects once before giving up for this run.
    let listed: { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> };
    try {
      listed = await entry.client.listTools();
    } catch {
      evictMcpClient(serverName);
      entry = await getOrConnect(serverName, cfg, hash);
      if (!entry.client) continue;
      try {
        listed = await entry.client.listTools();
      } catch (err) {
        entry.lastError = err instanceof Error ? err.message : String(err);
        console.error(`MCP server "${serverName}" failed:`, entry.lastError);
        continue;
      }
    }
    entry.tools = listed.tools.length;
    const client = entry.client;
    for (const t of listed.tools) {
      if (disabled.has(t.name)) continue;
      const toolName = `${sanitize(serverName)}_${sanitize(t.name)}`;
      tools.push(
        tool({
          name: toolName,
          description: t.description ?? `MCP tool ${t.name} from ${serverName}`,
          // MCP inputSchema is JSON Schema — convert to zod for validation.
          // Object schemas map flat (what the server expects); anything
          // else falls back to a single `input` field.
          parameters: shapeOf(t.inputSchema as JsonSchema | undefined),
          execute: guarded(`mcp:${serverName}`, () => t.name, async (args: unknown) => {
            // Resolve the live client at call time — a reconnect between
            // registration and execution must not use a closed client.
            // Bounded: a stalled server fails the call instead of hanging
            // the run with no card (restart via restart_mcp_server).
            const live = pool.get(serverName);
            const c = live?.client && live.hash === hash ? live.client : client;
            // P1: serve idempotent reads from cache; writes invalidate.
            const read = isMcpReadTool(t.name);
            const cacheKey = read ? readCacheKey(serverName, t.name, args) : '';
            if (read) {
              const hit = readCacheGet(cacheKey);
              if (hit !== undefined) return hit;
            } else {
              readCacheInvalidateServer(serverName);
            }
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              const res = (await Promise.race([
                c.callTool({
                  name: t.name,
                  arguments: (args ?? {}) as Record<string, unknown>,
                }),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(
                    () => reject(new Error(`MCP tool ${t.name} timed out after ${MCP_CALL_TIMEOUT_MS / 1000}s — restart "${serverName}" and retry`)),
                    MCP_CALL_TIMEOUT_MS,
                  );
                }),
              ])) as { content?: Array<{ type: string; text?: string }> };
              const content = res.content ?? [];
              const out =
                content
                  .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
                  .join('\n') || '(no output)';
              if (read) readCacheSet(cacheKey, shortArgs(args), out);
              return out;
            } finally {
              if (timer) clearTimeout(timer);
            }
          }, opts),
          needsApproval: approvalPolicy(`mcp:${serverName}`, () => t.name, { isRead: () => isMcpReadTool(t.name) }),
        }),
      );
    }
    console.log(`MCP: ${serverName} → ${listed.tools.length} tools`);
  }
  return tools;
}

/** Chat-install: the approval card is the trust gate (the user sees the
 * exact command before it can run on their computer). Installed OFF unless
 * the user explicitly asked to turn it on. */
export function createMcpInstallTool(_opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'install_mcp_server',
    description:
      'Register an MCP server from chat (local stdio or remote URL). ' +
      'Call ONLY for servers NOT in your registered-servers list — for listed servers use their tools directly, ' +
      'for erroring ones use restart_mcp_server. ' +
      'ALWAYS show the user the exact command (or URL) plus the env/header KEY NAMES first, then call — ' +
      'the approval card is the confirm step, so do NOT add a question-tool confirm on top. ' +
      'NEVER research a server via shell: no npm view/pack, no tarball downloads, no curl|tar, no cache cleaning — ' +
      'those commands each burn an approval and can corrupt the install. Get config from skill docs or ask the user. ' +
      'If any env values are missing, ask for them with the question tool BEFORE calling — ' +
      'never register placeholder values. Secrets (passkeys, API keys) are collected ONLY via the question tool; ' +
      'if the user pastes a secret in chat instead, do NOT repeat its value — use it and move on. ' +
      'After the user answers an env question, call install_mcp_server immediately — never re-ask in text. ' +
      'NEVER propose `npm install -g`: global installs do not belong on the computer. Prefer in order: ' +
      '(1) a server checkout already on the computer — run it directly, e.g. ["node", "/abs/workspace/path/server.js"]; ' +
      '(2) `npx -y <pkg>` (slow first download is fine). ' +
      'Paths on the user\'s own machine (C:\\…, /Users/…) do NOT exist on the computer — ' +
      'translate to a workspace path or npx, never copy them verbatim. ' +
      'Values for environment/headers are secrets: never print them back to chat.',
    parameters: z.object({
      name: z.string().describe('Server name [A-Za-z0-9_-]+ — its tools appear as <name>_<tool>'),
      command: z.array(z.string()).optional().describe('Stdio launch, e.g. ["npx","-y","pkg"]. Set exactly one of command/url.'),
      url: z.string().optional().describe('Remote streamable-HTTP URL. Set exactly one of command/url.'),
      environment: z.record(z.string(), z.string()).optional().describe('Env for stdio servers (secrets — never print back)'),
      headers: z.record(z.string(), z.string()).optional().describe('Headers for remote servers (secrets — never print back)'),
      activate: z.boolean().optional().describe('true = enable immediately. Default false (registered OFF). Pass true only if the user explicitly asked to turn it on.'),
    }),
    execute: async (args: {
      name: string;
      command?: string[];
      url?: string;
      environment?: Record<string, string>;
      headers?: Record<string, string>;
      activate?: boolean;
    }) => {
      const res = saveMcpServer(args.name, {
        command: args.command,
        url: args.url,
        environment: args.environment,
        headers: args.headers,
        isActive: args.activate === true ? true : false,
      });
      if (!res.ok) {
        if (res.error === 'exists') {
          return (
            `MCP server "${args.name}" is already registered — do NOT call install_mcp_server again for it. ` +
            `Tell the user to toggle it from Settings → MCP, or proceed with the task.`
          );
        }
        return `Cannot register MCP server "${args.name}": ${res.error}.`;
      }
      const active = args.activate === true;
      return (
        `Registered MCP server "${args.name}" (${args.url ? 'remote' : 'local'}) — currently ${active ? 'ON' : 'OFF'}. ` +
        (active
          ? 'Its tools load on the next run.'
          : 'Tell the user to turn it on from Settings → MCP when ready; its tools load on the next run after that.')
      );
    },
    needsApproval: async (_ctx: unknown, input: { name?: string }) => {
      if (process.env.PERMISSION_MODE === 'permissive') return false;
      // Already registered → no card; execute just reports it. This keeps
      // a redundant install call from ever popping an approval.
      if (typeof input?.name === 'string' && readMcpConfig()[input.name]) return false;
      return true;
    },
  });
}

/** Force-reconnect a server (Settings restart button, chat recovery).
 * Evicts the pooled client and connects fresh. */
export async function restartMcpServer(
  name: string,
): Promise<{ ok: true; status: string; tools: number } | { ok: false; error: string }> {
  const servers = readMcpConfig();
  const cfg = servers[name];
  if (!cfg) return { ok: false, error: 'unknown server' };
  if (cfg.isActive === false) return { ok: false, error: 'server is off — turn it on first' };
  evictMcpClient(name);
  const hash = configHash(cfg);
  const entry = await getOrConnect(name, cfg, hash);
  if (!entry.client) return { ok: false, error: entry.lastError ?? 'connect failed' };
  try {
    const listed = await entry.client.listTools();
    entry.tools = listed.tools.length;
    return { ok: true, status: 'connected', tools: listed.tools.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    entry.lastError = msg;
    return { ok: false, error: msg };
  }
}

/** Chat recovery: re-run an already-registered server. Never gated — the
 * server command was approved at install time; this only reconnects it. */
export function createMcpRestartTool(_opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'restart_mcp_server',
    description:
      'Reconnect an MCP server that is erroring or stale (Settings shows "Connection closed" or 0 tools). ' +
      'Call with the server name, then retry the failed tool. Do NOT call install_mcp_server for an already-registered server.',
    parameters: z.object({
      name: z.string().describe('Registered server name, e.g. wayfind-arc'),
    }),
    execute: async (args: { name: string }) => {
      const res = await restartMcpServer(args.name);
      if (!res.ok) return `Restart of "${args.name}" failed: ${res.error}.`;
      return `MCP server "${args.name}" reconnected (${res.tools} tools) — retry the failed tool now.`;
    },
    needsApproval: async () => false,
  });
}

/** Per-run registry snapshot for the system prompt — the model sees what is
 * already installed, so it uses tools instead of re-installing. */
export function mcpCatalogPrompt(): string {
  const servers = listMcpServers().filter((s) => s.isActive);
  if (servers.length === 0) return ' No MCP servers registered.';
  const lines = servers.map(
    (s) => `- ${s.name} (${s.type}, ${s.tools} tool${s.tools === 1 ? '' : 's'}${s.status === 'error' ? `, ERROR: ${s.lastError ?? 'connection failed'}` : ''})`,
  );
  const base =
    ' Registered MCP servers (already installed — use their <name>_<tool> tools directly, ' +
    'never call install_mcp_server for these; if one errors, call restart_mcp_server):\n' +
    lines.join('\n');
  // P1: recently observed reads ride along so the model trusts them instead
  // of re-fetching the same list/get every turn. Fresh ~10 min; any write on
  // a server already evicted its entries.
  const facts = recentMcpReads();
  if (facts.length === 0) return base;
  const factLines = facts.map(
    (f) => `- ${f.server}.${f.tool}(${f.args}) [${f.ageSec}s ago] → ${f.text.slice(0, 300)}`,
  );
  return base + '\nAlready observed (fresh — do NOT re-fetch these, use the values):\n' + factLines.join('\n');
}

export interface McpCandidate {
  name: string;
  command?: string[];
  url?: string;
  /** Env/header key names the server needs (values unknown). */
  envKeys: string[];
  /** Skill file the candidate was extracted from. */
  source: string;
}

/** ${VAR} placeholders inside config values. */
function placeholderKeys(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/\$\{([A-Za-z0-9_]+)\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function candidateFromConfig(name: string, cfg: McpServerConfig & { args?: unknown }, source: string, skillDir: string): McpCandidate | null {
  if (!MCP_NAME_RE.test(name)) return null;
  const command = normalizeCommand(cfg.command, cfg.args);
  const hasUrl = typeof cfg.url === 'string' && cfg.url.length > 0;
  if (!command && !hasUrl) return null;
  // Local-path rule: resolve relative server paths against the skill dir —
  // `npm install -g` output never runs on the computer.
  const resolved = command?.map((el) => {
    if (el.startsWith('./') || el.startsWith('../')) return resolve(skillDir, el);
    if (/^[^/\s]+\.(m?js|cjs)$/.test(el) && existsSync(join(skillDir, el))) return join(skillDir, el);
    return el;
  });
  const envKeys = [
    ...Object.keys(hasUrl ? (cfg.headers ?? {}) : (serverEnv(cfg) ?? {})),
    ...Object.values(hasUrl ? (cfg.headers ?? {}) : (serverEnv(cfg) ?? {})).flatMap((v) =>
      typeof v === 'string' ? placeholderKeys(v) : [],
    ),
  ].filter((k, i, a) => a.indexOf(k) === i);
  return { name, command: resolved, url: hasUrl ? cfg.url : undefined, envKeys, source };
}

/** Scan an installed skill dir for MCP server references: mcpServers config
 * blocks (json files + ```json fences in markdown), `npm install -g` lines
 * (rewritten to `npx -y`), and `npx -y <pkg>` mentions. Capped at 5. */
export function detectMcpReferences(skillDir: string): McpCandidate[] {
  const found = new Map<string, McpCandidate>();
  const keep = (c: McpCandidate | null, via: 'config' | 'npmg' = 'config') => {
    if (!c || found.size >= 5) return;
    if (via === 'npmg') {
      // Same package already covered by a real config block — skip the dupe.
      const dupe = [...found.values()].some((e) => JSON.stringify(e.command) === JSON.stringify(c.command));
      if (dupe || found.has(c.name)) return;
    } else if (found.has(c.name)) {
      // Prefer the richer candidate (more env keys) regardless of scan order.
      if (c.envKeys.length <= (found.get(c.name)?.envKeys.length ?? 0)) return;
    }
    found.set(c.name, c);
  };
  const files: string[] = [];
  const walk = (dir: string) => {
    if (files.length > 100) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (/\.(json|md)$/.test(e)) files.push(p);
    }
  };
  walk(skillDir);
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = file.slice(skillDir.length + 1);
    if (file.endsWith('.json')) {
      try {
        const parsed = JSON.parse(text) as { mcpServers?: Record<string, McpServerConfig> };
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          for (const [n, cfg] of Object.entries(parsed.mcpServers)) {
            keep(candidateFromConfig(n, cfg, rel, skillDir));
          }
        }
      } catch {
        // Not JSON or not an MCP config — ignore.
      }
    }
    // ``` fences containing mcpServers (whole fence, then parse —
    // nesting-safe, unlike stopping at the first closing brace; any
    // language tag opens so pairing never shifts).
    for (const m of text.matchAll(/```[A-Za-z0-9_-]*\s*\n([\s\S]*?)```/g)) {
      if (!m[1].includes('"mcpServers"')) continue;
      try {
        const parsed = JSON.parse(m[1]) as { mcpServers?: Record<string, McpServerConfig> };
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          for (const [n, cfg] of Object.entries(parsed.mcpServers)) {
            keep(candidateFromConfig(n, cfg, rel, skillDir));
          }
        }
      } catch {
        // Truncated or commented sample — ignore.
      }
    }
    // `npm install -g <pkg>` → never install global; run via npx instead.
    for (const m of text.matchAll(/npm\s+(?:install|i)\s+-g\s+([^\s'"]+)/g)) {
      const pkg = m[1];
      const short = pkg.split('/').pop() ?? pkg;
      keep({ name: short.replace(/^@/, '').replace(/[^A-Za-z0-9_-]/g, '-'), command: ['npx', '-y', pkg], envKeys: [], source: rel }, 'npmg');
    }
  }
  return [...found.values()];
}
