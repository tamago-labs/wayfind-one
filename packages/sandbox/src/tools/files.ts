// File tools: read, write, edit (read-modify-write), read_enc (sealed pull),
// media read (PDF/image via Meta-direct parsing utility).
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MAX_READ_BYTES } from '../config.js';
import { jail } from '../fsutil.js';
import { HttpError, requireExecAllowed } from '../http.js';
import { getMetaKey, getSessionToken } from '../session.js';
import { deriveWorkspaceKey, sealFile } from './crypto.js';

function doReadRaw(pathIn: unknown) {
  const { abs, rel } = jail(pathIn);
  const st = statSync(abs);
  if (!st.isFile()) throw new HttpError(400, 'not a file');
  if (st.size > MAX_READ_BYTES) throw new HttpError(413, `file too large (${st.size} bytes)`);
  return { path: rel, buf: readFileSync(abs) };
}

function doRead(pathIn: unknown) {
  const cur = doReadRaw(pathIn);
  return { path: cur.path, size: cur.buf.length, content: cur.buf.toString('utf8') };
}

function doWrite(pathIn: unknown, content: unknown) {
  requireExecAllowed('write');
  if (typeof content !== 'string') throw new HttpError(400, 'content is required');
  const { abs, rel } = jail(pathIn);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return { ok: true as const, path: rel, bytes: Buffer.byteLength(content) };
}

export const readTool = {
  name: 'read',
  description: 'Read a file from the sandbox workspace.',
  schema: z.object({ path: z.string().describe('Sandbox-relative path') }),
  run: async (args: { path: string }) => doRead(args.path),
};

export const readEncTool = {
  name: 'read_enc',
  description: 'Read a file sealed for the session key (AES-256-GCM envelope).',
  schema: z.object({ path: z.string().describe('Sandbox-relative path') }),
  run: async (args: { path: string }) => {
    const cur = doReadRaw(args.path);
    const token = getSessionToken();
    if (!token) throw new HttpError(409, 'no session — sealed read needs a booted session');
    const env = sealFile(deriveWorkspaceKey(token), cur.path, cur.buf);
    return { path: cur.path, size: cur.buf.length, ...env };
  },
};

export const writeTool = {
  name: 'write',
  description: 'Write a file into the sandbox workspace (creates parent dirs).',
  schema: z.object({ path: z.string().describe('Sandbox-relative path'), content: z.string() }),
  run: async (args: { path: string; content: string }) => doWrite(args.path, args.content),
};

export const editTool = {
  name: 'edit',
  description: 'Replace the first occurrence of oldText with newText in a sandbox file.',
  schema: z.object({ path: z.string(), oldText: z.string(), newText: z.string() }),
  run: async (args: { path: string; oldText: string; newText: string }) => {
    const cur = doRead(args.path);
    if (!cur.content.includes(args.oldText)) throw new HttpError(400, 'oldText not found');
    return doWrite(args.path, cur.content.replace(args.oldText, args.newText));
  },
};

/** Non-attested parse record: anything the Meta parsing utility touched.
 * Surfaced in bot_evidence so receipts distinguish attested inference from
 * utility parsing. The inference pin (near-ai only) is untouched. */
export interface ParseRecord {
  path: string;
  kind: 'meta-pdf' | 'meta-image';
  chars: number;
  attested: false;
}

export const parseLog: ParseRecord[] = [];

export function clearParseLog(): void {
  parseLog.length = 0;
}

const META_RESPONSES_URL = 'https://api.meta.ai/v1/responses';
const READER_MODEL = 'muse-spark-1.3';
const META_TIMEOUT_MS = 120_000;

/** Max chars kept per parsed file in workspace context. */
const MAX_MEDIA_CHARS = 12_000;

const IMAGE_EXTS = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

/** Document parsing via the Meta utility (same endpoint/shape as the outer
 * read_file). Text + layout + vision/OCR — the offline fallback can't do
 * scanned pages. NON-ATTESTED by design: recorded in the parse log, never
 * part of the inference attestation chain. */
async function metaRead(buf: Buffer, mime: string, name: string, kind: ParseRecord['kind']): Promise<string> {
  const key = getMetaKey();
  if (!key) {
    throw new HttpError(503, 'document parsing is not configured for this sandbox (no Meta utility key injected)');
  }
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  const fileBlock =
    kind === 'meta-pdf'
      ? { type: 'input_file', filename: name, file_data: dataUrl }
      : { type: 'input_image', image_url: dataUrl };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS);
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
              { type: 'input_text', text: `Extract all text content from this document (${name}) in detail, preserving structure.` },
              fileBlock,
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new HttpError(502, `document parse failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { output?: unknown[]; error?: { message?: string } };
    if (data.error) throw new HttpError(502, `document parse failed: ${data.error.message ?? 'unknown'}`);
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
    if (!text) throw new HttpError(502, 'document parse returned no text');
    const out = text.slice(0, MAX_MEDIA_CHARS);
    parseLog.push({ path: name, kind, chars: out.length, attested: false });
    return out;
  } finally {
    clearTimeout(timer);
  }
}

export const pdfTool = {
  name: 'pdf_text',
  description: 'Extract text from a PDF in the sandbox workspace (bank statements, reports) via the Meta parsing utility (non-attested). Read-only — allowed in every profile.',
  schema: z.object({ path: z.string().describe('Sandbox-relative PDF path') }),
  run: async (args: { path: string }) => {
    if (!/\.pdf$/i.test(args.path)) throw new HttpError(400, 'not a PDF (path must end .pdf)');
    const out = await metaReadFile(args.path);
    if (!out || out.kind !== 'meta-pdf') throw new HttpError(400, 'not a PDF (path must end .pdf)');
    return { path: out.rel, chars: out.text.length, text: out.text };
  },
};

export const imageTool = {
  name: 'image_text',
  description: 'Describe an image in the sandbox workspace via the Meta parsing utility (non-attested). Read-only — allowed in every profile.',
  schema: z.object({ path: z.string().describe('Sandbox-relative image path (png/jpg/gif/webp)') }),
  run: async (args: { path: string }) => {
    if (!/\.(png|jpe?g|gif|webp)$/i.test(args.path)) throw new HttpError(400, 'not a supported image (png/jpg/gif/webp)');
    const out = await metaReadFile(args.path);
    if (!out || out.kind !== 'meta-image') throw new HttpError(400, 'not a supported image (png/jpg/gif/webp)');
    return { path: out.rel, chars: out.text.length, text: out.text };
  },
};

/** Read + parse a media file for any caller (tool or workspace context).
 * Returns null for unsupported types (caller decides skip vs error). */
export async function metaReadFile(relIn: string): Promise<{ rel: string; kind: 'meta-pdf' | 'meta-image'; text: string } | null> {
  const { abs, rel } = jail(relIn);
  const st = statSync(abs);
  if (!st.isFile()) throw new HttpError(400, 'not a file');
  if (st.size > MAX_READ_BYTES) throw new HttpError(413, `file too large (${st.size} bytes)`);
  const i = rel.lastIndexOf('.');
  const ext = (i >= 0 ? rel.slice(i) : '').toLowerCase();
  const name = rel.split('/').pop() ?? 'file';
  if (ext === '.pdf') {
    return { rel, kind: 'meta-pdf', text: await metaRead(readFileSync(abs), 'application/pdf', name, 'meta-pdf') };
  }
  const mime = IMAGE_EXTS.get(ext);
  if (!mime) return null;
  return { rel, kind: 'meta-image', text: await metaRead(readFileSync(abs), mime, name, 'meta-image') };
}
