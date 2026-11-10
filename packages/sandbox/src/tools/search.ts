// Search tools: glob (name match) + grep (content match).
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MAX_GLOB_MATCHES, MAX_GREP_MATCHES, MAX_READ_BYTES, WORKSPACE_DIR } from '../config.js';
import { globToRegExp, jail, walk } from '../fsutil.js';
import { HttpError } from '../http.js';

export const globTool = {
  name: 'glob',
  description: 'List sandbox files matching a glob.',
  schema: z.object({
    pattern: z.string().describe('e.g. **/*.ts'),
    root: z.string().optional().describe('Sandbox-relative root'),
  }),
  run: async (args: { pattern: string; root?: string }) => {
    if (!args.pattern) throw new HttpError(400, 'pattern is required');
    const base = args.root ? jail(args.root).abs : WORKSPACE_DIR;
    const files: string[] = [];
    walk(base, files);
    const re = globToRegExp(args.pattern);
    return { matches: files.filter((f) => re.test(f)).slice(0, MAX_GLOB_MATCHES) };
  },
};

export const grepTool = {
  name: 'grep',
  description: 'Search sandbox file contents with a regex.',
  schema: z.object({
    pattern: z.string(),
    flags: z.string().optional().describe('RegExp flags subset, e.g. "i"'),
    root: z.string().optional(),
    include: z.string().optional().describe('Glob filter, e.g. "*.ts"'),
  }),
  run: async (args: { pattern: string; flags?: string; root?: string; include?: string }) => {
    if (!args.pattern) throw new HttpError(400, 'pattern is required');
    const flags = (args.flags ?? '').replace(/[^gimsuy]/g, '');
    let re: RegExp;
    try {
      re = new RegExp(args.pattern, flags.includes('g') ? flags : flags + 'g');
    } catch {
      throw new HttpError(400, 'invalid regex');
    }
    const base = args.root ? jail(args.root).abs : WORKSPACE_DIR;
    const incRe = args.include ? globToRegExp(args.include) : null;
    const files: string[] = [];
    walk(base, files);
    const matches: Array<{ file: string; line: number; text: string }> = [];
    for (const f of files) {
      if (matches.length >= MAX_GREP_MATCHES) break;
      if (incRe && !incRe.test(f)) continue;
      const abs = path.join(base, f);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.size > MAX_READ_BYTES) continue;
      let content: string;
      try {
        content = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (content.includes('\0')) continue; // binary
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        if (re.test(lines[i])) {
          matches.push({ file: f, line: i + 1, text: lines[i].slice(0, 1000) });
          if (matches.length >= MAX_GREP_MATCHES) break;
        }
      }
    }
    return { matches };
  },
};
