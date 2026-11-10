// Sync tools: push files in (Option A), list workspace manifest out.
// The harness diffs by sha256 and pulls changed files via read.
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MAX_LIST_ENTRIES, MAX_SYNC_FILES, WORKSPACE_DIR } from '../config.js';
import { jail, sha256File, walk } from '../fsutil.js';
import { HttpError } from '../http.js';

export const syncInTool = {
  name: 'sync_in',
  description: 'Push files into the sandbox workspace.',
  schema: z.object({
    files: z.array(z.object({ path: z.string(), contentBase64: z.string() })),
  }),
  run: async (args: { files: Array<{ path?: unknown; contentBase64?: unknown }> }) => {
    if (!Array.isArray(args.files)) throw new HttpError(400, 'files[] is required');
    if (args.files.length > MAX_SYNC_FILES) throw new HttpError(413, 'too many files');
    let wrote = 0;
    for (const f of args.files) {
      if (typeof f?.path !== 'string' || typeof f?.contentBase64 !== 'string') {
        throw new HttpError(400, 'each file needs path + contentBase64');
      }
      const { abs } = jail(f.path);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, Buffer.from(f.contentBase64, 'base64'));
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
