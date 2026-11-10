#!/usr/bin/env node
// wayfind CLI entry — P0: login/logout/start-guard. Sandbox sessions land next.
import { login } from '../src/commands/login.js';
import { logout } from '../src/commands/logout.js';
import { start } from '../src/commands/start.js';

const [, , cmd] = process.argv;

if (cmd === 'login') {
  await login();
} else if (cmd === 'logout') {
  await logout();
} else if (cmd === 'start' || cmd === undefined) {
  await start();
} else {
  console.error(`Unknown command: ${cmd}`);
  console.error('Usage: wayfind [login|logout|start]');
  process.exit(1);
}
