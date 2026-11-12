// Web tools, opencode-style: `webfetch` (keyless page fetch → markdown,
// like opencode's turndown flow) and `websearch` (Exa REST search; needs
// EXA_API_KEY in env or the keystore, graceful message without one).
// Hosted provider search (webSearchTool) is NOT used — it only works on
// OpenAI's Responses API and fails on third-party endpoints.
import TurndownService from 'turndown';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { approvalPolicy, guarded, type GuardOpts } from '../../core/guard.js';
import { drawKey } from '../../providers/keystore.js';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB, opencode parity
const FETCH_TIMEOUT_MS = 30_000;
const EXA_SEARCH_URL = 'https://api.exa.ai/search';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'meta', 'link', 'noscript']);

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

async function fetchPage(url: string, format: 'text' | 'markdown' | 'html'): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        Accept: 'text/markdown, text/html, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_RESPONSE_SIZE) throw new Error(`page exceeds 5MB (${buf.length} bytes)`);
    const body = buf.toString('utf8');
    if (format === 'html') return body.length > 60_000 ? body.slice(0, 60_000) + '\n…(truncated)' : body;
    if (format === 'text') {
      const text = stripHtml(body);
      return text.length > 60_000 ? text.slice(0, 60_000) + '\n…(truncated)' : text;
    }
    const md = turndown.turndown(body);
    return md.length > 60_000 ? md.slice(0, 60_000) + '\n…(truncated)' : md;
  } finally {
    clearTimeout(timer);
  }
}

function exaKey(): string | null {
  return process.env.EXA_API_KEY ?? drawKey('EXA_API_KEY');
}

export function hasSearchKey(): boolean {
  return exaKey() !== null;
}

interface ExaResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  text?: string;
}

async function exaSearch(query: string, numResults: number): Promise<string> {
  const key = exaKey();
  if (!key) {
    return 'Web search is not configured: no EXA_API_KEY in env or keystore. Ask the owner to add one (`wayfind keys set EXA_API_KEY <key>`), or give me a URL and I will fetch it directly.';
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(EXA_SEARCH_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        query,
        numResults: Math.min(Math.max(numResults, 1), 10),
        type: 'auto',
        livecrawl: 'fallback',
        contents: { text: { maxCharacters: 3000 } },
      }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Exa rejected the API key (401/403)');
    if (!res.ok) throw new Error(`Exa HTTP ${res.status}`);
    const data = (await res.json()) as { results?: ExaResult[] };
    const results = data.results ?? [];
    if (results.length === 0) return 'No search results found. Try a different query.';
    return results
      .map((r, i) => {
        const snippet = (r.text ?? '').slice(0, 600);
        return `${i + 1}. ${r.title ?? '(no title)'}\n   ${r.url ?? ''}${r.publishedDate ? ` (${r.publishedDate})` : ''}\n   ${snippet}`;
      })
      .join('\n\n');
  } finally {
    clearTimeout(timer);
  }
}

export function createWebTools(opts: GuardOpts): Array<ReturnType<typeof tool>> {
  const webfetch = tool({
    name: 'webfetch',
    description:
      'Fetch a web page and return its content as markdown (default), text, or html. Use for reading docs, articles, and pages the user links.',
    parameters: z.object({
      url: z.string().describe('http(s) URL to fetch'),
      format: z.enum(['text', 'markdown', 'html']).optional().describe('return format (default markdown)'),
    }),
    execute: guarded(
      'webfetch',
      (a: { url: string }) => a.url,
      async (a: { url: string; format?: 'text' | 'markdown' | 'html' }) => {
        if (!a.url.startsWith('http://') && !a.url.startsWith('https://')) {
          throw new Error('URL must start with http:// or https://');
        }
        return fetchPage(a.url, a.format ?? 'markdown');
      },
      opts,
    ),
    needsApproval: approvalPolicy('webfetch', (a: { url: string }) => a.url),
  });

  const websearch = tool({
    name: 'websearch',
    description:
      'Explicit web search (Exa) returning titles, URLs, and snippets. Use when you need a raw result list; built-in grounded search already runs automatically for current or external facts. Needs an EXA_API_KEY to run.',
    parameters: z.object({
      query: z.string().describe('search query'),
      numResults: z.number().optional().describe('number of results (default 8, max 10)'),
    }),
    execute: guarded(
      'websearch',
      (a: { query: string }) => a.query,
      async (a: { query: string; numResults?: number }) => {
        const out = await exaSearch(a.query, a.numResults ?? 8);
        // Only billable calls count — missing-key fallbacks never hit Exa.
        if (hasSearchKey() && !out.startsWith('No search results')) {
          opts.onUsage?.({ kind: 'websearch', unit: 'calls', quantity: 1, detail: a.query.slice(0, 120) });
        }
        return out;
      },
      opts,
    ),
    needsApproval: approvalPolicy('websearch', (a: { query: string }) => a.query),
  });

  return [webfetch, websearch];
}
