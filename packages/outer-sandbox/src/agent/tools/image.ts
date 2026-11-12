// Image generation + editing via Meta's Muse Image (muse-image-1.0).
// Meta-direct with the shared Meta key (same as grounded search / voice),
// NOT the chat-model endpoint — image models live on api.meta.ai only.
// Single-shot endpoints (OpenAI Images-compatible); flat $0.01 per image,
// billed only on success. Saves bytes under workspace/generated/ and
// returns chat-ready markdown pointing at GET /files/view (inline).
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { PORT, WORKSPACE_DIR } from '../../core/config.js';
import { approvalPolicy, guarded, type GuardOpts } from '../../core/guard.js';
import { metaApiKey } from '../../providers/providers.js';
import { inside } from './paths.js';

const META_IMAGES_URL = 'https://api.meta.ai/v1/images';
const IMAGE_MODEL = 'muse-image-1.0';
const TIMEOUT_MS = 180_000;
const IMAGE_COST_USD = 0.01;

/** Public base the browser uses to reach this server (dev: localhost). */
function publicBase(): string {
  return process.env.AGENT_PUBLIC_URL ?? `http://127.0.0.1:${PORT}`;
}

function viewMarkdown(relPath: string, alt: string): string {
  const url = `${publicBase()}/files/view?path=${encodeURIComponent(relPath)}`;
  return `![${alt}](${url})`;
}

function usageLine(n: number): string {
  return `IMAGE_USAGE images=${n} cost_usd=${(n * IMAGE_COST_USD).toFixed(2)}`;
}

function extFor(format: string): string {
  return format === 'jpeg' ? 'jpg' : format;
}

async function postImages(path: string, body: Record<string, unknown>): Promise<{ b64: string[]; format: string }> {
  const key = metaApiKey();
  if (!key) {
    throw new Error('Image generation is not configured (no Meta API key on the server).');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${META_IMAGES_URL}${path}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: IMAGE_MODEL, ...body }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`Muse Image HTTP ${res.status}: ${detail}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      output_format?: string;
      error?: { message?: string };
    };
    if (data.error) throw new Error(`Muse Image: ${data.error.message ?? 'unknown error'}`);
    const items = data.data ?? [];
    if (items.length === 0) throw new Error('Muse Image returned no images.');
    const b64: string[] = [];
    for (const item of items) {
      if (item.b64_json) {
        b64.push(item.b64_json);
      } else if (item.url) {
        const img = await fetch(item.url, { signal: ctrl.signal });
        if (!img.ok) throw new Error(`Muse Image signed URL fetch failed: HTTP ${img.status}`);
        b64.push(Buffer.from(await img.arrayBuffer()).toString('base64'));
      }
    }
    return { b64, format: data.output_format ?? 'png' };
  } finally {
    clearTimeout(timer);
  }
}

function saveGenerated(b64: string, format: string, stem: string): string {
  const rel = `generated/${stem}.${extFor(format)}`;
  const full = inside(rel);
  mkdirSync(`${WORKSPACE_DIR}/generated`, { recursive: true });
  writeFileSync(full, Buffer.from(b64, 'base64'));
  return rel;
}

function stemOf(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `img-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function createImageTools(opts: GuardOpts): Array<ReturnType<typeof tool>> {
  const generate = tool({
    name: 'generate_image',
    description:
      'Generate an image from a text description with Meta Muse Image. Square 1024x1024 by default. ' +
      'Use whenever the user asks for a picture, illustration, logo draft, or visual. ' +
      'The image is saved to the workspace and shown in chat automatically — just briefly say what you made.',
    parameters: z.object({
      prompt: z.string().describe('Detailed image description (subject, style, mood, colors)'),
      size: z
        .string()
        .optional()
        .describe('WxH aspect hint, e.g. "1024x1024" square (default), "1536x1024" landscape, "1024x1536" portrait'),
    }),
    execute: guarded(
      'generate_image',
      (a: { prompt: string }) => a.prompt.slice(0, 120),
      async (a: { prompt: string; size?: string }) => {
        const { b64, format } = await postImages('/generations', {
          prompt: a.prompt,
          n: 1,
          size: a.size ?? '1024x1024',
          output_format: 'png',
          reasoning_strength: 'low',
        });
        opts.onUsage?.({ kind: 'image', unit: 'images', quantity: b64.length, detail: a.prompt.slice(0, 120) });
        const rel = saveGenerated(b64[0], format, stemOf());
        opts.onFileSaved?.(rel);
        return `${viewMarkdown(rel, a.prompt.slice(0, 80))}\n\nSaved to ${rel}. ${usageLine(1)}`;
      },
      opts,
    ),
    needsApproval: approvalPolicy('generate_image', (a: { prompt: string }) => a.prompt.slice(0, 120)),
  });

  const edit = tool({
    name: 'edit_image',
    description:
      'Edit a workspace image (a generated image or a Library file) with a text instruction, e.g. "make it night". ' +
      'Pass the workspace-relative path. The edited copy is saved alongside the original and shown in chat.',
    parameters: z.object({
      image_path: z.string().describe('Workspace-relative path of the source image'),
      prompt: z.string().describe('What to change, keeping the rest intact'),
    }),
    execute: guarded(
      'edit_image',
      (a: { image_path: string }) => a.image_path,
      async (a: { image_path: string; prompt: string }) => {
        const full = inside(a.image_path);
        let stat: ReturnType<typeof statSync> | null = null;
        try {
          stat = statSync(full);
        } catch {
          stat = null;
        }
        if (!stat || stat.isDirectory()) throw new Error(`Not an image file: ${a.image_path}`);
        if (stat.size > 10 * 1024 * 1024) throw new Error('Source image too large (10MB max).');
        const buf = readFileSync(full);
        const ext = a.image_path.split('.').pop()?.toLowerCase() ?? 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
        const { b64, format } = await postImages('/edits', {
          prompt: a.prompt,
          images: [{ image_url: `data:${mime};base64,${buf.toString('base64')}` }],
          n: 1,
          reasoning_strength: 'low',
        });
        opts.onUsage?.({ kind: 'image', unit: 'images', quantity: b64.length, detail: `edit ${a.image_path}` });
        const rel = saveGenerated(b64[0], format, `${stemOf()}-edit`);
        opts.onFileSaved?.(rel);
        return `${viewMarkdown(rel, a.prompt.slice(0, 80))}\n\nSaved to ${rel} (edited from ${a.image_path}). ${usageLine(1)}`;
      },
      opts,
    ),
    needsApproval: approvalPolicy('edit_image', (a: { image_path: string }) => a.image_path),
  });

  return [generate, edit];
}
