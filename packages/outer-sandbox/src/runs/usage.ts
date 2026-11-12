// Usage metering: every completed run emits a usage event (logged + kept on
// the run), and every metered tool call emits its own event immediately
// (works for parked runs too). If WAYFIND_API_URL is set, events are also
// POSTed to POST /runs/:id/usage (run id = backend run id via TASK_RUN_ID).
// Observe-only: metering never blocks. Token-level cost accounting for
// priced models lands here via costPer1M; unknown rates stay tracked
// (quantities) but unpriced (no spendUsd).
import { GROUNDED_SEARCH_USD_EACH, IMAGE_USD_EACH, VOICE_USD_PER_SEC, type UsageKind, type UsageUnit } from '../usage/prices.js';

export type { UsageKind, UsageUnit };

export interface TokenCounts {
  input: number;
  output: number;
}

export interface UsageEvent {
  runId: string;
  model: string;
  /** Which metered call this event covers. Defaults to 'chat'. */
  kind?: UsageKind;
  /** What `quantity` counts in. Defaults to 'calls'. */
  unit?: UsageUnit;
  /** Amount in `unit` (images, seconds, calls, tokens). */
  quantity?: number;
  provider?: string;
  durationMs: number;
  outputChars: number;
  toolCalls: number;
  tokens?: TokenCounts;
  /** $/1M tokens from providers.json. */
  costPer1M?: { input: number; output: number };
  /** Computed when a price is known (images, or tokens + rates). */
  spendUsd?: number;
  /** Cognito sub threaded through from POST /task. Absent locally. */
  userId?: string;
  at: string;
}

export async function reportUsage(usage: UsageEvent): Promise<UsageEvent> {
  usage.kind ??= 'chat';
  usage.unit ??= usage.kind === 'chat' ? 'chars' : 'calls';
  if (usage.kind === 'image' && typeof usage.quantity === 'number') {
    usage.spendUsd = usage.quantity * IMAGE_USD_EACH;
  } else if (usage.kind === 'voice' && typeof usage.quantity === 'number') {
    // Billed whole seconds, rounded down — quantity keeps 0.1s precision.
    usage.spendUsd = Math.floor(usage.quantity) * VOICE_USD_PER_SEC;
  } else if (usage.tokens && usage.costPer1M) {
    usage.spendUsd =
      (usage.tokens.input * usage.costPer1M.input + usage.tokens.output * usage.costPer1M.output) / 1_000_000;
    if (usage.kind === 'grounded_search') {
      // One usage event = one web_search query: $2.50/1k queries on top.
      usage.spendUsd += GROUNDED_SEARCH_USD_EACH;
    }
  } else if (usage.kind === 'grounded_search') {
    // Query happened but no token counts — price the query alone.
    usage.spendUsd = GROUNDED_SEARCH_USD_EACH;
  }
  console.log(`[usage] ${JSON.stringify(usage)}`);
  const base = process.env.WAYFIND_API_URL;
  if (!base) return usage;
  const usageToken = process.env.USAGE_TOKEN;
  try {
    const res = await fetch(`${base}/runs/${usage.runId}/usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(usageToken ? { 'X-computer-usage-token': usageToken } : {}),
      },
      body: JSON.stringify(usage),
    });
    if (!res.ok) {
      console.error(`[usage] post failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  } catch (err) {
    console.error('[usage] post failed:', err instanceof Error ? err.message : err);
  }
  return usage;
}

/** Sum input/output tokens across SDK rawResponses usage entries. */
export function sumResponseTokens(raw: unknown): TokenCounts | undefined {
  const responses = Array.isArray(raw) ? raw : [];
  let input = 0;
  let output = 0;
  let found = false;
  for (const r of responses) {
    const u = (r as { usage?: { inputTokens?: number; outputTokens?: number } })?.usage;
    if (typeof u?.inputTokens === 'number' || typeof u?.outputTokens === 'number') {
      input += u.inputTokens ?? 0;
      output += u.outputTokens ?? 0;
      found = true;
    }
  }
  return found ? { input, output } : undefined;
}

/** Parse Meta Responses-API `usage: {input_tokens, output_tokens}`. */
export function parseMetaUsage(data: unknown): TokenCounts | undefined {
  const u = (data as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
  if (typeof u?.input_tokens === 'number' || typeof u?.output_tokens === 'number') {
    return { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 };
  }
  return undefined;
}
