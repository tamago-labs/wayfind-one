// wayfind audit — list the caller's audit trail (newest first).
// Usage: wayfind audit [--conversation <id>] [--limit N]
import { apiBase } from '../auth/client.js';
import { loadToken } from '../sandbox/api.js';

export async function audit(rawArgs) {
  const args = [...rawArgs];
  let conversationId = '';
  let limit = 50;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--conversation' || flag === '--id') conversationId = args.shift() ?? '';
    else if (flag === '--limit' || flag === '-n') limit = Number(args.shift()) || 50;
    else {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }
  }
  const token = await loadToken();
  const qs = new URLSearchParams({ limit: String(limit), ...(conversationId ? { conversationId } : {}) });
  const res = await fetch(`${apiBase()}/audit?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  for (const e of data.events ?? []) {
    console.log(`${e.at ?? '?'}  ${e.actor ?? '?'}  ${e.action ?? '?'}${e.conversationId ? '  ' + String(e.conversationId).slice(0, 8) : ''}${e.detail ? '  ' + JSON.stringify(e.detail).slice(0, 120) : ''}`);
  }
  if (!(data.events ?? []).length) console.log('No audit events.');
}
