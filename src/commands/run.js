// wayfind run -- one-shot disposable sandbox execution (warm reuse by default).
// resolve session → push workspace → exec → pull diff → terminate (always).
// Usage: wayfind run [--dir <path>] [--ttl <sec>] [--no-pull] [--fresh] -- <cmd...>
//        wayfind run "echo hi"
import path from 'node:path';
import { loadToken, provision, relay, terminate } from '../sandbox/api.js';
import { pull, push } from '../sandbox/sync.js';

export async function run(rawArgs) {
  const args = [...rawArgs];
  let dir = process.cwd();
  let ttl = 1800;
  let doPull = true;
  let reuse = true;
  while (args[0]?.startsWith('--')) {
    const flag = args.shift();
    if (flag === '--dir') dir = path.resolve(args.shift() ?? dir);
    else if (flag === '--ttl') ttl = Math.min(28_800, Math.max(300, Number(args.shift()) || ttl));
    else if (flag === '--no-pull') doPull = false;
    else if (flag === '--fresh') reuse = false;
    else if (flag === '--') break;
    else {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }
  }
  const cmd = args.join(' ').trim();
  if (!cmd) {
    console.error('Usage: wayfind run [--dir <path>] [--ttl <sec>] [--no-pull] -- <command>');
    process.exit(1);
  }

  const token = await loadToken();
  console.log(`Provisioning sandbox (workspace: ${dir})…`);
  const session = await provision(token, ttl, reuse);
  console.log(`Sandbox ${session.sandboxId} ready${session.reused ? ' (warm reuse)' : ''}.`);
  let exitCode = 0;
  try {
    const pushed = await push(token, session, dir);
    console.log(`Pushed ${pushed.pushed}/${pushed.total} files (skipped ${pushed.skipped} unchanged).`);
    const out = await relay(token, session, 'exec', { cmd });
    if (out.stdout) process.stdout.write(out.stdout);
    if (out.stderr) process.stderr.write(out.stderr);
    if (out.timedOut) console.error('\n[wayfind] command timed out.');
    exitCode = out.exit ?? 0;
    if (doPull) {
      const pulled = await pull(token, session, dir);
      console.log(`[wayfind] pulled ${pulled.pulled}/${pulled.total} files.`);
    }
  } finally {
    try {
      await terminate(token, session);
      console.log('Sandbox terminated.');
    } catch (err) {
      console.error(`Terminate failed (may still bill — check console): ${err.message}`);
      exitCode = exitCode || 1;
    }
  }
  process.exit(exitCode);
}
