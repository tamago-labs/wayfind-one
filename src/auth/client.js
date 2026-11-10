// Wayfind Cloud API client for the CLI (no dependencies, global fetch).
import os from 'node:os';
import { execFile } from 'node:child_process';

const DEFAULT_API_URL =
  'https://td4dfiwfkmwp32gyqfzxb7axly0kbrwg.lambda-url.ap-southeast-1.on.aws';

export function apiBase() {
  return (process.env.WAYFIND_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '');
}

async function post(path, body, token) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  return data;
}

async function get(path, token) {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  return data;
}

export const deviceName = () => {
  const host = os.hostname().slice(0, 40);
  return `CLI on ${host}`;
};

export async function requestCode() {
  return post('/auth/device', { deviceName: deviceName() });
}

export async function pollForToken(code, { intervalMs = 3000, timeoutMs = 10 * 60_000, onTick } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await post('/auth/device/poll', { code });
    if (res.status === 'approved' && res.token) return res;
    if (res.status === 'approved' && !res.token) {
      throw new Error('Code was already claimed by another session. Run login again.');
    }
    if (res.status === 'denied') throw new Error('Login denied on the approval page.');
    if (res.status === 'expired') throw new Error('Code expired. Run login again.');
    if (Date.now() > deadline) throw new Error('Timed out waiting for approval.');
    onTick?.(res);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Returns { userId, email, via } or throws when the token is invalid. */
export async function validate(token) {
  return get('/auth/me', token);
}

export async function revokeSelf(token) {
  return post('/auth/revoke', {}, token);
}

export function openBrowser(url) {
  const platform = process.platform;
  const opener = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  return new Promise((resolve) => {
    execFile(opener, args, (err) => resolve(!err));
  });
}
