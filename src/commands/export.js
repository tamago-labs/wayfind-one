// wayfind export — pull the live session's workspace back locally.
// Usage: wayfind export [--dir <path>] (defaults to cwd).
import path from 'node:path';
import { getSession, loadToken } from '../sandbox/api.js';
import { pull } from '../sandbox/sync.js';

export async function exportFiles(rawArgs) {
  const args = [...rawArgs];
  let dir = process.cwd();
  while (args[0]?.startsWith('--')) {
    const flag = args.shift();
    if (flag === '--dir') dir = path.resolve(args.shift() ?? dir);
    else {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }
  }
  const token = await loadToken();
  const session = await getSession(token);
  if (!session) {
    console.error('No active sandbox. Nothing to export — run something first.');
    process.exit(1);
  }
  const out = await pull(token, null, dir);
  console.log(`Exported ${out.pulled}/${out.total} files to ${dir} (skipped ${out.skipped} unchanged).`);
}
