// wayfind policy — view and set the caller's execution policy.
// Usage: wayfind policy [show]
//        wayfind policy set --level none|standard|verified_inference [--models a,b] [--max-ttl seconds]
import { apiBase } from '../auth/client.js';
import { loadToken } from '../sandbox/api.js';

async function call(method, path, body) {
  const token = await loadToken();
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  return data;
}

export async function policy(rawArgs) {
  const args = [...rawArgs];
  if (args[0] !== 'set') {
    const out = await call('GET', '/policy');
    console.log(JSON.stringify(out.policy, null, 2));
    return;
  }
  args.shift();
  const body = {};
  while (args.length) {
    const flag = args.shift();
    if (flag === '--level') body.mandatoryLevel = args.shift();
    else if (flag === '--models') body.allowedModels = (args.shift() ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (flag === '--max-ttl') body.maxIdleTtlSeconds = Number(args.shift());
    else {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }
  }
  const out = await call('PUT', '/policy', body);
  console.log(JSON.stringify(out.policy, null, 2));
}
