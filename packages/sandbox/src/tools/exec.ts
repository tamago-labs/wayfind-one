// exec tool: run a shell command inside the workspace.
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { EXEC_TIMEOUT_MS, MAX_OUTPUT_BYTES, WORKSPACE_DIR } from '../config.js';
import { jail } from '../fsutil.js';
import { HttpError, requireExecAllowed } from '../http.js';

export const name = 'exec';
export const description = 'Run a shell command inside the sandbox workspace.';
export const schema = z.object({
  cmd: z.string(),
  cwd: z.string().optional().describe('Directory inside the workspace (default: root)'),
  timeoutMs: z.number().optional().describe('Kill after this many ms'),
});

export async function run(args: z.infer<typeof schema>) {
  requireExecAllowed('exec');
  const { cmd, cwd: cwdIn, timeoutMs: timeoutIn } = args;
  if (!cmd) throw new HttpError(400, 'cmd is required');
  const cwd = typeof cwdIn === 'string' && cwdIn ? jail(cwdIn).abs : WORKSPACE_DIR;
  const timeoutMs =
    typeof timeoutIn === 'number' && timeoutIn > 0 ? Math.min(timeoutIn, EXEC_TIMEOUT_MS) : EXEC_TIMEOUT_MS;
  return new Promise<{ stdout: string; stderr: string; exit: number; timedOut: boolean }>((resolve) => {
    execFile(
      'sh',
      ['-c', cmd],
      { cwd: cwd ?? WORKSPACE_DIR, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES * 4 },
      (err, stdout, stderr) => {
        const exit = typeof err?.code === 'number' ? err.code : err ? 1 : 0;
        const timedOut = !!err?.killed;
        const cap = (s: string) => (s.length > MAX_OUTPUT_BYTES ? s.slice(0, MAX_OUTPUT_BYTES) : s);
        resolve({ stdout: cap(stdout ?? ''), stderr: cap(stderr ?? ''), exit, timedOut });
      },
    );
  });
}
