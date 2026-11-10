// File tools: read, write, edit (read-modify-write).
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MAX_READ_BYTES } from '../config.js';
import { jail } from '../fsutil.js';
import { HttpError } from '../http.js';

function doRead(pathIn: unknown) {
  const { abs, rel } = jail(pathIn);
  const st = statSync(abs);
  if (!st.isFile()) throw new HttpError(400, 'not a file');
  if (st.size > MAX_READ_BYTES) throw new HttpError(413, `file too large (${st.size} bytes)`);
  return { path: rel, size: st.size, content: readFileSync(abs, 'utf8') };
}

function doWrite(pathIn: unknown, content: unknown) {
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
