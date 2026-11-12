// File reader: give the agent eyes on workspace files. Images and PDFs
// are sent to Meta-direct muse-spark-1.3 (documented image + PDF support:
// PDFs arrive as extracted text + first-50 page renders) while main chat
// stays on the Modal open-weights model. Same Meta key as grounded search
// and voice. Text files are read locally — no API call needed.
import { readFileSync, statSync } from 'node:fs';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { approvalPolicy, guarded, type GuardOpts } from '../../core/guard.js';
import { metaApiKey } from '../../providers/providers.js';
import { parseMetaUsage, type TokenCounts } from '../../runs/usage.js';
import { inside } from './paths.js';

const META_RESPONSES_URL = 'https://api.meta.ai/v1/responses';
const READER_MODEL = 'muse-spark-1.3';
const TIMEOUT_MS = 120_000;
const MAX_BYTES = 50 * 1000 * 1000;

const IMAGE_EXTS = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i).toLowerCase() : '';
}

export async function readWorkspaceFile(relPath: string, question?: string, onTokens?: (t: TokenCounts | undefined) => void): Promise<string> {
  const full = inside(relPath);
  let stat: ReturnType<typeof statSync> | null = null;
  try {
    stat = statSync(full);
  } catch {
    stat = null;
  }
  if (!stat || stat.isDirectory()) throw new Error(`Not a file: ${relPath}`);
  if (stat.size > MAX_BYTES) throw new Error(`File too large (${stat.size} bytes, 50MB max): ${relPath}`);
  const ext = extOf(relPath);
  // Plain text never leaves the machine.
  if (!IMAGE_EXTS.has(ext) && ext !== '.pdf' && ext !== '.txt' && ext !== '.md' && ext !== '.json') {
    throw new Error(`Unsupported file type for reading: ${relPath || '(no extension)'}`);
  }
  if (ext === '.txt' || ext === '.md' || ext === '.json') {
    const text = readFileSync(full, 'utf8');
    return text.length > 30_000 ? `${text.slice(0, 30_000)}\n…(truncated)` : text;
  }
  const key = metaApiKey();
  if (!key) {
    return 'File reading is not configured (no Meta API key on the server). Describe the file and I will work from that.';
  }
  const buf = readFileSync(full);
  const mime = ext === '.pdf' ? 'application/pdf' : (IMAGE_EXTS.get(ext) ?? 'image/png');
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  const fileBlock =
    ext === '.pdf'
      ? { type: 'input_file', filename: relPath.split('/').pop() ?? 'document.pdf', file_data: dataUrl }
      : { type: 'input_image', image_url: dataUrl };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(META_RESPONSES_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: READER_MODEL,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: question ?? `Describe this file (${relPath}) in detail.` },
              fileBlock,
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new Error(`File reader HTTP ${res.status}: ${detail}`);
    }
    const data = (await res.json()) as { output?: unknown[]; usage?: unknown; error?: { message?: string } };
    if (data.error) throw new Error(`File reader: ${data.error.message ?? 'unknown error'}`);
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
    return text || 'The file reader returned no description. Try a more specific question.';
  } finally {
    clearTimeout(timer);
  }
}

export function createFileReaderTool(opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'read_file',
    description:
      'Look at a workspace file: images (png/jpg/gif/webp) and PDFs are understood visually, text files returned directly. ' +
      'Use when the user names a file in the workspace or Library ("summarize report.pdf", "what is in this screenshot"). ' +
      'Attached chat images arrive in your messages already — reach for this tool for stored files.',
    parameters: z.object({
      path: z.string().describe('Workspace-relative file path, e.g. "report.pdf" or "generated/img-....png"'),
      question: z.string().optional().describe('Focused question about the file; defaults to a full description'),
    }),
    execute: guarded(
      'read_file',
      (a: { path: string }) => a.path,
      async (a: { path: string; question?: string }) => {
        const answer = await readWorkspaceFile(a.path, a.question, (tokens) =>
          opts.onUsage?.({
            kind: 'read_file',
            unit: 'tokens',
            quantity: (tokens?.input ?? 0) + (tokens?.output ?? 0),
            detail: a.path,
            ...(tokens ? { tokens } : {}),
          }),
        );
        return `${answer}\n\nFILE_USAGE file=${a.path}`;
      },
      opts,
    ),
    needsApproval: approvalPolicy('read_file', (a: { path: string }) => a.path),
  });
}
