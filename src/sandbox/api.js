// wayfind-api sandbox client for the CLI. Auth: CliToken from
// ~/.wayfind/credentials.json (same login as `wayfind login`).
import { apiBase } from '../auth/client.js';
import { loadCredentials } from '../auth/store.js';

export async function loadToken() {
  const creds = await loadCredentials();
  if (!creds) {
    console.error('Not logged in. Run: npm run login');
    process.exit(1);
  }
  return creds.token;
}

async function api(path, body, token) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  return data;
}

export async function provision(token, idleTtlSeconds = 1800, reuse = false) {
  const out = await api('/sandbox/provision', { idleTtlSeconds, reuse }, token);
  if (!out?.sandboxId || !out?.sessionToken) throw new Error('provision returned no session');
  return out;
}

export async function getSession(token) {
  const res = await fetch(`${apiBase()}/sandbox/session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  return data.session ?? null;
}

export async function terminate(token, session) {
  // No ids → terminates the caller's live session (row-resolved).
  return api('/sandbox/terminate', session ? {
    sandboxId: session.sandboxId,
    sessionToken: session.sessionToken,
  } : {}, token);
}

/** Relay a call to the exec agent. The server resolves the caller's live
 * session — no ids needed (explicit session overrides when given). */
export async function relay(token, session, sub, body) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (session) {
    headers['X-Sandbox-Id'] = session.sandboxId;
    headers['X-Sandbox-Token'] = session.sessionToken;
  }
  const res = await fetch(`${apiBase()}/sandbox/proxy/${sub}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `sandbox ${sub} failed (${res.status})`);
  return data;
}
