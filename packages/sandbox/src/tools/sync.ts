// Sync tools: push files in (Option A), list workspace manifest out.
// The harness diffs by sha256 and pulls changed files via read_enc.
// sync_in accepts sealed envelopes {path, sha256, nonce, data} (current)
// or legacy plaintext {path, contentBase64} (old CLIs during rollout).
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MAX_LIST_ENTRIES, MAX_SYNC_FILES, WORKSPACE_DIR } from '../config.js';
import { jail, sha256File, walk } from '../fsutil.js';
import { HttpError } from '../http.js';
import { getSessionToken } from '../session.js';
import { deriveWorkspaceKey, openFile } from './crypto.js';

const sealedFile = z.object({
  path: z.string(),
  sha256: z.string(),
  nonce: z.string(),
  data: z.string(),
});
const legacyFile = z.object({ path: z.string(), contentBase64: z.string() });

export const syncInTool = {
  name: 'sync_in',
  description: 'Push files into the sandbox workspace (sealed envelopes preferred).',
  schema: z.object({
    files: z.array(z.union([sealedFile, legacyFile])),
  }),
  run: async (args: { files: Array<Record<string, unknown>> }) => {
    if (!Array.isArray(args.files)) throw new HttpError(400, 'files[] is required');
    if (args.files.length > MAX_SYNC_FILES) throw new HttpError(413, 'too many files');
    let wrote = 0;
    for (const f of args.files) {
      if (typeof f?.path !== 'string') throw new HttpError(400, 'each file needs path');
      const { abs } = jail(f.path);
      mkdirSync(path.dirname(abs), { recursive: true });
      if (typeof f.contentBase64 === 'string') {
        writeFileSync(abs, Buffer.from(f.contentBase64, 'base64'));
      } else {
        const token = getSessionToken();
        if (!token) throw new HttpError(409, 'no session — sealed push needs a booted session');
        const plaintext = openFile(deriveWorkspaceKey(token), f.path, f);
        writeFileSync(abs, plaintext);
      }
      wrote++;
    }
    return { ok: true as const, wrote };
  },
};

export const syncOutTool = {
  name: 'sync_out',
  description: 'List sandbox workspace files with sha256 (client diffs, then reads changed files).',
  schema: z.object({}),
  run: async () => {
    const files: string[] = [];
    walk(WORKSPACE_DIR, files);
    const manifest = files.slice(0, MAX_LIST_ENTRIES).map((f) => {
      const abs = path.join(WORKSPACE_DIR, f);
      let st;
      try {
        st = statSync(abs);
      } catch {
        return null;
      }
      return { path: f, size: st.size, mtimeMs: st.mtimeMs, sha256: sha256File(abs) };
    });
    return { files: manifest.filter(Boolean) };
  },
};
