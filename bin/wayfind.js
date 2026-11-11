#!/usr/bin/env node
// wayfind CLI entry — P0: login/logout/start-guard. Sandbox sessions land next.
import { login } from '../src/commands/login.js';
import { logout } from '../src/commands/logout.js';
import { start } from '../src/commands/start.js';
import { run } from '../src/commands/run.js';
import { status } from '../src/commands/status.js';
import { stop } from '../src/commands/stop.js';
import { exportFiles } from '../src/commands/export.js';
import { verify } from '../src/commands/verify.js';

const [, , cmd, ...rest] = process.argv;

if (cmd === 'login') {
  await login();
} else if (cmd === 'logout') {
  await logout();
} else if (cmd === 'run') {
  await run(rest);
} else if (cmd === 'status') {
  await status();
} else if (cmd === 'stop') {
  await stop();
} else if (cmd === 'export') {
  await exportFiles(rest);
} else if (cmd === 'verify') {
  await verify(rest);
} else if (cmd === 'start' || cmd === undefined) {
  await start();
} else {
  console.error(`Unknown command: ${cmd}`);
  console.error('Usage: wayfind [login|logout|run|status|stop|export|verify|start]');
  process.exit(1);
}
