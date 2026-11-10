// wayfind status — show the caller's live sandbox session, if any.
import { getSession, loadToken } from '../sandbox/api.js';

export async function status() {
  const token = await loadToken();
  const s = await getSession(token);
  if (!s) {
    console.log('No active sandbox. Run: wayfind run "..."');
    return;
  }
  console.log(`Sandbox ${s.sandboxId}`);
  console.log(`  endpoint:      ${s.endpoint}`);
  console.log(`  provisioned:   ${s.provisionedAt}`);
  console.log(`  last used:     ${s.lastUsedAt ?? '—'}`);
}
