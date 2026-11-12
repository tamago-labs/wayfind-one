// Grounded search: Meta web_search exposed as an explicit function tool.
// Hosted grounding only works when Meta serves the request; when the main
// model runs elsewhere (e.g. an open-weights endpoint), the agent calls this
// tool instead. It posts to Meta's Responses API with our key and returns a
// cited answer. Never user keys.
import { tool } from '@openai/agents';
import { z } from 'zod';
import { approvalPolicy, guarded, type GuardOpts } from '../../core/guard.js';
import { metaApiKey } from '../../providers/providers.js';
import { parseMetaUsage, type TokenCounts } from '../../runs/usage.js';

const META_RESPONSES_URL = 'https://api.meta.ai/v1/responses';
const GROUNDING_MODEL = 'muse-spark-1.3';
const TIMEOUT_MS = 90_000;

interface RawAnnotation {
  type?: string;
  url?: string;
  title?: string;
}

function appendSources(text: string, output: unknown): string {
  if (/sources:/i.test(text)) return text;
  const seen = new Set<string>();
  const lines: string[] = [];
  const items = Array.isArray(output) ? output : [];
  for (const item of items) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const annotations = (block as { annotations?: unknown })?.annotations;
      if (!Array.isArray(annotations)) continue;
      for (const a of annotations as RawAnnotation[]) {
        if (a?.type === 'url_citation' && a.url && !seen.has(a.url)) {
          seen.add(a.url);
          lines.push(`- [${a.title ?? a.url}](${a.url})`);
        }
      }
    }
  }
  return lines.length > 0 ? `${text}\n\nSources:\n${lines.join('\n')}` : text;
}

export async function groundedSearch(query: string, onTokens?: (t: TokenCounts | undefined) => void): Promise<string> {
  const key = metaApiKey();
  if (!key) {
    return 'Grounded search is not configured (no Meta API key on the server). Give me a URL and I will fetch it directly.';
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(META_RESPONSES_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: GROUNDING_MODEL,
        input: `${query}\n\nEnd your answer with a 'Sources:' markdown list of the URLs you relied on.`,
        tools: [{ type: 'web_search' }],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`Meta grounded search HTTP ${res.status}: ${detail}`);
    }
    const data = (await res.json()) as { output?: unknown[]; usage?: unknown; error?: { message?: string } };
    if (data.error) throw new Error(`Meta grounded search: ${data.error.message ?? 'unknown error'}`);
    onTokens?.(parseMetaUsage(data));
    const texts: string[] = [];
    for (const item of data.output ?? []) {
      const content = (item as { type?: string; content?: unknown })?.content;
      if ((item as { type?: string })?.type !== 'message' || !Array.isArray(content)) continue;
      for (const block of content) {
        const b = block as { type?: string; text?: string };
        if (b?.type === 'output_text' && b.text) texts.push(b.text);
      }
    }
    const text = texts.join('\n').trim();
    if (!text) return 'Grounded search returned no answer. Try a different query.';
    return appendSources(text, data.output);
  } finally {
    clearTimeout(timer);
  }
}

export function createGroundedSearchTool(opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'grounded_search',
    description:
      'Grounded web search for current or external facts. Returns a cited answer with a Sources list. Use whenever the answer needs live or recent information. Keep its Sources list at the end of your answer.',
    parameters: z.object({
      query: z.string().describe('search question'),
    }),
    execute: guarded(
      'grounded_search',
      (a: { query: string }) => a.query,
      async (a: { query: string }) =>
        groundedSearch(a.query, (tokens) =>
          opts.onUsage?.({
            kind: 'grounded_search',
            unit: 'tokens',
            quantity: (tokens?.input ?? 0) + (tokens?.output ?? 0),
            detail: a.query.slice(0, 120),
            ...(tokens ? { tokens } : {}),
          }),
        ),
      opts,
    ),
    needsApproval: approvalPolicy('grounded_search', (a: { query: string }) => a.query),
  });
}
