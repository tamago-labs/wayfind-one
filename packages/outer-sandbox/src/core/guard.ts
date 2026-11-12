// Shared tool guard: permission check (allow/deny) + doom-loop guard
// (3x identical tool+target in one run → stop). Runs in an
// AsyncLocalStorage context so concurrent server runs stay isolated.
//
// Approvals use the SDK-native path: tools declare `needsApproval` via
// approvalPolicy() below, the run pauses with `interruptions`, and resume
// goes through RunState (see runs/runner.ts). `guarded()` only enforces
// allow/deny inside execute — asks are decided before execute ever runs.
import { AsyncLocalStorage } from 'node:async_hooks';
import { check, loadRules, type Action, type Rule } from './permissions.js';
import type { TokenCounts, UsageKind, UsageUnit } from '../runs/usage.js';

import { randomUUID } from 'node:crypto';

export interface ApprovalRequest {
  id: string;
  permission: string;
  target: string;
  /** True when auto-allowed in permissive mode — audit only. */
  auto?: boolean;
}

/** A metered tool call (Meta API, Exa, …). Observe-only: reported, never blocked. */
export interface MeteredCall {
  kind: UsageKind;
  unit: UsageUnit;
  quantity: number;
  detail?: string;
  tokens?: TokenCounts;
}

export interface GuardOpts {
  onApproval?: (approval: ApprovalRequest) => void;
  /** Fired by tools after each metered call; the runner reports it. */
  onUsage?: (call: MeteredCall) => void;
  /** Fired by tools when they save a workspace file chat should show
   * (generated/edited images). The runner appends markdown for any the
   * model failed to echo, so images never silently land only on disk. */
  onFileSaved?: (relPath: string) => void;
  /** Per-bot skill allowlist. Undefined = all installed skills enabled; [] = none. */
  allowedSkills?: string[];
  /** Per-bot MCP allowlist. Undefined = all active servers enabled; [] = none. */
  allowedMcp?: string[];
  /** Cognito sub of the run owner (metering + schedule attribution). */
  ownerId?: string;
  /** Conversation scope = frontend Bot id (schedule attribution). */
  conversationId?: string;
  /** Frontend-known backend base (local dev can reach the deployed API). */
  apiUrl?: string;
  /** User JWT (local dev): forwarded to backend-authed agent tools. Never logged. */
  userToken?: string;
}

interface RunCtx {
  runId: string;
  /** Child (task) runs act under the parent's delegation grant. */
  child: boolean;
}

const runStore = new AsyncLocalStorage<RunCtx>();
const callLogs = new Map<string, Array<{ tool: string; target: string }>>;

/**
 * Per-run approval grants: approving once auto-passes the same
 * permission+target for the rest of that run. Scoped to the run — a new
 * run asks again. Cleared with the call log in clearRunLog().
 */
const runGrants = new Map<string, Set<string>>();
const grantKey = (permission: string, target: string): string => `${permission}::${target}`;
export function grantForRun(runId: string, permission: string, target: string): void {
  const grants = runGrants.get(runId) ?? new Set<string>();
  grants.add(grantKey(permission, target));
  runGrants.set(runId, grants);
}

function hasGrant(runId: string, permission: string, target: string): boolean {
  const grants = runGrants.get(runId);
  if (!grants) return false;
  // Exact grant, or a run-scoped blanket grant (permission + '*' —
  // set by "allow all for this run"; never persisted to rules).
  return grants.has(grantKey(permission, target)) || grants.has(grantKey(permission, '*'));
}

/** Default: enforcing — asks park until approved. Set
 * PERMISSION_MODE=permissive to auto-allow asks (audit-logged). */
export function permissionMode(): 'permissive' | 'enforcing' {
  return process.env.PERMISSION_MODE === 'permissive' ? 'permissive' : 'enforcing';
}

function wildcard(pattern: string, value: string): boolean {
  const rx = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return rx.test(value);
}

export function decide(rules: Rule[], permission: string, target: string): Action {
  return check(rules, permission, target);
}

/**
 * Read-only tools never interrupt: listing, searching, or reading files
 * cannot mutate anything, so asking per call is pure friction (a dozen
 * cards for one "find my pictures" request). Explicit `deny` rules still
 * hold — guarded() throws in execute.
 */
const READ_ONLY = new Set(['list', 'glob', 'read', 'grep', 'webfetch', 'websearch', 'grounded_search']);

