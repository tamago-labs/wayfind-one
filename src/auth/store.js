// Credential storage: ~/.wayfind/credentials.json, 0600.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = path.join(os.homedir(), '.wayfind');
const FILE = path.join(DIR, 'credentials.json');

export async function loadCredentials() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token !== 'string' || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds) {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(FILE, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
  // chmod covers pre-existing files (writeFile mode only applies on create).
  try {
    await fs.chmod(FILE, 0o600);
  } catch { /* best-effort (Windows ACLs) */ }
}

export async function clearCredentials() {
  try {
    await fs.rm(FILE, { force: true });
  } catch { /* already gone */ }
}
