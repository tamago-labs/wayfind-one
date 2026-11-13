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

/** List the caller's conversations (metadata + receipts, no bearers/keys). */
export async function listConversations(token) {
  const res = await fetch(`${apiBase()}/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  return data.conversations ?? [];
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

/** Control-plane proxy to the caller's ONE outer computer (same path the
 * website uses). kind=one_outer routes past any classic computer. */
async function computerProxy(token, path) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${apiBase()}/computer/proxy${path}${sep}kind=one_outer`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  return data;
}

/** Live inner sandbox sessions on the outer computer. */
export async function listInnerSandboxes(token) {
  const out = await computerProxy(token, '/sandboxes');
  return out.sandboxes ?? [];
}

/** Closed-run evidence summaries (task titles, no transcripts). */
export async function listInnerEvidence(token) {
  const out = await computerProxy(token, '/team/evidence');
  return out.evidence ?? [];
}

/** Full stored evidence bundle for one closed sandbox (receipt + transcript). */
export async function fetchInnerEvidence(token, sandboxId) {
  const out = await computerProxy(token, `/team/evidence/${encodeURIComponent(sandboxId)}`);
  return out.evidence ?? null;
}