/**
 * Allowed by default, no card: image generation/editing costs $0.01 per
 * image and every call logs an IMAGE_USAGE line in the transcript for
 * later billing. Explicit `deny` rules still hold — guarded() throws in
 * execute.
 */
const FREE_ALLOW = new Set(['generate_image', 'edit_image', 'read_file']);

/**
 * Workspace-local writes never interrupt: `write`/`edit` are confined to
 * the workspace by inside() — reversible, user-visible files. Asking per
 * CSV or note file is pure friction (a dozen cards for one import job).
 * External mutations (MCP writes, sends, API posts) still ask. Explicit
 * `deny` rules still hold — guarded() throws in execute.
 */
const LOCAL_WRITE = new Set(['write', 'edit']);

/** Read-like MCP tool names: list/get/fetch…elay — idempotent server-side
 * reads that must never interrupt. Conservative on purpose: anything not
 * matching still asks, so a misnamed write can only ever over-ask. */
const MCP_READ_RE = /(^|_)(list|get|fetch|find|search|show|describe|view|check|count|query)(_|$)/i;

/** True when an MCP tool name is a read (see MCP_READ_RE). Shared by the
 * approval gate and the read cache so they can never disagree. */
export function isMcpReadTool(toolName: string): boolean {
  return MCP_READ_RE.test(toolName);
}

/**
 * SDK `needsApproval` policy for a tool: interrupt only when the rules say
 * "ask" AND the server runs in enforcing mode. Child runs inherit the
 * parent's delegation grant (the `task` spawn itself was already gated).
 * `opts.isRead` marks per-call reads (MCP list/get/fetch…) — those skip
 * the card unless explicitly denied, same as READ_ONLY builtins.
 */
export function approvalPolicy<TArgs>(
  permission: string,
  targetOf: (args: TArgs) => string,
  opts?: { isRead?: (input: TArgs) => boolean },
): (_ctx: unknown, input: TArgs) => Promise<boolean> {
  return async (_ctx: unknown, input: TArgs) => {
    if (runStore.getStore()?.child) return false;
    if (permissionMode() !== 'enforcing') return false;
    const target = targetOf(input);
    // Already approved this run — don't park again.
    if (hasGrant(runStore.getStore()?.runId ?? '', permission, target)) return false;
    const action = decide(loadRules(), permission, target);
    if (
      (READ_ONLY.has(permission) || FREE_ALLOW.has(permission) || LOCAL_WRITE.has(permission) || opts?.isRead?.(input)) &&
      action !== 'deny'
    )
      return false;
    return action === 'ask';
  };
}

export function runWithContext<T>(runId: string, child: boolean, fn: () => T): T {
  return runStore.run({ runId, child }, fn);
}

/** Wrap a tool execute with permission + doom-loop checks. */
export function guarded<TArgs, TResult>(
  permission: string,
  targetOf: (args: TArgs) => string,
  execute: (args: TArgs) => Promise<TResult>,
  opts: GuardOpts,
): (args: TArgs) => Promise<TResult> {
  const rules = loadRules();
  return async (args: TArgs) => {
    const target = targetOf(args);
    const action = decide(rules, permission, target);
    if (action === 'deny') {
      throw new Error(`Denied by policy: ${permission} "${target}"`);
    }
    if (action === 'ask') {
      // Audit only. The SDK interruption flow (needsApproval) is the sole
      // enforcer in enforcing mode — reaching execute means this call was
      // approved (fresh resume, per-run grant, or auto). Permissive mode auto-allows.
      const ctxRunId = runStore.getStore()?.runId ?? 'cli';
      if (!hasGrant(ctxRunId, permission, target)) {
        opts.onApproval?.({ id: randomUUID(), permission, target, auto: permissionMode() === 'permissive' });
      }
    }
    const runId = runStore.getStore()?.runId ?? 'cli';
    const log = callLogs.get(runId) ?? [];
    log.push({ tool: permission, target });
    callLogs.set(runId, log);
    const last3 = log.slice(-3);
    if (last3.length === 3 && last3.every((c) => c.tool === permission && c.target === target)) {
      throw new Error(`Doom-loop guard: ${permission} "${target}" called 3x identically — stopping.`);
    }
    return execute(args);
  };
}

export function clearRunLog(runId: string): void {
  callLogs.delete(runId);
  runGrants.delete(runId);
}

export function toolCallCount(runId: string): number {
  return callLogs.get(runId)?.length ?? 0;
}
